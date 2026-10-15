import assert from 'node:assert/strict';
import test from 'node:test';
import { groupProcesses, liveThinkingKey, processGroupSummary, thinkingPreview, type ProcessGroup } from '../src/process-groups';
import type { ResponseItem } from '../src/conversation-presentation';
import type { ToolItem } from '../src/tool-groups';

const thought = (key: string): ResponseItem => ({ type: 'thinking', key, index: 0, block: { type: 'thinking', thinking: 'First paragraph.\n\n**Latest thought.**' } });
const tool = (key: string, completed = true, name = 'read_file'): ToolItem => ({
  type: 'tool', key, index: 0, call: { type: 'toolCall', id: key, name, arguments: { path: 'src/main.ts' } },
  ...(completed ? { result: { role: 'toolResult', toolName: name, toolCallId: key, content: 'ok' } } : {}),
});
const prose: ResponseItem = { type: 'text', key: 'prose', index: 0, block: { type: 'text', text: 'Actual reply.' } };

test('compact process combines thoughts and tools but never crosses prose or image boundaries', () => {
  const input = [thought('a'), tool('b'), thought('c'), tool('d'), prose, thought('e')];
  const before = structuredClone(input);
  const groups = groupProcesses(input, false);
  assert.equal(groups.length, 3);
  const first = groups[0] as ProcessGroup;
  assert.deepEqual(first.items, input.slice(0, 4));
  assert.equal(first.running, false);
  assert.equal(groups[1], prose);
  assert.deepEqual(input, before);
  assert.deepEqual(processGroupSummary(first, 'zh'), { label: '已完成：读取文件 2 项', detail: '' });
  const image: ResponseItem = { type: 'image', key: 'image', index: 0, block: { type: 'image' } };
  assert.equal(groupProcesses([thought('a'), image, tool('b')], false).length, 3);
});

test('compact progress retains identity and switches from thinking to tool activity to completion', () => {
  const first = groupProcesses([thought('a')], true)[0] as ProcessGroup;
  assert.deepEqual(processGroupSummary(first, 'zh'), { label: '正在思考', detail: 'Latest thought.' });
  const next = groupProcesses([thought('a'), tool('b', false)], true)[0] as ProcessGroup;
  assert.equal(next.key, first.key);
  assert.equal(processGroupSummary(next, 'en').detail, 'src/main.ts');
  assert.match(processGroupSummary(next, 'en').label, /Reading/);
  const ended = groupProcesses([thought('a'), tool('b'), prose], true)[0] as ProcessGroup;
  assert.equal(ended.running, false, 'later prose closes the process even while the turn is active');
  assert.equal(ended.key, first.key);
});

test('compact process leaves errors approvals missing results and dedicated tools outside', () => {
  const failed = { ...tool('b'), result: { ...tool('b').result!, isError: true } };
  for (const item of [failed, tool('b', false), ...['subagent', 'workflow', 'enter_plan_mode', 'exit_plan_mode', 'clarify_user', 'desktop_send_message'].map(name => tool('b', true, name))]) {
    const result = groupProcesses([thought('a'), item, thought('c')], false);
    assert.equal(result[1], item);
    assert.equal(result.length, 3);
  }
  const awaiting = tool('b', false);
  assert.equal(groupProcesses([thought('a'), awaiting], true, ['b'])[1], awaiting);
  const pending = { ...tool('b'), result: { ...tool('b').result!, desktopToolPending: true } };
  assert.equal((groupProcesses([thought('a'), pending], true)[0] as ProcessGroup).running, true);
  assert.equal(groupProcesses([thought('a'), pending], false)[1], pending);
});

test('thinking activity ends on tools or prose and ignores empty text placeholders', () => {
  assert.equal(liveThinkingKey([thought('a')], true), 'a');
  assert.equal(liveThinkingKey([thought('a'), tool('b', false)], true), undefined);
  assert.equal(liveThinkingKey([thought('a'), prose], true), undefined);
  assert.equal(liveThinkingKey([thought('a')], false), undefined);
  const empty: ResponseItem = { ...prose, block: { type: 'text', text: '' } };
  assert.equal(liveThinkingKey([thought('a'), empty], true), 'a');
  assert.equal(groupProcesses([thought('a'), empty, tool('b')], false).length, 1);
  assert.equal(thinkingPreview('**First line.**\nmore\n\nNewest line.', false), 'First line.');
  assert.equal(thinkingPreview('**First line.**\nmore\n\nNewest line.', true), 'Newest line.');
});
