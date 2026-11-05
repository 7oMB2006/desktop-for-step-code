import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteCard } from '../electron/remote-card.mjs';
import { chatReducer, initialChat } from './fixtures/remote-chat-model';

test('chat simulation shares the outgoing reply shape and does not add receipt or completion titles', () => {
  let state = chatReducer(initialChat(), { type: 'send', text: 'first', scene: 'reply' });
  assert.equal(state.messages.at(-1)?.reaction, 'typing');
  state = chatReducer(state, { type: 'tick', ms: 1800 });
  const reply = state.messages.find(message => message.card?.reply === 'working')!;
  assert.equal(remoteCard(reply.card!).header, undefined);
  const key = reply.id;
  state = chatReducer(state, { type: 'finish' });
  assert.equal(state.messages.find(message => message.id === key)?.card?.reply, 'completed');
  assert.equal(state.messages.find(message => message.text === 'first')?.reaction, undefined);
  assert.equal(state.messages.filter(message => message.id === key).length, 1);
});
test('queued message indicators survive the previous simulated response ending', () => {
  let state = chatReducer(initialChat(), { type: 'send', text: 'first', scene: 'reply' });
  state = chatReducer(state, { type: 'send', text: 'second', scene: 'reply' });
  state = chatReducer(state, { type: 'finish' });
  assert.equal(state.messages.find(message => message.text === 'first')?.reaction, undefined);
  assert.equal(state.messages.find(message => message.text === 'second')?.reaction, 'typing');
  state = chatReducer(state, { type: 'tick', ms: 80 });
  assert.equal(state.queue.length, 0);
  assert.ok(state.job);
});
test('simulated bare session/help do not start work, and targeted stopping keeps original session identity', () => {
  let state = chatReducer(initialChat(), { type: 'send', text: '/session', scene: 'reply' });
  state = chatReducer(state, { type: 'send', text: '/help', scene: 'reply' });
  assert.equal(state.job, undefined);
  assert.match(state.messages.at(-1)!.text, /\/sessions/);
  state = chatReducer(state, { type: 'send', text: 'run', scene: 'reply' });
  state = chatReducer(state, { type: 'tick', ms: 3000 });
  state = chatReducer(state, { type: 'send', text: '/session s2', scene: 'reply' });
  assert.equal(state.session, 's2');
  state = chatReducer(state, { type: 'send', text: '/stop s2', scene: 'reply' });
  assert.ok(state.job);
  state = chatReducer(state, { type: 'send', text: '/stop s1', scene: 'reply' });
  assert.equal(state.job, undefined);
  const reply = state.messages.find(message => message.card?.reply === 'interrupted')!;
  assert.match(reply.card!.title, /^s1/);
  assert.ok(reply.text.length > 0);
  assert.equal(state.session, 's2');
});
test('simulated code acknowledgment is not authorization and does not start a model job', () => {
  let state = chatReducer(initialChat(), { type: 'send', text: 'wrong', scene: 'pairing' });
  assert.equal(state.messages.at(-1)?.reaction, undefined);
  state = chatReducer(state, { type: 'send', text: '12345678', scene: 'pairing' });
  assert.equal(state.messages.at(-1)?.reaction, 'ok');
  assert.equal(state.connected, false);
  assert.equal(state.awaitingConfirmation, true);
  assert.equal(state.job, undefined);
  state = chatReducer(state, { type: 'confirm' });
  assert.equal(state.connected, true);
  assert.equal(state.awaitingConfirmation, false);
});
test('approval freezes the simulated response until an exact single-use decision', () => {
  let state = chatReducer(initialChat(), { type: 'send', text: 'test', scene: 'approval' });
  state = chatReducer(state, { type: 'tick', ms: 1500 });
  const approval = state.messages.find(message => message.approval === 'pending')!;
  assert.equal(chatReducer(state, { type: 'tick', ms: 10000 }), state);
  assert.equal(chatReducer(state, { type: 'finish' }), state);
  const denied = chatReducer(state, { type: 'decision', id: approval.id, allow: false });
  assert.equal(denied.job, undefined);
  assert.equal(denied.messages.find(message => message.id === approval.id)?.approval, 'denied');
  assert.equal(chatReducer(denied, { type: 'decision', id: approval.id, allow: true }), denied);
  const allowed = chatReducer(state, { type: 'decision', id: approval.id, allow: true });
  assert.equal(chatReducer(allowed, { type: 'tick', ms: 9000 }).job, undefined);
});
test('empty and interrupted simulation results retain distinct outgoing semantics', () => {
  const empty = chatReducer(chatReducer(initialChat(), { type: 'send', text: 'empty', scene: 'empty' }), { type: 'finish' });
  assert.equal(empty.messages.at(-1)?.card?.reply, 'completed');
  assert.equal(empty.messages.at(-1)?.text, '');
  let interrupted = chatReducer(initialChat(), { type: 'send', text: 'cancel', scene: 'interrupted' });
  interrupted = chatReducer(interrupted, { type: 'tick', ms: 5500 });
  assert.equal(interrupted.messages.at(-1)?.card?.reply, 'interrupted');
  assert.ok(interrupted.messages.at(-1)!.text.length > 0);
});
