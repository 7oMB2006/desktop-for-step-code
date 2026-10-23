import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionSummary } from '../electron/session-summary';

test('summary projects task plan and live services without configuration or metadata', () => {
  const result = sessionSummary({ sessionId: 'a', skillCount: 7, tasks: {
    activePlan: { id: 'plan', title: 'Implement summary' }, archivedPlans: [{ secret: 'hidden' }],
    tasks: [{ id: '1', subject: 'Read', description: 'Read source', status: 'completed', metadata: { secret: 'hidden' } },
      { id: '2', subject: 'Build', status: 'in_progress' }, { id: '3', subject: 'Verify', status: 'pending' }],
  }, mcp: [{ name: 'tools__server', status: 'connected', toolCount: 3, env: { SECRET: 'hidden' } },
    { name: 'off', status: 'disabled', toolCount: 0 }] }, 'a');
  assert.equal(result.plan?.title, 'Implement summary');
  assert.deepEqual(result.tasks.map(task => task.status), ['completed', 'in_progress', 'pending']);
  assert.equal(result.mcp[0].toolCount, 3);
  assert.equal(result.skillCount, 7);
  assert.equal(JSON.stringify(result).includes('hidden'), false);
});
test('summary rejects responses from a different session and ignores malformed records', () => {
  assert.throws(() => sessionSummary({ sessionId: 'old' }, 'new'), /Session changed/);
  const result = sessionSummary({ sessionId: 'a', skillCount: NaN, tasks: { tasks: [null,
    { id: '1', status: 'pending' }, { id: '1', status: 'completed' }, { id: '2', status: 'invented' }] },
    mcp: [null, { name: 'invalid', status: 'unknown' }] }, 'a');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.skillCount, 0);
  assert.deepEqual(result.mcp, []);
});
test('summary preserves explicit task failure without inferring failure from tool errors', () => {
  const result = sessionSummary({ sessionId: 'a', tasks: { tasks: [
    { id: '1', status: 'failed', subject: 'Verify', description: 'Validation did not pass' },
    { id: '2', status: 'in_progress', metadata: { error: 'A tool failed' } },
  ] } }, 'a');
  assert.deepEqual(result.tasks.map(task => task.status), ['failed', 'in_progress']);
  assert.equal(result.tasks[0].description, 'Validation did not pass');
  assert.equal(JSON.stringify(result).includes('A tool failed'), false);
});

test('summary exposes bounded plan history and timestamps without task metadata', () => {
  const summary = sessionSummary({ sessionId: 'a', tasks: {
    activePlan: { id: 'active', title: 'Now' },
    tasks: [{ id: 'a', status: 'pending', createdAt: 100, updatedAt: 200 }],
    archivedPlans: [
      { id: 'active', title: 'Duplicate active', tasks: [{ id: 'x', status: 'completed' }] },
      { id: 'old', title: 'Before', tasks: [{ id: '1', status: 'completed', updatedAt: 150, metadata: { secret: 'hidden' } }] },
      { id: 'old', title: 'Duplicate history', tasks: [{ id: '2', status: 'pending' }] },
      { id: 'invalid', title: 'Invalid timestamps', tasks: [{ id: '3', status: 'failed', createdAt: Infinity, updatedAt: -1 }] },
    ],
  } }, 'a');
  assert.equal(summary.tasks[0].createdAt, 100);
  assert.equal(summary.tasks[0].updatedAt, 200);
  assert.deepEqual(summary.archivedPlans?.map(plan => plan.id), ['old', 'invalid']);
  assert.equal(summary.archivedPlans?.[0].tasks[0].updatedAt, 150);
  assert.equal(summary.archivedPlans?.[1].tasks[0].updatedAt, undefined);
  assert.equal(JSON.stringify(summary).includes('hidden'), false);
  const many = sessionSummary({ sessionId: 'a', tasks: { archivedPlans: Array.from({ length: 60 }, (_, index) =>
    ({ id: String(index), title: 'History', tasks: Array.from({ length: 30 }, (_, id) => ({ id: String(id), status: 'completed' })) })) } }, 'a');
  assert.equal(many.archivedPlans?.reduce((sum, plan) => sum + plan.tasks.length, 0), 1000);
  assert.ok(many.archivedPlans!.length <= 50);
});
