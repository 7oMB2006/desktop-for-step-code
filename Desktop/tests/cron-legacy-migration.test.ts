import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronBindings } from '../electron/cron-bindings';
import { CronHistory } from '../electron/cron-history';
import {
  convertLegacyCronRecord, legacyCronRevision, reviewLegacyCronProject, reviewLegacyCronRecord,
} from '../electron/cron-legacy-migration';
import type { CronHistoryEntry } from '../src/contracts';

const job = Object.freeze({
  schemaVersion: 1, id: 'old-job', cron: '* * * * *', prompt: 'Synthetic task',
  durable: true, recurring: true, createdAt: 100, nextFireAt: 300, autoExpireAt: 700,
});
const evidence = {
  owner: { kind: 'verified', sessionId: 'session-a',
    association: { sessionId: 'session-a', source: 'created', at: 100 } },
  execution: 'clear', now: 200,
} as const;
const paused = { ...job, schemaVersion: 2, desktopPausedAt: 150 };

test('A future legacy task is a candidate only for the verified owner, not the open or forked conversation', () => {
  assert.deepEqual(reviewLegacyCronRecord(job, evidence),
    { kind: 'candidate', status: 'enabled', sessionId: 'session-a' });
  for (const sessionId of ['session-b', 'fork-a']) {
    assert.deepEqual(reviewLegacyCronRecord(job, { ...evidence, owner: { ...evidence.owner, sessionId } }),
      { kind: 'inactive', reason: 'owner-conflict', paused: false });
  }
  assert.deepEqual(reviewLegacyCronRecord(job, { ...evidence, owner: { kind: 'unavailable' } }),
    { kind: 'inactive', reason: 'owner-unavailable', paused: false });
  assert.deepEqual(reviewLegacyCronRecord(job, { ...evidence, owner: { kind: 'conflict' } }),
    { kind: 'inactive', reason: 'owner-conflict', paused: false });
  assert.equal(job.schemaVersion, 1);
});

test('A previously reviewed handoff can prove ownership, without returning recovery authority', () => {
  assert.deepEqual(reviewLegacyCronRecord(job, { ...evidence, owner: { ...evidence.owner,
    association: { sessionId: 'session-a', source: 'recovered', at: 150 } } }),
  { kind: 'candidate', status: 'enabled', sessionId: 'session-a' });
});

test('Legacy pause survives, including a passed occurrence; expired or unowned rows stay inactive', () => {
  assert.deepEqual(reviewLegacyCronRecord(Object.freeze({ ...paused, nextFireAt: 180 }), evidence),
    { kind: 'candidate', status: 'paused', sessionId: 'session-a' });
  assert.deepEqual(reviewLegacyCronRecord(paused, { ...evidence, now: 700 }),
    { kind: 'inactive', reason: 'expired', paused: true });
  assert.deepEqual(reviewLegacyCronRecord(paused, { ...evidence, owner: { kind: 'unavailable' } }),
    { kind: 'inactive', reason: 'owner-unavailable', paused: true });
});

test('Missed, expired, completed, and unconfirmed legacy work never yields an enabled migration candidate', () => {
  for (const [row, execution, reason] of [
    [{ ...job, recurring: false, nextFireAt: 200 }, 'clear', 'overdue'],
    [{ ...job, nextFireAt: 199 }, 'clear', 'overdue'],
    [{ ...job, autoExpireAt: 200 }, 'clear', 'expired'],
    [{ ...job, recurring: false, lastFiredAt: 190 }, 'clear', 'already-delivered'],
    [{ ...job, recurring: false }, 'completed-one-shot', 'completed'],
    [job, 'unconfirmed', 'unconfirmed-execution'],
  ] as const) {
    assert.deepEqual(reviewLegacyCronRecord(row, { ...evidence, execution }), { kind: 'inactive', reason, paused: false });
  }
  assert.equal(reviewLegacyCronRecord({ ...job, lastFiredAt: 150 }, evidence).kind, 'candidate');
});

