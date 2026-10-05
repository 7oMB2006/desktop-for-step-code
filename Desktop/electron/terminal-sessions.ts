import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TerminalEvent, TerminalInfo, TerminalSnapshot } from '../src/contracts';
import { terminalEnvironment, terminalInput, terminalSize } from './terminal-policy';

type Entry = { info: TerminalInfo; chunks: { seq: number; data: string }[]; bytes: number; seq: number; child?: ChildProcess; cancel?: () => void; closing?: Promise<void> };
const key = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function taskkill(pid: number): Promise<boolean> {
  return new Promise(resolve => {
    const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const killer = spawn(executable, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const finish = (success: boolean) => { clearTimeout(timer); resolve(success); };
    const timer = setTimeout(() => { killer.kill(); finish(false); }, 3000);
    killer.once('error', () => finish(false));
    killer.once('exit', code => finish(code === 0));
  });
}

export async function terminateTerminalHost(child: ChildProcess, killTree = taskkill, timeout = 3000) {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (!child.pid || exited()) return;
  // A successful taskkill invocation is not itself confirmation that the host exited.
  const stopped = new Promise<boolean>(resolve => {
    const finish = (success: boolean) => {
      clearTimeout(timer); child.removeListener('exit', onExit); resolve(success);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(exited()), timeout);
    child.once('exit', onExit);
  });
  let killed = false;
  try { killed = await killTree(child.pid); } catch {}
  if (!(await stopped) && !exited()) throw new Error(killed ? 'Terminal did not exit after termination' : 'Could not terminate the terminal process tree');
}

export class TerminalSessions {
  private entries = new Map<string, Entry>();
  private numbers = new Map<string, number>();
  private stopping = false;
  private closing = new Set<Promise<void>>();
  constructor(private node: string, private host: string, private emit: (event: TerminalEvent) => void,
    private terminate = terminateTerminalHost) {}
  list(cwd?: string): TerminalSnapshot[] {
    return [...this.entries.values()].filter(entry => cwd === undefined || key(entry.info.cwd) === key(cwd))
      .map(entry => ({ ...entry.info, chunks: [...entry.chunks] }));
  }
  async create(cwd: string, cols = 80, rows = 24): Promise<TerminalSnapshot> {
    if (this.stopping) throw new Error('Terminals are shutting down');
    terminalSize(cols, rows);
    if (this.entries.size >= 24 || this.list(cwd).length >= 8) throw new Error('Terminal limit reached');
    const directory = key(cwd);
    const number = (this.numbers.get(directory) ?? 0) + 1;
    this.numbers.set(directory, number);
    const pwsh = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
    const shell = existsSync(pwsh) ? pwsh : join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const entry: Entry = { info: { id: randomUUID(), cwd, title: `PowerShell ${number}`, status: 'starting', cols, rows }, chunks: [], bytes: 0, seq: 0 };
    this.entries.set(entry.info.id, entry);
    const child = spawn(this.node, [this.host], { cwd, env: terminalEnvironment(process.env),
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    entry.child = child;
    this.emit({ type: 'state', terminal: { ...entry.info } });
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (entry.child !== child || entry.info.status === 'exited') return;
        entry.info.status = 'failed';
        this.emit({ type: 'state', terminal: { ...entry.info } });
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not start the terminal')); }
      };
      const timer = setTimeout(() => { fail(); void this.kill(entry).catch(() => {}); }, 15000);
      entry.cancel = () => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error('Terminal was closed')); }
      };
      child.on('message', (message: any) => {
        if (entry.child !== child || entry.closing) return;
        if (message.type === 'ready') {
          entry.info.status = 'running';
          child.send({ type: 'resize', cols: entry.info.cols, rows: entry.info.rows });
          this.emit({ type: 'state', terminal: { ...entry.info } });
          if (!settled) { settled = true; clearTimeout(timer); resolve({ ...entry.info, chunks: [...entry.chunks] }); }
        } else if (message.type === 'data' && typeof message.data === 'string' && Number.isSafeInteger(message.seq) && message.seq > entry.seq) {
          entry.seq = message.seq;
          entry.chunks.push({ seq: message.seq, data: message.data });
          entry.bytes += Buffer.byteLength(message.data);
          while (entry.bytes > 512 * 1024 && entry.chunks.length > 1)
            entry.bytes -= Buffer.byteLength(entry.chunks.shift()!.data);
          this.emit({ type: 'data', id: entry.info.id, seq: message.seq, data: message.data });
        } else if (message.type === 'exit') {
          entry.info.status = 'exited'; entry.info.exitCode = Number.isInteger(message.exitCode) ? message.exitCode : undefined;
          this.emit({ type: 'state', terminal: { ...entry.info } });
        } else if (message.type === 'failed') fail();
      });
      child.on('error', fail);
      child.on('exit', () => {
        if (entry.child !== child) return;
        clearTimeout(timer);
        if (!entry.closing && entry.info.status !== 'exited') fail();
        entry.child = undefined;
      });
      child.send({ type: 'start', shell, cwd, cols, rows });
    });
  }
  private require(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Unknown terminal');
    return entry;
  }
  write(id: string, data: unknown) {
    const entry = this.require(id);
    const value = terminalInput(data);
    if (entry.closing || entry.info.status !== 'running' || !entry.child?.connected) throw new Error('Terminal is not running');
    entry.child.send({ type: 'write', data: value });
  }
  resize(id: string, cols: unknown, rows: unknown) {
    const entry = this.require(id);
    Object.assign(entry.info, terminalSize(cols, rows));
    if (entry.info.status === 'running' && entry.child?.connected) entry.child.send({ type: 'resize', cols, rows });
  }
  ack(id: string, seq: unknown) {
    const entry = this.require(id);
    if (!Number.isSafeInteger(seq) || (seq as number) < 0 || (seq as number) > entry.seq) throw new Error('Invalid terminal acknowledgement');
    if (entry.child?.connected) entry.child.send({ type: 'ack', seq });
  }
  async close(id: string) {
    const entry = this.require(id);
    if (entry.closing) return entry.closing;
    const operation = this.kill(entry).then(() => {
      this.entries.delete(id);
      this.emit({ type: 'closed', id });
    }).catch(error => {
      entry.info.status = 'failed';
      this.emit({ type: 'state', terminal: { ...entry.info } });
      throw error;
    }).finally(() => { this.closing.delete(operation); entry.closing = undefined; });
    entry.closing = operation;
    this.closing.add(operation);
    return operation;
  }
  private async kill(entry: Entry) {
    entry.cancel?.();
    entry.cancel = undefined;
    const child = entry.child;
    if (!child) return;
    await this.terminate(child);
    entry.child = undefined;
  }
  async stopAll() {
    this.stopping = true;
    try {
      await Promise.all([...this.entries.keys()].map(id => this.close(id)));
      await Promise.all([...this.closing]);
    } catch (error) {
      await Promise.allSettled([...this.closing]);
      this.stopping = false;
      throw error;
    }
  }
}
