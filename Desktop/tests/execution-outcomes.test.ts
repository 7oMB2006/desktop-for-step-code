import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatch } from 'diff';
import { commandOutcomePresentation, readCommandOutcome } from '../src/command-outcome';
import { toolPresentation, type ResponseItem } from '../src/conversation-presentation';
import { groupConsecutiveTools } from '../src/tool-groups';
import { groupProcesses } from '../src/process-groups';
import { incompleteResponse } from '../src/incomplete-response';
import type { Message } from '../src/contracts';

const execution = (status: string, extra: Record<string, unknown> = {}) =>
  ({ status, exitCode: null, signal: null, timedOut: false, aborted: false, ...extra });
const result = (observed: unknown): Message => ({ role: 'toolResult', content: '', isError: false, details: { execution: observed } });

test('native command outcomes retain exit, signal, deadline and cancellation facts in both languages', () => {
  for (const [observed, state, expected] of [
    [execution('exited', { exitCode: 0 }), 'done', /通过/],
    [execution('exited', { exitCode: -7 }), 'failed', /退出码 -7/],
    [execution('timed_out', { exitCode: 0, signal: 'SIGTERM', timeoutSeconds: .25 }), 'failed', /超时.*0\.25s.*SIGTERM.*退出码 0/],
    [execution('signaled', { signal: 'SIGKILL' }), 'failed', /信号终止.*SIGKILL/],
    [execution('canceled', { exitCode: 7, signal: 'SIGTERM' }), 'stopped', /已取消.*SIGTERM.*退出码 7/],
    [execution('unknown'), 'unknown', /结果未知/],
  ] as const) {
    for (const name of ['run_command', 'bash', 'powershell', 'exec_command']) {
      const message = result(observed);
      const before = JSON.stringify(message);
      const zh = toolPresentation(name, message, false, 'zh');
      assert.equal(zh.state, state);
      assert.match(zh.label, expected);
      assert.equal(toolPresentation(name, message, false, 'en').state, state);
      assert.equal(JSON.stringify(message), before);
      assert.equal(toolPresentation(name, { ...message, desktopToolPending: true }, true, 'zh').state, 'running');
    }
  }
  const error = toolPresentation('run_command', { ...result(execution('exited', { exitCode: 0 })), isError: true }, false, 'zh');
  assert.equal(error.label, '命令工具异常');
  assert.match(error.status, /命令通过/);
  assert.equal(toolPresentation('run_command', { ...result(execution('canceled')), isError: true }, false, 'zh').state, 'stopped',
    'Native cancellation can reject the invocation while retaining the authoritative process outcome');
});

test('malformed outcomes stay unknown and status overrides contradictory redundant booleans', () => {
  for (const value of [null, [], {}, execution('exited'), execution('exited', { exitCode: 1.5 }),
    execution('signaled'), execution('exited', { exitCode: 0, signal: 2 }), execution('unknown', { timeoutSeconds: NaN }),
    execution('unknown', { timeoutSeconds: -1 }), execution('unknown', { signal: 'SIG\nKILL' }), execution('new-status')]) {
    assert.equal(readCommandOutcome(value), undefined);
    assert.equal(toolPresentation('run_command', result(value), false, 'zh').state, 'unknown');
  }
  const observed = readCommandOutcome(execution('canceled', { aborted: false, timedOut: true }))!;
  assert.equal(commandOutcomePresentation(observed, 'en').state, 'stopped');
  assert.equal(toolPresentation('custom', result(execution('exited', { exitCode: 7 })), false, 'en').state, 'done',
    'unrelated tools do not inherit shell semantics');
});

test('then_run reports applied edits separately from validation and invocation failures', () => {
  const patch = createPatch('a.ts', 'old\n', 'new\n');
  for (const status of ['exited', 'timed_out', 'signaled', 'canceled', 'unknown']) {
    const observed = execution(status, { exitCode: 7, signal: 'SIGTERM' });
    const message: Message = { role: 'toolResult', isError: status === 'canceled', content: '',
      details: { changed: true, patch, thenRun: { command: 'check', exitCode: 0, timedOut: false, execution: observed } } };
    const view = toolPresentation('edit_file', message, false, 'zh', { then_run: 'check' });
    assert.match(view.label, /^修改了文件 · 验证/);
    assert.notEqual(view.state, 'done');
    if (status === 'canceled') {
      assert.equal(view.state, 'stopped');
      assert.match(view.label, /已取消/);
    }
  }
  const checkError: Message = { role: 'toolResult', content: '', details: { changed: true,
    thenRun: { command: 'check', exitCode: null, timedOut: false, invocationError: 'Example adapter fault' } } };
  assert.equal(toolPresentation('write_file', checkError, false, 'zh').label, '写入了文件 · 验证未能启动');
  const processingError: Message = { role: 'toolResult', content: '', isError: true, details: { patch } };
  assert.equal(toolPresentation('edit_file', processingError, false, 'zh').label, '文件已修改 · 后续处理未完成');
});

test('failed, cancelled and unknown commands remain visible outside successful process groups', () => {
  for (const status of ['exited', 'timed_out', 'signaled', 'canceled', 'unknown']) {
    const middle: ResponseItem = { type: 'tool', key: 'middle', index: 1,
      call: { type: 'toolCall', name: 'run_command', id: 'command' },
      result: result(execution(status, { exitCode: 7, signal: 'SIGTERM' })) };
    const content: ResponseItem[] = [
      { type: 'tool', key: 'first', index: 0, call: { type: 'toolCall', name: 'read_file' }, result: { role: 'toolResult', content: '' } },
      middle,
      { type: 'tool', key: 'last', index: 2, call: { type: 'toolCall', name: 'read_file' }, result: { role: 'toolResult', content: '' } },
    ];
    assert.equal(groupConsecutiveTools(content, false)[1], middle);
    assert.ok(groupProcesses(content, false).includes(middle));
  }
});

test('incomplete response notices follow the final assistant, not hidden recovery prompts or old failures', () => {
  const empty: Message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'Example thought' }],
    stopReason: 'stop', incomplete: 'no_visible_output' };
  const hidden: Message = { role: 'custom', customType: 'step-incomplete-turn-recovery', display: false, content: 'INTERNAL PROMPT' };
  assert.match(incompleteResponse([empty, hidden], true, 'zh')!, /等待运行时/);
  assert.match(incompleteResponse([empty, hidden], false, 'zh')!, /本轮未完成/);
  assert.doesNotMatch(incompleteResponse([empty, hidden], false, 'en')!, /INTERNAL PROMPT/);
  assert.equal(incompleteResponse([empty, hidden, { role: 'assistant', content: 'Recovered', stopReason: 'stop' }], false, 'en'), undefined);
});
