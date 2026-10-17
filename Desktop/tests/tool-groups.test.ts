import assert from 'node:assert/strict';
import test from 'node:test';
import { toolPresentation, type ResponseItem } from '../src/conversation-presentation';
import { groupConsecutiveTools, toolGroupLabel, type ToolItem } from '../src/tool-groups';

const tool = (id: string, name = 'read_file', result = true): ToolItem => ({
  type: 'tool', key: id, index: Number(id) || 0, call: { type: 'toolCall', id, name, arguments: { path: `${id}.ts` } },
  ...(result ? { result: { role: 'toolResult', toolName: name, toolCallId: id, content: 'ok' } } : {}),
});
const text: ResponseItem = { type: 'text', key: 'text', index: 4, block: { type: 'text', text: 'Prose boundary' } };

test('only adjacent ordinary tools combine without changing source items', () => {
  const a = tool('1'), b = tool('2'), c = tool('3');
  const input = [a, b, text, c];
  const output = groupConsecutiveTools(input, false);
  assert.deepEqual(output, [{ type: 'tool-group', key: 'tools:1', index: 1, items: [a, b] }, text, c]);
  assert.deepEqual(input, [a, b, text, c]);
});

test('approvals, errors, missing results and special tools remain visible boundaries', () => {
  for (const boundary of [
    { ...tool('3'), result: { ...tool('3').result!, isError: true } },
    ...['subagent', 'workflow', 'enter_plan_mode', 'exit_plan_mode', 'desktop_send_message', 'clarify_user'].map(name => tool('3', name)),
    tool('3', 'run_command', false),
  ]) {
    const input = [tool('1'), tool('2'), boundary, tool('4')];
    const output = groupConsecutiveTools(input, false);
    assert.equal(output[0].type, 'tool-group');
    assert.equal(output[1], boundary);
    assert.equal(output[2], input[3]);
  }
  const waiting = tool('2', 'run_command', false);
  assert.deepEqual(groupConsecutiveTools([tool('1'), waiting, tool('3')], true, ['2']), [tool('1'), waiting, tool('3')]);
});

test('pending structured questions stay outside live groups before and after answers', () => {
  for (const completed of [false, true]) {
    const question = tool('2', 'clarify_user', completed);
    const input = [tool('1'), question, tool('3')];
    assert.deepEqual(groupConsecutiveTools(input, true), input);
  }
});

test('live group identity survives arriving tools and results', () => {
  const a = tool('1'), b = tool('2', 'run_command', false);
  const first = groupConsecutiveTools([a, b], true)[0];
  const next = groupConsecutiveTools([a, tool('2', 'run_command'), tool('3', 'search', false)], true)[0];
  assert.equal(first.key, next.key);
  assert.equal(toolGroupLabel([a, b], 'zh'), '正在处理工具 · 1 / 2 项已返回');
  assert.equal(toolGroupLabel([a, tool('2', 'run_command')], 'zh'), '已完成：读取文件 1 项、命令执行 1 项');
  assert.match(toolGroupLabel([a, b], 'en'), /1 \/ 2 results received/);
});

test('image and thinking blocks also prevent cross-boundary grouping', () => {
  for (const type of ['image', 'thinking'] as const) {
    const boundary: ResponseItem = { type, key: type, index: 2, block: { type } };
    const input = [tool('1'), boundary, tool('3')];
    assert.deepEqual(groupConsecutiveTools(input, false), input);
  }
});

test('partial tool output remains running and becomes unreturned on interruption', () => {
  const partial = { ...tool('2'), result: { ...tool('2').result!, desktopToolPending: true } };
  assert.equal(toolGroupLabel([tool('1'), partial], 'zh'), '正在处理工具 · 1 / 2 项已返回');
  assert.equal(toolPresentation('read_file', partial.result, true, 'zh').state, 'running');
  assert.equal(toolPresentation('read_file', partial.result, false, 'zh').state, 'missing');
  assert.deepEqual(groupConsecutiveTools([tool('1'), partial], false), [tool('1'), partial]);
});

test('failed embedded checks stay visible outside successful tool and compact process groups', async () => {
  const { groupProcesses } = await import('../src/process-groups');
  for (const timedOut of [false, true]) {
    const boundary = tool('2', 'write_file');
    boundary.result!.details = { changed: true, thenRun: { command: 'check', exitCode: timedOut ? null : 7, timedOut } };
    const input = [tool('1'), boundary, tool('3')];
    assert.deepEqual(groupConsecutiveTools(input, false), input);
    const compact = groupProcesses(input, false);
    assert.equal(compact[1], boundary, 'a failed check cannot become a completed process summary');
  }
});
