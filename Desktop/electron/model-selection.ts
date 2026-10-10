import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message, Model, ModelChange, ModelSelection } from '../src/contracts';
import type { SessionRuntime } from './session-runtimes';

const sameModel = (a?: Model, b?: Model) => a?.id === b?.id && a?.provider === b?.provider;
const identity = ({ id, provider, name }: Model) => ({ id, provider, name: name || id });
type ChangeSet = { changes: ModelChange[]; awaiting?: { from: ModelChange['from']; to: ModelChange['to']; promptHash?: string } };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function modelThinkingLevels(model: Model): string[] {
  if (model.thinkingLevels) return model.thinkingLevels;
  if (!model.reasoning) return ['off'];
  const map = (model as Model & { thinkingLevelMap?: Record<string, unknown> }).thinkingLevelMap;
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].filter(level =>
    map?.[level] !== null && (!['xhigh', 'max'].includes(level) || map?.[level] !== undefined));
}

// Client observations live in sidecars, not Step's transcript or model context.
export class ModelSelections {
  private records = new Map<string, ChangeSet>();
  private loading = new Map<string, Promise<ChangeSet>>();
  private writes: Promise<void> = Promise.resolve();
  constructor(private root: string, private changed: (worker: SessionRuntime) => void,
    private onError: (error: unknown) => void = () => {}) {}
  private file(id: string) { return join(this.root, `${createHash('sha256').update(id).digest('hex')}.json`); }
  async load(id: string): Promise<ChangeSet> {
    if (this.records.has(id)) return this.records.get(id)!;
    if (this.loading.has(id)) return this.loading.get(id)!;
    const loading = (async () => {
      let record: ChangeSet = { changes: [] };
      try {
        const value = JSON.parse(await readFile(this.file(id), 'utf8'));
        const validModel = (model: Model) => model && ['id', 'provider', 'name'].every(key =>
          typeof model[key as keyof Model] === 'string' && String(model[key as keyof Model]).length <= 300);
        if (Array.isArray(value.changes)) record.changes = value.changes.filter((change: ModelChange) =>
          typeof change?.id === 'string' && Number.isFinite(change.userTimestamp) && validModel(change.from) && validModel(change.to));
        if (validModel(value.awaiting?.from) && validModel(value.awaiting?.to)) record.awaiting = value.awaiting;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError(error); }
      this.records.set(id, record);
      return record;
    })();
    this.loading.set(id, loading);
    try { return await loading; } finally { this.loading.delete(id); }
  }
  changes(worker: SessionRuntime) { return this.records.get(worker.state?.sessionId ?? '')?.changes ?? []; }
  selection(worker: SessionRuntime) { return worker.pendingModel; }
  select(worker: SessionRuntime, model: Model, thinkingLevel?: string) {
    const levels = modelThinkingLevels(model);
    const level = thinkingLevel ?? worker.pendingModel?.thinkingLevel ?? worker.state?.thinkingLevel;
    const selection: ModelSelection = { model, thinkingLevel: levels.includes(level!) ? level : levels[0] };
    worker.pendingModel = sameModel(selection.model, worker.state?.model)
      && selection.thinkingLevel === worker.state?.thinkingLevel ? undefined : selection;
    this.changed(worker);
  }
  selectEffort(worker: SessionRuntime, level: string) {
    const model = worker.pendingModel?.model ?? worker.models.find(model => sameModel(model, worker.state?.model)) ?? worker.state?.model;
    if (!model || !modelThinkingLevels(model).includes(level)) throw new Error('Unsupported thinking level');
    this.select(worker, model, level);
  }
  async apply(worker: SessionRuntime) {
    if (!worker.pendingModel || worker.busy || worker.runActive) return;
    if (worker.mutating) throw new Error('Session operation in progress');
    worker.mutating = true;
    const selection = worker.pendingModel;
    try {
      const current = await worker.rpc.request('get_state');
      worker.state = current;
      if (current.isStreaming || current.isCompacting) throw new Error('Wait for the current task to finish');
      if (!current.sessionId) throw new Error('Session identity unavailable');
      const records = await this.load(current.sessionId);
      if (!sameModel(selection.model, current.model)) {
        const previousModel = current.model ? identity(current.model) : undefined;
        await worker.rpc.request('set_model', { provider: selection.model.provider, modelId: selection.model.id });
        const actual = await worker.rpc.request('get_state');
        worker.state = actual;
        if (!sameModel(selection.model, actual.model)) throw new Error('Runtime did not apply the selected model');
        if (previousModel && worker.messages.some(message => message.role === 'assistant' && message.display !== false)) {
          const from = records.awaiting?.from ?? previousModel;
          records.awaiting = sameModel(from, actual.model) ? undefined : { from, to: identity(selection.model) };
          this.save(current.sessionId);
        }
      }
      if (selection.thinkingLevel !== undefined && selection.thinkingLevel !== worker.state?.thinkingLevel) {
        await worker.rpc.request('set_thinking_level', { level: selection.thinkingLevel });
        worker.state = await worker.rpc.request('get_state');
        if (worker.state?.thinkingLevel !== selection.thinkingLevel) throw new Error('Runtime did not apply the selected thinking level');
      }
      if (worker.pendingModel === selection) worker.pendingModel = undefined;
    } finally {
      worker.mutating = false;
      this.changed(worker);
    }
  }
  async prepare(worker: SessionRuntime, message: string) {
    if (message.trimStart().startsWith('/')) return;
    await this.apply(worker);
    const id = worker.state?.sessionId;
    const records = id ? this.records.get(id) : undefined;
    if (id && records?.awaiting && !worker.busy && !worker.runActive) {
      records.awaiting.promptHash = hash(message);
      this.save(id);
    }
  }
  delivered(worker: SessionRuntime, content: Message['content'], timestamp?: number) {
    const id = worker.state?.sessionId;
    const records = id ? this.records.get(id) : undefined;
    const text = typeof content === 'string' ? content : content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
    if (!id || !records?.awaiting || !Number.isFinite(timestamp) || records.awaiting.promptHash !== hash(text)) return false;
    records.changes.push({ id: randomUUID(), userTimestamp: timestamp!, from: records.awaiting.from, to: records.awaiting.to });
    records.awaiting = undefined;
    this.save(id);
    return true;
  }
  private save(id: string) {
    const contents = JSON.stringify(this.records.get(id));
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.root, { recursive: true });
      const file = this.file(id);
      await writeFile(`${file}.tmp`, contents, 'utf8'); await rename(`${file}.tmp`, file);
    }).catch(error => { try { this.onError(error); } catch { /* persistence must not poison the queue */ } });
  }
  async flush() { await this.writes; }
  async remove(id: string) { await this.flush(); this.records.delete(id); await rm(this.file(id), { force: true }); }
}
