import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingPlanReview, planReview } from '../src/plan-review';
import type { Message } from '../src/contracts';

test('Plan review preserves the full proposal and requires exact native options', () => {
  const request = { type: 'extension_ui_request' as const, id: 'one', method: 'select', title: 'Desktop Plan review\nD:\\proposal.md\n\n# Plan\n\nLast line', options: ['Approve plan', 'Request refinements', 'Keep planning'] };
  assert.deepEqual(planReview(request), { path: 'D:\\proposal.md', content: '# Plan\n\nLast line' });
  assert.equal(planReview({ ...request, options: ['Approve'] }), undefined);
  assert.equal(planReview({ ...request, method: 'input' }), undefined);
});

test('ended reviews retain a history-derived reentry without retaining authorization', () => {
  const dismissed: Message = { role: 'toolResult', toolName: 'exit_plan_mode', content: 'Review ended',
    details: { planFilePath: 'D:\\proposal.md', planContents: '# Proposal', outcome: 'dismissed' } };
  assert.equal(pendingPlanReview([dismissed], true), true);
  assert.equal(pendingPlanReview([dismissed, { role: 'user', content: 'Another question' }], true), true);
  assert.equal(pendingPlanReview([dismissed], false), false);
  assert.equal(pendingPlanReview([{ ...dismissed, details: undefined }], true), false);
  assert.equal(pendingPlanReview([dismissed, { ...dismissed, details: { ...dismissed.details, outcome: 'approved' } }], true), false);
  assert.equal(pendingPlanReview([{ ...dismissed, isError: true }], true), false);
});
