import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationEntriesReader } from '../src/conversation-presentation';
import type { Message } from '../src/contracts';

test('streaming replaces the active response without invalidating completed turns', () => {
  const read = createConversationEntriesReader();
  const user: Message = { role: 'user', content: 'First' };
  const answer: Message = { role: 'assistant', content: 'Complete' };
  const next: Message = { role: 'user', content: 'Next' };
  const live: Message = { role: 'assistant', content: 'Partial' };
  const before = read([user, answer, next, live]);
  const after = read([user, answer, next, { ...live, content: 'Partial output' }]);
  assert.equal(after[0], before[0]);
  assert.equal(after[1], before[1]);
  assert.equal(after[2], before[2]);
  assert.notEqual(after[3], before[3]);
  assert.equal(before[3].type === 'response' && before[3].items[0].message.content, 'Partial');
});

test('a tool result invalidates only its owning response', () => {
  const read = createConversationEntriesReader();
  const history: Message[] = [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Complete' },
    { role: 'user', content: 'Next' }, { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'read_file' }] }];
  const before = read(history);
  const after = read([...history, { role: 'toolResult', toolCallId: 'call', content: 'Read' }]);
  assert.equal(after[1], before[1]);
  assert.notEqual(after[3], before[3]);
  assert.equal(after[3].type === 'response' && after[3].items.length, 2);
  assert.equal(before[3].type === 'response' && before[3].items.length, 1);
});

test('same-length history replacements cannot reuse another session or branch', () => {
  const read = createConversationEntriesReader();
  const before = read([{ role: 'user', content: 'First' }, { role: 'assistant', content: 'A' }]);
  const after = read([{ role: 'user', content: 'Second' }, { role: 'assistant', content: 'B' }]);
  assert.notEqual(after[0], before[0]);
  assert.notEqual(after[1], before[1]);
  assert.deepEqual(read([]), []);
});

test('hidden messages retain real indexes and cannot accidentally reuse shifted entries', () => {
  const read = createConversationEntriesReader();
  const user: Message = { role: 'user', content: 'First' };
  const answer: Message = { role: 'assistant', content: 'A' };
  const before = read([user, answer]);
  const after = read([{ role: 'custom', display: false, content: 'Internal' }, user, answer]);
  assert.notEqual(after[0], before[0]);
  assert.notEqual(after[1], before[1]);
  assert.equal(after[1].type === 'response' && after[1].index, 2);
});
