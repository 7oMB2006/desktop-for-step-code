import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { QuitReview, needsQuitReview, quitReasons } from '../electron/quit-review';
import { SessionRuntimes, type SessionRuntime } from '../electron/session-runtimes';
import type { QuitReviewState } from '../src/quit-confirmation';

const empty = { temporaryJobs: 0, durableJobs: 0, runningTasks: 0, activeGoals: 0 };
function worker(id: string, cwd = resolve('project')): SessionRuntime {
  return { id, cwd, status: 'connected', busy: false, submissions: 0, pendingUI: new Map(),
    cron: { version: 1, status: 'ready', jobs: [] } } as unknown as SessionRuntime;
}
test('quit summary deduplicates project records, not temporary jobs or distinct projects', () => {
  const pool = new SessionRuntimes(() => {});
  for (const host of [worker('a'), worker('b'), worker('c', resolve('other'))]) {
    host.cron!.jobs = [
      { id: 'same', recurring: true, durable: true, nextFireAt: Date.now() },
      { id: 'temporary', recurring: false, durable: false, nextFireAt: Date.now() },
    ];
    pool.workers.set(host.id, host);
  }
  assert.deepEqual(quitReasons(pool, false), { ...empty, durableJobs: 2, temporaryJobs: 3,
    unknownCronHosts: 0, transitioning: false });
  const offline = worker('offline');
  offline.status = 'disconnected';
  offline.cron = pool.workers.get('a')!.cron;
  pool.workers.set(offline.id, offline);
  assert.equal(quitReasons(pool, false).temporaryJobs, 3);
});
test('quit summary protects unavailable Cron, queued tasks, approvals, goals and transitions', () => {
  const pool = new SessionRuntimes(() => {});
  const host = worker('a');
  pool.workers.set(host.id, host);
  assert.equal(needsQuitReview(quitReasons(pool, false)), false);
  host.cron!.status = 'unavailable';
  assert.equal(needsQuitReview(quitReasons(pool, false)), true);
  assert.equal(quitReasons(pool, false).runningTasks, 0);
  host.queued = true;
  assert.equal(quitReasons(pool, false).runningTasks, 1);
  host.queued = false;
  host.pendingUI.set('approval', {} as never);
  assert.equal(quitReasons(pool, false).runningTasks, 1);
  host.pendingUI.clear();
  host.launch = { goal: { status: 'active' } } as SessionRuntime['launch'];
  assert.equal(quitReasons(pool, false).activeGoals, 1);
  assert.equal(needsQuitReview({ ...empty, transitioning: true }), true);
});
test('quit review rejects stale, malformed and replayed replies and preserves pending identity', async () => {
  const events: QuitReviewState[] = [];
  const gate = new QuitReview(state => events.push(state));
  const first = gate.ask({ ...empty, temporaryJobs: 1 });
  assert.equal(gate.ask(empty), first);
  const old = gate.state.request!.id;
  assert.throws(() => gate.respond(old, 'true'));
  assert.throws(() => gate.respond('wrong', true));
  gate.refresh({ ...empty, temporaryJobs: 2 });
  assert.notEqual(gate.state.request!.id, old);
  assert.throws(() => gate.respond(old, true));
  gate.respond(gate.state.request!.id, false);
  assert.equal(await first, false);
  assert.equal(gate.state.request, undefined);
  const second = gate.ask(empty);
  const id = gate.state.request!.id;
  gate.respond(id, true);
  assert.equal(await second, true);
  assert.equal((gate.state as QuitReviewState).request?.phase, 'stopping');
  assert.throws(() => gate.respond(id, true));
  gate.reset();
  const third = gate.ask(empty);
  gate.reset();
  assert.equal(await third, false);
  assert.ok(events.every((state, index) => state.revision === index + 1));
});
