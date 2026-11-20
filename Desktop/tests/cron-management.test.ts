import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { CronManagement, cronCreation, cronJobs, type CronRuntimeJob, type SavedCronJobs } from '../electron/cron-management';
import type { SessionRuntime, SessionRuntimes } from '../electron/session-runtimes';
import { cronRevision } from '../src/cron-revision';

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
  assert.equal(result.hosts[0].sessionId, 'session');
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
test('Host navigation resolves only the current online runtime, without RPC, mutation or history fallback', () => {
  const f = fixture();
  f.worker.mutating = true;
  assert.equal(f.service.host('one'), f.worker, 'Navigation does not require stopping busy work');
  assert.equal(f.calls.length, 0);
  assert.equal(f.changes(), 0);
  for (const value of [undefined, '', 1, {}, 'x'.repeat(81), 'missing'])
    assert.throws(() => f.service.host(value));
  f.worker.stopping = true;
  assert.throws(() => f.service.host('one'), /offline/);
  f.worker.stopping = false;
  f.worker.state = { isStreaming: false };
  assert.throws(() => f.service.host('one'), /offline/);
  f.worker.state = { sessionId: 'session', isStreaming: false };
  f.worker.status = 'disconnected';
  assert.throws(() => f.service.host('one'), /Disconnected/);
  f.pool.workers.clear();
  assert.throws(() => f.service.host('one'), /Disconnected/);
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
test('Task editing validates strict payloads, preserves revisions and uses the per-host lock', async () => {
  const f = fixture();
  const input = { runtimeId: 'one', jobId: job.id, expected: cronRevision(job), paused: true };
  for (const invalid of [{ ...input, paused: 'yes' }, { ...input, jobId: '../x' },
    { ...input, expected: undefined }, { ...input, prompt: '' }, { ...input, cron: 'x'.repeat(101) }])
    assert.throws(() => f.service.update(invalid), /Invalid/);
  f.worker.rpc.request = async (type, args) => {
    assert.equal(f.worker.mutating, true);
    f.calls.push({ type, args });
    return { jobs: [], result: { ...job, desktopPausedAt: 123 } };
  };
  await f.service.update(input);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args?.action, 'update');
  assert.equal(f.calls[0].args?.expected, input.expected);
  assert.equal(f.worker.mutating, false);
  assert.equal(cronRevision({ ...job, nextFireAt: 999 }), cronRevision(job));
  assert.notEqual(cronRevision({ ...job, desktopPausedAt: 123 }), cronRevision(job));
});
test('Authorization invalidation must finish before editing and revalidate the host', async () => {
  const f = fixture();
  const input = { runtimeId: 'one', jobId: job.id, expected: cronRevision(job), paused: true };
  const failed = new CronManagement(f.pool, async () => ({ jobs: [], trusted: true }), () => {}, undefined,
    async () => { throw new Error('authorization storage failed'); });
  await assert.rejects(failed.update(input), /authorization storage failed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.worker.mutating, false);
  const replaced = new CronManagement(f.pool, async () => ({ jobs: [], trusted: true }), () => {}, undefined,
    async () => { f.worker.rpc = { request: async () => { throw new Error('must not run'); } } as any; });
  await assert.rejects(replaced.update(input), /host changed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.worker.mutating, false);
});

function ownedFixture() {
  const f = fixture();
  const sessionFile = resolve('isolated-profile', 'original.jsonl');
  const foreignFile = resolve('other-profile', 'elsewhere.jsonl');
  f.worker.state = { ...f.worker.state!, sessionFile };
  const home = { ...job, sessionId: 'session', sessionFile, status: 'enabled' as const, revision: 'a'.repeat(64),
    nextFireAt: Date.now() + 600000, autoExpireAt: Date.now() + 3600000 };
  const offline = { ...home, id: 'offline', sessionId: 'other', sessionFile: foreignFile, revision: 'b'.repeat(64) };
  const parked = { ...job, id: 'old', desktopPausedAt: 10, autoExpireAt: undefined };
  const temporary = { ...home, id: 'temp', durable: false, revision: 'c'.repeat(64) };
  let saved: SavedCronJobs & { jobs: CronRuntimeJob[] } = { jobs: [home, offline, parked], trusted: true };
  let reads = 0;
  const service = new CronManagement(f.pool, async () => { reads++; return saved; }, () => {}, undefined, undefined,
    { sameSessionFile: async (a, b) => a === b });
  f.worker.rpc.request = async (type, args) => {
    f.calls.push({ type, args });
    return { jobs: [home, temporary], trusted: true };
  };
  return { ...f, service, home, offline, parked, temporary, reads: () => reads,
    disk: (value: typeof saved) => { saved = value; } };
}

test('Session-owned list combines trusted disk records with the correct resident worker only', async () => {
  const f = ownedFixture();
  const paused = { ...f.offline, id: 'paused', status: 'paused' as const, enabled: false };
  const missed = { ...f.offline, id: 'missed', status: 'completed' as const, lastStatus: 'missed' as const };
  f.disk({ jobs: [f.home, f.offline, f.parked, paused, missed], trusted: true, incomplete: false });
  const overview = await f.service.list([f.worker.cwd]);
  const tasks = new Map(overview.tasks.map(task => [task.id, task]));
  assert.equal(overview.sessionOwned, true);
  assert.equal(f.reads(), 1, 'A trusted online worker must not replace the disk inventory');
  assert.equal(tasks.size, 6);
  assert.equal(tasks.get(f.home.id)?.runtimeId, f.worker.id);
  assert.equal(tasks.get(f.home.id)?.association?.sessionId, 'session');
  assert.equal(tasks.get(f.offline.id)?.runtimeId, undefined);
  assert.equal(tasks.get(f.offline.id)?.association?.sessionId, 'other');
  assert.equal(tasks.get(f.parked.id)?.association, undefined);
  assert.equal(tasks.get(f.parked.id)?.scheduling, 'parked');
  assert.equal(tasks.get(f.parked.id)?.recoverable, false);
  assert.equal(tasks.get('paused')?.scheduling, 'paused');
  assert.equal(tasks.get('missed')?.scheduling, 'missed');
  assert.equal(tasks.get('missed')?.recoverable, false);
  assert.equal(tasks.get(f.temporary.id)?.runtimeId, 'one');
  assert.doesNotMatch(JSON.stringify(overview), /sessionFile|isolated-profile|other-profile/);
  assert.deepEqual(f.calls[0].args, { action: 'list', sessionId: 'session' });
});

test('A changed or partial disk snapshot cannot synthesize an owner for a live stale row', async () => {
  const f = ownedFixture();
  for (const incomplete of [false, true]) {
    f.disk({ jobs: [{ ...f.home, prompt: 'Edited while listing', revision: 'd'.repeat(64) }, f.offline], trusted: true, incomplete });
    const overview = await f.service.list([f.worker.cwd]);
    const row = overview.tasks.find(item => item.id === f.home.id);
    assert.equal(row?.prompt, 'Edited while listing');
    assert.equal(row?.runtimeId, undefined);
    assert.equal(row?.recoverable, false, 'A resident session cannot be opened again as an offline host');
    assert.equal(overview.tasks.find(item => item.id === f.offline.id)?.recoverable, !incomplete);
    assert.deepEqual(overview.issues.map(issue => issue.reason), incomplete ? ['unavailable'] : []);
  }
  f.disk({ jobs: [], trusted: false, incomplete: false });
  const untrusted = await f.service.list([f.worker.cwd]);
  assert.deepEqual(untrusted.tasks.map(row => row.id), ['temp']);
  assert.equal(untrusted.issues[0].reason, 'untrusted');
});

test('A different native session cannot lend its live runtime to a saved task', async () => {
  const f = ownedFixture();
  f.worker.rpc.request = async () => ({ jobs: [f.offline], trusted: true });
  const overview = await f.service.list([f.worker.cwd]);
  assert.equal(overview.tasks.find(item => item.id === f.offline.id)?.runtimeId, undefined);
  assert.deepEqual(overview.issues.map(issue => issue.reason), ['unavailable']);
});

test('Session-owned create, update and delete send the reviewed digest and current owner', async () => {
  const f = ownedFixture();
  const longId = 'native-2026'.repeat(4);
  f.worker.rpc.request = async (type, args) => {
    f.calls.push({ type, args });
    return { jobs: [], trusted: true, result: { ...f.home, id: longId } };
  };
  const runAt = Date.now() + 600000;
  const create = { runtimeId: f.worker.id, cron: '* * * * *', prompt: 'One-shot', recurring: false, durable: true, runAt };
  await f.service.create(create);
  await f.service.update({ runtimeId: f.worker.id, jobId: longId, expected: f.home.revision, paused: true });
  await f.service.delete(f.worker.id, longId, f.home.revision);
  assert.deepEqual(f.calls.map(call => call.args?.sessionId), ['session', 'session', 'session']);
  assert.equal(f.calls[0].args?.runAt, runAt);
  assert.equal(f.calls[1].args?.expected, f.home.revision);
  assert.equal(f.calls[2].args?.expected, f.home.revision);
  assert.throws(() => f.service.delete(f.worker.id, longId), /Invalid/);
  assert.throws(() => f.service.update({ runtimeId: f.worker.id, jobId: longId, expected: cronRevision(f.home), paused: true }), /Invalid/);
  for (const invalid of [{ ...create, runAt: Date.now() - 1 }, { ...create, recurring: true },
    { ...create, runAt: undefined, recurring: true, intervalHours: 0 },
    { ...create, runAt: undefined, recurring: true, intervalHours: '1' }])
    assert.throws(() => f.service.create(invalid), /Invalid/);
  assert.throws(() => cronCreation(create), /Invalid/);
  const fixed = { ...create, runAt: undefined, recurring: true, intervalHours: 168 };
  assert.equal(cronCreation(fixed, true).intervalHours, 168);
});

test('An owner change under the host lock prevents an inspected command from reaching RPC', async () => {
  const f = ownedFixture();
  f.idle(async worker => { worker.state = { ...worker.state!, sessionId: 'other' }; });
  await assert.rejects(f.service.delete(f.worker.id, f.home.id, f.home.revision), /host changed/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.worker.mutating, false);
});
