import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingMessages } from '../electron/pending-messages';
import type { SessionRuntime } from '../electron/session-runtimes';
import { MessageRevision } from '../src/message-revision';
import { applyMessageEvent } from '../src/message-events';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function fixture({ consume = true } = {}) {
  const requests: { type: string; args: Record<string, unknown> }[] = [];
  let failure = false;
  const worker = { id: 'A', busy: true, status: 'connected', submissions: 0, operations: 0, mutating: false, failed: false, interrupted: false,
    rpc: { request: async (type: string, args: Record<string, unknown>) => {
      requests.push({ type, args }); if (failure) throw new Error('offline');
      if (consume) queue.delivered(worker, args.message);
    } },
  } as unknown as SessionRuntime;
  const errors: unknown[] = [];
  const queue = new PendingMessages(() => {}, (_worker, error) => errors.push(error), (message, files) => `${message}${files.length ? `\nfiles:${files.join(',')}` : ''}`);
  return { worker, queue, requests, errors, fail: () => { failure = true; } };
}
test('queued drafts are worker scoped, bounded and expose neither image bytes nor file paths', () => {
  const { worker, queue } = fixture();
  const id = queue.enqueue(worker, 'draft', { message: 'draft', images: [{ data: 'private-image' }] }, ['private-path']);
  assert.deepEqual(queue.list(worker), [{ id, message: 'draft', attachmentCount: 2, version: 0, sending: undefined }]);
  assert.equal(queue.list({ ...worker }).length, 0);
  for (let i = 1; i < 20; i++) queue.enqueue(worker, String(i), { message: String(i) });
  assert.throws(() => queue.enqueue(worker, '21', {}), /limit/);
  assert.equal(worker.queued, true);
});
test('editing retains attachment payload and queue position; stale edits and withdrawn IDs fail closed', async () => {
  const { worker, queue, requests } = fixture();
  const first = queue.enqueue(worker, 'first', { message: 'first', images: [{ data: 'image' }] }, ['a']);
  const second = queue.enqueue(worker, 'second', { message: 'second' });
  queue.edit(worker, first, 0, 'updated');
  assert.deepEqual(queue.list(worker).map(item => item.id), [first, second]);
  assert.throws(() => queue.edit(worker, first, 0, 'old'), /changed/);
  queue.remove(worker, second, 0);
  await assert.rejects(queue.steer(worker, second, 0), /changed/);
  await queue.steer(worker, first, 1);
  assert.equal(requests[0].args.message, 'updated\nfiles:a');
  assert.deepEqual(requests[0].args.images, [{ data: 'image' }]);
  assert.equal(requests[0].args.streamingBehavior, 'steer');
  assert.equal(queue.list(worker).length, 0);
});
test('completion drains FIFO, failures and interruption retain undelivered drafts', async () => {
  const { worker, queue, requests, fail, errors } = fixture();
  queue.enqueue(worker, 'first', { message: 'first' }); queue.enqueue(worker, 'second', { message: 'second' });
  queue.completed(worker);
  await tick();
  assert.equal(requests.length, 0, 'still-running worker must not drain');
  worker.busy = false; worker.interrupted = true;
  queue.completed(worker); await tick();
  assert.equal(requests.length, 0);
  worker.interrupted = false; fail();
  queue.resumed(worker);
  queue.completed(worker); await tick();
  assert.equal(requests.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(queue.list(worker).length, 2);
  assert.equal(queue.list(worker)[0].sending, false);
  await queue.drain(worker);
  assert.equal(requests.length, 1, 'failed delivery must not retry automatically');
});
test('successful completion sends each draft once and resets worker reservations', async () => {
  const { worker, queue, requests } = fixture();
  queue.enqueue(worker, 'one', { message: 'one' }); queue.enqueue(worker, 'two', { message: 'two' });
  worker.busy = false;
  queue.completed(worker); await tick(); await tick();
  assert.deepEqual(requests.map(item => item.args.message), ['one', 'two']);
  assert.equal(queue.list(worker).length, 0);
  assert.equal(worker.submissions, 0); assert.equal(worker.operations, 0); assert.equal(worker.queued, false);
});
test('consumption releases the row immediately and prevents editing or double steering during delivery', async () => {
  const { worker, queue } = fixture();
  let finish!: () => void;
  worker.rpc.request = () => new Promise<void>(resolve => { finish = resolve; });
  const id = queue.enqueue(worker, 'same', { message: 'same' });
  const sending = queue.steer(worker, id, 0);
  assert.throws(() => queue.remove(worker, id, 0), /already sent/);
  await assert.rejects(queue.steer(worker, id, 0), /already sent/);
  queue.delivered(worker, [{ type: 'text', text: 'same' }]);
  assert.equal(queue.list(worker).length, 0);
  finish(); await sending;
});
test('RPC acknowledgement retains the sent receipt until an authoritative matching user event', async () => {
  const { worker, queue, requests } = fixture({ consume: false });
  const id = queue.enqueue(worker, 'waiting', { message: 'waiting' });
  queue.enqueue(worker, 'next', { message: 'next' });
  await queue.steer(worker, id, 0);
  assert.equal(queue.list(worker)[0].sending, true);
  assert.equal(queue.list(worker)[0].id, id);
  assert.throws(() => queue.edit(worker, id, 0, 'changed'), /already sent/);
  worker.busy = false;
  await queue.drain(worker);
  assert.equal(requests.length, 1, 'no background dispatch while an accepted message waits for consumption');
  queue.delivered(worker, 'unrelated');
  assert.equal(queue.list(worker).length, 2);
  queue.delivered(worker, [{ type: 'text', text: 'waiting' }]);
  assert.deepEqual(queue.list(worker).map(item => item.message), ['next']);
  assert.equal(worker.queued, true);
});
test('only steering an active response marks the consumed user message, scoped to its worker and timestamp', async () => {
  const { worker, queue } = fixture({ consume: false });
  const id = queue.enqueue(worker, 'same', { message: 'same' });
  await queue.steer(worker, id, 0);
  assert.equal(queue.list(worker)[0].steered, true);
  queue.delivered(worker, 'same', 123);
  const message = { role: 'user', content: 'same', timestamp: 123 };
  assert.equal(queue.decorate(worker, message).desktopSteered, true);
  assert.equal(queue.decorate({ ...worker }, message).desktopSteered, undefined);
  assert.equal(queue.decorate(worker, { ...message, timestamp: 124 }).desktopSteered, undefined);
  assert.equal(queue.decorate(worker, { ...message, role: 'assistant' }).desktopSteered, undefined);
  worker.busy = false;
  const next = queue.enqueue(worker, 'same', { message: 'same' });
  await queue.steer(worker, next, 0);
  queue.delivered(worker, 'same', 125);
  assert.equal(queue.decorate(worker, { ...message, timestamp: 125 }).desktopSteered, undefined);
});
test('consumption can publish its authoritative user event before a newer queue revision', async () => {
  const { worker } = fixture({ consume: false });
  const revision = new MessageRevision();
  revision.acceptSnapshot({ runtimeId: worker.id, runtimeRevision: 4 });
  let notifications = 0;
  const message = { role: 'user', content: 'steered', timestamp: 55 };
  const ordered = new PendingMessages(() => { notifications++; }, () => {});
  const orderedId = ordered.enqueue(worker, 'steered', { message: 'steered' });
  await ordered.steer(worker, orderedId, 0);
  notifications = 0;
  assert.equal(ordered.delivered(worker, message.content, message.timestamp, false), true);
  assert.equal(notifications, 0);
  const event = { type: 'message_start', runtimeId: worker.id, runtimeRevision: 5, message: ordered.decorate(worker, message) };
  assert.equal(revision.acceptEvent(event), true);
  assert.equal(applyMessageEvent([], event)[0].desktopSteered, true);
  ordered.publish(worker);
  assert.equal(notifications, 1);
  assert.equal(revision.acceptEvent({ type: 'desktop_queue', runtimeId: worker.id, runtimeRevision: 6 }), true);
});
test('confirmed cancellation restores in-flight drafts without retry, version reuse or attachment loss', async () => {
  const { worker, queue, requests } = fixture({ consume: false });
  const first = queue.enqueue(worker, 'same', { message: 'same', images: [{ data: 'image' }] }, ['file']);
  await queue.steer(worker, first, 0);
  queue.enqueue(worker, 'later', { message: 'later' });
  assert.throws(() => queue.recover(worker), /stop/);
  worker.busy = false; worker.interrupted = true;
  queue.recover(worker);
  assert.equal(queue.list(worker)[0].sending, false);
  assert.equal(queue.list(worker)[0].version, 1);
  assert.equal(queue.list(worker)[0].attachmentCount, 2);
  await queue.drain(worker);
  assert.equal(requests.length, 1, 'recovery must not retry automatically');
  assert.throws(() => queue.remove(worker, first, 0), /changed/);
  queue.edit(worker, first, 1, 'edited');
  queue.remove(worker, first, 2);
  assert.deepEqual(queue.list(worker).map(item => item.message), ['later']);
});
test('a dead child releases waiting receipts for local withdrawal', async () => {
  const { worker, queue } = fixture({ consume: false });
  const first = queue.enqueue(worker, 'lost', { message: 'lost' });
  await queue.steer(worker, first, 0);
  worker.status = 'disconnected'; worker.busy = false;
  queue.recover(worker);
  queue.remove(worker, first, 1);
  assert.equal(worker.queued, false);
});
test('steering is blocked while abort and queue cancellation settle', async () => {
  const { worker, queue, requests } = fixture({ consume: false });
  const first = queue.enqueue(worker, 'later', { message: 'later' });
  worker.stopping = true;
  await assert.rejects(queue.steer(worker, first, 0), /cannot send/);
  assert.equal(requests.length, 0);
});
