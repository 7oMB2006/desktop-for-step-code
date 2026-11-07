import { randomUUID } from 'node:crypto';
import type { Message, PendingMessage, RuntimeEvent } from '../src/contracts';
import type { SessionRuntime } from './session-runtimes';
import { isUltracodeInput, ultracodeInput } from '../src/ultracode-input';
import { isProjectInstructionsCommand } from '../src/project-instructions';

interface Entry extends PendingMessage { payload: Record<string, unknown>; files: string[]; bytes: number; dispatched?: boolean }
export type QueueReceiptEvent = 'delivered' | 'removed' | 'dispatching' | 'unknown';
export function promptNeedsQueue(worker: Pick<SessionRuntime, 'busy' | 'submissions' | 'state'>) {
  return worker.busy || worker.submissions > 0 || Boolean(worker.state?.isCompacting);
}
// Undelivered drafts remain editable here; once dispatched, Step owns execution.
export class PendingMessages {
  private entries = new Map<SessionRuntime, Entry[]>();
  private paused = new Set<SessionRuntime>();
  private revisions = new WeakMap<SessionRuntime, number>();
  private draining = new Set<SessionRuntime>();
  private steeredMessages = new WeakMap<SessionRuntime, Set<number>>();
  constructor(
    private changed: (worker: SessionRuntime) => void,
    private failed: (worker: SessionRuntime, error: unknown) => void,
    private format: (message: string, files: string[]) => string = message => message,
    private beforePrompt: (worker: SessionRuntime, message: string) => Promise<void> = async () => {},
    private receipt: (worker: SessionRuntime, id: string, event: QueueReceiptEvent) => void = () => {},
  ) {}
  list(worker: SessionRuntime): PendingMessage[] {
    return (this.entries.get(worker) ?? []).map(({ id, message, attachmentCount, version, sending, steered }) => ({ id, message, attachmentCount, version, sending, ...(steered ? { steered } : {}) }));
  }
  publish(worker: SessionRuntime) {
    worker.queued = Boolean(this.entries.get(worker)?.length);
    this.changed(worker);
  }
  enqueue(worker: SessionRuntime, message: string, payload: Record<string, unknown>, files: string[] = []) {
    this.assertQueueable(message, payload, files);
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
    this.assertQueueable(message, entry.payload, entry.files);
    if (!message.trim() && !entry.attachmentCount) throw new Error('Message is empty');
    const formatted = this.format(message, entry.files);
    const payload = { ...entry.payload, message: isUltracodeInput(String(entry.payload.message ?? '')) ? ultracodeInput(formatted) : formatted };
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (this.entries.get(worker)!.reduce((sum, item) => sum + (item === entry ? bytes : item.bytes), 0) > 32 * 1024 * 1024)
      throw new Error('Pending messages exceed 32 MiB');
    entry.message = message; entry.payload = payload; entry.bytes = bytes; entry.version++;
    this.publish(worker);
  }
  remove(worker: SessionRuntime, id: string, version: number) {
    const entry = this.require(worker, id, version);
    this.entries.set(worker, this.entries.get(worker)!.filter(item => item !== entry)); this.publish(worker);
    this.receipt(worker, entry.id, 'removed');
  }
  withdraw(worker: SessionRuntime, id: string) {
    const entry = this.entries.get(worker)?.find(item => item.id === id);
    if (!entry || entry.sending || entry.dispatched) return false;
    this.remove(worker, id, entry.version);
    return true;
  }
  pause(worker: SessionRuntime) {
    this.paused.add(worker);
    this.revisions.set(worker, (this.revisions.get(worker) ?? 0) + 1);
  }
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
      this.receipt(worker, entry.id, 'delivered');
    }
    return Boolean(entry);
  }
  clear(worker: SessionRuntime) {
    const entries = this.entries.get(worker) ?? [];
    this.pause(worker);
    this.entries.delete(worker); this.paused.delete(worker); worker.queued = false;
    for (const entry of entries) this.receipt(worker, entry.id, 'removed');
  }
  async steer(worker: SessionRuntime, id: string, version: number) {
    const entry = this.require(worker, id, version);
    if (worker.mutating || worker.stopping || worker.state?.isCompacting || worker.status !== 'connected') throw new Error('This session cannot send right now');
    if (entry.payload.completionReview && worker.busy) throw new Error('Tasks with completion review must be sent in order');
    this.resumed(worker);
    return this.dispatch(worker, entry, true);
  }
  completed(worker: SessionRuntime) {
    if (worker.failed || worker.interrupted || ['error', 'aborted', 'length'].includes(worker.messages?.at(-1)?.stopReason ?? '') || worker.status !== 'connected') { this.pause(worker); return; }
    // Let the original prompt's RPC settlement finish before starting another run.
    setTimeout(() => void this.drain(worker), 0).unref();
  }
  runtimeEvent(worker: SessionRuntime, event: RuntimeEvent) {
    if (event.type === 'desktop_completion_review' && !['pending', 'reviewing'].includes(event.review?.status)
      || event.type === 'agent_end' && !event.desktopRecoveryPending || event.desktopRecoverySettled
      || ['compaction_end', 'auto_compaction_end', 'auto_clm_end'].includes(event.type)) this.completed(worker);
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
    this.assertQueueable(entry.message, entry.payload, entry.files);
    const revision = this.revisions.get(worker), version = entry.version;
    entry.sending = true; entry.steered = steer && worker.busy; worker.submissions++; worker.operations++; this.publish(worker);
    try {
      if (!worker.busy) await this.beforePrompt(worker, String(entry.payload.message ?? ''));
      // Preparation can outlive abort/recovery, clear, or a worker transition.
      if (this.revisions.get(worker) !== revision || this.paused.has(worker)
        || !this.entries.get(worker)?.includes(entry) || entry.version !== version || !entry.sending
        || worker.stopping || worker.mutating || worker.state?.isCompacting || worker.status !== 'connected'
        || !steer && (worker.busy || worker.interrupted || worker.failed)) {
        if (entry.version === version) { entry.sending = false; entry.steered = false; }
        return;
      }
      if (Array.isArray(entry.payload.images) && entry.payload.images.length && !worker.state?.model?.input?.includes('image'))
        throw new Error('The selected model does not support images. The queued input was not sent; choose an image-capable model in Desktop.');
      // Irreversible for remote withdrawal, even if the RPC later times out.
      entry.dispatched = true;
      this.receipt(worker, entry.id, 'dispatching');
      await worker.rpc.request('prompt', { ...entry.payload, ...(steer ? { streamingBehavior: 'steer' } : {}) }, 600000);
      // RPC success means accepted for delivery, not consumed by the agent.
      // Only the authoritative user message event releases the pending receipt.
    } catch (error) {
      entry.sending = false; this.pause(worker);
      if (entry.dispatched) this.receipt(worker, entry.id, 'unknown');
      throw error;
    } finally {
      worker.submissions--; worker.operations--; this.publish(worker);
      if (this.revisions.get(worker) === revision && !worker.busy && !worker.interrupted && !worker.failed && !this.paused.has(worker))
        setTimeout(() => void this.drain(worker), 0).unref();
    }
  }
  private assertQueueable(message: string, payload: Record<string, unknown>, files: string[]) {
    const attachments = files.length + (Array.isArray(payload.images) ? payload.images.length : 0);
    if (isProjectInstructionsCommand(message, attachments) || isProjectInstructionsCommand(String(payload.message ?? ''), attachments))
      throw new Error('Run /init separately after the current task finishes; it cannot be queued');
  }
}
