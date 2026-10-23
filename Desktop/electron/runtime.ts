import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
    if (/^(STEP|PI_|AI_AGENT|ELECTRON_|NODE_OPTIONS|NODE_PATH)/i.test(key) || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|COOKIE)$/i.test(key)) delete env[key];
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

export class RpcCommandError extends Error {}

export class RpcProcess {
  private child?: ChildProcessWithoutNullStreams;
  private stopping?: Promise<void>;
  private disconnected = false;
  private stderr = '';
  private pending = new Map<string, { resolve: (data: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  get hasPendingRequests() { return this.pending.size > 0; }
  constructor(private event: (value: any) => void, private maxRecordChars?: number) {}
  start(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) {
    if (this.child || this.stopping) throw new Error('Runtime already started or still stopping');
    this.disconnected = false;
    this.stderr = '';
    const child = spawn(node, [entry, '--mode', 'rpc', ...args], { cwd, env, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    const decoder = new JsonLines(value => {
      if (this.child !== child || this.disconnected) return;
      if (value.type === 'response' && value.id && this.pending.has(value.id)) {
        const request = this.pending.get(value.id)!; this.pending.delete(value.id); clearTimeout(request.timer);
        value.success ? request.resolve(value.data) : request.reject(new RpcCommandError(value.error || 'Runtime command failed'));
      } else this.event(value);
    }, this.maxRecordChars);
    child.stdin.on('error', error => {
      if (this.child !== child || this.disconnected) return;
      this.fail(error);
      this.event({ type: 'desktop_exit', details: { kind: 'rpc-write', message: error.message } });
      void this.stop().catch(() => {});
    });
    child.stdout.on('data', chunk => {
      if (this.child !== child || this.disconnected) return;
      try { decoder.push(chunk); }
      catch (e) {
        if (this.child !== child) return;
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
      this.child = undefined;
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
    const child = this.child;
    if (!child) return;
    this.disconnected = true;
    this.fail(new Error('Runtime stopped'));
    this.stopping = this.terminate(child).then(() => {
      if (this.child === child) this.child = undefined;
    }).finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
  private async terminate(child: ChildProcessWithoutNullStreams) {
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); resolve(); }); killer.on('exit', () => resolve());
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
