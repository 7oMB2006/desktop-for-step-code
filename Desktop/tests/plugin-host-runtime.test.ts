import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { hostService } from './fixtures/plugin-host-service';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import { CapabilityService } from '../electron/capability-service';
import { PluginHostLauncher } from '../electron/plugin-host-launcher';
import type { RuntimeEvent } from '../src/contracts';

const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const sdk = resolve('../examples/plugins/sdk-host-starter/plugins/dfsc-host-example');
async function waitFor(condition: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!await condition() && Date.now() < deadline) await delay(20);
  assert.ok(await condition(), label);
}

for (const asyncStartup of [false, true]) {
const startupEnv = asyncStartup ? { DFSC_ASYNC_STARTUP_V1: '1' } : {};
const mode = asyncStartup ? 'asynchronous startup' : 'legacy startup';

test(`real native discovery launches the bundled SDK, invokes the main broker and revokes on account change (${mode})`,
  { timeout: 90000 }, async t => {
    const f = await hostService(t, { packageDirectory: sdk, command: node,
      serverWrapper: resolve('tests/fixtures/host-sdk-proxy.mjs') });
    await f.broker.close();
    const events: RuntimeEvent[] = [];
    let brokerCalls = 0, sequence = 0, settingsReady = false;
    let launcher: PluginHostLauncher;
    const pool = new SessionRuntimes(event => {
      events.push(event);
      if (event.type === 'extension_ui_request' && event.method === 'confirm') queueMicrotask(() => {
        const worker = pool.workers.get(event.runtimeId);
        if (worker) pool.respondToRequest(worker, { id: event.id, confirmed: true });
      });
    }, undefined, { pluginsReady: worker => launcher.attach(worker), dispose: worker => launcher.invalidate(worker) });
    const capabilities = new CapabilityService({ root: f.root, runtime, node,
      environment: () => isolatedEnvironment(f.root), beforePluginMutation: () => launcher.invalidate() });
    launcher = new PluginHostLauncher({ root: f.root, pool, capabilities, language: () => 'zh', available: () => settingsReady,
      provider: {
        read: async worker => {
          const state = await worker.rpc.request('get_state');
          assert.equal(state.sessionId, worker.state?.sessionId);
          return { revision: 'a'.repeat(64), expiresAt: Date.now() + 3600000,
            capabilities: [{ id: 'model.text', available: true, model: state.model.id, channel: 'plan', region: 'cn' }] };
        },
        invoke: async () => { brokerCalls++; return { type: 'text', text: 'Verified host summary.' }; },
      } });
    try {
      await mkdir(join(f.root, 'agent'), { recursive: true });
      await writeFile(join(f.root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
      await writeFile(join(f.root, 'config.toml'), '[telemetry]\nenabled = false\n');
      await writeFile(join(f.root, 'fixture-models.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture',
        providers: { fixture: { api: 'openai-completions', apiKey: 'fixture-unused', baseUrl: 'http://127.0.0.1:1/v1',
          models: [{ id: 'fixture', name: 'Local fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 }] } } }));
      await launcher.start();
      const env = { ...isolatedEnvironment(f.root), HOME: f.root, USERPROFILE: f.root,
        ...startupEnv,
        DFSC_RUNTIME_HOST_V1: '1', STEPCODE_DESKTOP_AUTH_DATA: JSON.stringify(f.state.auth),
        STEPCODE_DESKTOP_AUTH_PATH: join(f.root, 'auth.json'), STEPCODE_CONFIG_PATH: join(f.root, 'fixture-models.json') };
      const worker = await pool.open(node, join(runtime, 'step/dist/bundle/step.js'), f.root, env);
      const nativeState = await worker.rpc.request('get_state');
      assert.equal(nativeState.model.provider, 'fixture');
      if (asyncStartup) await waitFor(async () =>
        (await worker.rpc.request('desktop_startup', { action: 'state' })).discovery === 'ready', 'host discovery');
      const pending = await worker.rpc.request('desktop_plugin_host', { action: 'list' });
      assert.equal(pending.records[0].phase, 'pending');
      settingsReady = true;
      await launcher.resumeDeferred();
      const summary = await worker.rpc.request('get_desktop_summary');
      assert.ok(summary.mcp.some((item: { name: string; status: string }) =>
        item.name === 'dfsc-host-example__example' && item.status === 'connected'));
      assert.equal(brokerCalls, 0);
      const inventory = await worker.rpc.request('desktop_plugin_host', { action: 'list' });
      assert.equal(inventory.records.length, 1);
      assert.equal(inventory.records[0].phase, 'connected');
      if (asyncStartup) {
        const startup = await pool.readStartup(worker);
        assert.equal(startup?.modelReady, true);
        assert.ok(startup?.tools.some(tool => tool.name === 'dfsc-host-example__example' && tool.status === 'connected'));
        await pool.assertExecutionReady(worker);
      }
      const call = async (name: string) => {
        const data = join(f.root, 'desktop-plugins', 'data', f.receipt.instance);
        const current = ++sequence, file = join(data, `result-${current}.json`);
        await writeFile(join(data, 'command.json'), JSON.stringify({ sequence: current, name,
          arguments: name === 'host_context' ? {} : { text: 'local fixture text' } }));
        let result = '';
        await waitFor(async () => {
          try { result = await readFile(file, 'utf8'); JSON.parse(result); return true; }
          catch { return false; }
        }, name);
        return result;
      };
      assert.match(await call('host_context'), /model.text/);
      assert.equal(brokerCalls, 0, 'Availability does not invoke a model');
      assert.match(await call('summarize_text'), /Verified host summary/);
      assert.equal(brokerCalls, 1);
      f.state.auth.step.access = 'changed-fixture-access';
      launcher.invalidate();
      assert.match(await call('host_context'), /STALE_CONTEXT/);
      assert.equal(brokerCalls, 1);
      const history = await worker.rpc.request('get_messages');
      assert.doesNotMatch(JSON.stringify([events, summary, history]),
        /dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|fixture-main-private-key|changed-fixture-access|declarationHash|executionHash/);
      assert.ok(!JSON.stringify([events, summary, history]).includes(inventory.records[0].requestId));
      await pool.remove(worker);
    } finally {
      await pool.stopAll();
      await capabilities.stop();
      await launcher.close();
    }
  });

test(`real native unconfigured consumer stays deferred and a global override invalidates its request (${mode})`,
  { timeout: 90000 }, async t => {
    const f = await hostService(t, { packageDirectory: sdk, command: node, configured: false });
    await f.broker.close();
    let launcher: PluginHostLauncher;
    const pool = new SessionRuntimes(() => {}, undefined, { pluginsReady: worker => launcher.attach(worker) });
    const capabilities = new CapabilityService({ root: f.root, runtime, node,
      environment: () => isolatedEnvironment(f.root) });
    launcher = new PluginHostLauncher({ root: f.root, pool, capabilities, provider: f.provider,
      language: () => 'zh', available: () => true });
    try {
      await mkdir(join(f.root, 'agent'), { recursive: true });
      await writeFile(join(f.root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
      await launcher.start();
      const env = { ...isolatedEnvironment(f.root), HOME: f.root, USERPROFILE: f.root, DFSC_RUNTIME_HOST_V1: '1', ...startupEnv };
      const worker = await pool.open(node, join(runtime, 'step/dist/bundle/step.js'), f.root, env);
      if (asyncStartup) await waitFor(async () =>
        (await pool.readStartup(worker))?.tools.some(tool => tool.hosted && tool.status === 'failed') === true, 'unconfigured host settled');
      const inventory = await worker.rpc.request('desktop_plugin_host', { action: 'list' });
      assert.equal(inventory.records[0].phase, asyncStartup ? 'failed' : 'pending');
      if (asyncStartup) {
        const startup = await pool.readStartup(worker);
        assert.equal(startup?.cleanupConfirmed, true);
        assert.equal(startup?.tools.find(tool => tool.name === 'dfsc-host-example__example')?.status, 'failed');
        await assert.rejects(pool.assertExecutionReady(worker), /STARTUP_NOT_READY/);
      }
      const summary = await worker.rpc.request('get_desktop_summary');
      assert.equal(summary.mcp.find((item: { name: string }) => item.name === 'dfsc-host-example__example').status, 'disabled');
      assert.equal(f.calls.length, 0);
      await writeFile(join(f.root, 'config.toml'), '[mcp_servers."dfsc-host-example__example"]\nenabled = false\n');
      await assert.rejects(worker.rpc.request('desktop_plugin_host',
        { action: 'inspect', requestId: inventory.records[0].requestId }));
      await launcher.attach(worker);
      assert.equal(f.calls.length, 0);
    } finally { await pool.stopAll(); await capabilities.stop(); await launcher.close(); }
  });

test(`hosted native initialization errors cannot echo a launch into notifications or history (${mode})`,
  { timeout: 60000 }, async t => {
    const f = await hostService(t, { command: node, serverWrapper: resolve('tests/fixtures/host-failing-mcp.mjs') });
    await f.broker.close();
    const events: RuntimeEvent[] = [];
    let launcher: PluginHostLauncher;
    const pool = new SessionRuntimes(event => events.push(event), undefined,
      { pluginsReady: worker => launcher.attach(worker), dispose: worker => launcher.invalidate(worker) });
    const capabilities = new CapabilityService({ root: f.root, runtime, node, environment: () => isolatedEnvironment(f.root) });
    launcher = new PluginHostLauncher({ root: f.root, pool, capabilities, language: () => 'zh', available: () => true,
      provider: {
        read: async () => ({ revision: 'b'.repeat(64), expiresAt: Date.now() + 3600000,
          capabilities: [{ id: 'model.text', available: true, model: 'fixture', channel: 'plan', region: 'cn' }] }),
        invoke: async () => { assert.fail('Startup cannot invoke a provider'); },
      } });
    try {
      await mkdir(join(f.root, 'agent'), { recursive: true });
      await writeFile(join(f.root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
      await launcher.start();
      const worker = await pool.open(node, join(runtime, 'step/dist/bundle/step.js'), f.root, {
        ...isolatedEnvironment(f.root), HOME: f.root, USERPROFILE: f.root, DFSC_RUNTIME_HOST_V1: '1',
        ...startupEnv,
      });
      if (asyncStartup) await waitFor(async () =>
        (await pool.readStartup(worker))?.tools.some(tool => tool.hosted && tool.status === 'failed') === true, 'failed host settled');
      const inventory = await worker.rpc.request('desktop_plugin_host', { action: 'list' });
      assert.equal(inventory.records[0].phase, 'failed');
      const summary = await worker.rpc.request('get_desktop_summary'), history = await worker.rpc.request('get_messages');
      assert.equal(summary.mcp.find((item: { name: string }) => item.name === 'dfsc-host-example__example').status, 'failed');
      assert.match(JSON.stringify(events), /Hosted MCP startup failed/);
      assert.doesNotMatch(JSON.stringify([events, summary, history]), /dfsc-launch-v1|DFSC_LAUNCH_CONTEXT|"broker"|"token"/);
    } finally { await pool.stopAll(); await capabilities.stop(); await launcher.close(); }
  });
}

test('without the native opt-in, ordinary SDK MCP startup keeps its existing behavior',
  { timeout: 60000 }, async t => {
    const f = await hostService(t, { packageDirectory: sdk, command: node, configured: false });
    await f.broker.close();
    const pool = new SessionRuntimes(() => {});
    try {
      await mkdir(join(f.root, 'agent'), { recursive: true });
      await writeFile(join(f.root, 'plugins', '.stepcode-preinstalled'), '["steppage"]');
      const worker = await pool.open(node, join(runtime, 'step/dist/bundle/step.js'), f.root,
        { ...isolatedEnvironment(f.root), HOME: f.root, USERPROFILE: f.root });
      const summary = await worker.rpc.request('get_desktop_summary');
      assert.equal(summary.mcp.find((item: { name: string }) => item.name === 'dfsc-host-example__example').status, 'connected');
      await assert.rejects(worker.rpc.request('desktop_plugin_host', { action: 'list' }));
      assert.equal(f.calls.length, 0);
    } finally { await pool.stopAll(); }
  });
