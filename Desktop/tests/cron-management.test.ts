import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CronManagement, cronCreation, cronJobs } from '../electron/cron-management';
import type { SessionRuntime, SessionRuntimes } from '../electron/session-runtimes';

const job = { schemaVersion: 1, id: 'job-1', cron: '0 9 * * *', prompt: 'Check tasks', recurring: true, durable: true, createdAt: 100, nextFireAt: 200, autoExpireAt: 300 };
function fixture() {
  const calls: { type: string; args?: Record<string, unknown> }[] = [];
  const worker = { id: 'one', cwd: 'D:/project', status: 'connected', operations: 0, mutating: false,
    state: { sessionId: 'session', sessionName: 'Original' }, rpc: {
      request: async (type: string, args?: Record<string, unknown>) => { calls.push({ type, args }); return { jobs: [job], trusted: true }; },
    },
  } as unknown as SessionRuntime;
  let idle = async (_worker: SessionRuntime) => {};
  const pool = { workers: new Map([[worker.id, worker]]), activeId: worker.id,
    require: (id: string) => { const value = pool.workers.get(id); if (!value || value.status !== 'connected') throw new Error('Disconnected'); return value; },
    isBusy: () => false, assertIdle: (worker: SessionRuntime) => idle(worker), publish: () => {},
  } as unknown as SessionRuntimes;
  let changes = 0;
  const service = new CronManagement(pool, async () => ({ trusted: true, jobs: [job] }), () => changes++);
  return { worker, pool, calls, service, changes: () => changes, idle: (next: typeof idle) => { idle = next; } };
}
test('Cron job projection validates bounded payloads and strips unknown fields', () => {
  const [projected] = cronJobs([{ ...job, apiKey: 'must-not-forward', sessionId: 'not-an-owner' }]);
  assert.equal('apiKey' in projected, false);
  assert.equal('sessionId' in projected, false);
  for (const jobs of [[{ ...job, id: '../x' }], [job, job], [{ ...job, prompt: 'a'.repeat(4001) }], [{ ...job, nextFireAt: NaN }], null])
    assert.throws(() => cronJobs(jobs));
});
test('Cron creation rejects coercion and unknown runtime parameters', () => {
  const valid = { runtimeId: 'one', cron: ' 0 9 * * * ', prompt: ' hello ', recurring: false, durable: false };
  assert.equal(cronCreation(valid).cron, '0 9 * * *');
  assert.equal(cronCreation(valid).prompt, 'hello');
  for (const value of [{ ...valid, durable: 'true' }, { ...valid, recurring: undefined }, { ...valid, prompt: '' }, { ...valid, cron: '' }])
    assert.throws(() => cronCreation(value));
});
test('Cron list deduplicates project-shared durable jobs, not temporary jobs', async () => {
  const f = fixture();
  const second = { ...f.worker, id: 'two', rpc: { request: async () => ({ jobs: [job], trusted: true }) } } as unknown as SessionRuntime;
  f.pool.workers.set(second.id, second);
  let result = await f.service.list(['D:/project']);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].runtimeId, 'one');
  assert.equal(result.hosts.length, 2);
  second.rpc.request = async () => ({ jobs: [{ ...job, durable: false }], trusted: true });
  result = await f.service.list(['D:/project']);
  assert.equal(result.tasks.length, 2);
  assert.ok(f.calls.every(call => call.type === 'desktop_cron'));
  assert.equal(f.worker.operations, 0);
});
test('Offline durable tasks are read-only, with no invented runtime ownership', async () => {
  const f = fixture();
  f.pool.workers.clear();
  const result = await f.service.list(['D:/project']);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].runtimeId, undefined);
  assert.deepEqual(result.hosts, []);
  assert.equal(f.calls.length, 0);
});
test('Untrusted or unreadable projects remain explicit issues', async () => {
  const f = fixture();
  f.pool.workers.clear();
  const service = new CronManagement(f.pool, async cwd => {
    if (cwd === 'untrusted') return { jobs: [], trusted: false };
    throw new Error('storage error');
  }, () => {});
  const result = await service.list(['untrusted', 'failed']);
  assert.deepEqual(result.issues.map(issue => issue.reason), ['untrusted', 'unavailable']);
});
test('Creation uses only native management RPC while holding the host mutation lock', async () => {
  const f = fixture();
  f.worker.rpc.request = async (type, args) => {
    assert.equal(f.worker.mutating, true);
    f.calls.push({ type, args });
    return { jobs: [], trusted: true };
  };
  await f.service.create({ runtimeId: 'one', cron: '0 9 * * *', prompt: 'read only', recurring: true, durable: true });
  assert.deepEqual(f.calls.map(call => call.type), ['desktop_cron']);
  assert.equal(f.calls[0].args?.action, 'create');
  assert.equal(f.worker.mutating, false);
  assert.equal(f.changes(), 1);
});
test('Busy, pending and replaced hosts cannot mutate Cron', async () => {
  const f = fixture();
  f.worker.operations = 1;
  await assert.rejects(f.service.delete('one', job.id), /busy/);
  f.worker.operations = 0;
  f.idle(async () => { throw new Error('queued input'); });
  await assert.rejects(f.service.delete('one', job.id), /queued/);
  assert.equal(f.worker.mutating, false);
  f.idle(async () => { f.worker.rpc = { request: async () => { throw new Error('must not run'); } } as any; });
  await assert.rejects(f.service.delete('one', job.id), /host changed/);
  assert.equal(f.calls.length, 0);
});
test('A failed mutation releases its lock without retrying a possibly committed write', async () => {
  const f = fixture();
  let calls = 0;
  f.worker.rpc.request = async () => { calls++; throw new Error('timeout'); };
  await assert.rejects(f.service.delete('one', job.id), /timeout/);
  assert.equal(calls, 1);
  assert.equal(f.worker.mutating, false);
});
