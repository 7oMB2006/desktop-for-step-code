import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { CapabilityGate } from '../electron/capability-gate';
import { PluginUpdateCoordinator } from '../electron/plugin-update-coordinator';
import type { RuntimeUpdateLease, SessionRuntime, SessionRuntimes } from '../electron/session-runtimes';
import type { PluginUpdateOperation, PluginUpdateRequest } from '../src/plugin-update';

type Options = ConstructorParameters<typeof PluginUpdateCoordinator>[0];
type Checked = Awaited<ReturnType<Options['check']>> & { scope: 'runtime' | 'theme' };
type PrivateState = {
  operation?: PluginUpdateOperation;
  previews: Map<string, { expires: number }>;
  persist(): Promise<void>;
};
type Event = { kind: string; locked: boolean; runtimeId?: string; phase?: PluginUpdateOperation['phase'] };
const request: PluginUpdateRequest = { id: 'example', ref: 'installed-ref', candidate: 'candidate-ref' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(config: {
  root?: string;
  scope?: 'runtime' | 'theme';
  workers?: { used?: boolean; busy?: boolean; disconnected?: boolean; unknownSummary?: boolean; missingHistory?: boolean }[];
  failReleaseAt?: number;
  failRestoreAt?: number;
  pauseMutation?: boolean;
  realPersistence?: boolean;
  warnings?: string[];
} = {}) {
  const events: Event[] = [], restored: string[] = [], released: string[] = [];
  const enteredMutation = deferred(), finishMutation = deferred();
  const confirmed = new Set<RuntimeUpdateLease>(), gate = new CapabilityGate();
  let locked = false, queries = 0, mutations = 0, checks = 0, refreshes = 0, restores = 0;
  const record = (kind: string, extra: Partial<Event> = {}) => events.push({ kind, locked, ...extra });
  const workers = (config.workers ?? [{ used: true }]).map((input, index) => {
    const worker = {
      id: randomUUID(), cwd: `C:/coordinator-fixture/project-${index}`,
      status: input.disconnected ? 'disconnected' : 'connected',
      state: { sessionId: randomUUID(), sessionName: `Conversation ${index}`, isStreaming: false },
      busy: input.busy === true, operations: 0, mutating: false, stopping: false,
      pendingUI: new Map(), messages: [], models: [], permissionPreset: 'ask',
      rpc: { async request(type: string) {
        assert.equal(type, 'get_desktop_summary');
        queries++;
        if (worker.status !== 'connected') throw new Error('Runtime is not connected');
        if (input.unknownSummary) return {};
        return { mcp: input.used === false ? [] : [{ name: 'example__server', status: 'connected' }] };
      } },
    } as unknown as SessionRuntime;
    return worker;
  });
  const pool = {
    workers: new Map(workers.map(worker => [worker.id, worker])),
    async assertIdle(worker: SessionRuntime) {
      record('idle', { runtimeId: worker.id });
      if (worker.status !== 'connected' || worker.busy || worker.operations || worker.stopping)
        throw new Error('Session operation in progress');
    },
    assertUpdateRestorable(worker: SessionRuntime) {
      if (config.workers?.[workers.indexOf(worker)]?.missingHistory)
        throw new Error('capability:runtime-history-unavailable');
    },
    async assertUpdateIdle(leases: readonly RuntimeUpdateLease[]) {
      record('update-idle');
      for (const worker of workers) {
        if (leases.some(lease => confirmed.has(lease) && lease.worker === worker)) continue;
        if (worker.status !== 'connected' || worker.busy || worker.operations || worker.mutating || worker.stopping)
          throw new Error('Session operation in progress');
      }
    },
    async releaseForUpdate(affected: readonly SessionRuntime[], leases: RuntimeUpdateLease[]) {
      for (let index = 0; index < affected.length; index++) {
        const worker = affected[index];
        record('release', { runtimeId: worker.id });
        worker.status = 'disconnected';
        if (index === config.failReleaseAt) {
          worker.failed = true;
          throw new Error('capability:release-unconfirmed');
        }
        worker.mutating = true;
        const lease = { worker, rpc: worker.rpc, sessionId: worker.state!.sessionId } as RuntimeUpdateLease;
        leases.push(lease); confirmed.add(lease); released.push(worker.id);
      }
    },
    isReleasedForUpdate(lease: RuntimeUpdateLease) {
      return confirmed.has(lease) && lease.worker.status === 'disconnected' && lease.worker.mutating;
    },
  } as unknown as SessionRuntimes;
  const checked: Checked = {
    scope: config.scope ?? 'runtime', status: 'compatible', stamp: 'configuration-stamp',
    identity: 'package-identity', version: '2.0.0', changes: [],
  };
  const coordinator = new PluginUpdateCoordinator({
    root: config.root ?? 'C:/unused-coordinator-fixture',
    pool, gate, releaseSupported: true,
    async check() { checks++; return { ...checked }; },
    assertAvailable() {
      if (locked) throw new Error('capability:busy');
    },
    acquire() {
      record('acquire');
      assert.equal(locked, false, 'The coordinator acquires its main-process lock only once');
      locked = true;
      return () => { record('unlock'); locked = false; };
    },
    external: () => false,
    canRestore: () => true,
    async restore(lease) {
      record('restore', { runtimeId: lease.worker.id });
      restored.push(lease.worker.id);
      lease.worker.mutating = false;
      if (restores++ === config.failRestoreAt) throw new Error('Restoration failed');
      lease.worker.status = 'connected';
      confirmed.delete(lease);
    },
    async refreshed() { refreshes++; record('refresh'); },
    async mutate(input, guard, proof) {
      const release = await guard({ scope: (proof as Checked).scope, pluginId: input.id }, async () => {
        record('recheck');
      });
      try {
        record('mutation');
        enteredMutation.resolve();
        if (config.pauseMutation) await finishMutation.promise;
        mutations++;
        return { warnings: config.warnings ?? [] };
      } finally {
        release?.();
        record('guard-released');
      }
    },
  });
  const state = coordinator as unknown as PrivateState;
  if (!config.realPersistence) state.persist = async () => { record('persist', { phase: state.operation?.phase }); };
  return {
    coordinator, state, pool, gate, workers, events, restored, released, enteredMutation, finishMutation,
    record, locked: () => locked,
    counts: () => ({ queries, mutations, checks, refreshes }),
  };
}

test('preflight observes idle consumers without writing, stopping, restoring or acquiring a lock', async () => {
  const f = fixture();
  const before = f.workers.map(worker => ({ worker, rpc: worker.rpc, state: worker.state, status: worker.status }));
  const preview = await f.coordinator.preflight(request);
  assert.equal(preview.readiness, 'needs-release');
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.sessions[0].runtimeId, f.workers[0].id);
  assert.deepEqual(f.events.map(event => event.kind), ['idle']);
  assert.deepEqual(f.counts(), { queries: 1, mutations: 0, checks: 1, refreshes: 0 });
  for (const original of before) {
    assert.equal(original.worker.rpc, original.rpc);
    assert.equal(original.worker.state, original.state);
    assert.equal(original.worker.status, original.status);
  }
  assert.equal(f.locked(), false);
});

