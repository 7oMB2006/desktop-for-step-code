import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, SummaryTask } from '../src/contracts';
import { summaryActivity, summaryAgents } from '../src/summary-activity';

const call: Message = { role: 'assistant', content: [{ type: 'toolCall', id: 'dispatch', name: 'subagent',
  arguments: { tasks: [{ agent: 'reader', task: 'Inspect the module' }, { agent: 'tester', task: 'Check coverage' }] } }] };
const result = (results: unknown[]): Message => ({ role: 'toolResult', toolName: 'subagent', toolCallId: 'dispatch', content: '', details: { results } });
const task = (status: SummaryTask['status']): SummaryTask => ({ id: '1', subject: 'Test', description: '', status });

test('summary reuses per-task structured records and never counts dispatch success as completed tasks', () => {
  const messages: Message[] = [{ role: 'user', content: 'Start' }, call,
    result([{ agent: 'reader', task: 'Read', status: 'completed' }, { agent: 'tester', task: 'Test', status: 'failed' }])];
  const before = structuredClone(messages);
  const records = summaryAgents(messages, false);
  assert.deepEqual(records.map(record => record.status), ['completed', 'failed']);
  assert.equal(records[1].target.type, 'subagent');
  assert.equal(summaryActivity([task('pending')], records), 'idle');
  assert.deepEqual(messages, before);
});

test('unobserved legacy and interrupted histories stay unknown; planned work stays queued', () => {
  assert.deepEqual(summaryAgents([call], true).map(record => record.status), ['queued', 'queued']);
  assert.deepEqual(summaryAgents([call], false).map(record => record.status), ['unknown', 'unknown']);
  const records = summaryAgents([call, result([{ agent: 'legacy', task: 'Old' }])], false);
  assert.equal(records[0].status, 'unknown');
  assert.equal(summaryActivity([], records), 'unknown');
});

test('activity represents tasks and agents, not parent-model streaming; stale data stays unknown', () => {
  assert.equal(summaryActivity(undefined, []), 'unknown');
  assert.equal(summaryActivity([], []), 'idle');
  assert.equal(summaryActivity([task('in_progress')], []), 'running');
  assert.equal(summaryActivity([task('completed')], []), 'completed');
  assert.equal(summaryActivity([task('in_progress')], [], true), 'unknown');
});

test('completion requires nonempty work and successful states for every task and agent', () => {
  const [agent] = summaryAgents([call, result([{ agent: 'reader', task: 'Read', status: 'completed' }])], false);
  assert.equal(summaryActivity([], [agent]), 'completed');
  assert.equal(summaryActivity([task('completed')], [{ ...agent, status: 'cached' }]), 'completed');
  for (const status of ['queued', 'failed', 'aborted', 'skipped'] as const) {
    assert.equal(summaryActivity([task('completed')], [{ ...agent, status }]), 'idle', status);
  }
  for (const status of ['pending', 'failed'] as const) {
    assert.equal(summaryActivity([task(status)], [agent]), 'idle', status);
  }
  assert.equal(summaryActivity([task('completed')], [{ ...agent, status: 'running' }]), 'running');
  assert.equal(summaryActivity([task('completed')], [{ ...agent, status: 'unknown' }]), 'unknown');
  assert.equal(summaryActivity([task('completed')], [agent], true), 'unknown');
  assert.equal(summaryActivity([], []), 'idle');
});

test('registered background events supersede snapshots without inventing completion for other steps', () => {
  const messages: Message[] = [call, { ...result([{ agent: 'reader', task: 'Read', status: 'running' }]),
    details: { agentId: 'background-1', status: 'running', results: [{ agent: 'reader', task: 'Read', status: 'running' }] } },
  { role: 'custom', content: '', customType: 'agent-notification', details: { agentId: 'background-1', event: 'background_done', status: 'completed' } }];
  assert.equal(summaryAgents(messages, false)[0].status, 'completed');
});

test('workflow records retain structured states and navigate to the existing orchestration inspector', () => {
  const messages: Message[] = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'flow', name: 'workflow', arguments: {} }] },
    { role: 'toolResult', toolName: 'workflow', toolCallId: 'flow', content: '', details: {
      schemaVersion: 1, runId: 'wf_test', status: 'partial_failed',
      agents: [{ id: 'a', label: 'worker', task: 'Read', status: 'cached' }, { id: 'b', label: 'worker', task: 'Write', status: 'failed' }],
      taskFailures: [{ primitive: 'parallel', index: 0, message: 'callback failed' }],
    } }];
  const records = summaryAgents(messages, false);
  assert.equal(records.length, 2, 'callbacks are not agents and repeated labels remain distinct');
  assert.deepEqual(records.map(record => record.status), ['cached', 'failed']);
  assert.deepEqual(records[0].target, { type: 'workflow', id: 'wf_test' });
  assert.notEqual(records[0].key, records[1].key);
});
