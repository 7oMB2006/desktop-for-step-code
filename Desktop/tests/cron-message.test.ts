import test from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../src/contracts';
import { cronMessage } from '../src/cron-message';
import { conversationEntries, responsePresentation } from '../src/conversation-presentation';
import { planExecutionResponses } from '../src/plan-execution';
import { goalCompletionResponse, type GoalState } from '../src/launch-state';
import { currentTurnWorkflows, workflowsFromMessages } from '../src/workflow-state';
import { createPatch } from 'diff';
import { turnChanges } from '../src/turn-changes';
import { turnOutputPaths } from '../src/turn-artifacts';
import { groupProcesses } from '../src/process-groups';
import { groupConsecutiveTools } from '../src/tool-groups';

const fire: Message = { role: 'custom', customType: 'step-cron', display: true,
  content: '[cron] Say hello', timestamp: 1000,
  details: { id: 'one', cron: '10 9 * * *', durable: true, recurring: true } };
const indexed = (messages: Message[]) => messages.map((message, index) => ({ message, index }));

test('Cron identity requires upstream custom role and type, not a prose prefix', () => {
  for (const message of [{ ...fire, role: 'user' }, { ...fire, role: 'assistant' },
    { ...fire, customType: 'other' }, { ...fire, display: false }]) {
    assert.equal(cronMessage(message), undefined);
  }
  assert.equal(cronMessage(fire)?.prompt, 'Say hello');
  assert.equal(cronMessage(fire)?.original, '[cron] Say hello');
  assert.equal(cronMessage(fire)?.cron, '10 9 * * *');
});

test('Missed notices use upstream details and preserve the complete original notice', () => {
  const message = { ...fire, content: '[cron] Missed 2 one-shot jobs\n- one: hello\n- two: check',
    details: { kind: 'missed', count: 2, jobs: [{ id: 'one' }, { id: 'two' }] } };
  assert.equal(cronMessage(message)?.kind, 'missed');
  assert.equal(cronMessage(message)?.count, 2);
  assert.equal(cronMessage(message)?.original, message.content);
  assert.equal(cronMessage({ ...fire, content: '[cron] Missed is just a task title' })?.kind, 'fire');
});

test('Missing or invalid metadata is not fabricated; multiline and non-prefix content survive', () => {
  const message: Message = { ...fire, content: [{ type: 'text', text: 'First\nsecond' }],
    timestamp: Infinity, details: { id: 12, cron: {}, count: -1, kind: 'missed' } };
  assert.deepEqual(cronMessage(message), { kind: 'missed', prompt: 'First\nsecond', original: 'First\nsecond',
    timestamp: undefined, id: undefined, cron: undefined, count: undefined });
  assert.equal(cronMessage({ ...fire, timestamp: 0 })?.timestamp, 0);
  assert.equal(cronMessage({ ...fire, timestamp: 1e20 })?.timestamp, undefined);
});

test('Cron replaces only its own prose in sequence and remains a boundary for every complexity preset', () => {
  const tool = { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'read_file' }] } as Message;
  const reply: Message = { role: 'assistant', content: 'Actual reply' };
  const { content, text, lastTextIndex } = responsePresentation(indexed([tool, fire, reply]));
  assert.deepEqual(content.map(item => item.type), ['tool', 'cron', 'text']);
  assert.equal(lastTextIndex, 2);
  assert.equal(text, '[cron] Say hello\n\nActual reply', 'Copy/export projection stays unchanged');
  assert.equal(groupProcesses(content, true)[1].type, 'cron');
  assert.equal(groupConsecutiveTools(content, true)[1].type, 'cron');
  assert.deepEqual(responsePresentation(indexed([{ ...fire, display: false }])).content, []);
  assert.deepEqual(responsePresentation(indexed([{ ...fire, role: 'assistant' }])).content.map(item => item.type), ['text']);
});

test('Consecutive Cron deliveries and saved snapshots preserve order and distinct notices', () => {
  const saved = JSON.parse(JSON.stringify([fire, { ...fire, details: { kind: 'missed', count: 1 } }])) as Message[];
  const presentation = responsePresentation(indexed(saved));
  assert.deepEqual(presentation.content.map(item => item.key), ['0:cron', '1:cron']);
  assert.deepEqual(presentation.content.map(item => item.type === 'cron' && item.notice.kind), ['fire', 'missed']);
});

