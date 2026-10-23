import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryTasks } from '../src/summary-tasks';
import type { Message, SessionSummary, SummaryTask } from '../src/contracts';

const task = (id: string, status: SummaryTask['status'], updatedAt?: number): SummaryTask =>
  ({ id, subject: id, description: '', status, ...(updatedAt ? { updatedAt } : {}) });
const snapshot = (tasks: SummaryTask[]): SessionSummary =>
  ({ sessionId: 's', plan: { id: 'p', title: 'Plan' }, tasks, mcp: [], skillCount: 0 });
const messages: Message[] = [{ role: 'user', content: 'Old request', timestamp: 100 },
  { role: 'user', content: 'New request', timestamp: 300 }];

test('completed previous-turn tasks leave current counts without mutating canonical data', () => {
  const summary = snapshot([task('1', 'completed', 200), task('2', 'completed', 250)]);
  const before = structuredClone(summary);
  const view = summaryTasks(summary, messages);
  assert.deepEqual(view.tasks, []);
  assert.deepEqual(view.history.map(plan => plan.tasks.length), [2]);
  assert.deepEqual(summary, before);
  assert.deepEqual(summaryTasks(summary, structuredClone(messages)), view, 'reload uses persisted evidence, not mounted state');
  assert.deepEqual(summaryTasks(summary, messages.slice(0, 1)).tasks, summary.tasks, 'completion remains visible in its original turn');
});

test('unfinished work carries across turns, new work and reopened tasks have independent progress', () => {
  const summary = snapshot([task('1', 'completed', 200), task('2', 'pending', 200),
    task('3', 'in_progress', 200), task('4', 'failed', 200), task('5', 'completed', 400)]);
  const view = summaryTasks(summary, messages);
  assert.deepEqual(view.tasks.map(task => task.id), ['2', '3', '4', '5']);
  assert.deepEqual(view.history[0].tasks.map(task => task.id), ['1']);
  summary.tasks[0] = task('1', 'in_progress', 450);
  assert.equal(summaryTasks(summary, messages).history.length, 0);
});

test('legacy snapshots use successful structured mutations, with no guesses for unknown records', () => {
  const mutation = (name: string, id: string): Message[] => [
    { role: 'assistant', content: [{ type: 'toolCall', id: `call-${id}`, name, arguments: { taskId: id } }] },
    { role: 'toolResult', toolCallId: `call-${id}`, toolName: name, content: '', details: { id } },
  ];
  const history = [messages[0], ...mutation('task_create', '1'), ...mutation('task_update', '2'), messages[1],
    ...mutation('task_update', '3')];
  const view = summaryTasks(snapshot(['1', '2', '3', 'unknown'].map(id => task(id, 'completed'))), history);
  assert.deepEqual(view.tasks.map(task => task.id), ['3', 'unknown']);
  assert.deepEqual(view.history[0].tasks.map(task => task.id), ['1', '2']);
  const failed = structuredClone(history);
  failed[2].isError = true;
  assert.ok(summaryTasks(snapshot([task('1', 'completed')]), failed).tasks.length);
});

test('Cron firings and Goal input form boundaries; steering and missed Cron notices do not', () => {
  for (const boundary of [
    { role: 'custom', customType: 'step-cron', content: '[cron] New request', timestamp: 300 },
    { role: 'custom', customType: 'desktop-goal-input', content: 'Goal', timestamp: 300 },
  ]) {
    assert.equal(summaryTasks(snapshot([task('1', 'completed', 200)]), [messages[0], boundary]).tasks.length, 0);
  }
  for (const notice of [
    { role: 'custom', customType: 'step-cron', content: '', details: { kind: 'missed' }, timestamp: 300 },
    { role: 'user', content: 'Hidden', display: false, timestamp: 300 },
  ]) {
    assert.equal(summaryTasks(snapshot([task('1', 'completed', 200)]), [messages[0], notice]).tasks.length, 1);
  }
});

test('runtime plan archives retain original task statuses and never enter current counts', () => {
  const summary = snapshot([task('new', 'pending', 400)]);
  summary.archivedPlans = [{ id: 'old', title: 'Previous', tasks: [task('unfinished', 'pending', 200)] }];
  const view = summaryTasks(summary, messages);
  assert.deepEqual(view.tasks.map(task => task.id), ['new']);
  assert.equal(view.history[0].tasks[0].status, 'pending');
  assert.equal(summaryTasks(undefined, messages).history.length, 0);
});
