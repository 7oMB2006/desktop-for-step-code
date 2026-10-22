import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('pinned Windows MCP discovery retains disable through migration, plugin discovery, restart and relocation', {
  timeout: 90000, skip: process.platform !== 'win32' && 'Windows runtime and first-preparation acceptance',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-steppage-rpc-'));
  const workspace = join(root, 'project');
  const bundle = join(root, 'bundle.mjs');
  const startLog = join(root, 'starts.log');
  const canonical = 'steppage__steppage';
  const node = resolve('runtime/node/node.exe');
  const env = isolatedEnvironment(root, { ...process.env, HOME: root, USERPROFILE: root });
  const worker = new RpcProcess(() => {});
  const admin = new RpcProcess(() => {});
  await mkdir(workspace);
  await mkdir(join(root, 'plugins', 'guard'), { recursive: true });
  await cp(new URL('./fixtures/steppage-mcp-server.mjs', import.meta.url), bundle);
  await writeFile(join(root, 'plugins', 'guard', 'step.plugin.json'), JSON.stringify({
    id: 'guard', name: 'Disable fixture', version: '1.0.0',
    mcpServers: { fixture: { command: node, args: [bundle], env: { DESKTOP_MCP_START_LOG: startLog } } },
  }));
  await writeFile(join(root, 'config.toml'), [
    'defaultProvider = "fixture"', 'defaultModel = "fixture"', 'permissionPreset = "ask"',
    '[telemetry]', 'enabled = false', '[mcp_servers."steppage"]', 'enabled = false',
    `command = ${JSON.stringify('C:\\Old App\\runtime\\node\\node.exe')}`, `args = [${JSON.stringify(bundle)}]`,
    '[mcp_servers."steppage".env]', `DESKTOP_MCP_START_LOG = ${JSON.stringify(startLog)}`,
    'PRIVATE_FIXTURE_SECRET = "never-project-this"',
    '[mcp_servers.guard__fixture]', 'enabled = false',
  ].join('\n') + '\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-not-a-real-key',
    models: [{ id: 'fixture', name: 'MCP fixture', contextWindow: 32768, maxTokens: 1024 }],
  } } }));
  admin.start(node, resolve('runtime/admin.mjs'), workspace, env);
  const reconcile = () => admin.request('reconcile_steppage', { bundlePath: bundle });
  const snapshot = async () => {
    worker.start(node, resolve('runtime/step/dist/bundle/step.js'), workspace, env);
    try {
      const state = await worker.request('get_state', {}, 60000);
      const summary = await worker.request('get_desktop_summary');
      assert.equal(state.messageCount, 0, 'MCP preparation must not send a model prompt');
      return summary.mcp as { name: string; status: string; toolCount: number }[];
    } finally { await worker.stop(); }
  };
  try {
    await reconcile();
    const settings = await admin.request('settings', { cwd: workspace });
    assert.ok(!settings.mcp.steppage);
    assert.equal(settings.mcp[canonical].command, node);
    assert.equal(settings.mcp[canonical].enabled, false);
    assert.ok(!JSON.stringify(settings).includes('never-project-this'));
    let statuses = await snapshot();
    assert.deepEqual(statuses.filter(s => s.name.includes('steppage')), [{ name: canonical, status: 'disabled', toolCount: 0 }]);
    assert.deepEqual(statuses.find(s => s.name === 'guard__fixture'), { name: 'guard__fixture', status: 'disabled', toolCount: 0 });
    assert.equal(await readFile(startLog, 'utf8').catch(() => ''), '', 'Disabled plugin servers must never be spawned');
    await reconcile();
    statuses = await snapshot();
    assert.equal(statuses.find(s => s.name === canonical)?.status, 'disabled', 'Restart must keep the override after builtin discovery');
    await admin.request('mcp', { name: canonical, config: { enabled: true } });
    statuses = await snapshot();
    assert.deepEqual(statuses.filter(s => s.name.includes('steppage')), [{ name: canonical, status: 'connected', toolCount: 1 }]);
    assert.equal((await readFile(startLog, 'utf8')).trim().split('\n').length, 1, 'Only one qualified server is connected');
    await admin.request('mcp', { name: canonical, config: {
      command: 'C:\\Moved App\\runtime\\node\\node.exe', enabled: false,
    } });
    await reconcile();
    statuses = await snapshot();
    assert.equal(statuses.find(s => s.name === canonical)?.status, 'disabled');
    assert.equal((await admin.request('settings', { cwd: workspace })).mcp[canonical].command, node);
    assert.equal((await readFile(startLog, 'utf8')).trim().split('\n').length, 1, 'Relocation must not re-enable or spawn');
    assert.ok((await readFile(join(root, 'config.toml'), 'utf8')).includes('never-project-this'));

    // A present but invalid bundle must report failure; a later valid file can recover on restart.
    await writeFile(bundle, 'process.exit(2);\n');
    await admin.request('mcp', { name: canonical, config: { enabled: true } });
    statuses = await snapshot();
    assert.equal(statuses.find(s => s.name === canonical)?.status, 'failed');
    await cp(new URL('./fixtures/steppage-mcp-server.mjs', import.meta.url), bundle);
    await reconcile();
    statuses = await snapshot();
    assert.deepEqual(statuses.filter(s => s.name.includes('steppage')), [{ name: canonical, status: 'connected', toolCount: 1 }]);
    assert.equal(statuses.find(s => s.name === 'guard__fixture')?.status, 'disabled');
  } finally {
    await worker.stop();
    await admin.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows first preparation stays usable without a bundle and retries after a valid bundle is supplied', {
  timeout: 60000, skip: process.platform !== 'win32' && 'Upstream first-preparation limitation is Windows-specific',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-steppage-first-'));
  const workspace = join(root, 'project');
  const bundle = join(root, 'prepared-bundle.mjs');
  const node = resolve('runtime/node/node.exe');
  const env = isolatedEnvironment(root, { ...process.env, HOME: root, USERPROFILE: root,
    PATH: process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : '' });
  const admin = new RpcProcess(() => {});
  const worker = new RpcProcess(() => {});
  try {
    await mkdir(workspace);
    await writeFile(join(root, 'config.toml'),
      'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
    await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
      api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
      models: [{ id: 'fixture', name: 'MCP first preparation', contextWindow: 32768, maxTokens: 1024 }],
    } } }));
    admin.start(node, resolve('runtime/admin.mjs'), workspace, env);
    await admin.request('reconcile_steppage', { bundlePath: bundle });
    assert.deepEqual((await admin.request('settings', { cwd: workspace })).mcp, {});
    worker.start(node, resolve('runtime/step/dist/bundle/step.js'), workspace, env);
    const state = await worker.request('get_state', {}, 60000);
    assert.equal(state.messageCount, 0, 'Missing StepPage must not block the rest of the runtime');
    const first = await worker.request('get_desktop_summary');
    assert.deepEqual(first.mcp.filter((s: { name: string }) => s.name.includes('steppage')),
      [{ name: 'steppage__steppage', status: 'failed', toolCount: 0 }]);
    await worker.stop();
    await cp(new URL('./fixtures/steppage-mcp-server.mjs', import.meta.url), bundle);
    await admin.request('reconcile_steppage', { bundlePath: bundle });
    worker.start(node, resolve('runtime/step/dist/bundle/step.js'), workspace, env);
    await worker.request('get_state', {}, 60000);
    const retry = await worker.request('get_desktop_summary');
    assert.deepEqual(retry.mcp.filter((s: { name: string }) => s.name.includes('steppage')),
      [{ name: 'steppage__steppage', status: 'connected', toolCount: 1 }]);
  } finally {
    await worker.stop();
    await admin.stop();
    await rm(root, { recursive: true, force: true });
  }
});
