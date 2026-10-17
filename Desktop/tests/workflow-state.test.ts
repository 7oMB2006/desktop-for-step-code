import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { currentTurnWorkflows, projectWorkflow, workflowsFromMessages, workflowIsActive, workflowIcon,
  preserveWorkflow, workflowCount, workflowIssues, workflowRetryText } from '../src/workflow-state';
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

const failure = { id: 'b', status: 'failed', error: { code: 'NODE_FAILED', message: 'Invalid request', retryable: false } };
const callback = { script: 'child.js', primitive: 'parallel', index: 1, message: 'Callback rejected' };
const failureResult = { ...final, status: 'partial_failed', summary: { total: 2, completed: 1, failed: 1, failedCallbacks: 1 },
  failures: [failure], taskFailures: [callback], cacheHits: 1 };
const resultMessage = (details: NonNullable<Message['details']>): Message => ({
  role: 'toolResult', toolName: 'workflow', toolCallId: 'call', content: '', details,
});

test('final failures overlay known nodes without losing metadata or making callbacks into agents', () => {
  const previous = preserveWorkflow(undefined, resultMessage({ ...progress, agents: [
    { ...progress.agents[0], status: 'completed' }, { ...progress.agents[1], rateLimitRetries: 2 },
  ] }));
  const state = preserveWorkflow(previous, resultMessage(failureResult)).desktopWorkflow!;
  assert.deepEqual(state.agents.map(agent => agent.status), ['completed', 'failed']);
  assert.equal(state.agents[1].label, '核验');
  assert.equal(state.agents[1].task, '核对结果');
  assert.deepEqual(state.agents[1].error, { ...failure.error, retryExhausted: undefined });
  assert.equal(state.agents[1].rateLimitRetries, 2);
  assert.equal(state.taskFailures?.length, 1);
  assert.equal(state.cacheHits, 1);
  assert.equal(workflowCount(state), '1 / 2');
  assert.equal(workflowIssues(state, 'zh'), '1 节点失败 · 1 回调错误');
  const fresh = projectWorkflow(failureResult, 'call')!;
  assert.equal(fresh.agents.length, 1, 'missing progress still exposes the authoritative failure');
  assert.equal(workflowCount(fresh), '1 / 2', 'a failures-only list is not a completion count');
  assert.equal(workflowIssues(fresh, 'en'), '1 failed node · 1 callback error');
});

test('callback metadata clears on successful final and does not leak across run or start identities', () => {
  const previous = preserveWorkflow(undefined, resultMessage({ ...progress, taskFailures: [callback],
    summary: { failedCallbacks: 1 } }));
  for (const details of [final, { ...failureResult, taskFailures: [], summary: { failedCallbacks: 0 } }]) {
    const state = preserveWorkflow(previous, resultMessage(details)).desktopWorkflow!;
    assert.deepEqual(state.taskFailures, []);
    assert.equal(state.failedCallbacks, 0);
  }
  for (const identity of [{ runId: 'wf_other' }, { startedAt: 999 }]) {
    const state = preserveWorkflow(previous, resultMessage({ ...final, ...identity, status: 'failed' })).desktopWorkflow!;
    assert.equal(state.agents.length, 0);
    assert.equal(state.taskFailures, undefined);
    assert.equal(state.failedCallbacks, undefined);
  }
});

test('duplicate persisted final messages retain failure details and retry counts', () => {
  let messages: Message[] = [{ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'call' }] }];
  messages = applyToolResult(messages, { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'call',
    partialResult: { details: { ...progress, agents: [
      { ...progress.agents[0], status: 'cached' }, { ...progress.agents[1], rateLimitRetries: 2 },
    ] } } });
  messages = applyToolResult(messages, { type: 'tool_execution_end', toolName: 'workflow', toolCallId: 'call',
    result: { details: failureResult }, isError: true });
  const message = { ...resultMessage(failureResult), isError: true };
  messages = applyMessageEvent(messages, { type: 'message_start', message });
  messages = applyMessageEvent(messages, { type: 'message_end', message });
  const state = workflowsFromMessages(messages, false)[0];
  assert.equal(messages.length, 2);
  assert.deepEqual(state.agents.map(agent => agent.status), ['cached', 'failed']);
  assert.equal(state.agents[1].rateLimitRetries, 2);
  assert.equal(state.agents[1].error?.code, 'NODE_FAILED');
  assert.equal(state.taskFailures?.length, 1);
  assert.equal(state.failedCallbacks, 1);
});

