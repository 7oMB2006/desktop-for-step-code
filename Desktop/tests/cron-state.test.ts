import test from 'node:test';
import assert from 'node:assert/strict';
import { cronState, hasScheduledCron } from '../electron/cron-state';

const job = { id: 'cron-1', recurring: true, durable: false, nextFireAt: 1234, autoExpireAt: 5678 };
const snapshot = (jobs: unknown[] = [job], status = 'ready') => JSON.stringify({ version: 1, status, jobs });

test('Cron snapshots project only scheduling metadata, not prompts or credentials', () => {
  const state = cronState(snapshot([{ ...job, prompt: 'private task', token: 'secret' }]))!;
  assert.deepEqual(state.jobs, [job]);
  assert.equal(hasScheduledCron(state), true);
  assert.equal(hasScheduledCron(cronState(snapshot([]))), false);
  assert.equal(hasScheduledCron(cronState(snapshot([], 'unavailable'))), true);
  assert.equal(hasScheduledCron(undefined), false);
});

test('Cron snapshots reject unsupported, oversized and malformed state', () => {
  for (const invalid of [undefined, '', 'null', '{', JSON.stringify({ version: 2, status: 'ready', jobs: [] }),
    snapshot([], 'unknown'), snapshot([job, job]), snapshot(Array(51).fill(job)),
    snapshot([{ ...job, id: '../file' }]), snapshot([{ ...job, recurring: 1 }]),
    snapshot([{ ...job, nextFireAt: '1234' }]), snapshot([{ ...job, nextFireAt: 1e20 }]),
    snapshot([{ ...job, autoExpireAt: null }]), ' '.repeat(24001)]) {
    assert.equal(cronState(invalid), undefined);
  }
});