test('preflight blocks an unsaved consumer without releasing any session', async () => {
  const f = fixture({ workers: [{ used: true, missingHistory: true }, { used: true }] });
  const preview = await f.coordinator.preflight(request);
  assert.equal(preview.readiness, 'blocked');
  assert.deepEqual(preview.blockers, ['runtime-history-unavailable']);
  assert.ok(preview.sessions.every(session => session.status === 'idle'));
  await assert.rejects(f.coordinator.apply({ token: preview.token, release: true }), /capability:operation-denied/);
  assert.deepEqual(f.released, []);
  assert.deepEqual(f.restored, []);
  assert.equal(f.counts().mutations, 0);
});

test('an unused unsaved session does not need restart history', async () => {
  const f = fixture({ workers: [{ used: false, missingHistory: true }] });
  const preview = await f.coordinator.preflight(request);
  assert.equal(preview.readiness, 'ready');
  assert.deepEqual(preview.blockers, []);
});

test('expired and consumed preview tokens cannot stop a session or apply an update', async () => {
  const f = fixture();
  const expired = await f.coordinator.preflight(request);
  f.state.previews.get(expired.token)!.expires = Date.now() - 1;
  await assert.rejects(f.coordinator.apply({ token: expired.token, release: true }), /capability:stale/);
  assert.deepEqual(f.released, []);
  const current = await f.coordinator.preflight(request);
  const result = await f.coordinator.apply({ token: current.token, release: true });
  assert.equal(result.id, current.token, 'The preview token is also the stable host-owned operation identity');
  await assert.rejects(f.coordinator.apply({ token: current.token, release: true }), /capability:stale/);
  assert.equal(f.counts().mutations, 1);
});