test('retry projection distinguishes active, recovered and exhausted retries and never spins after termination', () => {
  const retry = { attempt: 1, maxRetries: 2, delayMs: 500 };
  const state = projectWorkflow({ ...progress, agents: [{ ...progress.agents[0], retry, rateLimitRetries: 1 }] }, 'call')!;
  assert.deepEqual(state.agents[0].retry, retry);
  assert.match(workflowRetryText(state.agents[0], 'zh'), /重试 1\/2/);
  const recovered = { ...state.agents[0], status: 'completed' as const, retry: undefined };
  assert.match(workflowRetryText(recovered, 'en'), /Recovered.*1 retry/);
  const exhausted = { ...recovered, status: 'failed' as const, error: { ...failure.error, retryExhausted: true } };
  assert.match(workflowRetryText(exhausted, 'zh'), /重试次数已耗尽/);
  const previous = { ...resultMessage(progress), desktopWorkflow: state };
  assert.equal(preserveWorkflow(previous, resultMessage(final)).desktopWorkflow?.agents[0].retry, undefined);
  assert.equal(projectWorkflow({ ...progress, status: 'failed', agents: [{ ...progress.agents[0], retry }] }, 'call')?.agents[0].retry, undefined);
  const messages: Message[] = [{ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'call' }] }, previous];
  assert.equal(workflowsFromMessages(messages, false)[0].agents[0].retry, undefined);
  for (const invalid of [{ ...retry, attempt: 3 }, { ...retry, delayMs: -1 }, { ...retry, maxRetries: 1.5 }]) {
    assert.equal(projectWorkflow({ ...progress, agents: [{ ...progress.agents[0], retry: invalid }] }, 'call')?.agents[0].retry, undefined);
  }
});

test('failure surfaces are bounded, allowlisted, and redact credentials without exposing source paths', () => {
  const state = projectWorkflow({ ...failureResult, failures: Array.from({ length: 1001 }, (_, index) => ({
    ...failure, id: String(index), error: { code: 'invalid code!', message: 'API_KEY=private', retryable: 'yes' },
  })), taskFailures: [
    { ...callback, script: 'C:\\private\\secret.js', message: 'Authorization: Bearer private' },
    { ...callback, script: 'return agent("secret")' },
    { ...callback, script: 'API_KEY=private' },
    { ...callback, primitive: 'eval' },
    { ...callback, index: -1 },
    ...Array.from({ length: 100 }, () => callback),
  ] }, 'call')!;
  assert.equal(state.agents.length, 1000);
  assert.equal(state.agents[0].error?.message, '[redacted]');
  assert.equal(state.agents[0].error?.code, '');
  assert.equal(state.agents[0].error?.retryable, undefined);
  assert.equal(state.taskFailures?.length, 98);
  assert.ok(state.taskFailures?.slice(0, 3).every(item => item.script === undefined));
  assert.equal(state.taskFailures?.[0].message, '[redacted]');
});

