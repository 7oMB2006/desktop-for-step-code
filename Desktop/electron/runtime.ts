import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

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
  return { ...env, STEPCODE_ENTRYPOINT: '1', STEP_CODING_AGENT_DIR: `${root}/agent`, STEP_CODING_AGENT_SESSION_DIR: `${root}/sessions`, STEPCODE_AUTH_PATH: `${root}/auth.json`, STEPCODE_LEGACY_AUTH_PATH: `${root}/legacy-auth.json`, STEPCODE_DISABLE_PI_SERVICES: '1', STEP_CLIENT: 'desktop-for-step-code' };
}

export class RpcProcess {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (data: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private event: (value: any) => void) {}
  start(node: string, entry: string, cwd: string, env: NodeJS.ProcessEnv) {
    if (this.child) throw new Error('Runtime already started');
    const child = spawn(node, [entry, '--mode', 'rpc'], { cwd, env, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    const decoder = new JsonLines(value => {
      if (value.type === 'response' && value.id && this.pending.has(value.id)) {
        const request = this.pending.get(value.id)!; this.pending.delete(value.id); clearTimeout(request.timer);
        value.success ? request.resolve(value.data) : request.reject(new Error(value.error || 'Runtime command failed'));
      } else this.event(value);
    });
    child.stdout.on('data', chunk => { try { decoder.push(chunk); } catch (e) { this.fail(e as Error); void this.stop(); } });
    // Never relay raw stderr: upstream diagnostics can contain private environment values.
    child.stderr.resume();
    child.on('error', error => this.fail(error));
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.fail(new Error(`Runtime exited (${code ?? signal ?? 'unknown'})`));
      this.event({ type: 'desktop_exit', code });
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
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.fail(new Error('Runtime stopped'));
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); resolve(); }); killer.on('exit', () => resolve());
      });
    } else child.kill();
  }
}
