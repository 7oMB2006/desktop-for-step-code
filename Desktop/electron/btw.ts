import type { BtwEvent, BtwInput, BtwOwner } from '../src/btw';
import type { Usage } from '../src/contracts';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { RpcCommandError } from './runtime';

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
function owner(value: any): asserts value is BtwOwner {
  if (!value || !id(value.runtimeId) || !id(value.scopeId) || typeof value.sessionId !== 'string'
    || !value.sessionId || value.sessionId.length > 256) throw new Error('Invalid side question identity');
}
export function btwUsage(raw: any): Usage | undefined {
  const keys = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
  if (!raw || keys.some(key => !Number.isSafeInteger(raw[key]) || raw[key] < 0)) return;
  if (keys.every(key => raw[key] === 0) || !Number.isSafeInteger(raw.input + raw.cacheRead + raw.cacheWrite)) return;
  const value: Usage = { input: raw.input, output: raw.output, cacheRead: raw.cacheRead, cacheWrite: raw.cacheWrite };
  for (const key of ['reasoning', 'totalTokens'] as const)
    if (Number.isSafeInteger(raw[key]) && raw[key] >= 0) value[key] = raw[key];
  return value;
}
type Active = { worker: SessionRuntime; input: BtwInput; timer: ReturnType<typeof setTimeout> };

export class BtwRequests {
  private active = new Map<string, Active>();
  constructor(private runtimes: Pick<SessionRuntimes, 'require' | 'publish'>, private emit: (event: BtwEvent) => void) {}
  async ask(value: unknown) {
    owner(value);
    const input = value as BtwInput;
    if (!id(input.requestId) || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 8000)
      throw new Error('Invalid side question');
    const worker = this.runtimes.require(input.runtimeId);
    if (worker.state?.sessionId !== input.sessionId || worker.mutating || worker.stopping || worker.state.isCompacting)
      throw new Error('This conversation is not ready for a side question');
    if (this.active.has(worker.id)) throw new Error('A side question is already running');
    const pending: Active = { worker, input: { runtimeId: input.runtimeId, sessionId: input.sessionId,
      scopeId: input.scopeId, requestId: input.requestId, question: input.question.trim() },
      timer: setTimeout(() => { void this.cancel(input).catch(() => {}); }, 130_000) };
    pending.timer.unref();
    this.active.set(worker.id, pending);
    worker.operations++; worker.btwActive = true;
    this.runtimes.publish();
    try { await worker.rpc.request('desktop_btw', { action: 'ask', ...pending.input }); }
    catch (error) {
      if (error instanceof RpcCommandError) {
        this.finish(pending);
        throw new Error('Side question is unavailable in this runtime');
      }
      // An acknowledgement timeout is ambiguous; confirm cancellation before releasing ownership.
      try { await worker.rpc.request('desktop_btw', { action: 'cancel', requestId: input.requestId, scopeId: input.scopeId }); }
      catch { throw new Error('Side question is unavailable; reconnect the conversation before retrying'); }
      this.finish(pending);
      throw new Error('Side question is unavailable in this runtime');
    }
  }
  async cancel(value: unknown) {
    owner(value);
    const input = value as Omit<BtwInput, 'question'>;
    if (!id(input.requestId)) throw new Error('Invalid side question request');
    const pending = this.active.get(input.runtimeId);
    if (!pending || pending.input.sessionId !== input.sessionId || pending.input.scopeId !== input.scopeId
      || pending.input.requestId !== input.requestId) return;
    await pending.worker.rpc.request('desktop_btw', { action: 'cancel', scopeId: input.scopeId, requestId: input.requestId });
    if (this.active.get(input.runtimeId) === pending) {
      const { runtimeId, sessionId, scopeId, requestId } = pending.input;
      this.emit({ type: 'desktop_btw', runtimeId, sessionId, scopeId, requestId, kind: 'cancelled' });
      this.finish(pending);
    }
  }
  async clear(value: unknown) {
    owner(value);
    const worker = this.runtimes.require(value.runtimeId);
    if (worker.state?.sessionId !== value.sessionId) return;
    const pending = this.active.get(worker.id);
    if (pending?.input.scopeId === value.scopeId) await this.cancel(pending.input);
    await worker.rpc.request('desktop_btw', { action: 'clear', scopeId: value.scopeId });
  }
  event(worker: SessionRuntime, raw: any) {
    const pending = this.active.get(worker.id);
    if (!pending || pending.worker !== worker || pending.input.requestId !== raw.requestId
      || pending.input.scopeId !== raw.scopeId || pending.input.sessionId !== raw.sessionId
      || !['start', 'delta', 'done', 'cancelled', 'error'].includes(raw.kind)) return;
    const { runtimeId, sessionId, scopeId, requestId } = pending.input;
    const event: BtwEvent = { type: 'desktop_btw', runtimeId, sessionId, scopeId, requestId, kind: raw.kind };
    if (['delta', 'done'].includes(raw.kind)) {
      if (typeof raw.text !== 'string' || raw.text.length > 64_000) return;
      event.text = raw.text;
    }
    if (raw.kind === 'start' && raw.model && ['id', 'provider', 'name'].every(key =>
      typeof raw.model[key] === 'string' && raw.model[key].length <= 300))
      event.model = { id: raw.model.id, provider: raw.model.provider, name: raw.model.name };
    event.usage = btwUsage(raw.usage);
    if (raw.truncated === true) event.truncated = true;
    this.emit(event);
    if (['done', 'error', 'cancelled'].includes(raw.kind)) this.finish(pending);
  }
  dispose(worker: SessionRuntime) {
    const pending = this.active.get(worker.id);
    if (!pending || pending.worker !== worker) return;
    const { runtimeId, sessionId, scopeId, requestId } = pending.input;
    this.emit({ type: 'desktop_btw', runtimeId, sessionId, scopeId, requestId, kind: 'error' });
    this.finish(pending);
  }
  private finish(pending: Active) {
    if (this.active.get(pending.worker.id) !== pending) return;
    clearTimeout(pending.timer);
    this.active.delete(pending.worker.id);
    pending.worker.operations--; pending.worker.btwActive = false;
    this.runtimes.publish();
  }
}
