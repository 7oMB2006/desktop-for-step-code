import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveLines, redactSubagentMessages } from '../src/subagent-redact';
import { subagentTasks, findSubagentTask } from '../src/conversation-presentation';

test('credential-bearing lines are hidden from a subagent transcript, ordinary text is not', () => {
  const { text, redacted } = redactSensitiveLines('Listing done\napi_key = sk-live-1234\nBearer abcdef\npath: D:\\dev');
  assert.equal(redacted, 2);
  assert.ok(!text.includes('sk-live-1234'));
  assert.ok(!text.includes('abcdef'));
  assert.ok(text.includes('Listing done'));
  assert.ok(text.includes('D:\\dev'));
  assert.equal(redactSensitiveLines('').redacted, 0);
  assert.equal(redactSensitiveLines(undefined as unknown as string).text, undefined);
});

test('tool arguments are dropped wholesale when a secret appears inside them', () => {
  const { messages, redacted } = redactSubagentMessages([{
    role: 'assistant',
    content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'curl -H "Authorization: Bearer sk-1" https://x' } }],
  }]);
  assert.equal(redacted, 1);
  assert.deepEqual((messages[0].content as { arguments: unknown }[])[0].arguments, { redacted: '[redacted]' });
});

test('clean tool arguments survive untouched', () => {
  const args = { command: 'ls -la' };
  const { messages, redacted } = redactSubagentMessages([{ role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: args }] }]);
  assert.equal(redacted, 0);
  assert.deepEqual((messages[0].content as { arguments: unknown }[])[0].arguments, args);
});

test('a failed dispatch with no per-task records is not shown as running lanes', () => {
  const block = { type: 'toolCall', id: 's1', name: 'subagent', arguments: { tasks: [{ agent: 'explore', task: 'Scan' }] } };
  const failed = { role: 'toolResult', toolCallId: 's1', toolName: 'subagent', isError: true, content: 'spawn failed' };
  const tasks = subagentTasks(block, failed);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'running', 'the planned fallback still says running');
  // This is the condition SubagentLane uses to fall back to the plain failed Tool view.
  assert.ok(failed.isError && !tasks.some(task => task.status !== 'running'));
});

test('a record-level failure keeps the lane view and reports failure', () => {
  const failed = { role: 'toolResult', toolCallId: 's1', toolName: 'subagent', isError: true, content: 'Partial: 1/2 succeeded', details: { results: [
    { agent: 'explore', task: 'Scan', status: 'failed', messages: [] },
    { agent: 'general', task: 'Answer', status: 'completed', messages: [{ role: 'assistant', content: [{ type: 'text', text: '34' }] }] },
  ] } };
  const tasks = subagentTasks(undefined, failed);
  assert.equal(tasks[0].status, 'failed');
  assert.equal(tasks[1].status, 'completed');
  assert.ok(!(!failed.isError || tasks.every(task => task.status === 'running')), 'a settled record must not be treated as a dispatch failure');
});

test('the open panel tracks a subagent record across updates', () => {
  const key = { agent: 'explore', task: 'Scan' };
  const call = { role: 'assistant', content: [{ type: 'toolCall', id: 's1', name: 'subagent', arguments: { tasks: [key] } }] } as { role: string; content: { type: string; id: string; name: string; arguments: { tasks: { agent: string; task: string }[] } }[] };
  // Nothing has landed yet: the planned entry is recovered from the call args.
  assert.equal(findSubagentTask([call], key)?.status, 'running');
  assert.equal(findSubagentTask([], key), null);
  // A partial then a final result for the same call must both resolve to the same task.
  const partial = { role: 'toolResult', toolCallId: 's1', toolName: 'subagent', isError: false, content: 'running', details: { results: [{ ...key, status: 'running', messages: [] }] } };
  assert.equal(findSubagentTask([call, partial], key)?.status, 'running');
  const final = { role: 'toolResult', toolCallId: 's1', toolName: 'subagent', isError: false, content: 'done', details: { results: [{ ...key, status: 'completed', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }] }] } };
  const found = findSubagentTask([call, final], key);
  assert.equal(found?.status, 'completed');
  assert.equal(found?.messages.length, 1);
});