test('double application and a new preflight cannot enter a running update', { timeout: 10000 }, async () => {
  const f = fixture({ pauseMutation: true });
  const preview = await f.coordinator.preflight(request);
  const first = f.coordinator.apply({ token: preview.token, release: true });
  try {
    await Promise.race([f.enteredMutation.promise, first.then(() => {
      throw new Error('The update finished before reaching the paused mutation');
    })]);
    await assert.rejects(f.coordinator.apply({ token: preview.token, release: true }), /capability:busy/);
    await assert.rejects(f.coordinator.preflight(request), /capability:busy/);
  } finally {
    f.finishMutation.resolve();
    await first;
  }
  assert.equal(f.counts().mutations, 1);
  assert.equal(f.released.length, 1);
  assert.equal(f.restored.length, 1);
});

for (const scenario of ['busy', 'unknown'] as const) {
  test(`an unrelated ${scenario} session blocks runtime updates before interruption`, async () => {
    const f = fixture({ workers: [{ used: true }, scenario === 'busy'
      ? { used: false, busy: true } : { used: false, disconnected: true }] });
    const preview = await f.coordinator.preflight(request);
    assert.equal(preview.readiness, 'blocked');
    assert.ok(preview.blockers.includes(scenario === 'busy' ? 'session-busy' : 'runtime-unknown'));
    await assert.rejects(f.coordinator.apply({ token: preview.token, release: true }), /capability:operation-denied/);
    assert.deepEqual(f.released, []);
    assert.equal(f.counts().mutations, 0);
  });
}

test('partial release restores every confirmed lease without restarting failed or untouched workers', async () => {
  const f = fixture({ workers: [{}, {}, {}, {}], failReleaseAt: 2 });
  const preview = await f.coordinator.preflight(request);
  const result = await f.coordinator.apply({ token: preview.token, release: true });
  assert.deepEqual(f.released, f.workers.slice(0, 2).map(worker => worker.id));
  assert.deepEqual(f.restored, f.released);
  assert.equal(f.workers[2].status, 'disconnected');
  assert.equal(f.workers[3].status, 'connected');
  assert.equal(f.counts().mutations, 0);
  assert.equal(result.installation, 'unchanged');
  assert.equal(result.phase, 'attention');
  assert.match(result.error!, /capability:release-unconfirmed/);
  assert.deepEqual(result.sessions.map(session => session.restoration), ['restored', 'restored', 'unknown', 'untouched']);
});

