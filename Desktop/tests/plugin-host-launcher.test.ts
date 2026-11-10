import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostService } from './fixtures/plugin-host-service';
import { PluginHostLauncher } from '../electron/plugin-host-launcher';
import { createHostClient } from '../../examples/plugins/host-client/client.mjs';
import type { CapabilityService } from '../electron/capability-service';
import type { FollowLaunch } from '../../examples/plugins/host-client/protocol.mjs';

async function fixture(t: test.TestContext, configured = true) {
  const f = await hostService(t, { configured });
  await f.broker.close();
  const record = { requestId: randomUUID(), pluginId: f.descriptor.id, consumer: 'example',
    declarationHash: createHash('sha256').update(await readFile(join(f.directory, 'dfsc.host.json'))).digest('hex'),
    root: f.directory, sessionId: f.worker.state!.sessionId!, conflict: false, phase: 'pending',
    executionHash: createHash('sha256').update(JSON.stringify([
      'node', ['dist/server.mjs'], f.directory, [],
    ])).digest('hex') };
  const state = { allowed: true, available: true, fail: false, inspect: true,
    starts: [] as FollowLaunch[], start: undefined as (() => Promise<void>) | undefined,
    resolve: undefined as (() => Promise<void>) | undefined };
  const capabilities = { withHostDescriptor: async (id, root, consumer, action) => {
    assert.equal(id, record.pluginId); assert.equal(root, record.root); assert.equal(consumer, record.consumer);
    if (!state.allowed) throw new Error('unavailable');
    await state.resolve?.();
    return action(f.descriptor);
  } } as Pick<CapabilityService, 'withHostDescriptor'>;
  f.worker.rpc.request = async (type, args) => {
    if (type === 'get_state') return f.worker.state;
    assert.equal(type, 'desktop_plugin_host');
    if (args?.action === 'list') return { records: [{ ...record }] };
    assert.equal(args?.requestId, record.requestId);
    if (args?.action === 'inspect') {
      if (!state.inspect) throw new Error('stale');
      return { ...record };
    }
    assert.equal(args?.action, 'start');
    state.starts.push(JSON.parse(String(args?.context)));
    await state.start?.();
    if (state.fail) throw new Error('native failed');
    record.phase = 'connected';
    return { started: true };
  };
  const launcher = new PluginHostLauncher({ root: f.root, pool: f.pool, provider: f.provider,
    capabilities, language: () => 'zh', available: () => state.available });
  await launcher.start();
  t.after(() => launcher.close());
  const client = () => createHostClient({ pluginId: record.pluginId, consumer: record.consumer,
    environment: { DFSC_LAUNCH_CONTEXT: JSON.stringify(state.starts[0]) } });
  return { ...f, launcher, record, launchState: state, client };
}
test('launcher issues only inside native receipt resolution and deduplicates concurrent attachment', async t => {
  const f = await fixture(t);
  await Promise.all([f.launcher.attach(f.worker), f.launcher.attach(f.worker)]);
  await f.launcher.attach(f.worker);
  assert.equal(f.launchState.starts.length, 1);
  assert.equal(f.calls.length, 0);
  const client = f.client();
  t.after(() => client.close());
  assert.equal((await client.context()).capabilities[0].model, 'step-5-preview');
  assert.doesNotMatch(JSON.stringify(f.launchState.starts), /fixture-main-private-key/);
  f.launcher.invalidate(f.worker);
  await assert.rejects(client.context(), /STALE_CONTEXT/);
});
test('safe launcher observations distinguish first-use approval, approval and revocation without issuing or invoking', async t => {
  const f = await fixture(t);
  const binding = await f.store.current(f.descriptor);
  assert.equal((await f.launcher.status(f.descriptor, binding)).status, 'restart-required');
  await f.launcher.attach(f.worker);
  const first = await f.launcher.status(f.descriptor, binding);
  assert.equal(first.status, 'connected');
  assert.equal(first.capabilities?.[0].authorization, 'required');
  assert.equal(f.state.confirmations.length, 0);
  assert.equal(f.calls.length, 0);
  const client = f.client(); t.after(() => client.close());
  const context = await client.context();
  await client.invoke({ requestId: randomUUID(), revision: context.revision, capability: 'model.text',
    input: { messages: [{ role: 'user', content: 'fixture' }] } });
  const approved = await f.launcher.status(f.descriptor, binding);
  assert.equal(approved.capabilities?.[0].authorization, 'approved');
  assert.doesNotMatch(JSON.stringify(approved), /broker|token|launchId|revision|instance|fingerprint|requestId/);
  f.launcher.invalidate();
  assert.equal((await f.launcher.status(f.descriptor, binding)).status, 'restart-required');
  assert.equal(f.launchState.starts.length, 1);
});
test('an observation finishing after a session switch cannot expose the previous session state', async t => {
  const f = await fixture(t);
  await f.launcher.attach(f.worker);
  const binding = await f.store.current(f.descriptor);
  const read = f.provider.read.bind(f.provider);
  f.provider.read = async (...args) => {
    const snapshot = await read(...args);
    f.pool.activeId = 'other-runtime';
    return snapshot;
  };
  assert.equal((await f.launcher.status(f.descriptor, binding)).status, 'unavailable');
  assert.equal(f.calls.length, 0);
});
test('an observation crossing a cancelled settings gate cannot revoke a healthy lease', async t => {
  const f = await fixture(t);
  await f.launcher.attach(f.worker);
  const binding = await f.store.current(f.descriptor);
  const request = f.worker.rpc.request.bind(f.worker.rpc);
  let inspections = 0;
  f.worker.rpc.request = async (...args) => {
    const result = await request(...args);
    if (args[0] === 'desktop_plugin_host' && args[1]?.action === 'inspect' && ++inspections === 2)
      f.launchState.available = false;
    return result;
  };
  assert.equal((await f.launcher.status(f.descriptor, binding)).status, 'unavailable');
  f.launchState.available = true;
  const client = f.client(); t.after(() => client.close());
  await client.context();
  assert.equal(f.launchState.starts.length, 1, 'No replacement launch is issued');
  assert.equal(f.calls.length, 0);
});
test('unconfigured, conflicting, unexpected or disabled native consumers get no startup context', async t => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.launchState.allowed = false; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.record.conflict = true; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.record.root = join(f.root, 'elsewhere'); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.record.executionHash = '0'.repeat(64); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.record.sessionId = randomUUID(); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.launchState.inspect = false; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.launchState.available = false; },
  ]) {
    const f = await fixture(t);
    change(f);
    await f.launcher.attach(f.worker);
    assert.equal(f.launchState.starts.length, 0);
    assert.equal(f.calls.length, 0);
  }
  const f = await fixture(t, false);
  await f.launcher.attach(f.worker);
  assert.equal(f.launchState.starts.length, 0);
});
test('native failure and invalidation during startup revoke even a newly issued lease', async t => {
  for (const action of ['fail', 'worker', 'global', 'transport'] as const) {
    const f = await fixture(t);
    f.launchState.start = async () => {
      if (action === 'fail') f.launchState.fail = true;
      if (action === 'worker') f.launcher.invalidate(f.worker);
      if (action === 'global') f.launcher.invalidate();
      if (action === 'transport') f.worker.rpc = { ...f.worker.rpc };
    };
    await f.launcher.attach(f.worker);
    assert.equal(f.launchState.starts.length, 1);
    const client = f.client();
    t.after(() => client.close());
    await assert.rejects(client.context(), /STALE_CONTEXT/);
    assert.equal(f.calls.length, 0);
  }
});
test('settings gates defer a new transport until transaction release without renewing revoked launches', async t => {
  const f = await fixture(t);
  f.launchState.available = false;
  await f.launcher.attach(f.worker);
  await f.launcher.resumeDeferred();
  assert.equal(f.launchState.starts.length, 0);
  f.launchState.available = true;
  await f.launcher.resumeDeferred();
  assert.equal(f.launchState.starts.length, 1);
  f.launcher.invalidate(f.worker);
  await f.launcher.resumeDeferred();
  assert.equal(f.launchState.starts.length, 1);
  const client = f.client();
  t.after(() => client.close());
  await assert.rejects(client.context(), /STALE_CONTEXT/);
});
test('deferred attachment cannot outlive its native transport or invalidation', async t => {
  for (const action of ['transport', 'worker', 'global'] as const) {
    const f = await fixture(t);
    f.launchState.available = false;
    await f.launcher.attach(f.worker);
    if (action === 'transport') f.worker.rpc = { ...f.worker.rpc };
    else f.launcher.invalidate(action === 'worker' ? f.worker : undefined);
    f.launchState.available = true;
    await f.launcher.resumeDeferred();
    assert.equal(f.launchState.starts.length, 0);
  }
});
test('a gate closing during descriptor resolution defers only the still-unissued native launch', async t => {
  const f = await fixture(t);
  f.launchState.available = false;
  await f.launcher.attach(f.worker);
  f.launchState.available = true;
  f.launchState.resolve = async () => { f.launchState.available = false; };
  await f.launcher.resumeDeferred();
  assert.equal(f.launchState.starts.length, 0);
  f.launchState.resolve = undefined;
  f.launchState.available = true;
  await f.launcher.resumeDeferred();
  assert.equal(f.launchState.starts.length, 1);
});
test('transaction release cannot reissue a launch revoked before its native start', async t => {
  const f = await fixture(t);
  const issue = f.launcher.broker.issue.bind(f.launcher.broker);
  let issues = 0;
  f.launcher.broker.issue = async (...args) => {
    issues++;
    const launch = await issue(...args);
    f.launchState.available = false;
    return launch;
  };
  await f.launcher.attach(f.worker);
  assert.equal(issues, 1);
  assert.equal(f.launchState.starts.length, 0);
  f.launchState.available = true;
  await f.launcher.resumeDeferred();
  assert.equal(issues, 1);
  assert.equal(f.launchState.starts.length, 0);
});
test('native rediscovery and package changes revoke a previously connected consumer', async t => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.record.conflict = true; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.launchState.inspect = false; },
    async (f: Awaited<ReturnType<typeof fixture>>) => {
      await writeFile(join(f.directory, 'changed.txt'), 'changed package');
    },
  ]) {
    const f = await fixture(t);
    await f.launcher.attach(f.worker);
    const client = f.client();
    t.after(() => client.close());
    await client.context();
    await change(f);
    await assert.rejects(client.context(), /STALE_CONTEXT/);
  }
});
