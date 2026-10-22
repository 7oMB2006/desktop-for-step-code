import { open, realpath, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative, isAbsolute } from 'node:path';
import type { Message } from '../src/contracts';
import { projectWorkflow, preserveWorkflow, workflowIsActive } from '../src/workflow-state';
import type { RuntimeEvent } from '../src/contracts';

type Binding = { runId: string; startedAt: number };
export class WorkflowBindings {
  private writes = new Map<string, Promise<void>>();
  constructor(private directory: string, private report: (error: unknown) => void = () => {}) {}
  private file(sessionId: string) { return join(this.directory, createHash('sha256').update(sessionId).digest('hex') + '.json'); }
  async flush() {
    while (this.writes.size) await Promise.all([...this.writes.values()]);
  }
  async remove(sessionId: string) {
    await this.writes.get(sessionId);
    await rm(this.file(sessionId), { force: true });
  }
  async copyHistory(sourceId: string, targetId: string, messages: Message[]) {
    if (sourceId === targetId) return;
    const source = await this.load(sourceId);
    const calls = new Set(messages.flatMap(message => Array.isArray(message.content)
      ? message.content.filter(block => block.type === 'toolCall' && block.name === 'workflow').map(block => block.id) : []));
    for (const [id, binding] of Object.entries(source)) {
      if (!calls.has(id)) continue;
      this.event(targetId, { type: 'tool_execution_update', toolName: 'workflow', toolCallId: id,
        partialResult: { details: { schemaVersion: 1, status: 'running', runId: binding.runId, startedAt: binding.startedAt } } });
    }
    await this.writes.get(targetId);
  }
  async load(sessionId: string): Promise<Record<string, Binding>> {
    await this.writes.get(sessionId);
    try {
      const data = JSON.parse(await readFile(this.file(sessionId), 'utf8'));
      return data.sessionId === sessionId && data.bindings && typeof data.bindings === 'object' ? data.bindings : {};
    } catch { return {}; }
  }
  event(sessionId: string | undefined, event: RuntimeEvent) {
    if (!sessionId || event.toolName !== 'workflow' || typeof event.toolCallId !== 'string'
      || !['tool_execution_update', 'tool_execution_end'].includes(event.type)) return;
    const value = event.type === 'tool_execution_update' ? event.partialResult : event.result;
    const flow = projectWorkflow(value?.details, event.toolCallId);
    if (!flow?.runId || flow.startedAt === undefined) return;
    const callId = event.toolCallId;
    const previous = this.writes.get(sessionId) ?? Promise.resolve();
    const writing = previous.then(async () => {
      let bindings: Record<string, Binding> = {};
      try {
        const data = JSON.parse(await readFile(this.file(sessionId), 'utf8'));
        if (data.sessionId === sessionId) bindings = data.bindings ?? {};
      } catch {}
      if (Object.hasOwn(bindings, callId) && bindings[callId].runId === flow.runId
        && bindings[callId].startedAt === flow.startedAt) return;
      // IDs are data, not object prototype setters; only the most recent bounded catalog is retained.
      const entries = new Map(Object.entries(bindings));
      entries.set(callId, { runId: flow.runId!, startedAt: flow.startedAt! });
      await mkdir(this.directory, { recursive: true });
      const temporary = this.file(sessionId) + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify({ sessionId, bindings: Object.fromEntries([...entries].slice(-2000)) }), 'utf8');
        await rename(temporary, this.file(sessionId));
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
    }).catch(error => this.report(error));
    this.writes.set(sessionId, writing);
    void writing.finally(() => { if (this.writes.get(sessionId) === writing) this.writes.delete(sessionId); });
  }
}

/** Read only the bounded, runtime-owned progress file; never follow result scriptPath. */
export async function hydrateWorkflowHistory(cwd: string, messages: Message[], bindings: Record<string, Binding> = {}): Promise<Message[]> {
  return Promise.all(messages.map(async message => {
    if (message.desktopImported || message.role !== 'toolResult' || message.toolName !== 'workflow' || !message.toolCallId) return message;
    const current = projectWorkflow(message.details, message.toolCallId);
    const binding = Object.hasOwn(bindings, message.toolCallId) ? bindings[message.toolCallId] : undefined;
    const identity = current ?? (binding && projectWorkflow({ schemaVersion: 1, status: 'running',
      runId: binding.runId, startedAt: binding.startedAt }, message.toolCallId));
    if (!identity?.runId) return message;
    try {
      const root = await realpath(cwd);
      const file = await realpath(join(root, '.stepcode', 'workflows', 'runs', identity.runId, 'progress.json'));
      const rel = relative(root, file);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../')) return message;
      const handle = await open(file, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1024 * 1024) return message;
        const buffer = Buffer.alloc(1024 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 1024 * 1024) return message;
        const saved = projectWorkflow(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')), message.toolCallId);
        if (saved?.runId !== identity.runId || (identity.startedAt !== undefined && saved.startedAt !== identity.startedAt)) return message;
        // An error without structured details cannot replace a bound terminal progress state.
        if (!current && !workflowIsActive(saved.status)) return { ...message, desktopWorkflow: saved };
        return preserveWorkflow({ ...message, desktopWorkflow: saved }, message);
      } finally { await handle.close(); }
    } catch { return preserveWorkflow(undefined, message); }
  }));
}
