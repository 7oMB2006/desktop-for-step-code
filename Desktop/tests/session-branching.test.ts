import test from 'node:test';
import assert from 'node:assert/strict';
import { activeHistory, messagesWithEntryIds, type HistoryEntry } from '../electron/session-branching';

const user = (text: string, timestamp?: number) => ({ role: 'user', content: text, timestamp });
const entries: HistoryEntry[] = [
  { id: 'u1', parentId: null, type: 'message', message: user('same', 1) },
  { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'answer', timestamp: 2 } },
  { id: 'u2', parentId: 'a1', type: 'message', message: user('same', 3) },
  { id: 'other', parentId: 'a1', type: 'message', message: user('same', 3) },
];

test('entry mapping follows the active path and distinguishes repeated user text', () => {
  const messages = [user('same', 1), user('same', 3)];
  assert.deepEqual(messagesWithEntryIds(messages, entries, 'u2').map(message => message.entryId), ['u1', 'u2']);
  assert.ok(!('entryId' in messages[0]));
  assert.deepEqual(activeHistory(entries, 'u2').map(entry => entry.id), ['u1', 'a1', 'u2']);
});
test('compacted/synthetic messages never borrow an unrelated or stale entry ID', () => {
  assert.deepEqual(messagesWithEntryIds([{ ...user('summary', 4), entryId: 'stale' }, user('same', 3)],
    entries, 'u2').map(message => message.entryId), [undefined, 'u2']);
  assert.equal(messagesWithEntryIds([entries[1].message!], entries, 'u2')[0].entryId, 'a1');
});
test('ambiguous identities fail closed instead of choosing the first matching message', () => {
  const duplicate = [
    { id: 'x', parentId: null, type: 'message', message: user('same') },
    { id: 'y', parentId: 'x', type: 'message', message: user('same') },
  ];
  assert.equal(messagesWithEntryIds([user('same')], duplicate, 'y')[0].entryId, undefined);
});
test('invalid active paths reject missing parents and cycles', () => {
  assert.throws(() => activeHistory(entries, 'missing'), /Incomplete/);
  assert.throws(() => activeHistory([{ id: 'x', parentId: 'x', type: 'message' }], 'x'), /Invalid/);
});
