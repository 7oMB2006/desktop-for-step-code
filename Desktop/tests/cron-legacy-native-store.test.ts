import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { convertLegacyCronRecord, legacyCronRevision } from '../electron/cron-legacy-migration';

const source = process.env.DFSC_CRON_CANDIDATE_SOURCE;
const sourceUrl = () => pathToFileURL(join(source!, 'packages/coding-agent/src/features/step-cron.ts')).href;
const needsSource = { skip: !source && 'Set DFSC_CRON_CANDIDATE_SOURCE to the prepared v0.1.8 source checkout' };
test('Upstream file lock protects migration and preserves other records', needsSource, async t => {
  const { CronFileStore } = await import(sourceUrl());
  const root = await mkdtemp(join(tmpdir(), 'desktop-cron-upstream-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'tasks.json');
  const row = { schemaVersion: 1, id: 'owned', cron: '* * * * *', prompt: 'Synthetic',
    recurring: true, durable: true, createdAt: 100, nextFireAt: 300, autoExpireAt: 700 };
  const other = { ...row, id: 'other', schemaVersion: 2, sessionId: 'session-b' };
  const unknown = '{"schemaVersion":99,"id":"future-row"}';
  const contents = [JSON.stringify(row), JSON.stringify(other), unknown, ''].join('\n');
  await writeFile(file, contents);

  const store = new CronFileStore(file, { warn: () => {} });
  const approved = { id: row.id, createdAt: row.createdAt, revision: legacyCronRevision(row),
    sessionId: 'session-a', status: 'enabled' } as const;
  const verify = (now: number) => ({
    owner: { kind: 'verified', sessionId: 'session-a', association: { sessionId: 'session-a', source: 'created', at: 101 } },
    execution: 'clear', now, sessionFile: join(root, 'fixture.jsonl'),
  } as const);
  const lock = `${file}.lock`;
  await writeFile(lock, '');
  assert.throws(() => convertLegacyCronRecord(store, approved, () => verify(200)), /acquire cron storage lock/);
  assert.equal(await readFile(file, 'utf8'), contents);
  await rm(lock);
  assert.throws(() => convertLegacyCronRecord(store, approved, () => verify(300)), /evidence changed/i);
  assert.equal(await readFile(file, 'utf8'), contents);

  convertLegacyCronRecord(store, approved, () => verify(200));
  const migrated = await readFile(file, 'utf8');
  const [updated, foreign, unreadable] = migrated.split('\n');
  assert.deepEqual(JSON.parse(updated), { ...row, schemaVersion: 2, origin: 'legacy', status: 'enabled',
    sessionId: 'session-a', sessionFile: join(root, 'fixture.jsonl') });
  assert.equal(foreign, JSON.stringify(other));
  assert.equal(unreadable, unknown);
  assert.throws(() => convertLegacyCronRecord(store, approved, () => verify(200)), /record changed/i);
  assert.equal(await readFile(file, 'utf8'), migrated);
});

test('Migrated paused and unbound tasks do not deliver or generate missed notices', needsSource, async t => {
  const { CronFileStore, StepCronRuntime } = await import(sourceUrl());
  const root = await mkdtemp(join(tmpdir(), 'desktop-cron-upstream-delivery-'));
  const file = join(root, 'tasks.json');
  const future = { schemaVersion: 1, id: 'future', cron: '* * * * *', prompt: 'Synthetic',
    recurring: true, durable: true, createdAt: 100, nextFireAt: 60_000, autoExpireAt: 300_000 };
  const paused = { ...future, id: 'paused', schemaVersion: 2, recurring: false, desktopPausedAt: 120 };
  const unbound = { ...future, id: 'unbound', recurring: false };
  await writeFile(file, [future, paused, unbound].map(row => JSON.stringify(row)).join('\n') + '\n');
  const store = new CronFileStore(file);
  for (const [row, status] of [[future, 'enabled'], [paused, 'paused']] as const) {
    convertLegacyCronRecord(store, { id: row.id, createdAt: row.createdAt, revision: legacyCronRevision(row),
      sessionId: 'session-a', status }, () => ({
      owner: { kind: 'verified', sessionId: 'session-a', association: { sessionId: 'session-a', source: 'created', at: 100 } },
      execution: 'clear', now: 200, sessionFile: join(root, 'fixture.jsonl'),
    }));
  }

  let now = 200;
  const deliveries: { owner: string; kind: string; id?: string }[] = [];
  const host = (owner: string) => new StepCronRuntime({
    now: () => now, storagePath: file,
    ownsJob: (row: { sessionId?: string }) => row.sessionId === owner,
    sendMessage: (event: { kind: string; job?: { id: string } }) =>
      deliveries.push({ owner, kind: event.kind, id: event.job?.id }),
  });
  const owners = ['session-b', 'fork-a', 'session-a'].map(host);
  t.after(async () => {
    for (const runtime of owners) runtime.stop();
    await rm(root, { recursive: true, force: true });
  });
  for (const runtime of owners) runtime.start(root, true);
  assert.deepEqual(deliveries, []);
  now = future.nextFireAt;
  for (const runtime of owners) runtime.tick();
  assert.deepEqual(deliveries, [{ owner: 'session-a', kind: 'fire', id: 'future' }]);
  assert.equal(store.load().find((row: { id: string }) => row.id === paused.id)?.status, 'paused');
});