test('An invalid evaluation clock cannot make a task eligible', () => {
  assert.deepEqual(reviewLegacyCronRecord(job, { ...evidence, now: NaN }),
    { kind: 'inactive', reason: 'invalid-clock', paused: false });
});

test('Native, hybrid, temporary and malformed records never go through legacy conversion', () => {
  for (const row of [{ ...job, durable: false }, { ...job, schemaVersion: 2 },
    { ...paused, sessionId: 'session-b' }, { ...paused, status: 'enabled' },
    { ...job, desktopPausedAt: 150 }, { ...paused, desktopPausedAt: undefined },
    { ...job, intervalHours: 12 }, { ...job, nextFireAt: Infinity }, null]) {
    const result = reviewLegacyCronRecord(row, evidence);
    assert.equal(result.kind, 'inactive');
    if (result.kind === 'inactive') assert.equal(result.reason, 'unsupported-record');
  }
});

const workspace = 'D:/sample-project';
const session = { id: 'session-a', cwd: workspace, path: 'fixture-a.jsonl' };
function sources() {
  return {
    saved: async () => ({ trusted: true, jobs: [job] as unknown }),
    sessions: async () => [session],
    archived: (_id: string) => false,
    sameWorkspace: async (left: string, right: string) => left === right,
    verifyManagedSession: async (_path: string) => {},
    bindings: { get: async () => evidence.owner.association },
    history: { migrationSnapshot: () => ({ unconfirmed: false, entries: [] as CronHistoryEntry[] }) },
    now: () => 200,
  };
}

test('Trusted inventory checks actual sidecar identity, not another generation, project or visible conversation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-cron-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bindings = new CronBindings(root);
  await bindings.set(workspace, [job], session.id, 'created');
  const data = { ...sources(), bindings, sessions: async () => [session, { ...session, id: 'fork-a' }],
    saved: async () => ({ trusted: true, jobs: [job, { ...job, id: 'other-job' }] }) };
  const checked = await reviewLegacyCronProject(workspace, data);
  assert.deepEqual(checked, { kind: 'reviewed', tasks: [
    { id: job.id, createdAt: job.createdAt, review: { kind: 'candidate', sessionId: session.id, status: 'enabled' } },
    { id: 'other-job', createdAt: job.createdAt, review: { kind: 'inactive', reason: 'owner-unavailable', paused: false } },
  ] });
  const [candidate] = checked.tasks;
  for (const [cwd, row] of [[workspace, { ...job, createdAt: 110 }], ['D:/other-project', job]] as const) {
    const review = await reviewLegacyCronProject(cwd, { ...data, saved: async () => ({ trusted: true, jobs: [row] }) });
    assert.deepEqual(review, { kind: 'reviewed', tasks: [{ ...candidate, createdAt: row.createdAt,
      review: { kind: 'inactive', reason: 'owner-unavailable', paused: false } }] });
  }
});

test('Inventory blocks ambiguous, archived, unmanaged and moved sessions even with an association', async () => {
  for (const [overrides, reason] of [
    [{ sessions: async () => [session, { ...session, path: 'copied.jsonl' }] }, 'owner-conflict'],
    [{ sessions: async () => [] }, 'owner-unavailable'],
    [{ archived: () => true }, 'owner-unavailable'],
    [{ sessions: async () => [{ ...session, cwd: 'D:/moved' }] }, 'owner-unavailable'],
    [{ verifyManagedSession: async () => { throw new Error('unmanaged'); } }, 'owner-unavailable'],
    [{ bindings: { get: async () => { throw new Error('corrupt sidecar'); } } }, 'owner-unavailable'],
  ] as const) {
    const review = await reviewLegacyCronProject(workspace, { ...sources(), ...overrides });
    assert.deepEqual(review, { kind: 'reviewed', tasks: [{ id: job.id, createdAt: job.createdAt,
      review: { kind: 'inactive', reason, paused: false } }] });
  }
});

