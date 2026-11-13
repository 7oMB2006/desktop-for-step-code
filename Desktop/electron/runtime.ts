import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

export class JsonLines {
  private decoder = new StringDecoder('utf8');
  private fragments: string[] = [];
  private recordChars = 0;
  constructor(private receive: (value: any) => void, private maxRecordChars = 32 * 1024 * 1024) {}
  push(chunk: Buffer) {
    const decoded = this.decoder.write(chunk);
    let start = 0;
    // Scan each stdout fragment once; rescanning an accumulated history is quadratic.
    while (start < decoded.length) {
      const end = decoded.indexOf('\n', start);
      const fragment = decoded.slice(start, end < 0 ? undefined : end);
      this.recordChars += fragment.length;
      if (this.recordChars > this.maxRecordChars) throw new Error(`Runtime record exceeds ${this.maxRecordChars / 1024 / 1024} MiB`);
      this.fragments.push(fragment);
      if (end < 0) break;
      const line = this.fragments.join('').trim();
      this.fragments = [];
      this.recordChars = 0;
      start = end + 1;
      if (!line) continue;
      let value: unknown;
      try { value = JSON.parse(line); } catch { throw new Error('Invalid runtime JSONL'); }
      this.receive(value);
    }
  }
}

export function isolatedEnvironment(root: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (/^(STEP|PI_|AI_AGENT|ELECTRON_|NODE_OPTIONS|NODE_PATH|NODE_COMPILE_CACHE|DFSC_(?:HOST|LAUNCH|RUNTIME_HOST)_)/i.test(key) || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(key)) delete env[key];
  }
  return { ...env, STEPCODE_ENTRYPOINT: '1', STEPCODE_STORAGE_ROOT_DIR: root, STEP_CODING_AGENT_DIR: `${root}/agent`, STEP_CODING_AGENT_SESSION_DIR: `${root}/sessions`, STEPCODE_AUTH_PATH: `${root}/auth.json`, STEPCODE_LEGACY_AUTH_PATH: `${root}/legacy-auth.json`, STEPCODE_DISABLE_PI_SERVICES: '1', STEP_CLIENT: 'desktop-for-step-code' };
}

/**
 * Stderr tail for diagnostics, with credential-bearing lines removed.
 * Upstream diagnostics can echo environment values, so nothing that looks like a
 * secret reaches a file; the tail is bounded so a runaway log cannot bloat it.
 */
