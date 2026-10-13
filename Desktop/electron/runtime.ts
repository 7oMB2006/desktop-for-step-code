import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { platformPathKey } from '../src/platform-path';

export function runtimeNodePath(root: string, platform: NodeJS.Platform = process.platform): string {
  return join(root, 'node', platform === 'win32' ? 'node.exe' : 'node');
}

export function runtimePathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  return platformPathKey(path, platform);
}

type LinuxProcess = { pid: number; parent: number; session: number; started: string; state: string };
export type LinuxProcessSession = { leader: number; started: string };
async function linuxProcess(pid: number): Promise<LinuxProcess | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // comm is parenthesized and may itself contain spaces or parentheses.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid, parent: Number(fields[1]), session: Number(fields[3]), state: fields[0], started: fields[19] };
  } catch (error: any) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return undefined; throw error; }
}

/** Stop only this owned Linux process and its descendants, including PTY jobs
 * in separate process groups. PID start times prevent signalling reused PIDs. */
export async function terminateLinuxProcessTree(pid: number, timeout = 1500, expectedStart?: string): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('Invalid child process');
  const root = await linuxProcess(pid);
  if (!root || (expectedStart !== undefined && root.started !== expectedStart)) return true;
  const snapshot = await linuxProcesses();
  if ((await linuxProcess(pid))?.started !== root.started) return true;
  const processes: LinuxProcess[] = [];
  const visited = new Set<number>();
  const collect = (entry: LinuxProcess) => {
    if (visited.has(entry.pid)) return;
    visited.add(entry.pid);
    for (const child of snapshot) if (child.parent === entry.pid) collect(child);
    processes.push(entry); // Signal descendants before the parent can exit/reparent them.
  };
  collect(root);
  return terminateLinuxProcesses(processes, timeout);
}

async function linuxProcesses(): Promise<LinuxProcess[]> {
  // /proc/<pid>/task/<tid>/children is optional on some Linux kernels. The
  // process table's parent IDs also cover children created by non-main threads.
  return (await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name))
    .map(name => linuxProcess(Number(name)).catch((error: NodeJS.ErrnoException) => {
      // hidepid can expose directory names but deny another user's stat file.
      // The owned root is read separately and must remain accessible.
      if (error.code === 'EACCES' || error.code === 'EPERM') return undefined;
      throw error;
    })))).filter((entry): entry is LinuxProcess => Boolean(entry));
}

async function terminateLinuxProcesses(processes: LinuxProcess[], timeout: number): Promise<boolean> {
  const live = async (entry: LinuxProcess) => {
    const current = await linuxProcess(entry.pid);
    return current?.started === entry.started && current.state !== 'Z' && current.state !== 'X';
  };
  const signal = async (signal: NodeJS.Signals) => {
    for (const entry of processes) {
      if (!(await live(entry))) continue;
      try { process.kill(entry.pid, signal); }
      catch (error: any) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  const wait = async (milliseconds: number) => {
    const deadline = Date.now() + milliseconds;
    do {
      if (!(await Promise.all(processes.map(live))).some(Boolean)) return true;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    return false;
  };
  await signal('SIGTERM');
  if (await wait(timeout)) return true;
  await signal('SIGKILL');
  return wait(1000);
}

/** Capture only a PTY-owned session leader while it is alive, before accepting input. */
export async function captureLinuxProcessSession(pid: number): Promise<LinuxProcessSession> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('Invalid terminal session');
  const leader = await linuxProcess(pid);
  if (!leader || leader.session !== pid) throw new Error('Could not identify the terminal session');
  return { leader: pid, started: leader.started };
}

/** Jobs can be reparented to init after the PTY shell exits. Its session ID
 * persists until the last member exits. Enumerate and signal individual owned
 * session members; never signal a whole process group or another session.
 * Jobs already reparented AND moved into another session are outside this fallback. */
export async function terminateLinuxProcessSession(session: LinuxProcessSession, timeout = 1500): Promise<boolean> {
  if (!Number.isSafeInteger(session.leader) || session.leader <= 1 || session.leader === process.pid || !/^\d+$/.test(session.started)) {
    throw new Error('Invalid terminal session');
  }
  const leader = await linuxProcess(session.leader);
  if (leader && leader.started !== session.started) return true; // The original session has ended and its PID was reused.
  const members = (await linuxProcesses()).filter(entry => entry.session === session.leader && entry.pid !== process.pid
    && BigInt(entry.started) >= BigInt(session.started));
  return terminateLinuxProcesses(members, timeout);
}

export class JsonLines {
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  constructor(private receive: (value: any) => void) {}
  push(chunk: Buffer) {
    this.buffer += this.decoder.write(chunk);
    if (this.buffer.length > 32 * 1024 * 1024) throw new Error('Runtime record exceeds 32 MiB');
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
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

export class RpcProcess {
  private child?: ChildProcessWithoutNullStreams;
  private stopping?: Promise<void>;
  private stderr = '';
  private pending = new Map<string, { resolve: (data: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  get hasPendingRequests() { return this.pending.size > 0; }
  constructor(private event: (value: any) => void) {}
  start(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) {
    if (this.child || this.stopping) throw new Error('Runtime already started');
    this.stderr = '';
    const child = spawn(node, [entry, '--mode', 'rpc', ...args], { cwd, env, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    const decoder = new JsonLines(value => {
      if (this.child !== child) return;
      if (value.type === 'response' && value.id && this.pending.has(value.id)) {
        const request = this.pending.get(value.id)!; this.pending.delete(value.id); clearTimeout(request.timer);
        value.success ? request.resolve(value.data) : request.reject(new Error(value.error || 'Runtime command failed'));
      } else this.event(value);
    });
    child.stdin.on('error', error => {
      if (this.child !== child) return;
      this.fail(error);
      this.event({ type: 'desktop_exit', details: { kind: 'rpc-write', message: error.message } });
      void this.stop();
    });
    child.stdout.on('data', chunk => {
      try { decoder.push(chunk); }
      catch (e) {
        if (this.child !== child) return;
        this.fail(e as Error);
        this.event({ type: 'desktop_exit', details: { kind: 'rpc-protocol', message: (e as Error).message } });
        void this.stop();
      }
    });
    // Raw stderr is never relayed to the UI: upstream diagnostics can contain
    // private environment values. A bounded copy is kept for the crash log, and
    // stderrForLog() strips anything credential-shaped before it is written.
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-16384); });
    child.stderr.resume();
    child.on('error', error => this.fail(error));
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      const details = { kind: 'runtime-exit', exitCode: code ?? null, signal: signal ?? null, stderrTail: stderrForLog(this.stderr) };
      const error = new Error(`Runtime exited (${code ?? signal ?? 'unknown'})`) as Error & { details?: Record<string, unknown> };
      error.details = details;
      this.fail(error);
      this.event({ type: 'desktop_exit', code, details });
    });
  }
  request(type: string, args: Record<string, unknown> = {}, timeout = 30000): Promise<any> {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('Runtime is not connected'));
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
    if (!this.child?.stdin.writable) throw new Error('Runtime is not connected');
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
    this.child = undefined;
    this.fail(new Error('Runtime stopped'));
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); resolve(); }); killer.on('exit', () => resolve());
      });
    } else if (process.platform === 'linux' && child.pid) {
      this.stopping = terminateLinuxProcessTree(child.pid).then(stopped => {
        if (!stopped) throw new Error('Could not stop the runtime process tree');
      }).catch(error => {
        if (child.exitCode === null && child.signalCode === null) this.child = child;
        throw error;
      }).finally(() => { this.stopping = undefined; });
      await this.stopping;
    } else child.kill();
  }
}