test('history reload restores failure details and callbacks even with no progress file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-failure-'));
  try {
    const message = resultMessage(failureResult);
    const restored = (await hydrateWorkflowHistory(root, [message]))[0].desktopWorkflow!;
    assert.equal(restored.agents[0].error?.code, 'NODE_FAILED');
    assert.equal(restored.taskFailures?.[0].message, callback.message);
    const directory = join(root, '.stepcode', 'workflows', 'runs', progress.runId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, agents: [
      { ...progress.agents[0], status: 'cached' }, { ...progress.agents[1], rateLimitRetries: 2 },
    ] }));
    const hydrated = (await hydrateWorkflowHistory(root, [message]))[0].desktopWorkflow!;
    assert.deepEqual(hydrated.agents.map(agent => agent.status), ['cached', 'failed']);
    assert.equal(hydrated.agents[1].rateLimitRetries, 2);
    assert.equal(hydrated.agents[1].error?.message, 'Invalid request');
    assert.equal(hydrated.taskFailures?.length, 1);
    assert.equal(hydrated.cacheHits, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stopping remains active until a terminal result and never spins in idle history', () => {
  const stopping = { ...progress, status: 'stopping' };
  const projected = projectWorkflow(stopping, 'call')!;
  assert.equal(projected.status, 'stopping');
  assert.equal(workflowIsActive(projected.status), true);
  assert.equal(workflowIcon(projected.status), 'pending');
  const messages: Message[] = [
    { role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'call' }] },
    { role: 'toolResult', toolName: 'workflow', toolCallId: 'call', content: '', details: stopping },
  ];
  assert.equal(workflowsFromMessages(messages, true)[0].status, 'stopping');
  const idle = workflowsFromMessages(messages, false)[0];
  assert.equal(idle.status, 'unknown');
  assert.deepEqual(idle.agents.map(agent => agent.status), ['unknown', 'unknown']);
  messages.push({ role: 'user', content: 'next turn' });
  assert.equal(workflowsFromMessages(messages, true)[0].status, 'unknown');
  const pending = applyToolResult(messages.slice(0, 1), { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'call',
    partialResult: { details: progress } });
  const sparse = applyToolResult(pending, { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'call',
    partialResult: { details: { ...stopping, agents: undefined } } });
  assert.deepEqual(sparse[1].desktopWorkflow?.agents.map(agent => agent.status), ['running', 'queued']);
});

test('partial failure preserves final metadata and known node outcomes across persisted events', () => {
  const settled = { ...progress, status: 'partial_failed', completedAgents: 1, agents: [
    { ...progress.agents[0], status: 'completed', finishedAt: 150 },
    { ...progress.agents[1], status: 'failed', finishedAt: 190 },
  ] };
  const partial = { ...final, status: 'partial_failed', summary: { total: 2, completed: 1, failed: 1 } };
  assert.equal(workflowIsActive('partial_failed'), false);
  let messages: Message[] = [{ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'call' }] }];
  messages = applyToolResult(messages, { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'call',
    partialResult: { details: settled } });
  const message: Message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'call', content: '', details: partial, isError: true };
  messages = applyToolResult(messages, { type: 'tool_execution_end', toolName: 'workflow', toolCallId: 'call',
    result: { details: partial }, isError: true });
  messages = applyMessageEvent(messages, { type: 'message_start', message });
  messages = applyMessageEvent(messages, { type: 'message_end', message });
  const flow = workflowsFromMessages(messages, false)[0];
  assert.equal(flow.status, 'partial_failed');
  assert.equal(flow.finishedAt, 200);
  assert.equal(flow.spentTokens, 50);
  assert.equal(flow.totalAgents, 2);
  assert.equal(flow.completedAgents, 1);
  assert.deepEqual(flow.agents.map(agent => agent.status), ['completed', 'failed']);
});

