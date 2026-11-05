import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPayload, consumeReview } from '../electron/completion-review';
import { SessionRuntimes, type SessionRuntime, type WorkerTransport } from '../electron/session-runtimes';
import { PendingMessages } from '../electron/pending-messages';
import { projectLaunch } from '../electron/launch-state';
import { emptyLaunch, draftLaunchChanges } from '../src/launch-state';
import { completionReview, reviewActive, reviewErrorText, reviewLabel, reviewReason } from '../src/completion-review';
import { conversationEntries, responsePresentation } from '../src/conversation-presentation';

const review = { version: 1 as const, id: 'review-1', sessionId: 'session-1', status: 'pending' as const, sent: false };
const worker = () => ({ status: 'connected', busy: false, submissions: 0, operations: 0, mutating: false,
  failed: false, interrupted: false, messages: [], pendingUI: new Map(),
  state: { sessionId: 'session-1', isStreaming: false, desktopCompletionReview: 1 },
  launch: { ...emptyLaunch(), reviewArmed: true } }) as unknown as SessionRuntime;

test('review labels and guarded errors follow the selected language without claiming verification passed', () => {
  assert.equal(reviewLabel('ended', true), '自查流程结束');
  assert.equal(reviewLabel('ended', false), 'Self-review ended');
  assert.equal(reviewReason('persistence', true), '自查状态保存失败');
  const message = 'Error: Completion review is only available for ordinary main tasks';
  assert.equal(reviewErrorText(message, false), message);
  assert.equal(reviewErrorText(message, true), 'Error: 完成后自查仅适用于普通主会话任务');
  assert.equal(reviewErrorText('Unrelated error', true), 'Unrelated error');
});

test('review is a one-shot snapshot, never an unchecked renderer RPC option', () => {
  const host = worker();
  const payload = reviewPayload(host, { message: 'task' });
  assert.equal(payload.completionReview, true);
  assert.equal(host.launch?.reviewArmed, true, 'Preparing or failing submission does not consume consent');
  consumeReview(host, {});
  assert.equal(host.launch?.reviewArmed, true);
  consumeReview(host, payload);
  assert.equal(host.launch?.reviewArmed, false);
  assert.equal(payload.completionReview, true, 'A queued task keeps its captured choice');
  for (const launch of [{ plan: true }, { goalArmed: true }, { ultracode: true }, { ultracodeArmed: true }]) {
    host.launch = { ...emptyLaunch(), reviewArmed: true, ...launch };
    assert.throws(() => reviewPayload(host, { message: 'task' }), /ordinary/);
  }
  host.launch = { ...emptyLaunch(), reviewArmed: true };
  for (const message of ['/usage', ' /compact', 'ultracode: task'])
    assert.throws(() => reviewPayload(host, { message }), /ordinary/);
  delete host.state!.desktopCompletionReview;
  assert.throws(() => reviewPayload(host, { message: 'task' }), /does not support/);
  assert.deepEqual(draftLaunchChanges({ ...emptyLaunch(), reviewArmed: true }, { ...emptyLaunch(), plan: true }),
    [{ mode: 'review', enabled: false }, { mode: 'plan', enabled: true }]);
});

test('history restores the outcome, but never resumes an unfinished review or accepts foreign records', () => {
  const entry = (data: unknown) => ({ id: 'record', parentId: null, type: 'custom', customType: 'desktop-completion-review', data });
  const interrupted = projectLaunch([entry(review)], 'record', 'session-1');
  assert.equal(interrupted.review?.status, 'cancelled');
  assert.equal(interrupted.review?.reason, 'rebound');
  assert.equal(interrupted.reviewArmed, undefined);
  const live = { ...review, status: 'reviewing' as const };
  assert.deepEqual(projectLaunch([entry(review)], 'record', 'session-1', { ...emptyLaunch(), review: live }).review, live);
  assert.equal(projectLaunch([entry({ ...review, sessionId: 'foreign' })], 'record', 'session-1').review, undefined);
  assert.equal(completionReview({ ...review, sent: 'yes' }), undefined);
  assert.equal(reviewActive({ ...review, status: 'ended' }), false);
});