for (const checkpoint of ['before-restoration', 'between-restorations'] as const) {
  test(`${checkpoint} record failure cannot skip remaining runtime restoration`, async () => {
    const f = fixture({ workers: [{}, {}] });
    const persist = f.state.persist.bind(f.state);
    let failed = false;
    f.state.persist = async () => {
      await persist();
      if (!failed && f.state.operation?.phase === 'restoring'
        && (checkpoint === 'before-restoration' ? f.restored.length === 0 : f.restored.length === 1)) {
        failed = true;
        throw new Error('ENOSPC');
      }
    };
    const preview = await f.coordinator.preflight(request);
    const result = await f.coordinator.apply({ token: preview.token, release: true });
    assert.equal(failed, true, 'The intended persistence failure was exercised');
    assert.deepEqual(f.restored, f.workers.map(worker => worker.id));
    assert.ok(f.workers.every(worker => worker.status === 'connected' && !worker.mutating));
    assert.ok(result.sessions.every(session => session.restoration === 'restored'));
    assert.equal(result.installation, 'committed');
    assert.ok(result.warnings.includes('capability:update-operation-record-failed'));
    assert.equal(f.locked(), false);
  });
}

test('a failed restoration does not prevent later leases from being restored', async () => {
  const f = fixture({ workers: [{}, {}, {}], failRestoreAt: 0 });
  const preview = await f.coordinator.preflight(request);
  const result = await f.coordinator.apply({ token: preview.token, release: true });
  assert.deepEqual(f.restored, f.workers.map(worker => worker.id));
  assert.deepEqual(result.sessions.map(session => session.restoration), ['failed', 'restored', 'restored']);
  assert.equal(result.installation, 'committed');
  assert.equal(result.phase, 'attention');
  assert.equal(f.counts().mutations, 1, 'Recovery never reapplies the package update');
});

test('the main-process lock remains held from first interruption through the last restoration', async () => {
  const f = fixture({ workers: [{}, {}] });
  const preview = await f.coordinator.preflight(request);
  const result = await f.coordinator.apply({ token: preview.token, release: true });
  assert.equal(result.phase, 'done');
  assert.equal(f.events.filter(event => event.kind === 'acquire').length, 1);
  assert.equal(f.events.filter(event => event.kind === 'unlock').length, 1);
  const guarded = f.events.filter(event => ['release', 'mutation', 'guard-released', 'restore'].includes(event.kind)
    || event.kind === 'persist' && event.phase === 'restoring');
  assert.ok(guarded.length >= 6);
  assert.ok(guarded.every(event => event.locked), JSON.stringify(guarded));
  assert.ok(f.events.findIndex(event => event.kind === 'unlock')
    > f.events.map(event => event.kind).lastIndexOf('restore'));
  assert.equal(f.locked(), false);
  assert.equal(f.gate.active, false);
});

test('proven data-only theme updates do not observe or interrupt busy or unknown runtimes', async () => {
  const f = fixture({ scope: 'theme', workers: [{ used: false, busy: true }, { disconnected: true }] });
  const preview = await f.coordinator.preflight(request);
  assert.equal(preview.readiness, 'ready');
  assert.deepEqual(preview.sessions, []);
  assert.deepEqual(preview.blockers, []);
  const result = await f.coordinator.apply({ token: preview.token, release: false });
  assert.equal(result.phase, 'done');
  assert.equal(result.installation, 'committed');
  assert.equal(f.counts().queries, 0);
  assert.equal(f.counts().mutations, 1);
  assert.deepEqual(f.released, []);
  assert.deepEqual(f.restored, []);
  assert.equal(f.events.some(event => ['acquire', 'idle', 'update-idle'].includes(event.kind)), false);
});

function operation(phase: PluginUpdateOperation['phase'] = 'done'): PluginUpdateOperation {
  return {
    id: randomUUID(), pluginId: request.id, version: '2.0.0', phase,
    installation: 'committed', warnings: [],
    sessions: [{ runtimeId: randomUUID(), sessionId: randomUUID(), name: 'Conversation',
      status: 'idle', restoration: 'restored' }],
  };
}

