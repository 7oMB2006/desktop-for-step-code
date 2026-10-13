import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { currentTurnWorkflows, projectWorkflow, workflowsFromMessages } from '../src/workflow-state';
import { applyToolResult, applyMessageEvent } from '../src/message-events';
import { hydrateWorkflowHistory, WorkflowBindings } from '../electron/workflow-history';
import type { Message } from '../src/contracts';

const progress = { schemaVersion: 1, runId: 'wf_test', name: 'inline', status: 'running', startedAt: 100,
  totalAgents: 2, completedAgents: 0, agents: [
    { id: 'a', label: '审查', task: '检查限定词', status: 'running', startedAt: 101 },
    { id: 'b', label: '核验', task: '核对结果', status: 'queued' },
  ] };
const final = { schemaVersion: 1, runId: 'wf_test', name: 'inline', status: 'completed', startedAt: 100,
  finishedAt: 200, agentCalls: 2, spentTokens: 50 };

test('idle orphan workflow calls are unknown rather than spinning after a crash', () => {
  const messages: Message[] = [{ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'orphan' }] }];
  assert.equal(workflowsFromMessages(messages, true)[0].status, 'running');
  assert.equal(workflowsFromMessages(messages, false)[0].status, 'unknown');
  assert.equal(currentTurnWorkflows(messages, false)[0].status, 'unknown');
  const partial: Message[] = [...messages, { role: 'toolResult', content: '', toolName: 'workflow', toolCallId: 'orphan', details: progress }];
  assert.deepEqual(workflowsFromMessages(partial, false)[0].agents.map(agent => agent.status), ['unknown', 'unknown']);
  assert.equal(workflowsFromMessages(partial, true)[0].status, 'running');
  assert.equal(progress.agents[0].status, 'running');
  partial.push({ role: 'user', content: 'next turn' }, { role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'new' }] });
  assert.deepEqual(workflowsFromMessages(partial, true).map(flow => flow.status), ['unknown', 'running']);
});

test('current turn excludes unfinished historical workflows without removing history', () => {
  const messages: Message[] = [
    { role: 'user', content: 'old turn' },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'stale' }] },
    { role: 'user', content: 'unrelated next turn' },
  ];
  assert.equal(workflowsFromMessages(messages)[0].status, 'unknown');
  assert.deepEqual(currentTurnWorkflows(messages), []);
  messages.push({ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'new' }] });
  assert.deepEqual(currentTurnWorkflows(messages).map(flow => flow.toolCallId), ['new']);
  messages.push({ role: 'toolResult', toolName: 'workflow', toolCallId: 'new', content: '', details: final });
  assert.equal(currentTurnWorkflows(messages)[0].status, 'completed');
  assert.equal(workflowsFromMessages(messages).length, 2);
});
test('a visible Goal input separates workflows from earlier turns', () => {
  const messages: Message[] = [
    { role: 'user', content: 'old turn' },
    { role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'old' }] },
    { role: 'custom', customType: 'desktop-goal-input', content: 'Goal' },
    { role: 'custom', customType: 'step-goal', display: false, content: 'Continue' },
  ];
  assert.deepEqual(currentTurnWorkflows(messages), []);
  messages.push({ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'new' }] });
  assert.deepEqual(currentTurnWorkflows(messages).map(flow => flow.toolCallId), ['new']);
  messages.push({ role: 'custom', customType: 'desktop-goal-input', display: false, content: 'Hidden input' });
  assert.deepEqual(currentTurnWorkflows(messages).map(flow => flow.toolCallId), ['new']);
});

test('workflow final result and duplicate persisted messages preserve the latest agent snapshot', () => {
  let messages: Message[] = [{ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'call' }] }];
  messages = applyToolResult(messages, { type: 'tool_execution_update', toolCallId: 'call', toolName: 'workflow', partialResult: { content: '', details: progress } });
  const settled = { ...progress, status: 'completed', agents: progress.agents.map(a => ({ ...a, status: 'completed', finishedAt: 200 })) };
  messages = applyToolResult(messages, { type: 'tool_execution_update', toolCallId: 'call', toolName: 'workflow', partialResult: { content: '', details: settled } });
  messages = applyToolResult(messages, { type: 'tool_execution_end', toolCallId: 'call', toolName: 'workflow', result: { content: '', details: final } });
  messages = applyMessageEvent(messages, { type: 'message_start', message: { role: 'toolResult', toolCallId: 'call', toolName: 'workflow', content: '', details: final } });
  messages = applyMessageEvent(messages, { type: 'message_end', message: { role: 'toolResult', toolCallId: 'call', toolName: 'workflow', content: '', details: final } });
  const flows = workflowsFromMessages(messages);
  assert.equal(flows.length, 1);
  assert.equal(messages.length, 2);
  assert.equal(flows[0].status, 'completed');
  assert.deepEqual(flows[0].agents.map(a => a.status), ['completed', 'completed']);
  assert.equal(flows[0].spentTokens, 50);
});

