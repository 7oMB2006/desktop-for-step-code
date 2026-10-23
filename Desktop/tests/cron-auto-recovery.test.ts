import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronAutoRecovery } from '../electron/cron-auto-recovery';
import type { CronRecoveryPlan } from '../electron/cron-recovery';

function plan(): CronRecoveryPlan {
  return { workspace: 'D:/project', sessionId: 'session', sessionPath: 'private/session.jsonl', sessionStamp: '1', sessionName: 'Chat',
    configurationRef: 'a'.repeat(64), account: 'Plan account', model: { provider: 'step', id: 'model', name: 'Model' } as any,
    jobs: [{ id: 'one', cron: '* * * * *', prompt: 'PRIVATE INSTRUCTION', recurring: true, durable: true, createdAt: 100, nextFireAt: 5000, autoExpireAt: 50000 }] };
}
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'cron-auto-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let current = plan(), safe = true, launches = 0, inspections = 0, blocked = 0, now = 1000, inspectError = false;
  let launch = async () => { launches++; };
  const inspect = async () => { inspections++; if (inspectError) throw new Error('Saved session unavailable'); return structuredClone(current); };
  const service = new CronAutoRecovery(root, inspect, () => launch(), () => safe, () => now, () => { blocked++; });
  return { root, service, current: () => current, set: (next: Partial<CronRecoveryPlan>) => { current = { ...current, ...next }; },
    safe: (value: boolean) => { safe = value; }, time: (value: number) => { now = value; },
    launches: () => launches, inspections: () => inspections, blocked: () => blocked,
    missing: () => { inspectError = true; }, launch: (fn: typeof launch) => { launch = fn; } };
}
test('Automatic recovery defaults off, persists explicit bounded consent and contains no prompts or session paths', async t => {
  const f = await fixture(t);
  await f.service.run();
  assert.equal(f.inspections(), 0);
  await f.service.enable('key', f.current());
  const contents = await readFile(join(f.root, (await readdir(f.root))[0]), 'utf8');
  assert.ok(!contents.includes('PRIVATE INSTRUCTION'));
  assert.ok(!contents.includes('private/session.jsonl'));
  assert.equal((await f.service.status('D:/project'))?.expires, 50000);
  await f.service.run();
  assert.equal(f.launches(), 1);
  assert.equal((await f.service.status('D:/project'))?.state, 'enabled');
  await f.service.disable('D:/project');
  await f.service.run();
  assert.equal(f.launches(), 1);
});
for (const [name, change] of Object.entries({
  account: { configurationRef: 'b'.repeat(64) }, model: { model: { id: 'other', provider: 'step' } },
  tasks: { jobs: [{ ...plan().jobs[0], prompt: 'changed' }] }, project: { workspace: 'D:/moved' },
  pause: { jobs: [{ ...plan().jobs[0], desktopPausedAt: 500 }] },
})) test(`Changed ${name} blocks automatic launch and requires new consent`, async t => {
  const f = await fixture(t);
  await f.service.enable('key', f.current());
  f.set(change as Partial<CronRecoveryPlan>);
  await f.service.run();
  assert.equal(f.launches(), 0);
  assert.equal((await f.service.status('D:/project'))?.state, 'blocked');
  assert.equal(f.blocked(), 1);
  await f.service.run();
  assert.equal(f.inspections(), 1, 'Blocked attempts are never automatically retried');
});
test('Expiry, uncertain runs and all overdue tasks never launch automatically', async t => {
  for (const mode of ['expiry', 'uncertain', 'one-shot', 'recurring']) {
    const f = await fixture(t);
    if (mode === 'one-shot' || mode === 'recurring')
      f.set({ jobs: [{ ...f.current().jobs[0], recurring: mode === 'recurring', nextFireAt: 500 }] });
    await f.service.enable('key', f.current());
    if (mode === 'expiry') f.time(50000);
    if (mode === 'uncertain') f.safe(false);
    await f.service.run();
    assert.equal(f.launches(), 0, mode);
    assert.equal((await f.service.status('D:/project'))?.state, 'blocked');
  }
});
test('Transport uncertainty consumes auto attempt; concurrent recovery cannot launch a second host', async t => {
  const f = await fixture(t);
  await f.service.enable('key', f.current());
  let release!: () => void;
  f.launch(() => new Promise((_, reject) => { release = () => reject(new Error('uncertain')); }));
  const first = f.service.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await f.service.run();
  release();
  await first;
  await f.service.run();
  assert.equal(f.inspections(), 1);
  assert.equal((await f.service.status('D:/project'))?.state, 'blocked');
});
test('Missing or archived target stays blocked, and revocation during launch is never overwritten', async t => {
  const f = await fixture(t);
  await f.service.enable('key', f.current());
  f.missing();
  await f.service.run();
  await f.service.run();
  assert.equal(f.launches(), 0);
  assert.equal(f.blocked(), 1);
  const g = await fixture(t);
  await g.service.enable('key', g.current());
  let release!: () => void;
  g.launch(() => new Promise(resolve => { release = resolve; }));
  const pending = g.service.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await g.service.disable('D:/project');
  release();
  await pending;
  assert.equal((await g.service.status('D:/project'))?.state, 'disabled');
  const h = await fixture(t);
  await h.service.enable('key', h.current());
  h.launch(async () => { await h.service.block('D:/project'); });
  await h.service.run();
  assert.equal((await h.service.status('D:/project'))?.state, 'blocked', 'An interrupted host cannot restore its old grant');
});
