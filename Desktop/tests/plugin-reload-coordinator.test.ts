import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityGate } from '../electron/capability-gate';
import { PluginReloadCoordinator } from '../electron/plugin-reload-coordinator';
import type { SessionRuntime, SessionRuntimes } from '../electron/session-runtimes';

const input = { id: 'example', ref: 'verified-package' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(count = 2) {
  let stamp = 'original', now = 1000, available = true, concurrent = 0, maxConcurrent = 0;
  let beforeIdle: ((worker: SessionRuntime) => Promise<void>) | undefined;
  let beforeCheck: (() => Promise<void>) | undefined;
  let beforeRefresh: ((worker: SessionRuntime) => Promise<void>) | undefined;
  const refreshed: string[] = [], queried: string[] = [];
  const unoccupied = new Set<string>();
  const absent = new Set<string>(), external = new Set<string>();
  const gate = new CapabilityGate();
  const workers = Array.from({ length: count }, (_, index) => {
    const worker = {
      id: `runtime-${index}`, cwd: `C:/fixture-${index}`, status: 'connected',
      state: { sessionId: `session-${index}`, sessionName: `Session ${index}` },
      busy: false, operations: 0, submissions: 0, pendingUI: new Map(), messages: [],
      rpc: { async request(method: string, payload: { action: string; sessionId: string; pluginId: string; root: string }) {
        assert.equal(method, 'desktop_plugin_reload');
        assert.equal(payload.sessionId, worker.state?.sessionId);
        assert.equal(payload.pluginId, input.id);
        assert.equal(payload.root, 'C:/fixture-plugins/example');
        if (payload.action === 'inspect') {
          queried.push(worker.id);
          await beforeIdle?.(worker);
          if (absent.has(worker.id)) return { status: 'absent' };
          return { status: worker.busy && !unoccupied.has(worker.id) ? 'busy' : 'ready' };
        }
        assert.equal(payload.action, 'reload');
        assert.equal(gate.active, true);
        concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
        try {
          await beforeRefresh?.(worker);
          refreshed.push(worker.id);
          return { status: 'applied' };
        } finally { concurrent--; }
      } },
    } as unknown as SessionRuntime;
    return worker;
  });
  const pool = {
    workers: new Map(workers.map(worker => [worker.id, worker])),
    activeId: workers[0]?.id,
  } as unknown as SessionRuntimes;
  const coordinator = new PluginReloadCoordinator({
    pool, gate, now: () => now,
    async check(request) {
      assert.deepEqual(request, input);
      await beforeCheck?.();
      return { name: 'Example', stamp, root: 'C:/fixture-plugins/example' };
    },
    assertAvailable() { if (!available) throw new Error('capability:busy'); },
    external: worker => external.has(worker.id),
  });
  async function settle() {
    for (let index = 0; index < 100; index++) {
      await new Promise(resolve => setImmediate(resolve));
      if (!gate.active && !coordinator.state(input)?.sessions.some(item => ['ready', 'applying'].includes(item.phase))) break;
    }
    return coordinator.state(input)!;
  }
  async function apply(whenIdle = true) {
    const preview = await coordinator.preview(input);
    assert.ok(preview.token);
    await coordinator.apply({ token: preview.token, whenIdle });
    return settle();
  }
  return { coordinator, workers, pool, gate, refreshed, queried, apply, settle,
    stamp: (value: string) => { stamp = value; }, advance: (ms: number) => { now += ms; },
    available: (value: boolean) => { available = value; },
    beforeIdle: (action: typeof beforeIdle) => { beforeIdle = action; },
    beforeCheck: (action: typeof beforeCheck) => { beforeCheck = action; },
    beforeRefresh: (action: typeof beforeRefresh) => { beforeRefresh = action; },
    maxConcurrent: () => maxConcurrent, unoccupied, absent, external };
}

test('preview inspects all live runtimes without changing selection or restarting', async () => {
  const f = fixture();
  const preview = await f.coordinator.preview(input);
  assert.equal(preview.mode, 'plugin-mcp');
  assert.deepEqual(preview.sessions.map(item => item.phase), ['ready', 'ready']);
  assert.deepEqual(f.queried, ['runtime-0', 'runtime-1']);
  assert.deepEqual(f.refreshed, []);
  assert.equal(f.pool.activeId, 'runtime-0');
});
test('reload remains bound to explicit targets when selection changes and is sequential', async () => {
  const f = fixture(3);
  const transports = f.workers.map(worker => worker.rpc);
  const preview = await f.coordinator.preview(input);
  f.pool.activeId = 'runtime-2';
  await f.coordinator.apply({ token: preview.token!, whenIdle: true });
  const result = await f.settle();
  assert.equal(f.maxConcurrent(), 1);
  assert.equal(f.pool.activeId, 'runtime-2');
  assert.deepEqual(f.refreshed, ['runtime-0', 'runtime-1', 'runtime-2']);
  assert.deepEqual(f.workers.map(worker => worker.rpc), transports);
  assert.ok(result.sessions.every(item => item.phase === 'applied'));
});
test('an unrelated busy runtime does not block an idle target, and waiting applies later', async () => {
  const f = fixture();
  f.workers[0].busy = true;
  const state = await f.apply();
  assert.deepEqual(f.refreshed, ['runtime-1']);
  assert.equal(state.sessions[0].phase, 'waiting');
  assert.equal(state.sessions[0].reason, 'occupied');
  f.workers[0].busy = false;
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, ['runtime-1', 'runtime-0']);
  assert.ok(f.coordinator.state(input)!.sessions.every(item => item.phase === 'applied'));
  assert.equal(f.coordinator.state({ ...input, ref: 'replacement-ref' }), null);
  assert.equal(f.maxConcurrent(), 1);
});
test('applying only to idle targets never silently schedules busy ones', async () => {
  const f = fixture(); f.workers[0].busy = true;
  const state = await f.apply(false);
  assert.equal(state.sessions[0].phase, 'cancelled');
  f.workers[0].busy = false;
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, ['runtime-1']);
});
test('cancel waiting survives a concurrent readiness read', async () => {
  const f = fixture(1); f.workers[0].busy = true;
  const state = await f.apply();
  f.workers[0].busy = false;
  const entered = deferred(), release = deferred();
  f.beforeIdle(async () => { entered.resolve(); await release.promise; });
  const tick = f.coordinator.tick();
  await entered.promise;
  f.coordinator.cancel({ id: 'example', operationId: state.operationId! });
  release.resolve(); await tick;
  assert.deepEqual(f.refreshed, []);
  assert.equal(f.coordinator.state(input)!.sessions[0].phase, 'cancelled');
});
test('cancel does not interrupt an already-started runtime replacement', async () => {
  const f = fixture(); f.workers[0].busy = true;
  const entered = deferred(), release = deferred();
  f.beforeRefresh(async () => { entered.resolve(); await release.promise; });
  const preview = await f.coordinator.preview(input);
  const state = await f.coordinator.apply({ token: preview.token!, whenIdle: true });
  await entered.promise;
  f.coordinator.cancel({ id: 'example', operationId: state.operationId! });
  const closed = f.coordinator.close();
  let drained = false; void closed.then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(drained, false);
  release.resolve(); await closed;
  assert.deepEqual(f.refreshed, ['runtime-1']);
  assert.deepEqual(f.coordinator.state(input)!.sessions.map(item => item.phase), ['cancelled', 'applied']);
});
test('a new runtime generation is not targeted by an old queued operation', async () => {
  const f = fixture(1); f.workers[0].busy = true;
  await f.apply();
  f.workers[0].busy = false; f.workers[0].rpc = { ...f.workers[0].rpc } as SessionRuntime['rpc'];
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, []);
  assert.equal(f.coordinator.state(input)!.sessions[0].reason, 'changed');
});
test('changed configuration cancels deferred execution without applying the new settings silently', async () => {
  const f = fixture(1); f.workers[0].busy = true;
  await f.apply();
  f.stamp('different'); f.workers[0].busy = false;
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, []);
  assert.equal(f.coordinator.state(input)!.sessions[0].reason, 'changed');
});
test('preview consent is expiring and one-use', async () => {
  const f = fixture(0), preview = await f.coordinator.preview(input);
  f.advance(120001);
  await assert.rejects(f.coordinator.apply({ token: preview.token!, whenIdle: true }), /stale/);
  const next = await f.coordinator.preview(input);
  await f.coordinator.apply({ token: next.token!, whenIdle: true });
  await assert.rejects(f.coordinator.apply({ token: next.token!, whenIdle: true }), /stale/);
});
test('waiting expires and never wakes historical or disconnected sessions', async () => {
  const f = fixture(2);
  f.workers[0].busy = true; f.workers[1].status = 'disconnected';
  const state = await f.apply();
  assert.equal(state.sessions.length, 1);
  assert.deepEqual([...new Set(f.queried)], ['runtime-0']);
  f.advance(30 * 60000 + 1); f.workers[0].busy = false;
  await f.coordinator.tick();
  assert.equal(f.coordinator.state(input)!.sessions[0].reason, 'expired');
  assert.deepEqual(f.refreshed, []);
});
test('shared settings gate delays reload without locking or failing unrelated tasks', async () => {
  const f = fixture(1); f.workers[0].busy = true;
  await f.apply(); f.workers[0].busy = false;
  const release = deferred();
  const operation = f.gate.run(() => release.promise);
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, []);
  release.resolve(); await operation;
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, ['runtime-0']);
});
test('a failed target is not automatically retried and does not stop subsequent targets', async () => {
  const f = fixture();
  f.beforeRefresh(async worker => { if (worker.id === 'runtime-0') throw new Error('private runtime detail'); });
  await f.apply(); await f.coordinator.tick();
  assert.deepEqual(f.refreshed, ['runtime-1']);
  const state = f.coordinator.state(input)!;
  assert.equal(state.sessions[0].phase, 'failed');
  assert.equal(state.sessions[0].reason, 'failed');
  assert.ok(!JSON.stringify(state).includes('private runtime detail'));
});
for (const protection of ['external', 'remote-attached', 'operation'] as const) {
  const protect = (f: ReturnType<typeof fixture>, active: boolean) => {
    const worker = f.workers[0];
    if (protection === 'external') {
      if (active) f.external.add(worker.id);
      else f.external.delete(worker.id);
    } else if (protection === 'remote-attached') worker.remoteAttached = active;
    else worker.mutating = active;
  };
  test(`a nonmember is not counted even with ${protection} protection`, async () => {
    const f = fixture();
    protect(f, true);
    f.absent.add('runtime-0');
    const result = await f.apply();
    assert.ok(f.queried.includes('runtime-0'));
    assert.deepEqual(result.sessions.map(item => item.runtimeId), ['runtime-1']);
    assert.deepEqual(f.refreshed, ['runtime-1']);
  });
  test(`a confirmed member retains ${protection} protection`, async () => {
    const f = fixture(1);
    protect(f, true);
    const state = await f.apply();
    assert.equal(state.sessions[0].reason, protection);
    assert.equal(state.sessions[0].phase, protection === 'operation' ? 'waiting' : 'cancelled');
    assert.deepEqual(f.refreshed, []);
    protect(f, false);
    await f.coordinator.tick();
    if (protection !== 'operation') {
      assert.deepEqual(f.refreshed, []);
      assert.equal(f.coordinator.state(input)?.sessions[0].phase, 'cancelled');
      const retry = await f.coordinator.start(input);
      assert.notEqual(retry.operationId, state.operationId);
      await f.settle();
    }
    assert.deepEqual(f.refreshed, ['runtime-0']);
  });
}
test('Remote attachment during inspect prevents a reload', async () => {
  const f = fixture(1);
  const preview = await f.coordinator.preview(input);
  f.beforeIdle(async worker => { worker.remoteAttached = true; });
  await f.coordinator.apply({ token: preview.token!, whenIdle: true });
  assert.equal((await f.settle()).sessions[0].reason, 'remote-attached');
  assert.deepEqual(f.refreshed, []);
});
test('nonmembers are not woken or reported as loaded', async () => {
  const f = fixture(1);
  f.workers[0].rpc.request = async () => ({ status: 'absent' });
  assert.equal((await f.apply()).sessions.length, 0);
  assert.deepEqual(f.refreshed, []);
});
test('running or queued agent work is not a target plugin call', async () => {
  const f = fixture(1);
  f.workers[0].busy = true;
  f.unoccupied.add(f.workers[0].id);
  Object.assign(f.workers[0], { queued: true, pendingUI: new Map([['approval', {}]]) });
  assert.equal((await f.apply()).sessions[0].phase, 'applied');
});
test('one-click reload coalesces concurrent requests for the same plugin', async () => {
  const f = fixture(1);
  f.workers[0].busy = true;
  const [first, second] = await Promise.all([f.coordinator.start(input), f.coordinator.start(input)]);
  assert.equal(first.operationId, second.operationId);
  assert.equal((await f.coordinator.start(input)).operationId, first.operationId);
  assert.deepEqual(f.refreshed, []);
});
test('closing the coordinator cancels waits and prevents new operations', async () => {
  const f = fixture(1); f.workers[0].busy = true;
  await f.apply(); await f.coordinator.close();
  f.workers[0].busy = false; await f.coordinator.tick();
  await assert.rejects(f.coordinator.preview(input), /busy/);
  assert.deepEqual(f.refreshed, []);
});
test('failed app shutdown can resume management without resurrecting cancelled work', async () => {
  const f = fixture(1); f.workers[0].busy = true;
  await f.apply(); await f.coordinator.close();
  f.coordinator.resume(); f.workers[0].busy = false;
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, []);
  assert.equal(f.coordinator.state(input)?.sessions[0].phase, 'cancelled');
  await f.apply();
  assert.deepEqual(f.refreshed, ['runtime-0']);
});
for (const action of ['preview', 'apply'] as const) {
  test(`failed shutdown invalidates an in-flight ${action} even after management resumes`, async () => {
    const f = fixture(1), preview = await f.coordinator.preview(input);
    const entered = deferred(), release = deferred();
    f.beforeCheck(async () => { entered.resolve(); await release.promise; });
    const work = action === 'preview' ? f.coordinator.preview(input)
      : f.coordinator.apply({ token: preview.token!, whenIdle: true });
    await entered.promise;
    await f.coordinator.close(); f.coordinator.resume();
    release.resolve();
    await assert.rejects(work, /busy/);
    assert.equal(f.coordinator.state(input), null);
    assert.deepEqual(f.refreshed, []);
  });
}
test('concurrent consent for the same plugin cannot overwrite an accepted operation', async () => {
  const f = fixture(1); f.workers[0].busy = true;
  const first = await f.coordinator.preview(input), second = await f.coordinator.preview(input);
  const entered = deferred(), release = deferred();
  f.beforeCheck(async () => { entered.resolve(); await release.promise; });
  const applying = f.coordinator.apply({ token: first.token!, whenIdle: true });
  await entered.promise;
  await assert.rejects(f.coordinator.apply({ token: second.token!, whenIdle: true }), /busy/);
  release.resolve();
  const state = await applying;
  assert.equal(f.coordinator.state(input)?.operationId, state.operationId);
  assert.deepEqual(f.refreshed, []);
});
test('consent that expires during readiness is not accepted', async () => {
  const f = fixture(1), preview = await f.coordinator.preview(input);
  f.beforeIdle(async () => { f.advance(120001); });
  await assert.rejects(f.coordinator.apply({ token: preview.token!, whenIdle: true }), /stale/);
  assert.deepEqual(f.refreshed, []);
});
test('configuration changed during readiness invalidates consent', async () => {
  const f = fixture(1), preview = await f.coordinator.preview(input);
  f.beforeIdle(async () => { f.stamp('new-config'); });
  await assert.rejects(f.coordinator.apply({ token: preview.token!, whenIdle: true }), /stale/);
  assert.deepEqual(f.refreshed, []);
});
for (const change of ['expire', 'config', 'cancel'] as const) {
  test(`deferred ${change} during final readiness prevents refresh`, async () => {
    const f = fixture(1); f.workers[0].busy = true;
    const state = await f.apply(); f.workers[0].busy = false;
    let checks = 0;
    f.beforeIdle(async () => {
      if (++checks !== 2) return;
      if (change === 'expire') f.advance(30 * 60000 + 1);
      if (change === 'config') f.stamp('different');
      if (change === 'cancel') f.coordinator.cancel({ id: input.id, operationId: state.operationId! });
    });
    await f.coordinator.tick();
    assert.deepEqual(f.refreshed, []);
    assert.equal(f.coordinator.state(input)!.sessions[0].phase, 'cancelled');
  });
}
test('idle-only consent does not turn into deferred scheduling after a target becomes busy', async () => {
  const f = fixture(1), preview = await f.coordinator.preview(input);
  let reads = 0;
  f.beforeIdle(async () => { if (++reads === 2) f.workers[0].busy = true; });
  await f.coordinator.apply({ token: preview.token!, whenIdle: false });
  await f.settle();
    assert.equal(f.coordinator.state(input)!.sessions[0].phase, 'cancelled');
  f.workers[0].busy = false;
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, []);
});
test('unknown inventory is disclosed without leaking transport details', async () => {
  const f = fixture(1);
  f.workers[0].remoteAttached = true;
  f.beforeIdle(async () => { throw new Error('private-path-and-token'); });
  const result = await f.apply();
  assert.equal(result.sessions[0].reason, 'unavailable');
  assert.equal(result.sessions[0].phase, 'cancelled');
  assert.doesNotMatch(JSON.stringify(result), /private-path-and-token/);
  f.beforeIdle(undefined);
  f.workers[0].remoteAttached = false;
  await f.coordinator.tick();
  assert.deepEqual(f.refreshed, []);
});
