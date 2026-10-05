import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Content, Message } from '../src/contracts';
import { conversationEntries, messageText, responsePresentation, toolPresentation, toolSubject, subagentTasks } from '../src/conversation-presentation';

test('cross-session tools have task-specific labels without claiming cancelled messages were sent', () => {
  assert.equal(toolPresentation('desktop_sessions', undefined, true, 'zh').label, '正在查看会话');
  assert.equal(toolPresentation('desktop_read_session', undefined, true, 'en').label, 'Reading session');
  assert.equal(toolPresentation('desktop_send_message', { role: 'toolResult', content: '{"delivered":false}' }, false, 'zh').label, '处理了会话传话请求');
});

const user = (text: string): Message => ({ role: 'user', content: text });
const text = (value: string): Message => ({ role: 'assistant', content: [{ type: 'text', text: value }] });
const call = (id: string): Message => ({ role: 'assistant', content: [
  { type: 'thinking', thinking: 'Reasoning' }, { type: 'text', text: 'Checking files' },
  { type: 'toolCall', id, name: 'read_file', arguments: { path: 'test.md' } },
] });
const result = (id: string, isError = false): Message => ({ role: 'toolResult', toolCallId: id, isError, content: 'File content' });
const indexed = (messages: Message[]) => messages.map((message, index) => ({ message, index }));

test('response grouping preserves user anchors and separates adjacent turns without mutating messages', () => {
  const messages = [user('One'), call('a'), result('a'), text('Answer'), user('Two'), text('Second')];
  const copy = structuredClone(messages);
  const entries = conversationEntries(messages);
  assert.deepEqual(entries.map(entry => entry.type === 'user' ? entry.item.index : entry.index), [0, 1, 4, 5]);
  assert.equal(entries[1].type === 'response' && entries[1].items.length, 3);
  assert.deepEqual(messages, copy);
});

test('tool results match call IDs rather than completion order and retain errors and images', () => {
  const image = { type: 'image', mimeType: 'image/png', data: 'fixture' };
  const messages = indexed([call('a'), call('b'), result('b', true), { ...result('a'), content: [image] }, text('Done')]);
  const { content, text: copiedText } = responsePresentation(messages);
  const tools = content.filter(item => item.type === 'tool');
  assert.equal(tools.length, 2);
  assert.equal(tools[0].result?.toolCallId, 'a');
  assert.equal(tools[1].result?.isError, true);
  assert.deepEqual(tools[0].result?.content, [image]);
  assert.deepEqual(content.map(item => item.type), ['thinking', 'text', 'tool', 'thinking', 'text', 'tool', 'text']);
  assert.equal(content.at(-1)?.index, 4);
  assert.equal(copiedText, 'Checking files\n\nChecking files\n\nDone');
});

test('unfinished calls preserve narration without falsely successful results', () => {
  const { content, text: copiedText } = responsePresentation(indexed([call('a')]));
  assert.equal(content.filter(item => item.type === 'tool')[0].result, undefined);
  assert.equal(content.filter(item => item.type === 'text').length, 1);
  assert.equal(copiedText, 'Checking files');
});

test('orphan results, reasoning-only responses, and early narration remain in source order', () => {
  const messages = indexed([result('missing'), text('Plan'), { role: 'assistant', content: [{ type: 'thinking', thinking: 'Only reasoning' }] }]);
  const { content } = responsePresentation(messages);
  assert.deepEqual(content.map(item => item.type), ['tool', 'text', 'thinking']);
  assert.equal(content[0].type === 'tool' && content[0].result?.toolCallId, 'missing');
});

test('copy text excludes reasoning, tool arguments and images; tool subjects are bounded', () => {
  assert.equal(messageText(call('a')), 'Checking files');
  const response = responsePresentation(indexed([
    text('Plan'), call('a'), result('a'), {
      role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', data: 'fixture' }, { type: 'text', text: 'Conclusion' }],
    },
  ]));
  assert.equal(response.text, 'Plan\n\nChecking files\n\nConclusion');
  assert.deepEqual(response.content.map(item => item.type), ['text', 'thinking', 'text', 'tool', 'image', 'text']);
  assert.equal(toolSubject({ type: 'toolCall', arguments: { command: 'a\n'.repeat(200) } }).length, 160);
  assert.equal(toolSubject({ type: 'toolCall', arguments: null }), '');
});

test('tool summaries localize built-in names and aliases without exposing arguments', () => {
  for (const name of ['bash', 'powershell', 'run_command', 'exec_command']) {
    assert.equal(toolPresentation(name, undefined, true, 'zh').label, '正在运行命令');
    assert.equal(toolPresentation(name, result('a'), true, 'zh').label, '运行了命令');
  }
  assert.equal(toolPresentation('write_file', result('a'), false, 'zh').label, '写入了文件');
  assert.equal(toolPresentation('read', undefined, true, 'zh').label, '正在读取文件');
  assert.equal(toolPresentation('edit', result('a'), false, 'en').label, 'Edited file');
  assert.equal(toolPresentation('grep', result('a'), false, 'zh').label, '搜索了内容');
});