test('Inventory applies the execution journal by exact task generation and obeys the project uncertainty latch', async () => {
  const entry: CronHistoryEntry = { id: 'run-a', sessionId: 'session-b', jobId: job.id,
    createdAt: job.createdAt, at: 130, updatedAt: 140, state: 'unknown' };
  for (const [snapshot, candidate] of [
    [{ entries: [entry], unconfirmed: false }, false],
    [{ entries: [{ ...entry, createdAt: 1 }], unconfirmed: false }, true],
    [{ entries: [{ ...entry, jobId: undefined }], unconfirmed: false }, false],
    [{ entries: [], unconfirmed: true }, false],
  ] as const) {
    const review = await reviewLegacyCronProject(workspace, { ...sources(),
      history: { migrationSnapshot: () => ({ ...snapshot, entries: [...snapshot.entries] }) } });
    assert.equal(review.kind, 'reviewed');
    assert.equal(review.tasks[0].review.kind, candidate ? 'candidate' : 'inactive');
  }
});

test('Inventory never reads profile evidence for an untrusted project or chooses between duplicate task IDs', async () => {
  const data = sources();
  assert.deepEqual(await reviewLegacyCronProject(workspace, { ...data,
    saved: async () => ({ trusted: false, jobs: [] }),
    sessions: async () => { throw new Error('must not read profile'); } }), { kind: 'untrusted' });
  let lookups = 0;
  const review = await reviewLegacyCronProject(workspace, { ...data,
    saved: async () => ({ trusted: true, jobs: [job, { ...job, createdAt: 105 }] }),
    bindings: { get: async () => { lookups++; return evidence.owner.association; } } });
  assert.equal(lookups, 0);
  assert.equal(review.kind, 'reviewed');
  assert.deepEqual(review.tasks.map(task => task.review), [1, 2].map(() => ({
    kind: 'inactive', reason: 'duplicate-task-id', paused: false,
  })));
});

test('Inventory rechecks the clock after session verification, without creating missing profile history', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-cron-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const history = new CronHistory(join(root, 'not-created'));
  let now = 200;
  const review = await reviewLegacyCronProject(workspace, { ...sources(), history,
    now: () => now,
    verifyManagedSession: async () => { now = job.nextFireAt; },
  });
  assert.deepEqual(review, { kind: 'reviewed', tasks: [{ id: job.id, createdAt: job.createdAt,
    review: { kind: 'inactive', reason: 'overdue', paused: false } }] });
  assert.deepEqual(await readdir(root), []);
});

test('Conversion rechecks the approved snapshot and evidence inside the storage transaction', () => {
  const approved = { id: job.id, createdAt: job.createdAt, revision: legacyCronRevision(paused),
    sessionId: session.id, status: 'paused' } as const;
  let locked = false;
  const untouched = { ...job, id: 'another-job' };
  const original = [Object.freeze(paused), untouched];
  let rows: object[] = original;
  const store = { update: (mutate: (items: object[]) => readonly object[]) => {
    locked = true;
    try { rows = [...mutate(rows)]; }
    finally { locked = false; }
  } };
  const sessionFile = join(tmpdir(), 'fixture-a.jsonl');
  const verify = () => {
    assert.ok(locked);
    return { ...evidence, sessionFile };
  };
  assert.throws(() => convertLegacyCronRecord(store, { ...approved, revision: 'stale' }, verify), /record changed/i);
  assert.throws(() => convertLegacyCronRecord(store, approved, () => ({ ...verify(), now: 700 })), /evidence changed/i);
  assert.throws(() => convertLegacyCronRecord(store, approved, () => ({ ...verify(), sessionFile: 'relative.jsonl' })), /evidence changed/i);
  assert.equal(rows, original);
  convertLegacyCronRecord(store, approved, verify);
  const { desktopPausedAt: _, ...rest } = paused;
  assert.deepEqual(rows[0], { ...rest, origin: 'legacy', status: 'paused', sessionId: session.id, sessionFile });
  assert.equal(rows[1], untouched);
  assert.throws(() => convertLegacyCronRecord(store, approved, verify), /record changed/i);
});