const SENSITIVE_LINE = /(api[-_.]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|secret|password|passwd|credential|cookie|authorization|bearer\s+[A-Za-z0-9._-]|['"]?(?:token|apiKey|api_key)['"]?\s*[:=]|^\s*(?:STEP|PI|AI_AGENT)[A-Z0-9_]*\s*=)/i;
function stderrForLog(text: string, lines = 40): string {
  const safe = text.split(/\r?\n/).filter(line => line.trim().length > 0 && !SENSITIVE_LINE.test(line));
  const tail = safe.slice(-lines);
  return tail.length > 0 ? tail.join('\n') : '(no stderr lines passed the redaction filter)';
}

export class RpcCommandError extends Error {
  constructor(message: string, readonly details?: unknown) { super(message); }
}

export class RpcManagementStopError extends Error {
  readonly code = 'management-stop-unconfirmed';
  constructor(message: string, readonly shutdownAcknowledged: boolean, readonly exitConfirmed: boolean) {
    super(message);
    this.name = 'RpcManagementStopError';
  }
}

const powershell = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

export class RpcProcess {
  private child?: ChildProcessWithoutNullStreams;
  private exitedChild?: ChildProcessWithoutNullStreams;
  private runtimePid?: number;
  get pid() { return this.job ? this.runtimePid : this.child?.pid; }
  private stopping?: Promise<void>;
  private stoppingManagement = false;
  private managementStopError?: RpcManagementStopError;
  private managementShutdown?: {
    child: ChildProcessWithoutNullStreams; id: string; acknowledged: boolean;
    finish: (reason?: string) => void;
  };
  private disconnected = false;
  private job?: { name: string; script: string };
  private stderr = '';
  private pending = new Map<string, { resolve: (data: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  get hasPendingRequests() { return this.pending.size > 0; }
  constructor(private event: (value: any) => void, private maxRecordChars?: number, private containTree = false) {}
  start(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) {
    if (this.child || this.stopping || this.managementStopError) throw new Error('Runtime already started or still stopping');
    this.disconnected = false;
    this.exitedChild = undefined;
    this.stderr = '';
    this.runtimePid = undefined;
    this.job = this.containTree && process.platform === 'win32'
      ? { name: `Local\\DFSC-${randomUUID()}`, script: resolve(dirname(entry), '../../../windows-runtime-job.ps1') } : undefined;
    const executable = this.job ? powershell() : node;
    const launchArgs = this.job ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', this.job.script, '-Spec', Buffer.from(JSON.stringify({ job: this.job.name, node,
        args: [entry, '--mode', 'rpc', ...args], cwd }), 'utf8').toString('base64')] : [entry, '--mode', 'rpc', ...args];
    const child = spawn(executable, launchArgs, { cwd, env, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    const decoder = new JsonLines(value => {
      if (this.child !== child) return;
      if (this.job && !this.runtimePid && value?.type === 'dfsc_runtime_job' && value.job === this.job.name
        && Number.isInteger(value.pid) && value.pid > 0) {
        this.runtimePid = value.pid;
        return;
      }
      const shutdown = this.managementShutdown;
      if (shutdown?.child === child && value?.type === 'response' && value.id === shutdown.id) {
        if (value.success === true && value.data?.shutdown === true) shutdown.acknowledged = true;
        else shutdown.finish('Management shutdown was not acknowledged');
        return;
      }
      if (this.disconnected) return;
      if (value.type === 'response') {
        const request = this.pending.get(value.id);
        if (!request) return;
        this.pending.delete(value.id); clearTimeout(request.timer);
        value.success ? request.resolve(value.data) : request.reject(new RpcCommandError(value.error || 'Runtime command failed', value.details));
        return;
      }
      this.event(value);
    }, this.maxRecordChars);
    child.stdin.on('error', error => {
      if (this.child !== child || this.disconnected) return;
      this.fail(error);
      this.event({ type: 'desktop_exit', details: { kind: 'rpc-write', message: error.message } });
      void this.stop().catch(() => {});
    });
    child.stdout.on('data', chunk => {
      if (this.child !== child || this.disconnected && this.managementShutdown?.child !== child) return;
      try { decoder.push(chunk); }
      catch (e) {
        if (this.child !== child) return;
        if (this.managementShutdown?.child === child) {
          this.managementShutdown.finish('Management shutdown protocol failed');
          return;
        }
        this.fail(e as Error);
        this.event({ type: 'desktop_exit', details: { kind: 'rpc-protocol', message: (e as Error).message } });
        void this.stop().catch(() => {});
      }
    });
    // Raw stderr is never relayed to the UI: upstream diagnostics can contain
    // private environment values. A bounded copy is kept for the crash log, and
    // stderrForLog() strips anything credential-shaped before it is written.
    child.stderr.on('data', chunk => { if (this.child === child && !this.disconnected) this.stderr = (this.stderr + chunk.toString()).slice(-16384); });
    child.stderr.resume();
    child.on('error', error => { if (this.child === child && !this.disconnected) this.fail(error); });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      // A final response can still be buffered on stdout when exit is emitted.
      if (this.managementShutdown?.child === child) return;
      this.child = undefined;
      this.runtimePid = undefined;
      this.exitedChild = child;
      if (this.disconnected) return;
      const details = { kind: 'runtime-exit', exitCode: code ?? null, signal: signal ?? null, stderrTail: stderrForLog(this.stderr) };
      const error = new Error(`Runtime exited (${code ?? signal ?? 'unknown'})`) as Error & { details?: Record<string, unknown> };
      error.details = details;
      this.fail(error);
      this.event({ type: 'desktop_exit', code, details });
    });
  }
  request(type: string, args: Record<string, unknown> = {}, timeout = 30000): Promise<any> {
    if (this.disconnected || !this.child?.stdin.writable) return Promise.reject(new Error('Runtime is not connected'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Runtime timed out: ${type}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ ...args, type, id }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  respond(value: Record<string, unknown>) {
    if (this.disconnected || !this.child?.stdin.writable) throw new Error('Runtime is not connected');
    this.child.stdin.write(JSON.stringify({ ...value, type: 'extension_ui_response' }) + '\n');
  }
  private fail(error: Error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  async stop() {
    if (this.stopping) return this.stopping;
    return this.stopProcess(false);
  }
  async stopForUpdate() {
    const child = this.child;
    const job = this.job;
    if (process.platform !== 'win32' || !job || !this.runtimePid || !child?.pid || this.stopping || this.disconnected
      || child.exitCode !== null || child.signalCode !== null) throw new Error('capability:release-unconfirmed');
    await this.stopProcess(false, 5000, true);
  }
  private async verifyJob(job: { name: string; script: string }) {
    await new Promise<void>((resolve, reject) => {
      execFile(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', job.script, '-Verify', job.name], { windowsHide: true, timeout: 15000 },
      error => error ? reject(new Error('capability:release-unconfirmed')) : resolve());
    });
  }
  async stopManagement(timeoutMs = 5000): Promise<void> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      throw new RangeError('Management shutdown timeout must be between 1 and 30000ms');
    if (this.stopping) {
      if (this.stoppingManagement) return this.stopping;
      throw new RpcManagementStopError('Runtime process-tree termination is already in progress', false, false);
    }
    return this.stopProcess(true, timeoutMs);
  }
  private async stopProcess(management: boolean, timeoutMs = 5000, requireTree = false) {
    const child = this.child;
    if (!child) {
      if (!management && this.job && this.exitedChild) {
        await this.verifyJob(this.job);
        this.exitedChild = undefined;
      }
      if (management && (this.managementStopError || this.exitedChild)) {
        const previous = this.managementStopError;
        const error = new RpcManagementStopError(previous?.message ?? 'Management worker exited without shutdown acknowledgment',
          previous?.shutdownAcknowledged ?? false, Boolean(this.exitedChild) || previous?.exitConfirmed === true);
        this.managementStopError = error;
        throw error;
      }
      return;
    }
    this.disconnected = true;
    this.fail(new Error('Runtime stopped'));
    this.stoppingManagement = management;
    this.stopping = (management ? this.terminateManagement(child, timeoutMs) : this.terminate(child, requireTree)).then(async () => {
      if (!management && this.job) await this.verifyJob(this.job);
      if (this.child === child) this.child = undefined;
      this.runtimePid = undefined;
      this.exitedChild = undefined;
      this.managementStopError = undefined;
    }).finally(() => { this.stopping = undefined; this.stoppingManagement = false; });
    return this.stopping;
  }
  private terminateManagement(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout;
      const shutdown = {
        child, id: randomUUID(), acknowledged: false,
        finish: (reason?: string) => {
          if (this.managementShutdown !== shutdown) return;
          clearTimeout(timer);
          child.off('close', closed); child.off('error', failed); child.stdin.off('error', failed);
          this.managementShutdown = undefined;
          if (reason) {
            const error = new RpcManagementStopError(reason, shutdown.acknowledged,
              child.exitCode !== null || child.signalCode !== null);
            this.managementStopError = error;
            reject(error);
          } else resolve();
        },
      };
      const closed = (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.child === child) this.child = undefined;
        shutdown.finish(code !== 0 || signal !== null ? 'Management worker did not exit cleanly'
          : !shutdown.acknowledged ? 'Management worker exited without shutdown acknowledgment' : undefined);
      };
      const failed = () => shutdown.finish('Management shutdown transport failed');
      this.managementShutdown = shutdown;
      child.once('close', closed); child.once('error', failed); child.stdin.once('error', failed);
      timer = setTimeout(() => shutdown.finish('Management shutdown timed out before confirmed cleanup'), timeoutMs);
      if (!child.stdin.writable) { failed(); return; }
      try {
        child.stdin.write(JSON.stringify({ type: 'shutdown', id: shutdown.id }) + '\n', error => {
          if (error) failed();
        });
      } catch { failed(); }
    });
  }
  private async terminate(child: ChildProcessWithoutNullStreams, requireTree = false) {
    if (process.platform === 'win32' && child.pid) {
      const code = await new Promise<number | null>((resolve, reject) => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => reject(new Error('Runtime process-tree termination failed: helper unavailable')));
        killer.on('exit', (code, signal) => {
          if (code === 0 || code === 128 && !requireTree || this.job) resolve(code);
          else reject(new Error(`Runtime process-tree termination failed (${code ?? signal ?? 'unknown'})`));
        });
      });
      // A broken pipe can end the child before taskkill finds it (128).
      // Accept that race only after observing this exact child's exit.
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve, reject) => {
        const exited = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          child.off('exit', exited);
          reject(new Error(code === 0 ? 'Runtime did not exit after process-tree termination'
            : 'Runtime process-tree termination failed (128)'));
        }, 2000);
        child.once('exit', exited);
      });
    } else {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((done, reject) => {
        let timer: NodeJS.Timeout;
        const finish = (error?: Error) => {
          clearTimeout(timer); child.off('exit', exited);
          error ? reject(error) : done();
        };
        const exited = () => finish();
        child.once('exit', exited);
        timer = setTimeout(() => {
          try { child.kill('SIGKILL'); }
          catch (error) { finish(error as Error); return; }
          timer = setTimeout(() => finish(new Error('Runtime did not exit after forced termination')), 2000);
        }, 2000);
        try { child.kill('SIGTERM'); }
        catch (error) { finish(error as Error); }
      });
    }
  }
}
