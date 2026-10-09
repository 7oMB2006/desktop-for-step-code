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