test('tool state is per-call and never mistakes a missing result for success', () => {
  assert.equal(toolPresentation('bash', result('a'), true, 'zh').state, 'done');
  assert.equal(toolPresentation('bash', result('a', true), true, 'zh').label, '运行命令失败');
  assert.equal(toolPresentation('bash', undefined, false, 'zh').label, '运行命令（未返回）');
  assert.equal(toolPresentation('mcp_custom', undefined, true, 'en').label, 'Calling mcp_custom');
  assert.equal(toolPresentation('mcp_custom', result('a', true), false, 'zh').state, 'failed');
  assert.equal(toolPresentation('constructor', undefined, true, 'en').label, 'Calling constructor');
});

test('thinking disclosure advances on actual prose, not an empty streaming block or tool result', () => {
  const reasoning: Message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'Working' }] };
  assert.equal(responsePresentation(indexed([reasoning])).lastTextIndex, -1);
  assert.equal(responsePresentation(indexed([reasoning, text('  '), result('missing')])).lastTextIndex, -1);
  const response = responsePresentation(indexed([reasoning, text('First visible text'), reasoning]));
  assert.equal(response.lastTextIndex, 1);
  assert.equal(response.content[2].type, 'thinking', 'later reasoning remains independently expandable during a new phase');
});

const subagentCall = (arguments_: Record<string, unknown>): Content => ({ type: 'toolCall', id: 's1', name: 'subagent', arguments: arguments_ });
const subagentResult = (details: unknown, isError = false): Message => ({
  role: 'toolResult', toolCallId: 's1', toolName: 'subagent', isError, content: 'Parallel: 2/2 succeeded',
  ...(details === undefined ? {} : { details: details as { patch?: string; diff?: string } }),
});

test('subagent tasks come from the result records, falling back to the planned call args', () => {
  const call = subagentCall({ tasks: [{ agent: 'explore', task: 'List dirs' }, { agent: 'general', task: 'Answer' }] });
  const planned = subagentTasks(call, undefined);
  assert.deepEqual(planned.map(task => [task.agent, task.task, task.status]), [['explore', 'List dirs', 'running'], ['general', 'Answer', 'running']]);
  const running = subagentTasks(call, subagentResult({ results: [
    { agent: 'explore', task: 'List dirs', status: 'running', messages: [] },
    { agent: 'general', task: 'Answer', status: 'completed', messages: [{ role: 'assistant', content: [{ type: 'text', text: '34' }] }] },
  ] }));
  assert.deepEqual(running.map(task => [task.agent, task.status]), [['explore', 'running'], ['general', 'completed']]);
  assert.deepEqual(running[1].messages.map(message => messageText(message)), ['34']);
});

test('subagent failure and aborted states are not reported as completion', () => {
  const call = subagentCall({ agent: 'explore', task: 'Scan' });
  for (const [status, expected] of [['failed', 'failed'], ['aborted', 'aborted'], ['running', 'running'], ['completed', 'completed']] as const) {
    const [task] = subagentTasks(call, subagentResult({ results: [{ agent: 'explore', task: 'Scan', status, messages: [] }] }));
    assert.equal(task.status, expected);
    if (status !== 'completed') assert.notEqual(task.status, 'completed', `${status} must not read as done`);
  }
  const [errored] = subagentTasks(call, subagentResult({ results: [{ agent: 'explore', task: 'Scan', status: 'completed', messages: [] }] }, true));
  assert.equal(errored.status, 'completed', 'the record status decides rendering; isError stays on the message');
});

test('subagent records tolerate missing fields and non-object junk', () => {
  const call = subagentCall({ tasks: [{ agent: 'explore', task: 'A' }] });
  assert.deepEqual(subagentTasks(call, subagentResult({ results: [null, 'x', 3] })).map(t => [t.agent, t.status]), [['explore', 'running']]);
  assert.deepEqual(subagentTasks(call, subagentResult({})).map(t => t.agent), ['explore']);
  assert.deepEqual(subagentTasks(call, subagentResult({ results: [{ status: 'weird' }] })).map(t => t.status), ['running']);
  const [withUsage] = subagentTasks(call, subagentResult({ results: [{ agent: 'explore', task: 'A', status: 'completed', messages: [{ role: 'user', content: 'go' }, 'junk'], model: 'step-5', usage: { turns: 2 } }] }));
  assert.equal(withUsage.model, 'step-5');
  assert.equal(withUsage.turns, 2);
  assert.deepEqual(withUsage.messages.map(message => message.role), ['user']);
});

