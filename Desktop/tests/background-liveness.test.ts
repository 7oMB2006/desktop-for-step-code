import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundSubagentStates, findSubagentTask, projectBackgroundSubagentStates } from '../src/conversation-presentation';
import { summaryAgents } from '../src/summary-activity';
import type { Message } from '../src/contracts';

const dispatch = (id: string, status = 'running'): Message => ({
  role: 'toolResult', toolName: 'subagent', content: 'Started', details: { agentId: id, status, results: [] },
});
const notice = (id: string, event = 'background_done', status = 'completed'): Message => ({
  role: 'custom', customType: 'agent-notification', content: 'notice', details: { agentId: id, event, status },
});
const control = (rows: unknown): Message => ({ role: 'toolResult', toolName: 'agent_send', content: 'control', details: rows as any });

test('agent_send arrays reopen only registered lanes and later final notification settles them', () => {
  const messages: Message[] = [dispatch('lane-a'), dispatch('lane-b'), notice('lane-a'), notice('lane-b'),
    control([{ agentId: 'lane-a', status: 'running' }, { agentId: 'unknown', status: 'running' }])];
  assert.deepEqual([...backgroundSubagentStates(messages)], [['lane-a', 'running'], ['lane-b', 'completed']]);
  messages.push(notice('lane-a'));
  assert.equal(backgroundSubagentStates(messages).get('lane-a'), 'completed');
});

test('agent_send detail parsing is bounded and rejects malformed rows without rewriting messages', () => {
  const rows = [{ agentId: 'lane-a', status: 'failed' }, { agentId: '', status: 'running' },
    { agentId: 'lane-a', status: 'made-up' }, { agentId: 'lane-b', status: 'running' }, ...Array(80).fill({ agentId: 'lane-c', status: 'running' })];
  const messages = [dispatch('lane-a'), dispatch('lane-b'), control(rows)];
  const before = structuredClone(messages);
  assert.deepEqual([...backgroundSubagentStates(messages)], [['lane-a', 'failed'], ['lane-b', 'running']]);
  assert.deepEqual(messages, before);
});

test('live lane projection keeps known final outcomes and marks stale running history unknown', () => {
  const historical = new Map([['lane-a', 'running'], ['lane-b', 'completed'], ['lane-c', 'failed']] as const);
  assert.deepEqual([...projectBackgroundSubagentStates(historical, { status: 'known', lanes: [] })],
    [['lane-a', 'unknown'], ['lane-b', 'completed'], ['lane-c', 'failed']]);
  assert.deepEqual([...projectBackgroundSubagentStates(historical, { status: 'known', lanes: [{ id: 'lane-a', status: 'settling' }] })],
    [['lane-a', 'running'], ['lane-b', 'completed'], ['lane-c', 'failed']]);
  assert.equal(projectBackgroundSubagentStates(historical, { status: 'unavailable' }).get('lane-a'), 'unknown');
});

test('selected Agent records and summary share unknown outcomes without altering completed chain steps', () => {
  const block = { type: 'toolCall', id: 'call-a', name: 'subagent', arguments: { chain: [
    { agent: 'reader', task: 'Read' }, { agent: 'general', task: 'Finish' },
  ] } };
  const result: Message = { ...dispatch('lane-a'), toolCallId: 'call-a', details: { agentId: 'lane-a', status: 'running', results: [
    { agent: 'reader', task: 'Read', status: 'completed', messages: [] },
    { agent: 'general', task: 'Finish', status: 'running', messages: [] },
  ] } };
  const history: Message[] = [{ role: 'assistant', content: [block] }, result];
  const before = structuredClone(history);
  const activity = { status: 'known' as const, lanes: [] };
  const task = findSubagentTask(history, { agent: 'general', task: 'Finish', toolCallId: 'call-a', taskIndex: 1 }, activity);
  assert.equal(task?.status, 'unknown');
  assert.equal(task?.statusDetail, 'inactive');
  assert.deepEqual(summaryAgents(history, false, activity).map(agent => agent.status), ['completed', 'unknown']);
  assert.equal(findSubagentTask(history, { agent: 'general', task: 'Finish', toolCallId: 'call-a', taskIndex: 1 },
    { status: 'unavailable' })?.statusDetail, 'unavailable');
  assert.deepEqual(history, before);
});

test('missing live information keeps history unchanged until current ownership is known', () => {
  const historical = new Map([['lane-a', 'running'], ['lane-b', 'completed']] as const);
  assert.deepEqual([...projectBackgroundSubagentStates(historical, undefined)], [...historical]);
});
