import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronSessionWake, CronWakeLaunches, cronWakeFingerprint, cronWakeLeadMs, matchesCronWake, nextCronWake } from '../electron/cron-session-wake';
import { CronRecovery, type CronRecoveryPlan } from '../electron/cron-recovery';
import type { CronRuntimeJob } from '../electron/cron-management';
import { normalizedWorkspaceKey } from '../src/workspace-key';

const job: CronRuntimeJob = { id: 'test', sessionId: 'owner', sessionFile: 'session.jsonl', cron: '* * * * *',
  prompt: 'Review the build', durable: true, recurring: true, createdAt: 100, nextFireAt: 200, intervalHours: 1, status: 'enabled' };
const plan: CronRecoveryPlan = { workspace: '/project', jobs: [job], sessionId: 'owner', sessionPath: 'session.jsonl',
  sessionName: 'Owner', sessionStamp: 'file-stamp', configurationRef: 'a'.repeat(64), account: 'Checked account',
  model: { id: 'model', provider: 'provider', name: 'Model' }, owner: { before: 200, revisions: ['revision'] } };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const grant = { version: 1 as const, workspace: plan.workspace, sessionId: plan.sessionId, configurationRef: plan.configurationRef,
  accountRef: digest(plan.account), sessionFileRef: digest(normalizedWorkspaceKey(plan.sessionPath, process.platform)),
  model: plan.model, jobs: [cronWakeFingerprint(job)] };

test('Wake selects only a reviewed future occurrence within the lead time for the original session', () => {
  assert.equal(nextCronWake(grant, [job], 199), job);
  const advanced = { ...job, nextFireAt: cronWakeLeadMs + 200 };
  assert.equal(nextCronWake(grant, [advanced], 200), advanced);
  assert.equal(nextCronWake(grant, [advanced], 199), undefined);
  assert.equal(nextCronWake(grant, [job], 200), undefined);
  for (const changed of [{ sessionId: 'other' }, { sessionFile: undefined }, { status: 'paused' as const },
    { autoExpireAt: 190 }, { durable: false }, { prompt: 'Changed instructions' }, { intervalHours: 2 }]) {
    assert.equal(nextCronWake(grant, [{ ...job, ...changed }], 199), undefined);
  }
  assert.equal(nextCronWake(grant, [job, { ...job, id: 'unapproved', nextFireAt: 500 }], 199), undefined);
  assert.equal(nextCronWake(grant, [job, { ...job, id: 'foreign', sessionId: 'other' }], 199), job);
});

test('Authorization is scoped to task content, conversation, configuration, account and model', () => {
  assert.equal(matchesCronWake(grant, { ...plan, jobs: [{ ...job, nextFireAt: 300 }] }), true);
  for (const changed of [{ workspace: '/elsewhere' }, { sessionId: 'other' }, { account: 'Changed' }, { sessionPath: 'different.jsonl' },
    { configurationRef: 'b'.repeat(64) }, { model: { ...plan.model, id: 'other' } }, { owner: undefined },
    { jobs: [{ ...job, runAt: 999 }] }, { jobs: [job, { ...job, id: 'extra' }] }]) {
    assert.equal(matchesCronWake(grant, { ...plan, ...changed }), false);
  }
});

