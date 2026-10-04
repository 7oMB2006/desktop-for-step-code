import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPatch } from 'diff';
import { createTurnChangesReader, parseToolPatch, turnChanges } from '../src/turn-changes';
import { conversationEntries, type IndexedMessage } from '../src/conversation-presentation';
import type { Message } from '../src/contracts';

function edit(path: string, before: string, after: string, id = 'edit-1'): Message[] {
  return [
    { role: 'assistant', content: [{ type: 'toolCall', name: 'edit_file', id, arguments: { path } }] },
    { role: 'toolResult', toolName: 'edit_file', toolCallId: id, content: 'Done', details: { patch: createPatch(path, before, after) } },
  ];
}
const indexed = (messages: Message[]): IndexedMessage[] => messages.map((message, index) => ({ message, index }));

test('live reader reuses parsed results across prose deltas and invalidates tool changes', () => {
  const read = createTurnChangesReader();
  const messages = edit('a.ts', 'a\n', 'b\n');
  const first = read(indexed(messages));
  const prose: Message = { role: 'assistant', content: 'Continuing...' };
  assert.equal(read(indexed([...messages, prose])), first);
  assert.equal(read(indexed([...messages, { ...prose, content: 'Continuing the response...' }])), first);
  const replaced = read(indexed([messages[0], { ...messages[1], details: { patch: createPatch('a.ts', 'a\n', 'c\nd\n') } }]));
  assert.notEqual(replaced, first);
  assert.equal(replaced.added, 2);
  const moved = read(indexed([
    { role: 'assistant', content: [{ type: 'toolCall', name: 'edit_file', id: 'edit-1', arguments: { path: 'b.ts' } }] },
    messages[1],
  ]));
  assert.equal(moved.files[0].path, 'b.ts');
  assert.equal(read([]).files.length, 0);
});

test('turn patches retain true before/after line numbers, counts and inert text', () => {
  const patch = createPatch('src/main.ts', 'const old = 1;\nreturn old;\n', 'const value = 2;\nreturn value;\n');
  const result = parseToolPatch(patch, 'id')!;
  assert.equal(result.added, 2); assert.equal(result.removed, 2);
  assert.deepEqual(result.rows.filter(row => row.kind === 'remove').map(row => row.oldLine), [1, 2]);
  assert.deepEqual(result.rows.filter(row => row.kind === 'add').map(row => row.newLine), [1, 2]);
  const html = parseToolPatch(createPatch('a.html', '', '<img src=x onerror=alert(1)>\n'), 'html')!;
  assert.equal(html.rows.find(row => row.kind === 'add')!.text, '<img src=x onerror=alert(1)>');
});

test('repeated edits are kept as immutable operations, not claimed as a net diff', () => {
  const messages = [...edit('src/main.ts', 'a\n', 'b\n'), ...edit('src/main.ts', 'b\n', 'a\n', 'edit-2')];
  const before = JSON.stringify(messages);
  const changes = turnChanges(indexed(messages));
  assert.equal(changes.files.length, 1);
  assert.equal(changes.files[0].edits.length, 2);
  assert.equal(changes.added, 2); assert.equal(changes.removed, 2);
  assert.equal(changes.incomplete, false);
  assert.equal(JSON.stringify(messages), before);
});

test('turn boundaries prevent later edits from replacing previous records', () => {
  const messages: Message[] = [
    { role: 'user', content: 'first' }, ...edit('one.ts', 'a\n', 'b\n'),
    { role: 'assistant', content: 'Done.' },
    { role: 'user', content: 'second' }, ...edit('two.ts', 'a\n', 'c\n', 'edit-2'),
  ];
  const responses = conversationEntries(messages).filter(entry => entry.type === 'response');
  assert.equal(turnChanges(responses[0].items).files[0].path, 'one.ts');
  assert.equal(turnChanges(responses[1].items).files[0].path, 'two.ts');
});

test('failed, unmatched, duplicated and read-only results do not invent changes', () => {
  const messages = edit('src/main.ts', 'a\n', 'b\n');
  messages.push(messages[1], { ...messages[1], toolCallId: 'unknown' });
  assert.equal(turnChanges(indexed(messages)).files[0].edits.length, 1);
  assert.equal(turnChanges(indexed([{ ...messages[0] }, { ...messages[1], isError: true }])).files.length, 0);
  const read = messages.map(message => message.role === 'assistant' ?
    { ...message, content: [{ type: 'toolCall', name: 'read_file', id: 'edit-1', arguments: { path: 'src/main.ts' } }] } : message);
  assert.equal(turnChanges(indexed(read)).files.length, 0);
});

test('missing write snapshots or invalid patches explicitly produce partial records', () => {
  const messages = [...edit('a.ts', 'a\n', 'b\n'),
    { role: 'assistant', content: [{ type: 'toolCall', name: 'write_file', id: 'write-1', arguments: { path: 'b.ts', content: 'new' } }] },
    { role: 'toolResult', toolCallId: 'write-1', content: 'Done' },
  ] as Message[];
  const changes = turnChanges(indexed(messages));
  assert.equal(changes.files.length, 1); assert.equal(changes.incomplete, true);
  messages[1].details = { patch: 'not a patch' };
  assert.equal(turnChanges(indexed(messages)).files.length, 0);
});

test('malformed counts, multi-file patches, overlong lines and oversized payloads are bounded', () => {
  assert.equal(parseToolPatch('@@ -1,2 +1,1 @@\n-a\n+b\n', 'id'), undefined);
  assert.equal(parseToolPatch('x'.repeat(200001), 'id'), undefined);
  assert.equal(parseToolPatch(createPatch('a', '', 'x'.repeat(12001) + '\n'), 'id'), undefined);
  assert.equal(parseToolPatch(createPatch('a', 'a\n', 'b\n') + createPatch('b', 'a\n', 'b\n'), 'id'), undefined);
});