test('projection rejects malformed progress, deduplicates ids and redacts new task surfaces', () => {
  assert.equal(projectWorkflow({ ...progress, runId: '../escape' }, 'call'), undefined);
  assert.equal(projectWorkflow({ ...progress, schemaVersion: 2 }, 'call'), undefined);
  const flow = projectWorkflow({ ...progress, agents: [progress.agents[0], progress.agents[0],
    { id: 'bad', status: 'mystery' }, { id: 'secret', status: 'failed', task: 'API_KEY=private' }] }, 'call')!;
  assert.equal(flow.agents.length, 2);
  assert.equal(flow.agents[1].task, '[redacted]');
});

test('different runs on the same call never inherit another run agents', () => {
  const first = applyToolResult([], { type: 'tool_execution_update', toolCallId: 'call', toolName: 'workflow', partialResult: { details: progress } });
  const next = applyToolResult(first, { type: 'tool_execution_end', toolCallId: 'call', toolName: 'workflow', result: { details: { ...final, runId: 'wf_other' } } });
  assert.equal(next[0].desktopWorkflow?.agents.length, 0);
});

test('a final result never leaves stale progress spinning or invents agent success', () => {
  const first = applyToolResult([], { type: 'tool_execution_update', toolCallId: 'call', toolName: 'workflow', partialResult: { details: progress } });
  const ended = applyToolResult(first, { type: 'tool_execution_end', toolCallId: 'call', toolName: 'workflow', result: { details: final } });
  assert.deepEqual(ended[0].desktopWorkflow?.agents.map(agent => agent.status), ['unknown', 'unknown']);
  const failed = applyToolResult(first, { type: 'tool_execution_end', toolCallId: 'call', toolName: 'workflow', isError: true, result: { content: 'Failed' } });
  assert.equal(failed[0].desktopWorkflow?.status, 'failed');
  assert.deepEqual(failed[0].desktopWorkflow?.agents.map(agent => agent.status), ['unknown', 'unknown']);
});

test('history reads only bounded progress inside the session workspace and binds it to the final result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-history-'));
  try {
    const directory = join(root, '.stepcode', 'workflows', 'runs', 'wf_test');
    await mkdir(directory, { recursive: true });
    const message: Message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'call', content: '', details: { ...final, scriptPath: 'C:/unrelated/script.js' } };
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, status: 'completed', agents: progress.agents.map(a => ({ ...a, status: 'completed' })) }));
    const restored = await hydrateWorkflowHistory(root, [message]);
    assert.equal(restored[0].desktopWorkflow?.agents.length, 2);
    assert.equal(restored[0].desktopWorkflow?.status, 'completed');
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, startedAt: 999 }));
    assert.equal((await hydrateWorkflowHistory(root, [message]))[0].desktopWorkflow, undefined);
    await writeFile(join(directory, 'progress.json'), 'x'.repeat(1024 * 1024 + 1));
    assert.equal((await hydrateWorkflowHistory(root, [message]))[0].desktopWorkflow, undefined);
    await writeFile(join(directory, 'progress.json'), 'broken json');
    assert.equal((await hydrateWorkflowHistory(root, [message]))[0].desktopWorkflow?.agents.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('persisted call bindings recover interruption without matching error prose or another session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-binding-'));
  try {
    const directory = join(root, '.stepcode', 'workflows', 'runs', 'wf_test');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, status: 'aborted',
      agents: [{ ...progress.agents[0], status: 'completed' }, { ...progress.agents[1], status: 'aborted' }] }));
    const store = new WorkflowBindings(join(root, 'bindings'));
    store.event('parent', { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'call', partialResult: { details: progress } });
    const binding = await store.load('parent');
    const reopened = new WorkflowBindings(join(root, 'bindings'));
    assert.deepEqual(await reopened.load('parent'), binding);
    const message: Message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'call', content: 'unstructured error', isError: true, details: {} };
    const hydrated = await hydrateWorkflowHistory(root, [message], binding);
    assert.equal(hydrated[0].desktopWorkflow?.status, 'aborted');
    assert.deepEqual(hydrated[0].desktopWorkflow?.agents.map(agent => agent.status), ['completed', 'aborted']);
    assert.equal(hydrated[0].isError, true);
    assert.equal(message.desktopWorkflow, undefined);
    assert.equal((await hydrateWorkflowHistory(root, [message], await store.load('other-session')))[0].desktopWorkflow, undefined);
    assert.equal((await hydrateWorkflowHistory(root, [{ ...message, toolCallId: 'other-call' }], binding))[0].desktopWorkflow, undefined);
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, status: 'failed' }));
    assert.equal((await hydrateWorkflowHistory(root, [message], binding))[0].desktopWorkflow?.status, 'failed');
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, startedAt: 999, status: 'aborted' }));
    assert.equal((await hydrateWorkflowHistory(root, [message], binding))[0].desktopWorkflow, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
