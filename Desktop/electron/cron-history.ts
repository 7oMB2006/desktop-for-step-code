import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CronHistoryEntry, RuntimeEvent } from '../src/contracts';
import type { SessionRuntime } from './session-runtimes';
import { normalizedWorkspaceKey } from '../src/workspace-key';

const unresolved = (row: CronHistoryEntry) => row.reviewedAt === undefined
  && ['triggered', 'running', 'waiting', 'unknown'].includes(row.state);

// Small, bounded state transitions only. Never persist prompts, tool output or credentials.
export class CronHistory {
  private active = new Map<string, CronHistoryEntry>();
  private assistantStarted = new Set<string>();
  constructor(private root: string, private now = Date.now) {}
  private file(workspace: string) {
    return join(this.root, createHash('sha256').update(normalizedWorkspaceKey(workspace, process.platform)).digest('hex') + '.json');
  }
  private load(workspace: string): { entries: CronHistoryEntry[]; unconfirmed: boolean } {
    try {
      const bytes = readFileSync(this.file(workspace));
      if (bytes.length > 512000) throw new Error('Invalid Cron history');
      const document = JSON.parse(bytes.toString('utf8'));
      // Legacy arrays have no rotation latch; new writes preserve it atomically with the history.
      if (!Array.isArray(document) && (!document || document.version !== 1 || typeof document.unconfirmed !== 'boolean'))
        throw new Error('Invalid Cron history');
      const rows = Array.isArray(document) ? document : document.entries;
      const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
      if (!Array.isArray(rows) || rows.length > 200 || rows.some(row => !row || typeof row.id !== 'string'
        || !/^[\w-]{1,200}$/.test(row.id) || typeof row.sessionId !== 'string' || !/^[\w-]{1,200}$/.test(row.sessionId)
        || !time(row.at) || !time(row.updatedAt)
        || row.jobId !== undefined && (typeof row.jobId !== 'string' || !/^[\w-]{1,24}$/.test(row.jobId))
        || row.createdAt !== undefined && !time(row.createdAt) || row.reviewedAt !== undefined && !time(row.reviewedAt)
        || row.reason !== undefined && !['startup', 'host-exit'].includes(row.reason)
        || !['triggered', 'running', 'waiting', 'completed', 'failed', 'interrupted', 'unknown',
          'recovered', 'recovery_failed', 'recovery_blocked'].includes(row.state))) throw new Error('Invalid Cron history');
      const live = new Set([...this.active.values()].map(entry => entry.id));
      return { unconfirmed: Array.isArray(document) ? false : document.unconfirmed,
        entries: rows.map(({ id, jobId, createdAt, sessionId, at, updatedAt, state, reason, reviewedAt }) =>
        ({ id, jobId, createdAt, sessionId, at, updatedAt, state:
          !live.has(id) && ['triggered', 'running', 'waiting'].includes(state) ? 'unknown' : state, reason, reviewedAt })) };
    } catch (error: any) {
      if (error.code === 'ENOENT') return { entries: [], unconfirmed: false };
      throw error;
    }
  }
  list(workspace: string): CronHistoryEntry[] {
    return this.load(workspace).entries;
  }
  private persist(workspace: string, entries: CronHistoryEntry[], unconfirmed: boolean) {
    mkdirSync(this.root, { recursive: true });
    const file = this.file(workspace), temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, entries, unconfirmed }), { mode: 0o600 });
    renameSync(temporary, file);
  }
  private write(workspace: string, entry: CronHistoryEntry) {
    const previous = this.load(workspace);
    const rows = previous.entries.filter(row => row.id !== entry.id);
    rows.push(entry);
    const evicted = rows.slice(0, Math.max(0, rows.length - 200));
    this.persist(workspace, rows.slice(-200), previous.unconfirmed || evicted.some(unresolved));
  }
  record(workspace: string, sessionId: string, state: CronHistoryEntry['state'], reason?: CronHistoryEntry['reason']) {
    this.write(workspace, { id: randomUUID(), sessionId, state, reason, at: this.now(), updatedAt: this.now() });
  }
  uncertain(workspace: string) {
    const history = this.load(workspace);
    return history.unconfirmed || history.entries.some(unresolved);
  }
  acknowledge(workspace: string) {
    const entries = this.list(workspace).map(row => row.state === 'unknown' && row.reviewedAt === undefined
      ? { ...row, reviewedAt: this.now() } : row);
    this.persist(workspace, entries, false);
  }
  event(worker: SessionRuntime, event: RuntimeEvent) {
    if (!worker.state?.sessionId) return;
    let entry = this.active.get(worker.id);
    const message = event.message;
    if (event.type === 'message_start' && message?.role === 'custom' && message.customType === 'step-cron' && message.display !== false) {
      if (entry) this.write(worker.cwd, { ...entry, state: 'unknown', updatedAt: this.now() });
      this.assistantStarted.delete(worker.id);
      const details = message.details;
      entry = { id: randomUUID(), sessionId: worker.state.sessionId, state: 'triggered', at: this.now(), updatedAt: this.now(),
        ...(typeof details?.id === 'string' && /^[\w-]{1,24}$/.test(details.id) ? { jobId: details.id } : {}),
        ...(Number.isFinite(details?.createdAt) ? { createdAt: details.createdAt } : {}) };
      this.active.set(worker.id, entry);
      this.write(worker.cwd, entry);
      return;
    }
    if (!entry) return;
    let state: CronHistoryEntry['state'] | undefined;
    if (event.type === 'message_start' && message?.role === 'user') state = 'unknown';
    else if (event.type === 'message_start' && message?.role === 'assistant') {
      this.assistantStarted.add(worker.id);
      state = 'running';
    }
    else if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) state = 'waiting';
    else if (event.type === 'tool_execution_start') state = 'running';
    else if (event.type === 'desktop_exit') state = 'unknown';
    else if (event.type === 'agent_end') {
      const last = worker.messages.at(-1);
      state = worker.interrupted || last?.stopReason === 'aborted' ? 'interrupted'
        : worker.failed || last?.stopReason === 'error' ? 'failed'
        : this.assistantStarted.has(worker.id) && last?.role === 'assistant' && last.stopReason === 'stop' ? 'completed' : 'unknown';
    }
    if (!state) return;
    entry = { ...entry, state, updatedAt: this.now() };
    this.write(worker.cwd, entry);
    if (['completed', 'failed', 'interrupted', 'unknown'].includes(state)) {
      this.active.delete(worker.id);
      this.assistantStarted.delete(worker.id);
    }
    else this.active.set(worker.id, entry);
  }
}
