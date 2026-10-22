import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quitConfirmation, type QuitReasons } from '../src/quit-confirmation';

const empty: QuitReasons = { temporaryJobs: 0, durableJobs: 0, runningTasks: 0, activeGoals: 0 };

test('Cron alone explains why quit was intercepted without claiming a task is running', () => {
  const p = quitConfirmation({ ...empty, temporaryJobs: 1, durableJobs: 1 }, 'zh');
  assert.equal(p.title, '仍有定时任务，确认退出？');
  assert.deepEqual(p.items.map(item => item.kind), ['cron']);
  assert.match(p.items[0].title, /2 个定时任务/);
  assert.match(p.items[0].description, /到点不会执行/);
  assert.match(p.notes[0], /临时.*丢失/);
  assert.match(p.notes[1], /记录保留.*不代表.*自动恢复/);
  assert.equal(p.confirm, '退出应用');
});

test('durable-only tasks never show temporary loss or promise automatic resumption', () => {
  const p = quitConfirmation({ ...empty, durableJobs: 2 }, 'zh');
  assert.equal(p.notes.length, 1);
  assert.doesNotMatch(p.notes[0], /丢失/);
  assert.match(p.notes[0], /不代表/);
});

test('running tasks and Goals have distinct reasons and only running tasks use stop-and-quit', () => {
  assert.equal(quitConfirmation({ ...empty, runningTasks: 1 }, 'zh').confirm, '停止任务并退出');
  const p = quitConfirmation({ ...empty, activeGoals: 1 }, 'zh');
  assert.match(p.title, /Goal/);
  assert.equal(p.confirm, '退出应用');
  assert.deepEqual(p.items.map(item => item.kind), ['goal']);
});

test('mixed reasons remain independently visible, with Cron first', () => {
  const p = quitConfirmation({ temporaryJobs: 1, durableJobs: 2, runningTasks: 1, activeGoals: 1 }, 'en');
  assert.equal(p.title, 'Tasks remain active. Quit application?');
  assert.deepEqual(p.items.map(item => item.kind), ['cron', 'running', 'goal']);
  assert.equal(p.confirm, 'Stop tasks and quit');
  assert.equal(p.notes.length, 2);
  assert.equal(quitConfirmation(empty, 'zh').items.length, 0);
});

test('unavailable Cron counts are not invented and transitions explain their own interruption', () => {
  const unknown = quitConfirmation({ ...empty, unknownCronHosts: 1 }, 'zh');
  assert.match(unknown.items[0].title, /状态暂不可用/);
  assert.doesNotMatch(unknown.items[0].title, /0 个/);
  assert.match(quitConfirmation({ ...empty, durableJobs: 1, unknownCronHosts: 1 }, 'zh').items[0].title, /1 个已知/);
  const transition = quitConfirmation({ ...empty, transitioning: true }, 'en');
  assert.deepEqual(transition.items.map(item => item.kind), ['transition']);
  assert.match(transition.items[0].description, /session operation/);
});
