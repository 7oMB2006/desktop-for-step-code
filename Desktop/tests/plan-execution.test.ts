import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../src/contracts';
import { approvedPlan, planExecution, planExecutionResponses } from '../src/plan-execution';
import { conversationEntries } from '../src/conversation-presentation';

const approval: Message = { role: 'toolResult', toolName: 'exit_plan_mode', content: 'Approved',
  details: { outcome: 'approved', planFilePath: 'D:\\proposal.md', planContents: '# My plan\n\nApproved scope' } };
test('approval notes require a successful native result and retain the exact snapshot', () => {
  assert.deepEqual(approvedPlan(approval), { path: 'D:\\proposal.md', content: '# My plan\n\nApproved scope', title: 'My plan' });
  for (const outcome of ['dismissed', 'feedback', 'external_approval_required']) {
    assert.equal(approvedPlan({ ...approval, details: { ...approval.details, outcome, planModeExited: true, approvalSource: 'external' } }), undefined);
  }
  assert.equal(approvedPlan({ ...approval, isError: true }), undefined);
  assert.equal(approvedPlan({ ...approval, role: 'assistant' }), undefined);
});

test('steering retains execution ownership but ordinary next-round input ends it', () => {
  const messages: Message[] = [approval, { role: 'user', content: 'Small adjustment', desktopSteered: true },
    { role: 'assistant', content: 'Continuing', stopReason: 'toolUse' }];
  const running = planExecutionResponses(messages, true);
  assert.equal(running.size, 1);
  assert.equal(running.get(2)?.state, 'running');
  assert.equal(running.has(0), false, 'An intermediate response is not a completed execution');
  messages.push({ role: 'assistant', content: 'Done', stopReason: 'stop' }, { role: 'user', content: 'Next task' },
    { role: 'assistant', content: 'Next answer', stopReason: 'stop' });
  const settled = planExecutionResponses(messages, false);
  assert.equal(settled.get(2)?.state, 'completed');
  assert.equal(settled.has(5), false);
});
test('approval alone is never completion; execution outcomes follow the final assistant', () => {
  assert.equal(planExecution([approval], true)?.state, 'running');
  assert.equal(planExecution([approval], false)?.state, 'interrupted');
  for (const [stopReason, state] of [['stop', 'completed'], ['error', 'failed'], ['aborted', 'interrupted'], ['toolUse', 'interrupted']]) {
    assert.equal(planExecution([approval, { role: 'assistant', content: 'Result', stopReason }], false)?.state, state);
  }
});
test('later ordinary turns cannot inherit execution and older approved snapshots stay unchanged', () => {
  const entries = conversationEntries([approval, { role: 'assistant', content: 'Done', stopReason: 'stop' },
    { role: 'user', content: 'Next question' }, { role: 'assistant', content: 'Answer', stopReason: 'stop' }]);
  const response = entries.at(-1)!;
  assert.equal(response.type, 'response');
  if (response.type === 'response') assert.equal(planExecution(response.items.map(item => item.message), true), undefined);
});