test('structured review notes stay in the assistant response, not fake user bubbles or copied internal prompts', () => {
  const messages = [
    { role: 'user', content: 'task' }, { role: 'assistant', content: 'Initial answer' },
    { role: 'custom', customType: 'desktop-completion-review-input', display: true, content: 'PRIVATE NATIVE FEEDBACK',
      details: { version: 1, source: 'completion-review', reviewId: review.id } },
    { role: 'assistant', content: 'Checked and fixed' },
    { role: 'custom', customType: 'desktop-completion-review-result', display: true, content: 'Completion ended',
      details: { ...review, status: 'ended', sent: true } },
  ];
  const entries = conversationEntries(messages);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].type, 'response');
  if (entries[1].type !== 'response') throw new Error('Missing response');
  const rendered = responsePresentation(entries[1].items);
  assert.deepEqual(rendered.content.map(item => item.type), ['text', 'completion-review', 'text', 'completion-review']);
  assert.equal(rendered.text, 'Initial answer\n\nChecked and fixed');
  const ordinary = responsePresentation([{ index: 0, message: { role: 'assistant', content: 'Final self-review: ordinary prose' } }]);
  assert.equal(ordinary.content[0].type, 'text', 'Natural language never identifies automation');
});

test('intermediate agent_end and settled never release ownership or announce completion', async () => {
  const events: any[] = [];
  let receive!: (event: any) => void;
  const transport: WorkerTransport = { start() {}, respond() {}, async stop() {},
    async request(type) {
      if (type === 'get_state') return { sessionId: 'session-1', isStreaming: false, desktopCompletionReview: 1 };
      if (type === 'get_messages') return { messages: [] };
      if (type === 'get_entries') return { entries: [], leafId: null };
      if (type === 'get_available_models') return { models: [] };
      return {};
    } };
  const pool = new SessionRuntimes(event => events.push(event), callback => { receive = callback; return transport; });
  const host = await pool.open('node', 'entry', 'workspace', {});
  try {
    const emitReview = (status: string, completed = false) => receive({ type: 'desktop_completion_review', review: { ...review, status }, completed });
    emitReview('pending');
    receive({ type: 'agent_start' });
    receive({ type: 'message_end', message: { role: 'assistant', content: 'Initial', stopReason: 'stop' } });
    receive({ type: 'agent_end' });
    receive({ type: 'agent_settled' });
    assert.equal(pool.isBusy(host), true);
    assert.equal(host.runActive, true);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    assert.equal(events.find(event => event.type === 'agent_end').desktopReviewPending, true);
    await assert.rejects(pool.assertIdle(host), /Stop/);
    emitReview('reviewing');
    receive({ type: 'agent_start' });
    receive({ type: 'message_end', message: { role: 'assistant', content: 'Reviewed', stopReason: 'stop' } });
    receive({ type: 'agent_end' });
    assert.equal(pool.isBusy(host), true);
    emitReview('ended', true);
    emitReview('ended', true);
    assert.equal(pool.isBusy(host), false);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 1);
    receive({ type: 'desktop_completion_review', review: { ...review, sessionId: 'foreign', status: 'pending' } });
    assert.equal(pool.isBusy(host), false, 'Foreign review cannot seize ownership');
  } finally { await pool.stopAll(); }
});

test('queued review choices survive edits and failed dispatch, and cannot become a mid-task steer', async () => {
  const host = worker();
  const calls: any[] = [];
  let reject = true;
  host.rpc = { start() {}, respond() {}, async stop() {}, async request(_type, payload) {
    calls.push(payload); if (reject) throw new Error('preflight failed'); return {};
  } };
  const queue = new PendingMessages(() => {}, () => {});
  const id = queue.enqueue(host, 'task', reviewPayload(host, { message: 'task' }));
  consumeReview(host, reviewPayload(host, { message: 'task' }));
  queue.edit(host, id, 0, 'edited task');
  host.busy = true;
  await assert.rejects(queue.steer(host, id, 1), /in order/);
  assert.equal(calls.length, 0);
  host.busy = false;
  await queue.drain(host);
  assert.equal(calls[0].completionReview, true);
  assert.equal(queue.list(host)[0].sending, false);
  reject = false; queue.resumed(host);
  await queue.drain(host);
  assert.equal(calls[1].completionReview, true);
  assert.equal(calls[1].message, 'edited task');
  queue.delivered(host, 'edited task');
  assert.equal(queue.list(host).length, 0);
});