test('Authorization survives restart, revocation is owner-scoped, and an uncertain launch cannot be retried', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-cron-session-wake-'));
  try {
    const service = new CronSessionWake(root);
    await service.enable(plan);
    await service.enable({ ...plan, sessionId: 'other' });
    const reopened = new CronSessionWake(root);
    const saved = await reopened.get(plan.workspace, plan.sessionId);
    assert.ok(saved && matchesCronWake(saved, plan));
    await reopened.activate(saved, async () => {
      assert.equal((await service.get(plan.workspace, plan.sessionId))?.blocked, true);
    });
    assert.equal((await service.get(plan.workspace, plan.sessionId))?.blocked, undefined);
    await assert.rejects(reopened.activate(saved, async () => { throw new Error('uncertain'); }), /uncertain/);
    await assert.rejects(reopened.activate(saved, async () => assert.fail('Stale grant was reused')), /review/i);
    const eligible = [];
    for await (const row of new CronSessionWake(root).grants(error => { throw error; })) eligible.push(row.sessionId);
    assert.deepEqual(eligible, ['other']);
    await reopened.disable(plan.workspace, 'other');
    assert.equal(await service.get(plan.workspace, 'other'), undefined);
    assert.equal((await service.get(plan.workspace, plan.sessionId))?.blocked, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Changing a task blocks only its owner even when the original schedule is restored', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-cron-wake-edit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new CronSessionWake(root);
  await service.enable(plan);
  await service.enable({ ...plan, sessionId: 'other' });
  await service.block(plan.workspace, plan.sessionId);
  const reopened = new CronSessionWake(root);
  const restored = await reopened.get(plan.workspace, plan.sessionId);
  assert.ok(restored && matchesCronWake(restored, plan));
  assert.equal(restored.blocked, true);
  await assert.rejects(reopened.activate(restored, async () => assert.fail('Restored task reused old consent')), /review/i);
  assert.equal((await reopened.get(plan.workspace, 'other'))?.blocked, undefined);
});

test('Revocation or editing during a launch invalidates the gate and is never overwritten', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-cron-wake-revoke-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new CronSessionWake(root);
  for (const action of ['disable', 'block', 'enable'] as const) {
    await service.enable(plan);
    const current = await service.get(plan.workspace, plan.sessionId);
    assert.ok(current);
    const revised = { ...plan, jobs: [{ ...job, prompt: 'Reapproved instructions' }] };
    await service.activate(current, async isCurrent => {
      assert.equal(isCurrent(), true);
      const mutation = action === 'enable' ? service.enable(revised) : service[action](plan.workspace, plan.sessionId);
      assert.equal(isCurrent(), false, 'Revoke the in-flight gate before waiting on disk');
      await mutation;
    });
    const saved = await service.get(plan.workspace, plan.sessionId);
    if (action === 'disable') assert.equal(saved, undefined);
    else if (action === 'block') assert.equal(saved?.blocked, true);
    else assert.ok(saved && matchesCronWake(saved, revised) && !matchesCronWake(saved, plan));
  }
});

test('A slow wake and a corrupt history neither stall scans nor duplicate an owner', async () => {
  const launches = new CronWakeLaunches();
  const started: string[] = [], errors: unknown[] = [];
  let releaseSlow!: () => void;
  const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
  async function* candidates(...ids: string[]) {
    for (const sessionId of ids) yield { sessionId, workspace: `/${sessionId}` };
  }
  const scan = (...ids: string[]) => launches.scan(candidates(...ids), async ({ sessionId }) => {
    if (sessionId === 'corrupt') throw new Error('Invalid Cron history');
    return async () => {
      started.push(sessionId);
      if (sessionId === 'slow') await slow;
    };
  }, () => true, error => errors.push(error));
  try {
    await scan('slow', 'corrupt', 'healthy');
    assert.deepEqual(started, ['slow', 'healthy']);
    assert.equal(launches.hasWorkspace('/slow'), true);
    await scan('slow', 'new');
    assert.deepEqual(started, ['slow', 'healthy', 'new']);
    assert.equal(errors.length, 1);
  } finally { releaseSlow(); }
});

test('An unavailable history blocks automatic authorization before launch, but permits manual recovery', async () => {
  let launched = 0;
  for (const onlineRuntimeId of [undefined, 'online']) {
    const service = new CronRecovery(async () => ({ ...plan, onlineRuntimeId, automaticUnavailable: 'project-history' }),
      async () => { launched++; return { sessionId: plan.sessionId, runtimeId: 'manual' }; },
      () => 0, async () => assert.fail('Unsafe authorization was saved'));
    const preview = await service.prepare('task', 'owner');
    assert.equal(preview.automaticUnavailable, 'project-history');
    await assert.rejects(service.recover(preview.token, true, true), /unavailable/i);
    assert.equal(launched, 0);
    if (!onlineRuntimeId) {
      const manual = await service.prepare('task', 'owner');
      assert.equal((await service.recover(manual.token)).runtimeId, 'manual');
      launched = 0;
    }
  }
});

test('Reviewing an online owner can save a grant without relaunching that owner', async () => {
  let saved = 0;
  const service = new CronRecovery(async () => ({ ...plan, onlineRuntimeId: 'connected' }),
    async () => assert.fail('An online runtime must not be relaunched'), () => 0, async () => { saved++; });
  const first = await service.prepare('task', 'owner');
  await assert.rejects(service.recover(first.token), /already online/);
  const next = await service.prepare('task', 'owner');
  assert.deepEqual(await service.recover(next.token, true), { sessionId: 'owner', runtimeId: 'connected' });
  assert.equal(saved, 1);
});
