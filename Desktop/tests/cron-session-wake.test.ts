import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronSessionWake, cronWakeFingerprint, cronWakeLeadMs, matchesCronWake, nextCronWake } from '../electron/cron-session-wake';
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