test('reopened partial failure restores nodes while keeping authoritative final metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-partial-'));
  try {
    const directory = join(root, '.stepcode', 'workflows', 'runs', progress.runId);
    await mkdir(directory, { recursive: true });
    const saved = { ...progress, status: 'partial_failed', completedAgents: 1, agents: [
      { ...progress.agents[0], status: 'completed' }, { ...progress.agents[1], status: 'failed' },
    ] };
    await writeFile(join(directory, 'progress.json'), JSON.stringify(saved));
    const details = { ...final, status: 'partial_failed', summary: { total: 2, completed: 1, failed: 1 } };
    const store = new WorkflowBindings(join(root, 'bindings'));
    store.event('parent', { type: 'tool_execution_end', toolName: 'workflow', toolCallId: 'call', result: { details }, isError: true });
    const reopened = new WorkflowBindings(join(root, 'bindings'));
    await store.flush();
    const bindings = await reopened.load('parent');
    assert.equal(bindings.call.runId, progress.runId);
    const message: Message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'call', content: '', details, isError: true };
    const restored = (await hydrateWorkflowHistory(root, [message], bindings))[0];
    assert.equal(restored.desktopWorkflow?.status, 'partial_failed');
    assert.equal(restored.desktopWorkflow?.finishedAt, 200);
    assert.equal(restored.desktopWorkflow?.spentTokens, 50);
    assert.deepEqual(restored.desktopWorkflow?.agents.map(agent => agent.status), ['completed', 'failed']);
    assert.equal(restored.desktopWorkflow?.completedAgents, 1);
    assert.equal(restored.isError, true);
    const bound = (await hydrateWorkflowHistory(root, [{ ...message, details: {} }], bindings))[0];
    assert.equal(bound.desktopWorkflow?.status, 'partial_failed');
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...saved, status: 'stopping' }));
    const interrupted = (await hydrateWorkflowHistory(root, [{ ...message, details: {} }], bindings))[0];
    assert.equal(interrupted.desktopWorkflow?.status, 'failed', 'stopping is not a terminal result overriding an error');
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...saved, startedAt: 999 }));
    assert.equal((await hydrateWorkflowHistory(root, [message], bindings))[0].desktopWorkflow, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
    store.event('parent', { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'excluded', partialResult: { details: progress } });
    await store.flush();
    await store.copyHistory('parent', 'branch', [{ role: 'assistant', content: [{ type: 'toolCall', name: 'workflow', id: 'call' }] }]);
    assert.deepEqual(await store.load('branch'), binding, 'fork copies only retained calls');
    await store.copyHistory('parent', 'empty-branch', [{ role: 'user', content: 'before workflow' }]);
    assert.deepEqual(await store.load('empty-branch'), {});
    const reopened = new WorkflowBindings(join(root, 'bindings'));
    assert.deepEqual(await reopened.load('branch'), binding);
    const message: Message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'call', content: 'unstructured error', isError: true, details: {} };
    const hydrated = await hydrateWorkflowHistory(root, [message], binding);
    assert.equal(hydrated[0].desktopWorkflow?.status, 'aborted');
    assert.deepEqual(hydrated[0].desktopWorkflow?.agents.map(agent => agent.status), ['completed', 'aborted']);
    assert.equal(hydrated[0].isError, true);
    assert.equal((await hydrateWorkflowHistory(root, [message], await reopened.load('branch')))[0].desktopWorkflow?.status, 'aborted');
    assert.equal(message.desktopWorkflow, undefined);
    assert.equal((await hydrateWorkflowHistory(root, [message], await store.load('other-session')))[0].desktopWorkflow, undefined);
    assert.equal((await hydrateWorkflowHistory(root, [{ ...message, toolCallId: 'other-call' }], binding))[0].desktopWorkflow, undefined);
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, status: 'failed' }));
    assert.equal((await hydrateWorkflowHistory(root, [message], binding))[0].desktopWorkflow?.status, 'failed');
    await writeFile(join(directory, 'progress.json'), JSON.stringify({ ...progress, startedAt: 999, status: 'aborted' }));
    assert.equal((await hydrateWorkflowHistory(root, [message], binding))[0].desktopWorkflow, undefined);
    store.event('delete-me', { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'call', partialResult: { details: progress } });
    await store.remove('delete-me');
    assert.deepEqual(await reopened.load('delete-me'), {}, 'delete waits for in-flight writes');
    await store.remove('branch');
    assert.deepEqual(await reopened.load('branch'), {});
    assert.ok((await reopened.load('parent')).call, 'removing a branch preserves the source');
  } finally { await rm(root, { recursive: true, force: true }); }
});
