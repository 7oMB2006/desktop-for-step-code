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

test('settled activity represents tasks and agents; stale data stays unknown', () => {
  assert.equal(summaryActivity(undefined, []), 'unknown');
  assert.equal(summaryActivity([], []), 'idle');
  assert.equal(summaryActivity([task('in_progress')], []), 'running');
  assert.equal(summaryActivity([task('completed')], []), 'completed');
  assert.equal(summaryActivity([task('in_progress')], [], true), 'unknown');
});

test('live conversation activity takes effect before summary polling without changing task completion', () => {
  for (const tasks of [undefined, [], [task('pending')], [task('completed')]]) {
    const before = structuredClone(tasks);
    assert.equal(summaryActivity(tasks, [], false, true), 'running');
    assert.equal(summaryActivity(tasks, [], true, true), 'running', 'live runtime evidence survives a failed summary read');
    assert.deepEqual(tasks, before);
  }
  assert.equal(summaryActivity([], [], false, false), 'idle', 'ending an unplanned turn is not task completion');
  assert.equal(summaryActivity([task('pending')], [], false, false), 'idle');
  assert.equal(summaryActivity([task('completed')], [], false, false), 'completed');
  assert.equal(summaryActivity([task('completed')], [], true, false), 'unknown');
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

test('new visible inputs retire previous agent rows without deleting history or changing current identities', () => {
  const previous = [call, result([{ agent: 'reader', task: 'Old', status: 'failed' }])];
  const next: Message = { role: 'user', content: 'Next turn' };
  const currentCall = structuredClone(call);
  currentCall.content = [{ type: 'toolCall', id: 'new-dispatch', name: 'subagent', arguments: { agent: 'reader', task: 'New' } }];
  const currentResult: Message = { ...result([{ agent: 'reader', task: 'New', status: 'completed' }]), toolCallId: 'new-dispatch' };
  const messages = [...previous, next, currentCall, currentResult];
  const before = structuredClone(messages);
  const records = summaryAgents(messages, false);
  assert.deepEqual(records.map(record => record.task), ['New']);
  assert.equal(summaryAgents([...messages, { role: 'assistant', content: 'Done' }], false)[0].key, records[0].key);
  assert.deepEqual(messages, before);
  assert.deepEqual(summaryAgents([...previous, next], false), []);
  assert.deepEqual(summaryAgents([call, next, result([{ agent: 'reader', task: 'Late old result', status: 'completed' }])], false), []);
});

test('visible Goal input starts a turn but hidden reminders do not clear the current records', () => {
  const previous = [call, result([{ agent: 'reader', task: 'Old', status: 'completed' }])];
  assert.equal(summaryAgents([...previous, { role: 'user', content: 'Reminder', display: false }], false).length, 1);
  assert.equal(summaryAgents([...previous, { role: 'custom', customType: 'desktop-goal-input', content: 'New Goal' }], false).length, 0);
});

test('visible Cron notices start summary turns without losing history or claiming late results', () => {
  const previous = [call, result([{ agent: 'reader', task: 'Old', status: 'completed' }])];
  const fire: Message = { role: 'custom', customType: 'step-cron', content: '[cron] Check the module' };
  const currentCall: Message = { role: 'assistant', content: [
    { type: 'toolCall', id: 'cron-dispatch', name: 'subagent', arguments: {} },
  ] };
  const currentResult: Message = { ...result([{ agent: 'reader', task: 'Cron task', status: 'completed' }]),
    toolCallId: 'cron-dispatch' };
  for (const notice of [fire, { ...fire, details: { kind: 'missed', count: 1 } }]) {
    const messages = [...previous, notice, currentCall, currentResult];
    const before = structuredClone(messages);
    const records = summaryAgents(messages, false);
    assert.deepEqual(records.map(record => record.task), ['Cron task']);
    assert.deepEqual(summaryAgents([...previous, notice], true), []);
    assert.deepEqual(summaryAgents([call, notice, previous[1]], false), [], 'late results retain their dispatch turn');
    assert.deepEqual(summaryAgents([...messages, notice], true), [], 'each visible Cron starts another turn');
    assert.deepEqual(summaryAgents(JSON.parse(JSON.stringify(messages)), false), records, 'saved history uses the same boundaries');
    assert.deepEqual(messages, before);
  }
  for (const notice of [{ ...fire, display: false }, { ...fire, role: 'assistant' },
    { ...fire, customType: 'other' }]) {
    assert.equal(summaryAgents([...previous, notice], false).length, 1, 'hidden or non-Cron notices do not retire records');
  }
});

test('live background agents cross Cron turns and retire only after their terminal notification', () => {
  for (const status of ['running', 'queued'] as const) {
    const messages: Message[] = [call, {
      ...result([{ agent: 'reader', task: 'Background', status }]),
      details: { agentId: 'cron-background', status, results: [{ agent: 'reader', task: 'Background', status }] },
    }, { role: 'custom', customType: 'step-cron', content: '[cron] Next task' }];
    const records = summaryAgents(messages, true);
    assert.equal(records.length, 1);
    assert.equal(records[0].carried, true);
    assert.equal(records[0].status, status);
    assert.deepEqual(summaryAgents([...messages, { role: 'custom', customType: 'agent-notification', content: '',
      details: { agentId: 'cron-background', event: 'background_done', status: 'completed' } }], true), []);
  }
});

test('registered live background work survives turn changes and retires on completion', () => {
  const messages: Message[] = [call, {
    ...result([{ agent: 'reader', task: 'Background', status: 'running' }]),
    details: { agentId: 'background-live', status: 'running', results: [{ agent: 'reader', task: 'Background', status: 'running' }] },
  }, { role: 'user', content: 'Next turn' }];
  const records = summaryAgents(messages, false);
  assert.equal(records.length, 1);
  assert.equal(records[0].carried, true);
  assert.equal(records[0].status, 'running');
  const completed: Message = { role: 'custom', content: '', customType: 'agent-notification',
    details: { agentId: 'background-live', event: 'background_done', status: 'completed' } };
  assert.deepEqual(summaryAgents([...messages, completed], false), []);
  assert.equal(summaryAgents(messages.slice(0, -1), false)[0].key, records[0].key);
});

test('historical workflow records and late results never become current-turn records', () => {
  const workflowCall: Message = { role: 'assistant', content: [{ type: 'toolCall', id: 'old-flow', name: 'workflow', arguments: {} }] };
  const workflowResult: Message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'old-flow', content: '', details: {
    schemaVersion: 1, runId: 'wf_old', status: 'completed',
    agents: [{ id: 'a', label: 'worker', task: 'Old flow', status: 'completed' }],
  } };
  const next: Message = { role: 'user', content: 'Next turn' };
  assert.equal(summaryAgents([workflowCall, workflowResult], false).length, 1);
  assert.deepEqual(summaryAgents([workflowCall, workflowResult, next], false), []);
  assert.deepEqual(summaryAgents([workflowCall, next, workflowResult], false), []);
});

test('Cron summary workflows belong to their dispatch turn rather than their result arrival', () => {
  const workflowCall: Message = { role: 'assistant', content: [{ type: 'toolCall', id: 'cron-flow', name: 'workflow', arguments: {} }] };
  const workflowResult: Message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'cron-flow', content: '', details: {
    schemaVersion: 1, runId: 'wf_cron', status: 'completed',
    agents: [{ id: 'a', label: 'worker', task: 'Cron flow', status: 'completed' }],
  } };
  const fire: Message = { role: 'custom', customType: 'step-cron', content: '[cron] Run workflow' };
  assert.deepEqual(summaryAgents([workflowCall, workflowResult, fire], true), []);
  assert.deepEqual(summaryAgents([workflowCall, fire, workflowResult], false), []);
  assert.equal(summaryAgents([fire, workflowCall, workflowResult], false).length, 1);
});
