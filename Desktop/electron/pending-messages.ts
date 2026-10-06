import { randomUUID } from 'node:crypto';
import type { Message, PendingMessage } from '../src/contracts';
import type { SessionRuntime } from './session-runtimes';

interface Entry extends PendingMessage { payload: Record<string, unknown>; files: string[]; bytes: number }
// Undelivered drafts remain editable here; once dispatched, Step owns execution.
export class PendingMessages {
  private entries = new Map<SessionRuntime, Entry[]>();
  private paused = new Set<SessionRuntime>();
  private draining = new Set<SessionRuntime>();
  private steeredMessages = new WeakMap<SessionRuntime, Set<number>>();
  constructor(
    private changed: (worker: SessionRuntime) => void,
    private failed: (worker: SessionRuntime, error: unknown) => void,
    private format: (message: string, files: string[]) => string = message => message,
  ) {}
  list(worker: SessionRuntime): PendingMessage[] {
    return (this.entries.get(worker) ?? []).map(({ id, message, attachmentCount, version, sending, steered }) => ({ id, message, attachmentCount, version, sending, ...(steered ? { steered } : {}) }));
  }
  publish(worker: SessionRuntime) {
    worker.queued = Boolean(this.entries.get(worker)?.length);
    this.changed(worker);
  }
  enqueue(worker: SessionRuntime, message: string, payload: Record<string, unknown>, files: string[] = []) {
    const entries = this.entries.get(worker) ?? [];
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (entries.length >= 20 || entries.reduce((sum, entry) => sum + entry.bytes, 0) + bytes > 32 * 1024 * 1024)
      throw new Error('Pending messages exceed the queue limit (20 messages / 32 MiB)');
    const entry: Entry = { id: randomUUID(), message, payload, files, attachmentCount: files.length + (Array.isArray(payload.images) ? payload.images.length : 0), version: 0, bytes };
    entries.push(entry); this.entries.set(worker, entries); this.publish(worker);
    return entry.id;
  }
  private require(worker: SessionRuntime, id: string, version: number) {
    const entry = this.entries.get(worker)?.find(item => item.id === id);
    if (!entry || entry.sending || entry.version !== version) throw new Error('This queued message has changed or was already sent');
    return entry;
  }
  edit(worker: SessionRuntime, id: string, version: number, message: string) {
    const entry = this.require(worker, id, version);
    if (!message.trim() && !entry.attachmentCount) throw new Error('Message is empty');
    const payload = { ...entry.payload, message: this.format(message, entry.files) };
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (this.entries.get(worker)!.reduce((sum, item) => sum + (item === entry ? bytes : item.bytes), 0) > 32 * 1024 * 1024)
      throw new Error('Pending messages exceed 32 MiB');
    entry.message = message; entry.payload = payload; entry.bytes = bytes; entry.version++;
    this.publish(worker);
  }
  remove(worker: SessionRuntime, id: string, version: number) {
    const entry = this.require(worker, id, version);
    this.entries.set(worker, this.entries.get(worker)!.filter(item => item !== entry)); this.publish(worker);
  }
  pause(worker: SessionRuntime) { this.paused.add(worker); }
  // The caller must first clear upstream queues or confirm the child is gone.
  recover(worker: SessionRuntime) {
    if (worker.busy && worker.status === 'connected') throw new Error('Wait for the session to stop before recovering messages');
    this.pause(worker);
    for (const entry of this.entries.get(worker) ?? []) {
      if (!entry.sending) continue;
      entry.sending = false; entry.steered = false; entry.version++;
    }
    this.publish(worker);
  }
  decorate(worker: SessionRuntime, message: Message): Message {
    return message.role === 'user' && message.timestamp !== undefined && this.steeredMessages.get(worker)?.has(message.timestamp)
      ? { ...message, desktopSteered: true } : message;
  }
  delivered(worker: SessionRuntime, content: unknown, timestamp?: number, notify = true) {
    const message = typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n') : '';
    const entry = this.entries.get(worker)?.find(item => item.sending && item.payload.message === message);
    if (entry) {
      if (entry.steered && timestamp !== undefined) {
        const stamps = this.steeredMessages.get(worker) ?? new Set<number>();
        stamps.add(timestamp); this.steeredMessages.set(worker, stamps);
      }
      this.entries.set(worker, this.entries.get(worker)!.filter(item => item !== entry));
      worker.queued = Boolean(this.entries.get(worker)?.length);
      if (notify) this.publish(worker);
    }
    return Boolean(entry);
  }
  clear(worker: SessionRuntime) { this.entries.delete(worker); this.paused.delete(worker); worker.queued = false; }
  async steer(worker: SessionRuntime, id: string, version: number) {
    const entry = this.require(worker, id, version);
    if (worker.mutating || worker.stopping || worker.status !== 'connected') throw new Error('This session cannot send right now');
    this.resumed(worker);
    return this.dispatch(worker, entry, true);
  }
  completed(worker: SessionRuntime) {
    if (worker.failed || worker.interrupted || ['error', 'aborted', 'length'].includes(worker.messages?.at(-1)?.stopReason ?? '') || worker.status !== 'connected') { this.pause(worker); return; }
    // Let the original prompt's RPC settlement finish before starting another run.
    setTimeout(() => void this.drain(worker), 0).unref();
  }
  resumed(worker: SessionRuntime) { this.paused.delete(worker); }
  async drain(worker: SessionRuntime) {
    if (this.draining.has(worker) || this.paused.has(worker) || !worker.queued || worker.busy || worker.failed || worker.interrupted || worker.submissions || worker.mutating || worker.state?.isCompacting || worker.pendingUI?.size || worker.status !== 'connected') return;
    if (this.entries.get(worker)?.some(item => item.sending)) return;
    this.draining.add(worker);
    try {
      const entry = this.entries.get(worker)?.find(item => !item.sending);
      if (entry) await this.dispatch(worker, entry, false);
    } catch (error) { this.pause(worker); this.failed(worker, error); }
    finally { this.draining.delete(worker); }
  }
  private async dispatch(worker: SessionRuntime, entry: Entry, steer: boolean) {
    entry.sending = true; entry.steered = steer && worker.busy; worker.submissions++; worker.operations++; this.publish(worker);
    try {
      await worker.rpc.request('prompt', { ...entry.payload, ...(steer ? { streamingBehavior: 'steer' } : {}) }, 600000);
      // RPC success means accepted for delivery, not consumed by the agent.
      // Only the authoritative user message event releases the pending receipt.
    } catch (error) {
      entry.sending = false; this.pause(worker); throw error;
    } finally {
      worker.submissions--; worker.operations--; this.publish(worker);
      if (!worker.busy && !worker.interrupted && !worker.failed && !this.paused.has(worker))
        setTimeout(() => void this.drain(worker), 0).unref();
    }
  }
}
