import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Content, Message } from '../src/contracts';
import { conversationEntries, messageBlocks, messageText, responsePresentation, toolPresentation, toolSubject, subagentTasks } from '../src/conversation-presentation';

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

test('hidden runtime messages stay in history but not response groups, prose or copied text', () => {
  const hidden: Message = {
    role: 'custom', customType: 'ultraloop-discovery', display: false, content: 'Internal discovery reminder',
  };
  const notification: Message = {
    role: 'custom', customType: 'agent-notification', display: false, content: 'Internal lane notification',
  };
  const visible: Message = { role: 'custom', customType: 'extension-notice', display: true, content: 'Visible notice' };
  const messages = [hidden, user('One'), hidden, call('a'), notification, result('a'), text('Answer'), hidden,
    user('Two'), hidden, visible, text('Second')];
  const copy = structuredClone(messages);
  const entries = conversationEntries(messages);
  assert.deepEqual(entries.map(entry => entry.type === 'user' ? entry.item.index : entry.index), [1, 3, 8, 10]);
  assert.deepEqual(entries[1].type === 'response' && entries[1].items.map(item => item.index), [3, 5, 6]);
  const projected = responsePresentation(indexed(messages.slice(2, 8)));
  assert.deepEqual(projected.content.map(item => item.type), ['thinking', 'text', 'tool', 'text']);
  assert.equal(projected.content.at(-1)?.index, 4, 'source indices are not compacted');
  assert.equal(projected.text, 'Checking files\n\nAnswer');
  assert.deepEqual(conversationEntries([hidden, notification]), []);
  assert.deepEqual(responsePresentation(indexed([hidden, notification])), { content: [], lastTextIndex: -1, text: '' });
  assert.equal(responsePresentation(indexed([visible])).text, 'Visible notice');
  assert.deepEqual(messages, copy, 'presentation must not erase model context or lane lifecycle records');
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

test('trusted historical notification bodies share safe render and copy text while retaining wrappers', () => {
  // Bypassing the display projection leaks content; filtering the whole wrapper loses its header/footer.
  const header = '<agent-notification agentId="lane-a" alias="general" event="background_done" status="completed">';
  const footer = '</agent-notification>';
  const cases = [
    { content: `${header}**Start**\r\n\r\napi_key = synthetic-old-key\r\n\r\nEnd${footer}`,
      want: `${header}**Start**\r\n\r\n[redacted]\r\n\r\nEnd${footer}` },
    { content: `${header}token&quot; = synthetic-first-line\nEnd${footer}`,
      want: `${header}[redacted]\nEnd${footer}` },
    { content: `${header}Start\nBearer&nbsp;synthetic-last-line${footer}`,
      want: `${header}Start\n[redacted]${footer}` },
    { content: 'Start\napi_key = synthetic-legacy-key\nEnd', want: 'Start\n[redacted]\nEnd' },
    { content: `${header}Start &lt;safe&gt;\napi&#95;key = synthetic-encoded\nEnd &amp; safe${footer}`,
      want: `${header}Start &lt;safe&gt;\n[redacted]\nEnd &amp; safe${footer}` },
    { content: '<agent-notification agentId="lane-a" alias="token&amp;quot; = synthetic-alias" event="background_done" status="completed">Start\nEnd</agent-notification>',
      want: '<agent-notification agentId="lane-a" alias="[redacted]" event="background_done" status="completed">Start\nEnd</agent-notification>' },
  ];
  for (const { content, want } of cases) {
    for (const shape of [content, [{ type: 'text', text: content }]]) {
      const message: Message = { role: 'custom', customType: 'agent-notification', display: true,
        content: shape, entryId: 'notice', details: { agentId: 'lane-a', event: 'background_done', status: 'completed',
          detail: 'Start\napi_key = synthetic-detail-key\nEnd' } };
      const original = structuredClone(message);
      const presented = responsePresentation(indexed([message]));
      assert.deepEqual(messageBlocks(message), [{ type: 'text', text: want }]);
      assert.equal(messageText(message), want);
      assert.equal(presented.text, want, 'response copy uses the same safe text as render');
      assert.equal(presented.content[0].type === 'text' && presented.content[0].block.text, want);
      assert.deepEqual(message, original, 'source history, structured detail and lifecycle must remain unchanged');
    }
  }
});

test('notification-looking prose never grants ordinary messages a redaction identity', () => {
  const content = '<agent-notification agentId="lane-a">Start\napi_key = synthetic-ordinary-key\nEnd</agent-notification>';
  for (const message of [user(content), text(content), { role: 'assistant', customType: 'agent-notification', content },
    { role: 'custom', customType: 'extension-notice', content },
    { role: 'toolResult', toolName: 'read_file', content },
    { role: 'assistant', toolName: 'subagent', content }]) {
    assert.equal(messageText(message), content);
    const presented = responsePresentation(indexed([message]));
    assert.equal(message.role === 'toolResult' ? messageText(presented.content.find(item => item.type === 'tool')!.result!)
      : presented.text, content);
  }
});

test('trusted subagent results redact output copies even when orphaned or paginated', () => {
  // An orphan/paginated Tool still copies the entire output, not only its first visible page.
  const prefix = 'Start\r\n\r\n' + 'safe output\r\n'.repeat(3500);
  const raw = `${prefix}api_key = synthetic-late-page-key\r\n\r\nEnd`;
  const want = `${prefix}[redacted]\r\n\r\nEnd`;
  for (const toolName of ['subagent', 'agent_send']) {
    const message: Message = { role: 'toolResult', toolCallId: 's1', toolName, isError: true,
      desktopToolPending: false, entryId: 'result', content: [{ type: 'text', text: raw },
        { type: 'image', mimeType: 'image/png', data: 'fixture' }],
      details: { agentId: 'lane-a', status: 'failed', detail: 'Start\nBearer synthetic-detail\nEnd',
        results: [{ agent: 'general', task: 'Check', status: 'failed', activeText: raw }] } };
    const original = structuredClone(message);
    assert.equal(messageText(message), want, 'direct Tool output is safe before pagination');
    for (const entries of [indexed([message]), indexed([
      { role: 'assistant', content: [{ type: 'toolCall', id: 's1', name: toolName, arguments: { task: 'Check' } }] }, message,
    ])]) {
      const presented = responsePresentation(entries);
      const tool = presented.content.find(item => item.type === 'tool')!;
      assert.ok(tool.result);
      assert.notEqual(tool.result, message, 'renderer receives an output copy, not the raw history object');
      assert.equal(messageText(tool.result), want);
      assert.deepEqual(messageBlocks(tool.result), [{ type: 'text', text: want }, { type: 'image', mimeType: 'image/png', data: 'fixture' }]);
      assert.equal(tool.result.details?.detail, 'Start\n[redacted]\nEnd');
      assert.equal(tool.result.toolCallId, 's1');
      assert.equal(tool.result.toolName, toolName);
      assert.equal(tool.result.isError, true);
      assert.equal(tool.result.desktopToolPending, false);
      assert.equal(tool.result.details?.status, 'failed');
      assert.equal(presented.text, '', 'tool output does not get added to response prose copy');
      if (tool.call) assert.deepEqual(tool.call.arguments, { task: 'Check' });
    }
    assert.deepEqual(message, original);
  }
});

test('trusted subagent calls expose a safe input copy without rewriting authoritative arguments', () => {
  const arguments_ = {
    task: 'TASK-BEGIN\napi&#95;key = synthetic-input-task\nTASK-END',
    chain: [{ agent: 'general', task: 'CHAIN-BEGIN\nBearer&nbsp;synthetic-input-chain\nCHAIN-END' }],
    prompt: 'PROMPT-BEGIN\nauth_token = synthetic-input-prompt\nPROMPT-END',
  };
  const history: Message[] = [{ role: 'assistant', content: [
    { type: 'toolCall', id: 's1', name: 'subagent', arguments: arguments_ },
  ] }, { role: 'toolResult', toolCallId: 's1', toolName: 'subagent', content: 'failed', isError: true }];
  const original = structuredClone(history);
  const tool = responsePresentation(indexed(history)).content.find(item => item.type === 'tool')!;
  assert.notEqual(tool.call?.arguments, arguments_);
  assert.doesNotMatch(JSON.stringify(tool.call?.arguments), /synthetic-input/);
  assert.match(JSON.stringify(tool.call?.arguments), /TASK-BEGIN/);
  assert.match(JSON.stringify(tool.call?.arguments), /CHAIN-END/);
  assert.match(JSON.stringify(tool.call?.arguments), /PROMPT-END/);
  assert.deepEqual(history, original);
});

test('trusted subagent input copies replace values beneath sensitive object keys', () => {
  for (const name of ['subagent', 'agent_send']) {
    const args = {
      api_key: 'synthetic-key-only-value',
      task: 'Keep this task description',
      nested: { 'api&#95;key': { value: 'synthetic-nested-value' }, safe: 'Keep this note' },
      chain: [{ agent: 'general', task: 'Keep this chain step', password: 'synthetic-array-value' }],
      prompt: 'PROMPT-BEGIN\nsecret = synthetic-line-value\nPROMPT-END',
    };
    const call: Content = { type: 'toolCall', id: 'key-call', name, arguments: args };
    const history: Message[] = [{ role: 'assistant', content: [call] },
      { role: 'toolResult', toolCallId: call.id, toolName: name, content: 'Dispatch failed', isError: true }];
    const before = structuredClone(history);
    const tool = responsePresentation(indexed(history)).content.find(item => item.type === 'tool')!;
    assert.deepEqual(tool.call?.arguments, {
      api_key: '[redacted]', task: args.task,
      nested: { 'api&#95;key': '[redacted]', safe: args.nested.safe },
      chain: [{ agent: 'general', task: 'Keep this chain step', password: '[redacted]' }],
      prompt: 'PROMPT-BEGIN\n[redacted]\nPROMPT-END',
    });
    assert.doesNotMatch(JSON.stringify(tool.call?.arguments), /synthetic-/);
    assert.equal(tool.call?.id, call.id);
    assert.equal(tool.call?.name, name);
    assert.deepEqual(history, before);
  }
});

test('clean subagent input copies retain call identity and ordinary tools stay outside this projection', () => {
  for (const name of ['subagent', 'agent_send', 'read_file']) {
    const args = name === 'read_file' ? { api_key: 'synthetic-ordinary-value' }
      : { task: 'Inspect files', chain: [{ agent: 'general', task: 'Summarize findings' }], action: 'status', lane_id: 'lane_12345678' };
    const call: Content = { type: 'toolCall', id: 'clean-call', name, arguments: args };
    const tool = responsePresentation(indexed([{ role: 'assistant', content: [call] }])).content.find(item => item.type === 'tool')!;
    assert.equal(tool.call, call);
    assert.equal(tool.call?.arguments, args);
  }
});

test('paired child results without toolName use the trusted call name without rewriting tool identity', () => {
  // Looking only at result.toolName leaks old paired results whose identity lives on the call.
  for (const name of ['subagent', 'agent_send']) {
    const callBlock: Content = { type: 'toolCall', id: 'old-call', name, arguments: { task: 'Check' } };
    const result: Message = { role: 'toolResult', toolCallId: 'old-call', isError: false,
      content: 'Start\napi_key = synthetic-paired-key\nEnd' };
    const history: Message[] = [{ role: 'assistant', content: [callBlock] }, result];
    const original = structuredClone(history);
    const tool = responsePresentation(indexed(history)).content.find(item => item.type === 'tool')!;
    assert.equal(messageText(tool.result!), 'Start\n[redacted]\nEnd');
    assert.equal(tool.result!.toolName, undefined, 'do not synthesize a tool name into history identity');
    assert.equal(tool.result!.toolCallId, 'old-call');
    assert.equal(tool.call, callBlock, 'the call and its input stay raw');
    assert.deepEqual(history, original);
    assert.equal(messageText(result), 'Start\napi_key = synthetic-paired-key\nEnd', 'without call or name, identity cannot be inferred');
  }
  const conflicting: Message = { role: 'toolResult', toolCallId: 'old-call', toolName: 'read_file',
    content: 'api_key = synthetic-unrelated-key' };
  const tool = responsePresentation(indexed([
    { role: 'assistant', content: [{ type: 'toolCall', id: 'old-call', name: 'subagent' }] }, conflicting,
  ])).content.find(item => item.type === 'tool')!;
  assert.equal(messageText(tool.result!), 'api_key = synthetic-unrelated-key', 'an explicit unrelated identity is not overwritten');
});

test('typed truncated notification fragments redact without inventing missing wrappers', () => {
  const message: Message = { role: 'custom', customType: 'agent-notification',
    content: 'Start\napi_key = synthetic-truncated-key\n\n[output truncated]' };
  assert.equal(messageText(message), 'Start\n[redacted]\n\n[output truncated]');
  assert.equal(messageText(text('Start\napi_key = synthetic-untyped-tail\n[output truncated]')),
    'Start\napi_key = synthetic-untyped-tail\n[output truncated]', 'a truncation marker alone is not notification identity');
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
  assert.equal(toolPresentation('bash', result('a', true), true, 'zh').label, '命令工具异常');
  assert.equal(toolPresentation('bash', undefined, false, 'zh').label, '运行命令（未返回）');
  assert.equal(toolPresentation('mcp_custom', undefined, true, 'en').label, 'Calling mcp_custom');
  assert.equal(toolPresentation('mcp_custom', result('a', true), false, 'zh').state, 'failed');
  assert.equal(toolPresentation('constructor', undefined, true, 'en').label, 'Calling constructor');
});

test('file checks distinguish successful mutation from verification failure without changing the runtime result', () => {
  for (const name of ['edit_file', 'write_file']) {
    for (const [exitCode, timedOut, expected] of [[0, false, '验证通过'], [7, false, '验证失败'],
      [null, true, '验证超时'], [null, false, '验证未完成']] as const) {
      const message: Message = { ...result('check'), details: { changed: true,
        thenRun: { command: 'printf check', exitCode, timedOut } } };
      const presentation = toolPresentation(name, message, false, 'zh');
      assert.equal(presentation.state, exitCode === 0 ? 'done' : 'failed');
      assert.match(presentation.label, new RegExp(expected));
      assert.doesNotMatch(presentation.label, /写入文件失败|修改文件失败/);
      assert.equal(message.isError, false, 'presentation must not mark a successful mutation as failed');
      assert.match(toolPresentation(name, message, false, 'en').label, /check/);
      assert.equal(toolPresentation(name, { ...message, desktopToolPending: true }, true, 'zh').state, 'running');
    }
  }
  const unchanged: Message = { ...result('check'), details: { changed: false,
    thenRun: { command: 'check', exitCode: 7, timedOut: false } } };
  assert.equal(toolPresentation('write_file', unchanged, false, 'zh').label, '文件内容未变化 · 验证失败');
  for (const thenRun of [null, [], { command: 'check', timedOut: 'yes', exitCode: 7 },
    { command: 'check', timedOut: false, exitCode: -1 }, { command: '', timedOut: false, exitCode: 7 }]) {
    assert.equal(toolPresentation('write_file', { ...result('check'), details: { thenRun } }, false, 'zh').label, '写入了文件');
  }
  assert.equal(toolPresentation('write_file', result('cancelled', true), false, 'zh', { then_run: 'check' }).label, '文件修改或验证未完成');
  assert.equal(toolPresentation('write_file', result('failed', true), false, 'zh', { then_run: ' ' }).label, '写入文件失败');
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
test('chain queued and skipped records survive projection and background settlement', () => {
  const call = subagentCall({ chain: [{ agent: 'general', task: 'A' }, { agent: 'general', task: 'B' }, { agent: 'general', task: 'C' }] });
  assert.deepEqual(subagentTasks(call, undefined).map(task => task.status), ['running', 'queued', 'queued']);
  const dispatch = subagentResult({ agentId: 'lane', status: 'running' });
  assert.deepEqual(subagentTasks(call, dispatch, new Map([['lane', 'running']])).map(task => task.status), ['running', 'queued', 'queued']);
  const progress = subagentResult({ agentId: 'lane', results: [{ status: 'completed' }, { status: 'running' }, { status: 'queued' }] });
  assert.deepEqual(subagentTasks(call, progress, new Map([['lane', 'running']])).map(task => task.status), ['completed', 'running', 'queued']);
  const records = ['completed', 'failed', 'skipped'].map((status, index) => ({ agent: 'general', task: String(index), status, messages: [] }));
  assert.deepEqual(subagentTasks(call, subagentResult({ results: records })).map(task => task.status), ['completed', 'failed', 'skipped']);
  const queued = subagentResult({ agentId: 'lane', results: [{ status: 'completed' }, { status: 'queued' }, { status: 'skipped' }] });
  assert.deepEqual(subagentTasks(call, queued, new Map([['lane', 'failed']])).map(task => task.status), ['completed', 'failed', 'skipped']);
});
test('bounded rosters backfill omitted tasks from the planned dispatch', () => {
  const call = subagentCall({ tasks: [{ agent: 'general', task: 'T0' }, { agent: 'general', task: 'T1' }, { agent: 'general', task: 'T2' }] });
  const bounded = subagentTasks(call, subagentResult({ results: [
    { agent: 'general', task: 'T0', status: 'completed', messages: [] },
    { agent: 'general', task: 'T1', status: 'completed', messages: [] },
  ], omittedResults: 1 }));
  assert.deepEqual(bounded.map(task => [task.task, task.status, task.omitted === true]), [
    ['T0', 'completed', false], ['T1', 'completed', false], ['T2', 'running', true],
  ]);
  const chain = subagentCall({ chain: [{ agent: 'general', task: 'A' }, { agent: 'general', task: 'B' }, { agent: 'general', task: 'C' }] });
  const boundedChain = subagentTasks(chain, subagentResult({ results: [{ agent: 'general', task: 'A', status: 'completed', messages: [] }], omittedResults: 2 }));
  assert.deepEqual(boundedChain.map(task => [task.task, task.status, task.omitted === true]), [
    ['A', 'completed', false], ['B', 'queued', true], ['C', 'queued', true],
  ]);
  // Lane settlement reaches flagged rows through the same override as visible queued records.
  const settled = subagentTasks(chain, subagentResult({ agentId: 'lane', status: 'failed', results: [{ agent: 'general', task: 'A', status: 'completed', messages: [] }], omittedResults: 2 }), new Map([['lane', 'failed']]));
  assert.deepEqual(settled.map(task => [task.task, task.status, task.omitted === true]), [
    ['A', 'completed', false], ['B', 'failed', true], ['C', 'failed', true],
  ]);
  // A count without a planned list cannot invent tasks.
  const unplanned = subagentTasks(undefined, subagentResult({ results: [{ agent: 'general', task: 'A', status: 'completed', messages: [] }], omittedResults: 3 }));
  assert.deepEqual(unplanned.map(task => task.task), ['A']);
});

