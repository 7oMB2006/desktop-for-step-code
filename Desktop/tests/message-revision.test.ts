import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageRevision } from '../src/message-revision';
import { applyMessageEvent } from '../src/message-events';

test('a snapshot includes prior deltas but newer identical text remains valid', () => {
  const revision = new MessageRevision();
  assert.equal(revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 10 }), true);
  let messages = [{ role: 'assistant', content: [{ type: 'text', text: 'Alpha' }] }];
  for (const version of [10, 11, 11]) {
    const event = { type: 'message_update', runtimeId: 'a', runtimeRevision: version,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Alpha' } };
    if (revision.acceptEvent(event)) messages = applyMessageEvent(messages, event) as typeof messages;
  }
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'AlphaAlpha' }]);
});

test('late snapshots cannot roll back live text, while equal-version history can enrich metadata', () => {
  const revision = new MessageRevision();
  revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 10 });
  assert.equal(revision.acceptEvent({ type: 'message_update', runtimeId: 'a', runtimeRevision: 11 }), true);
  assert.equal(revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 10 }), false);
  assert.equal(revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 11 }), true);
  assert.equal(revision.acceptEvent({ type: 'message_update', runtimeId: 'a', runtimeRevision: 11 }), false);
});

test('history replacement advances the watermark and switching workers resets its scope', () => {
  const revision = new MessageRevision();
  revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 10 });
  assert.equal(revision.acceptEvent({ type: 'desktop_history', runtimeId: 'a', runtimeRevision: 20 }), true);
  assert.equal(revision.acceptEvent({ type: 'message_update', runtimeId: 'a', runtimeRevision: 12 }), false);
  assert.equal(revision.acceptSnapshot({ runtimeId: 'b', runtimeRevision: 1 }), true);
  assert.equal(revision.acceptEvent({ type: 'message_update', runtimeId: 'a', runtimeRevision: 99 }), false);
  assert.equal(revision.acceptEvent({ type: 'message_update', runtimeId: 'b', runtimeRevision: 2 }), true);
  assert.equal(revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 20 }), true);
});

test('unversioned fixture events remain supported without lowering the watermark', () => {
  const revision = new MessageRevision();
  revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 10 });
  assert.equal(revision.acceptEvent({ type: 'message_update', runtimeId: 'a' }), true);
  assert.equal(revision.acceptSnapshot({ runtimeId: 'a' }), true);
  assert.equal(revision.acceptSnapshot({ runtimeId: 'a', runtimeRevision: 9 }), false);
});
