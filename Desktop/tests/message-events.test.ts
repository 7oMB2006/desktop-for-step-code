import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMessageEvent } from '../src/message-events';
test('wire deltas without message snapshots update text, thinking and tool calls without mutating prior state', () => {
  const start = applyMessageEvent([], { type: 'message_start', message: { role: 'assistant', content: [] } });
  let next = start;
  for (const delta of [
    { type: 'thinking_start', contentIndex: 0 }, { type: 'thinking_delta', contentIndex: 0, delta: 'Thinking' },
    { type: 'text_start', contentIndex: 1 }, { type: 'text_delta', contentIndex: 1, delta: '你好' },
    { type: 'toolcall_start', contentIndex: 2, id: 'a', toolName: 'read_file' },
    { type: 'toolcall_delta', contentIndex: 2, delta: '{' },
  ]) next = applyMessageEvent(next, { type: 'message_update', assistantMessageEvent: delta });
  assert.deepEqual(start[0].content, []);
  assert.deepEqual(next[0].content, [{ type: 'thinking', thinking: 'Thinking' }, { type: 'text', text: '你好' }, { type: 'toolCall', id: 'a', name: 'read_file', arguments: {} }]);
  const final = { role: 'assistant', content: [{ type: 'text', text: '你好！' }] };
  assert.deepEqual(applyMessageEvent(next, { type: 'message_end', message: final }), [final]);
});
