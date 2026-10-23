import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronRecovery, assertRecoveryJobs, resumeCronHost, type CronRecoveryPlan } from '../electron/cron-recovery';
import { RpcCommandError } from '../electron/runtime';
import { CronBindings } from '../electron/cron-bindings';
import type { CronJobData } from '../src/contracts';

const job: CronJobData = { id: 'one', cron: '* * * * *', prompt: 'Check', durable: true,
  recurring: true, createdAt: 100, nextFireAt: 200 };
test('Resume retains a successful host and removes an explicitly rejected gated host without retry', async () => {
  for (const rejected of [false, true]) {
    let requests = 0, removed = 0;
    const error = new RpcCommandError('Cron recovery requires an idle trusted project');
    const resume = resumeCronHost({ request: async (type, args, timeout) => {
      requests++;
      assert.equal(type, 'desktop_cron_resume');
      assert.deepEqual(args, {});
      assert.equal(timeout, 15000);
      if (rejected) throw error;
    } }, async () => { removed++; });
    if (rejected) await assert.rejects(resume, e => e === error);
    else await resume;
    assert.equal(requests, 1);
    assert.equal(removed, rejected ? 1 : 0);
  }
});
test('Resume timeout and transport failures retain the potentially activated host without retry', async () => {
  for (const message of ['Runtime timed out: desktop_cron_resume', 'Runtime is not connected',
    'Runtime exited (1)', 'Cron recovery requires an idle trusted project']) {
    let requests = 0, removed = 0;
    const error = new Error(message);
    await assert.rejects(resumeCronHost({ request: async () => { requests++; throw error; } },
      async () => { removed++; }), e => e === error);
    assert.equal(requests, 1);
    assert.equal(removed, 0);
  }
});
test('Post-start gate allows native time advancement/expiry, never unreviewed work', () => {
  assertRecoveryJobs([job], [{ ...job, nextFireAt: 300 }]);
  assertRecoveryJobs([job], []);
  for (const change of [{ prompt: 'Other' }, { id: 'new' }, { createdAt: 101 }, { durable: false },
    { cron: '0 * * * *' }, { recurring: false }, { autoExpireAt: 500 }, { desktopPausedAt: 150 }])
    assert.throws(() => assertRecoveryJobs([job], [{ ...job, ...change }]), /changed/);
});
function fixture() {
  let plan = { workspace: 'D:/project', jobs: [job], sessionId: 'session', sessionName: 'Chat',
    sessionPath: 'D:/profile/session.jsonl', sessionStamp: '1', configurationRef: 'private-auth-hash',
    account: 'Plan account', model: { id: 'model', provider: 'step', name: 'Model' } } as CronRecoveryPlan;
  let time = 1000, launches = 0, inspections = 0;
  let inspect = async () => { inspections++; return structuredClone(plan); };
  let launch = async () => { launches++; return { sessionId: plan.sessionId, runtimeId: 'host' }; };
  const service = new CronRecovery(() => inspect(), () => launch(), () => time);
  return { service, change: (value: Partial<CronRecoveryPlan>) => { plan = { ...plan, ...value }; },
    time: (value: number) => { time = value; }, launches: () => launches, inspections: () => inspections,
    inspect: (value: typeof inspect) => { inspect = value; }, launch: (value: typeof launch) => { launch = value; } };
}
test('Recovery preview is read-only, bounded consent with no secret paths', async () => {
  const f = fixture();
  for (const args of [[null, 'session'], ['', '../escape'], ['x'.repeat(8193), 'session']])
    await assert.rejects(f.service.prepare(...args as [any, any]), /Invalid/);
  const preview = await f.service.prepare('task', 'session');
  assert.equal(f.launches(), 0);
  assert.equal(preview.permission, 'ask');
  assert.equal(preview.jobs.length, 1);
  assert.equal(preview.expires, 121000);
  assert.ok(!JSON.stringify(preview).includes('private-auth-hash'));
  assert.ok(!JSON.stringify(preview).includes('session.jsonl'));
  assert.deepEqual(await f.service.recover(preview.token), { sessionId: 'session', runtimeId: 'host' });
  await assert.rejects(f.service.recover(preview.token), /expired/);
  assert.equal(f.launches(), 1);
});
test('New review supersedes older consent and expiry is checked before and after inspection', async () => {
  const f = fixture();
  const old = await f.service.prepare('task', 'session');
  const latest = await f.service.prepare('task', 'session');
  await assert.rejects(f.service.recover(old.token), /expired/);
  f.time(latest.expires);
  await assert.rejects(f.service.recover(latest.token), /expired/);
  assert.equal(f.inspections(), 2);
  f.time(1000);
  const next = await f.service.prepare('task', 'session');
  f.inspect(async () => { f.time(next.expires); throw new Error('Trust revoked'); });
  await assert.rejects(f.service.recover(next.token), /Trust revoked/);
  assert.equal(f.launches(), 0);
  const g = fixture();
  const last = await g.service.prepare('task', 'session');
  g.inspect(async () => {
    g.time(last.expires);
    return { workspace: 'D:/project', jobs: [job], sessionId: 'session', sessionName: 'Chat',
      sessionPath: 'D:/profile/session.jsonl', sessionStamp: '1', configurationRef: 'private-auth-hash',
      account: 'Plan account', model: { id: 'model', provider: 'step', name: 'Model' } } as CronRecoveryPlan;
  });
  await assert.rejects(g.service.recover(last.token), /changed/);
  assert.equal(g.launches(), 0);
});
for (const [field, value] of Object.entries({
  jobs: [{ ...job, prompt: 'Changed' }], account: 'API account', configurationRef: 'other',
  sessionStamp: '2', workspace: 'D:/elsewhere', model: { id: 'other', provider: 'step', name: 'Other' },
})) test(`Changed ${field} invalidates consent without launch or retries`, async () => {
  const f = fixture();
  const preview = await f.service.prepare('task', 'session');
  f.change({ [field]: value });
  await assert.rejects(f.service.recover(preview.token), /changed/);
  await assert.rejects(f.service.recover(preview.token), /expired/);
  assert.equal(f.launches(), 0);
});
test('Concurrent confirmation cannot start a second host; launch failure consumes consent', async () => {
  const f = fixture();
  const preview = await f.service.prepare('task', 'session');
  let release!: () => void;
  f.launch(() => new Promise((_, reject) => { release = () => reject(new Error('Uncertain release')); }));
  const starting = f.service.recover(preview.token);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.service.recover(preview.token), /expired/);
  await assert.rejects(f.service.prepare('task', 'session'), /in progress/);
  release();
  await assert.rejects(starting, /Uncertain/);
  await assert.rejects(f.service.recover(preview.token), /expired/);
  await f.service.prepare('task', 'session');
});
test('Recovery only accepts durable nonempty task snapshots', async () => {
  const f = fixture();
  for (const jobs of [[], [{ ...job, durable: false }]]) {
    f.change({ jobs });
    await assert.rejects(f.service.prepare('task', 'session'), /durable/);
  }
});
test('Remembered recovery requires explicit review of unknown executions and never grants after a failed launch', async () => {
  const f = fixture();
  const plan = { workspace: 'D:/project', jobs: [job], sessionId: 'session', sessionName: 'Chat',
    sessionPath: 'private/session.jsonl', sessionStamp: '1', configurationRef: 'private-auth-hash',
    account: 'Plan', model: { id: 'model', provider: 'step', name: 'Model' }, unconfirmed: true } as CronRecoveryPlan;
  let grants = 0, launches = 0, fail = false;
  const service = new CronRecovery(async () => plan, async () => {
    launches++; if (fail) throw new Error('Uncertain launch'); return { sessionId: 'session', runtimeId: 'host' };
  }, () => 1000, async () => { grants++; });
  const preview = await service.prepare('key', 'session');
  assert.equal(preview.unconfirmed, true);
  await assert.rejects(service.recover(preview.token, true), /unconfirmed/);
  assert.equal(launches, 0);
  const next = await service.prepare('key', 'session');
  await service.recover(next.token, true, true);
  assert.equal(grants, 1);
  fail = true;
  const uncertain = await service.prepare('key', 'session');
  await assert.rejects(service.recover(uncertain.token, true, true), /Uncertain/);
  assert.equal(grants, 1);
  await assert.rejects(f.service.recover('token', 'true'), /Invalid/);
  await assert.rejects(f.service.recover('token', true), /unavailable/);
});
test('Desktop associations persist separately and distinguish projects and task generations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cron-bindings-'));
  const store = new CronBindings(root);
  await store.set('D:/project', [job, { ...job, id: 'temporary', durable: false }], 'session', 'created');
  assert.deepEqual((await store.get('D:/project', job))?.sessionId, 'session');
  assert.equal(await store.get('D:/other', job), undefined);
  assert.equal(await store.get('D:/project', { ...job, createdAt: 101 }), undefined);
  assert.equal(await store.get('D:/project', { ...job, durable: false }), undefined);
  assert.equal((await readdir(root)).length, 1);
  await new CronBindings(root).set('D:/project', [job], 'new-session', 'recovered');
  assert.equal((await store.get('D:/project', job))?.source, 'recovered');
  const file = join(root, (await readdir(root))[0]);
  assert.ok(!(await readFile(file, 'utf8')).includes('Check'));
  await writeFile(file, '{"sessionId":"../escape","source":"created","at":1}');
  await assert.rejects(store.get('D:/project', job), /Invalid/);
  await assert.rejects(store.set('D:/project', [job], '../escape', 'created'), /Invalid/);
});
test('Only successful live native durable creation records a creator; old history is not inferred', async () => {
  const store = new CronBindings(await mkdtemp(join(tmpdir(), 'cron-native-bindings-')));
  const success = { type: 'tool_execution_end', toolName: 'cron_create', result: { details: job }, isError: false };
  for (const event of [{ ...success, type: 'message_end' }, { ...success, isError: true },
    { ...success, toolName: 'cron_list' }, { ...success, result: { details: { ...job, durable: false } } }])
    assert.equal(await store.created('D:/project', 'session', event), false);
  assert.equal(await store.get('D:/project', job), undefined);
  assert.equal(await store.created('D:/project', 'session', success), true);
  assert.equal((await store.get('D:/project', job))?.sessionId, 'session');
  await assert.rejects(store.created('D:/project', 'session', { ...success, result: { details: {} } }));
});
