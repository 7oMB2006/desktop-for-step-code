import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionMoveError } from '../src/session-move-error';

test('Move errors distinguish live hosts, associated tasks and unavailable ownership', () => {
  const wrapped = (code: string) => new Error(`Error invoking remote method 'desktop': Error: ${code}`);
  assert.match(sessionMoveError(wrapped('MOVE_CRON_HOST: job-1, job_2'), true), /正在承载.*job-1, job_2/);
  assert.match(sessionMoveError(wrapped('MOVE_CRON_ASSOCIATED: owned'), true), /关联的持久.*owned/);
  assert.match(sessionMoveError(wrapped('MOVE_CRON_UNAVAILABLE'), true), /无需清空其他会话/);
  assert.match(sessionMoveError(wrapped('MOVE_CRON_HOST: task'), false), /hosting.*task/);
  assert.match(sessionMoveError(wrapped('MOVE_CRON_ASSOCIATED: task'), false), /owns saved.*task/);
  assert.match(sessionMoveError(wrapped('MOVE_CRON_UNAVAILABLE: runtime'), false), /isolation support/);
  assert.doesNotMatch(sessionMoveError(wrapped('MOVE_CRON_UNAVAILABLE: runtime'), false), /remote method/);
});

test('Move errors retain existing busy, directory, goal and background guidance', () => {
  assert.match(sessionMoveError(new Error('Pause active goal'), false), /Pause/);
  assert.match(sessionMoveError(new Error('Wait for background agents'), false), /Background/);
  assert.match(sessionMoveError(new Error('ENOENT'), false), /folder/);
  assert.match(sessionMoveError(new Error('Session operation in progress'), false), /queued messages/);
  assert.match(sessionMoveError(undefined, true), /未能移动/);
});