test('Cron starts independent responses without stealing previous Plan or Goal completion', () => {
  const messages: Message[] = [
    { role: 'user', content: 'Original task', entryId: 'owner', timestamp: 100 },
    { role: 'toolResult', toolName: 'exit_plan_mode', content: 'Approved',
      details: { outcome: 'approved', planFilePath: 'D:/plan.md', planContents: '# Plan' } },
    { role: 'assistant', content: 'Original result', stopReason: 'stop',
      desktopTiming: { run: { startedAt: 100, endedAt: 900 }, thinking: {} } },
    fire, { role: 'assistant', content: 'Cron result', stopReason: 'stop',
      desktopTiming: { run: { startedAt: 1000, endedAt: 1500 }, thinking: {} } },
    { ...fire, details: { kind: 'missed', count: 1 } },
    { role: 'assistant', content: 'Missed result', stopReason: 'stop' },
  ];
  for (const snapshot of [messages, JSON.parse(JSON.stringify(messages)) as Message[]]) {
    const responses = conversationEntries(snapshot).filter(entry => entry.type === 'response');
    assert.deepEqual(responses.map(entry => entry.index), [1, 3, 5]);
    assert.deepEqual(responses.map(entry => entry.items.map(item => item.index)), [[1, 2], [3, 4], [5, 6]]);
    assert.equal(responses[0].items.at(-1)?.message.desktopTiming?.run.endedAt, 900);
    assert.equal(responses[1].items.at(-1)?.message.desktopTiming?.run.startedAt, 1000);
    for (const busy of [true, false]) {
      assert.deepEqual([...planExecutionResponses(snapshot, busy)].map(([index, state]) => [index, state.state]),
        [[1, 'completed']]);
    }
    assert.equal(goalCompletionResponse(snapshot, {
      status: 'complete', completion: { userEntryId: 'owner' },
    } as GoalState), 1);
  }
});

test('Hidden Cron and assistant prefix prose do not split replies; visible Cron does', () => {
  const reply: Message = { role: 'assistant', content: 'Answer' };
  assert.equal(conversationEntries([reply, { ...fire, display: false }, reply]).length, 1);
  assert.equal(conversationEntries([reply, { ...fire, role: 'assistant' }, reply]).length, 1);
  assert.equal(conversationEntries([reply, fire, fire, reply]).length, 3);
});

test('Cron current-turn workflows cannot inherit an earlier live workflow', () => {
  const messages: Message[] = [
    { role: 'user', content: 'Original task' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'old', name: 'workflow' }] },
    fire,
  ];
  assert.deepEqual(currentTurnWorkflows(messages), []);
  assert.equal(workflowsFromMessages(messages)[0].status, 'unknown');
  messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: 'new', name: 'workflow' }] });
  assert.deepEqual(currentTurnWorkflows(messages).map(flow => flow.toolCallId), ['new']);
  assert.deepEqual(workflowsFromMessages(messages).map(flow => flow.status), ['unknown', 'running']);
});

test('Cron response owns only its own file changes and delivered outputs', () => {
  const write = (id: string, path: string): Message[] => [
    { role: 'assistant', content: [{ type: 'toolCall', id, name: 'write_file', arguments: { path } }] },
    { role: 'toolResult', toolCallId: id, toolName: 'write_file', content: 'Done',
      details: { patch: createPatch(path, '', 'Report\n') } },
    { role: 'assistant', content: 'Done', stopReason: 'stop' },
  ];
  const responses = conversationEntries([
    { role: 'user', content: 'Original task' }, ...write('original', 'previous.md'),
    fire, ...write('cron', 'scheduled.md'),
  ]).filter(entry => entry.type === 'response');
  assert.deepEqual(responses.map(entry => turnChanges(entry.items).files.map(file => file.path)),
    [['previous.md'], ['scheduled.md']]);
  assert.deepEqual(responses.map(entry => turnOutputPaths(entry.items, 'win32')),
    [['previous.md'], ['scheduled.md']]);
});