async function storedRecord(record: unknown, action: (f: ReturnType<typeof fixture>, root: string) => Promise<void>,
  config: Parameters<typeof fixture>[0] = { workers: [] }) {
  const temporary = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temporary, 'dfsc-plugin-update-coordinator-')));
  try {
    await mkdir(join(root, 'desktop-plugins'));
    await writeFile(join(root, 'desktop-plugins/update-operation.json'), JSON.stringify(record));
    await action(fixture({ ...config, root }), root);
  } finally {
    assert.equal(dirname(root), temporary);
    await rm(root, { recursive: true, force: true });
  }
}

for (const [name, normalized] of [
  ['\u7814\u7a76\n\u6807\u9898\t\u540e\u7eed', '\u7814\u7a76 \u6807\u9898 \u540e\u7eed'],
  ['\u0000\u0001\t\n\u007f', undefined],
  [' \t \n ', undefined],
] as const) {
  test(`normalized session display names survive a real persisted roundtrip (${JSON.stringify(name)})`, async () => {
    await storedRecord({ version: 1, operation: operation() }, async (f, root) => {
      const worker = f.workers[0];
      worker.state!.sessionName = name;
      const preview = await f.coordinator.preflight(request);
      assert.equal(preview.sessions[0].name, normalized ?? worker.state!.sessionId);
      const result = await f.coordinator.apply({ token: preview.token, release: true });
      assert.equal(result.phase, 'done');
      assert.equal(worker.state!.sessionName, name, 'Display normalization does not rename the actual session');
      const reopened = fixture({ root, workers: [] });
      assert.deepEqual(await reopened.coordinator.latest(request.id), result);
    }, { workers: [{}], realPersistence: true });
  });
}

test('successful update warning displays survive a real persisted roundtrip', async () => {
  const serviceWarning = `MCP declarations saved for ${Array.from({ length: 20 }, (_, index) =>
    `server-${index}-${'x'.repeat(24)}`).join(', ')}; the server starts after Step restarts.`;
  const warnings = [serviceWarning, ' First line\nSecond\tline\r ', '', '\u0000 \t\n', 'Existing safe warning'];
  await storedRecord({ version: 1, operation: operation() }, async (f, root) => {
    const preview = await f.coordinator.preflight(request);
    const result = await f.coordinator.apply({ token: preview.token, release: true });
    assert.equal(result.phase, 'done');
    assert.deepEqual(result.warnings, [serviceWarning.slice(0, 500), 'First line Second line', 'Existing safe warning']);
    assert.equal(warnings[0], serviceWarning, 'Display limits do not modify the source warning list');
    assert.deepEqual(await fixture({ root, workers: [] }).coordinator.latest(request.id), result);
  }, { workers: [{}], realPersistence: true, warnings });
});

for (const failedRecord of [false, true]) {
  test(`persisted warnings stay bounded with a full source list (record failure: ${failedRecord})`, async () => {
    const warnings = Array.from({ length: 101 }, (_, index) => `Source warning ${index}`);
    await storedRecord({ version: 1, operation: operation() }, async (f, root) => {
      const persist = f.state.persist.bind(f.state);
      let failed = false;
      f.state.persist = async () => {
        if (failedRecord && !failed && f.state.operation?.phase === 'restoring') {
          failed = true;
          throw new Error('ENOSPC');
        }
        await persist();
      };
      const preview = await f.coordinator.preflight(request);
      const result = await f.coordinator.apply({ token: preview.token, release: true });
      assert.equal(result.phase, 'done');
      assert.equal(result.warnings.length, 100);
      assert.deepEqual(result.warnings, failedRecord
        ? [...warnings.slice(0, 99), 'capability:update-operation-record-failed'] : warnings.slice(0, 100));
      assert.equal(failed, failedRecord);
      assert.deepEqual(await fixture({ root, workers: [] }).coordinator.latest(request.id), result);
    }, { workers: [{}], realPersistence: true, warnings });
  });
}

