import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostService } from './fixtures/plugin-host-service';
import { PluginHostLauncher } from '../electron/plugin-host-launcher';
import { PluginConfigurationStore } from '../electron/plugin-configuration.mjs';
import { createHostClient } from '../../examples/plugins/host-client/client.mjs';
import type { CapabilityService } from '../electron/capability-service';
import type { LaunchContext } from '../../examples/plugins/host-client/protocol.mjs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

async function fixture(t: test.TestContext, configured = true, routed = false) {
  const f = await hostService(t, { configured, ...(routed ? { settings: true,
    capabilities: ['model.text', 'model.asr', 'model.video'], independentCapabilities: ['model.asr'] } : {}) });
  await f.broker.close();
  const record = { requestId: randomUUID(), pluginId: f.descriptor.id, consumer: 'example',
    declarationHash: createHash('sha256').update(await readFile(join(f.directory, 'dfsc.host.json'))).digest('hex'),
    root: f.directory, sessionId: f.worker.state!.sessionId!, conflict: false, phase: 'pending',
    executionHash: createHash('sha256').update(JSON.stringify([
      'node', ['dist/server.mjs'], f.directory, routed ? [['STEPFUN_API_KEY', 'DFSC_INDEPENDENT_PLUGIN']] : [],
    ])).digest('hex') };
  const state = { allowed: true, available: true, fail: false, inspect: true,
    starts: [] as LaunchContext[], start: undefined as (() => Promise<void>) | undefined,
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
for (const official of [false, true]) test(`routed launch partitions direct and official calls (official: ${official})`, async t => {
  const f = await fixture(t, false, true);
  const configuration = new PluginConfigurationStore(f.root);
  const configured = await configuration.save(f.descriptor, {
    ref: f.descriptor.ref, revision: 'unconfigured', values: {},
    secrets: { key: { action: 'replace', value: 'isolated-direct-fixture' } },
  });
  const selected = await f.store.select(f.descriptor, { revision: 'unconfigured', mode: 'routed',
    configurationRevision: configured.revision, independentCapabilities: ['model.asr'],
    ...(official ? { account: f.account, models: { 'model.text': 'step-5-preview' } } : {}) });
  await f.launcher.attach(f.worker);
  assert.equal(f.launchState.starts.length, 1);
  const launch = f.launchState.starts[0], client = f.client();
  t.after(() => client.close());
  assert.equal(client.mode, official ? 'follow' : 'independent');
  assert.deepEqual(client.independentCapabilities, ['model.asr']);
  assert.equal(client.configurationRevision, configured.revision);
  assert.deepEqual(launch.capabilities, official ? ['model.text'] : ['model.asr']);
  assert.ok(!JSON.stringify(launch).includes('isolated-direct-fixture'));
  const status = await f.launcher.status(f.descriptor, selected);
  assert.equal(status.status, 'connected');
  assert.deepEqual(status.independentCapabilities, ['model.asr']);
  assert.equal(f.calls.length, 0);
  if (official) {
    const context = await client.context();
    assert.deepEqual(context.capabilities.map(item => item.id), ['model.text']);
    await assert.rejects(client.invoke({ requestId: randomUUID(), revision: context.revision, capability: 'model.asr',
      input: { audio: { mimeType: 'audio/wav', data: 'YQ==' } } }), /CAPABILITY_UNAVAILABLE/);
    assert.equal(f.state.confirmations.length, 0);
    assert.deepEqual(await client.invoke({ requestId: randomUUID(), revision: context.revision, capability: 'model.text',
      input: { messages: [{ role: 'user', content: 'fixture' }] } }), { type: 'text', text: 'host result' });
    assert.match(f.calls[0].url, /\/step_plan\/v1\/chat\/completions$/);
    assert.equal(f.state.confirmations.length, 1);
  } else {
    assert.equal(launch.broker, undefined);
    await assert.rejects(client.context(), /CAPABILITY_UNAVAILABLE/);
    assert.equal(f.calls.length, 0);
  }
  await configuration.save(f.descriptor, { ref: f.descriptor.ref, revision: configured.revision, values: {},
    secrets: { key: { action: 'replace', value: 'replacement-fixture' } } });
  const changed = await f.store.current(f.descriptor);
  assert.equal((await f.launcher.status(f.descriptor, changed)).status, 'restart-required');
  if (official) await assert.rejects(client.context(), /STALE_CONTEXT/);
});
test('actual retry IPC reattaches a recovered native host only after releasing its mutation lock', async t => {
  const f = await fixture(t);
  const source = ts.createSourceFile('main.ts', await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handle')!;
  const javascript = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const pool = { ...f.pool, require: () => f.worker, async retryLatest() {
    assert.equal(f.worker.mutating, true);
    f.launcher.invalidate(f.worker);
    await f.launcher.attach(f.worker);
    assert.equal(f.launchState.starts.length, 0, 'A locked recovery cannot issue a launch');
    throw new Error('STARTUP_NOT_READY: recovered original history');
  } };
  const handle = runInNewContext(javascript + '\nhandle', {
    Error, readingSelections: new Map(), transition: false, updateInstalling: false, runtimes: pool, pluginHosts: f.launcher,
    externalTasks: { retains: () => false }, selectedRuntime: () => f.worker.id, text: (value: string) => value,
  });
  await assert.rejects(handle('retryMessage', ['saved-user', 'edited input', f.worker.id]), /STARTUP_NOT_READY/);
  assert.equal(f.worker.mutating, false);
  const deadline = Date.now() + 5000;
  while (!f.launchState.starts.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.launchState.starts.length, 1);
  assert.equal(f.calls.length, 0);
});
for (const invalidation of ['worker', 'global', 'transport'] as const) {
  test(`a held old attachment cannot deduplicate a new transport after ${invalidation} replacement`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    let resolutions = 0;
    f.launchState.resolve = async () => {
      if (++resolutions === 1) { entered(); await held; }
    };
    const old = f.launcher.attach(f.worker);
    await entering;
    try {
      if (invalidation !== 'transport') f.launcher.invalidate(invalidation === 'worker' ? f.worker : undefined);
      f.worker.rpc = { ...f.worker.rpc };
      f.record.requestId = randomUUID();
      const current = f.launcher.attach(f.worker);
      assert.notEqual(current, old, 'The replacement must not reuse a promise bound to the old transport');
      await current;
      assert.equal(f.launchState.starts.length, 1);
    } finally { release(); await old; }
    assert.equal(f.launchState.starts.length, 1, 'The stale descriptor continuation must not start another consumer');
    const client = f.client(); t.after(() => client.close());
    await client.context();
    assert.equal(f.calls.length, 0);
  });
}
test('an unconfigured plugin does not invent a saved route or issue a lease', async t => {
  const f = await fixture(t, false);
  const binding = await f.store.current(f.descriptor);
  f.worker.rpc.request = async () => assert.fail('A source preview should not make an RPC');
  assert.deepEqual(await f.launcher.status(f.descriptor, binding),
    { status: 'unconfigured' });
  f.state.auth.step.profile = 'platform_oversea';
  assert.deepEqual(await f.launcher.status(f.descriptor, binding),
    { status: 'unconfigured' });
  f.state.changing = true;
  assert.deepEqual(await f.launcher.status(f.descriptor, binding), { status: 'unconfigured' });
  assert.equal(f.launchState.starts.length + f.state.confirmations.length + f.calls.length, 0);
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
