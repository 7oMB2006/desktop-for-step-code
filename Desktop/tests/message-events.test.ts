import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMessageEvent, applyToolResult } from '../src/message-events';
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

test('tool results arrive while the turn runs, so a long call does not read as unfinished until the turn ends', () => {
  const call = { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'subagent', arguments: { tasks: [{ agent: 'explore', task: 'Scan' }] } }] };
  const withFinal = applyToolResult([call], {
    type: 'tool_execution_end', toolCallId: 'c1', toolName: 'subagent', isError: false,
    result: { content: [{ type: 'text', text: 'done' }], details: { mode: 'parallel', results: [{ agent: 'explore', status: 'completed', messages: [] }] } },
  });
  assert.equal(withFinal.length, 2);
  assert.equal(withFinal[1].role, 'toolResult');
  assert.equal(withFinal[1].toolCallId, 'c1');
  assert.deepEqual(withFinal[1].details?.results, [{ agent: 'explore', status: 'completed', messages: [] }]);
});

test('partial results are replaced in place, never duplicated, and errors only come from the final event', () => {
  let messages = applyToolResult([], {
    type: 'tool_execution_update', toolCallId: 'c1', toolName: 'subagent',
    partialResult: { content: [{ type: 'text', text: 'running' }], details: { results: [{ agent: 'explore', status: 'running', messages: [] }] } },
  });
  messages = applyToolResult(messages, {
    type: 'tool_execution_update', toolCallId: 'c1', toolName: 'subagent',
    partialResult: { content: [{ type: 'text', text: 'running' }], details: { results: [{ agent: 'explore', status: 'running', messages: [{ role: 'user', content: 'go' }] }] } },
  });
  assert.equal(messages.filter(m => m.role === 'toolResult').length, 1, 'a repeat update must not orphan the earlier result');
  assert.equal(messages[0].isError, false, 'a partial is never an error');
  assert.equal((messages[0].details?.results as { messages: unknown[] }[])[0].messages.length, 1);
  messages = applyToolResult(messages, {
    type: 'tool_execution_end', toolCallId: 'c1', toolName: 'subagent', isError: true,
    result: { content: [{ type: 'text', text: 'boom' }] },
  });
  assert.equal(messages.filter(m => m.role === 'toolResult').length, 1);
  assert.equal(messages[0].isError, true);
  assert.equal(messages[0].details, undefined, 'the final event without details clears the partial details');
});

test('tool result events without a call id or a payload are ignored', () => {
  const base = [{ role: 'user', content: 'hi' }];
  assert.deepEqual(applyToolResult(base, { type: 'tool_execution_end', toolName: 'x', result: { content: 'y' } }), base);
  assert.deepEqual(applyToolResult(base, { type: 'tool_execution_end', toolCallId: 'c1', result: null }), base);
  assert.deepEqual(applyToolResult(base, { type: 'tool_execution_end', toolCallId: 'c1', result: 'plain' }), base);
  assert.deepEqual(applyToolResult(base, { type: 'message_update' }), base);
  assert.deepEqual(applyToolResult(base, { type: 'agent_end' }), base);
});