for (const historical of ['terminal', 'invalid'] as const) {
  test(`a delayed ${historical} record read cannot replace a newly started operation`, { timeout: 10000 }, async () => {
    const saved = operation();
    saved.version = '1.0.0';
    const record = { version: historical === 'invalid' ? 2 : 1, operation: saved };
    await storedRecord(record, async f => {
      const preview = await f.coordinator.preflight(request);
      const reading = f.coordinator.latest(request.id);
      const applying = f.coordinator.apply({ token: preview.token, release: true });
      try {
        await f.enteredMutation.promise;
        const current = await reading;
        assert.equal(current?.id, preview.token);
        assert.equal(current?.version, preview.version);
        assert.equal(current?.phase, 'applying');
      } finally {
        f.finishMutation.resolve();
        await applying;
      }
      const result = await applying;
      assert.equal(result.id, preview.token);
      assert.equal(result.version, preview.version);
      assert.equal(result.installation, 'committed');
      assert.equal(result.phase, 'done');
      assert.deepEqual(f.restored, f.workers.map(worker => worker.id));
      assert.ok(f.workers.every(worker => worker.status === 'connected' && !worker.mutating));
    }, { workers: [{}, {}], pauseMutation: true });
  });
}

for (const phase of ['done', 'attention'] as const) {
  test(`terminal ${phase} records remain historical facts after reopening`, async () => {
    const saved = operation(phase);
    if (phase === 'attention') {
      saved.sessions[0].restoration = 'failed';
      saved.error = 'capability:operation-failed';
    }
    await storedRecord({ version: 1, operation: saved }, async f => {
      assert.deepEqual(await f.coordinator.latest(request.id), saved);
      assert.equal(await f.coordinator.latest('another-plugin'), null);
      assert.deepEqual(f.restored, []);
      assert.equal(f.counts().mutations, 0);
    });
  });
}

for (const phase of ['releasing', 'applying', 'restoring'] as const) {
  test(`interrupted ${phase} records do not replay consent or claim confirmed restoration`, async () => {
    const saved = operation(phase);
    await storedRecord({ version: 1, operation: saved }, async f => {
      const loaded = await f.coordinator.latest(request.id);
      assert.equal(loaded?.id, saved.id);
      assert.equal(loaded?.phase, 'attention');
      assert.equal(loaded?.installation, 'unknown');
      assert.equal(loaded?.error, 'capability:update-operation-interrupted');
      assert.ok(loaded?.sessions.every(session => session.restoration === 'unknown'));
      assert.deepEqual(f.restored, []);
      assert.equal(f.counts().mutations, 0);
      assert.equal(f.locked(), false);
    });
  });
}

for (const [name, alter] of [
  ['unknown record version', (record: any) => { record.version = 2; }],
  ['unknown phase', (record: any) => { record.operation.phase = 'invented'; }],
  ['invalid installation fact', (record: any) => { record.operation.installation = 'installed-maybe'; }],
  ['non-string version', (record: any) => { record.operation.version = {}; }],
  ['null session', (record: any) => { record.operation.sessions = [null]; }],
  ['unknown restoration state', (record: any) => { record.operation.sessions[0].restoration = 'invented'; }],
  ['non-string warning', (record: any) => { record.operation.warnings = [{ secret: 'not-for-renderer' }]; }],
  ['unexpected private data', (record: any) => { record.operation.secret = 'not-for-renderer'; }],
] as const) {
  test(`persisted ${name} is rejected before projection to the renderer`, async () => {
    const record = { version: 1, operation: operation() };
    alter(record);
    await storedRecord(record, async f => {
      await assert.rejects(f.coordinator.latest(request.id), /capability:update-recovery-required/);
      assert.deepEqual(f.restored, []);
      assert.equal(f.counts().mutations, 0);
    });
  });
}
