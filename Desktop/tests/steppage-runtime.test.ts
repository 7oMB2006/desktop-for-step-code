import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('pinned MCP discovery retains disable through migration, plugin discovery, restart and relocation', {
  timeout: 90000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-steppage-rpc-'));
  const workspace = join(root, 'project');
  const bundle = join(root, 'bundle.mjs');
  const startLog = join(root, 'starts.log');
  const canonical = 'steppage__steppage';
  const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
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
    `command = ${JSON.stringify(process.platform === 'win32' ? 'C:\\Old App\\runtime\\node\\node.exe' : '/Old App/runtime/node/node')}`, `args = [${JSON.stringify(bundle)}]`,
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
      command: process.platform === 'win32' ? 'C:\\Moved App\\runtime\\node\\node.exe' : '/Moved App/runtime/node/node', enabled: false,
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

test('first preparation stays usable without a bundle and retries after a valid bundle is supplied', {
  timeout: 60000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-steppage-first-'));
  const workspace = join(root, 'project');
  const bundle = join(root, 'prepared-bundle.mjs');
  const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
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


test('fresh macOS StepPage uses only the Desktop transport while personal PATH and HOME remain untouched', {
  timeout: 60000, skip: process.platform !== 'darwin',
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-steppage-personal-'));
  const desktop = join(root, 'desktop');
  const personal = join(root, 'personal');
  const bin = join(personal, '.local/bin');
  const marker = join(personal, 'executed.txt');
  const homePath = join(desktop, 'steppage/home');
  const bundlePath = join(desktop, 'steppage/bin/steppage-mcp.mjs');
  const workspace = join(root, 'project');
  const node = resolve('runtime/node/node');
  const env = isolatedEnvironment(desktop, { ...process.env, HOME: personal, USERPROFILE: personal, PATH: bin });
  const admin = new RpcProcess(() => {});
  const worker = new RpcProcess(() => {});
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(homePath, { recursive: true });
    await mkdir(workspace);
    const sentinel = join(bin, 'steppage-mcp');
    await writeFile(sentinel, '#!/bin/sh\nprintf executed > "' + marker + '"\nexit 1\n');
    await chmod(sentinel, 0o700);
    await writeFile(join(desktop, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
    await writeFile(join(desktop, 'models.json'), JSON.stringify({ providers: { fixture: {
      api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
      models: [{ id: 'fixture', name: 'Isolated StepPage', contextWindow: 32768, maxTokens: 1024 }],
    } } }));
    admin.start(node, resolve('runtime/admin.mjs'), workspace, env);
    await admin.request('reconcile_steppage', { bundlePath, homePath });
    const settings = await admin.request('settings', { cwd: workspace });
    assert.equal(settings.mcp.steppage__steppage.command, node);
    assert.deepEqual(settings.mcp.steppage__steppage.args, [bundlePath]);
    const read = async () => {
      worker.start(node, resolve('runtime/step/dist/bundle/step.js'), workspace, env);
      try {
        const state = await worker.request('get_state', {}, 60000);
        assert.equal(state.messageCount, 0);
        return (await worker.request('get_desktop_summary')).mcp;
      } finally { await worker.stop(); }
    };
    const first = await read();
    assert.equal(first.find((s: any) => s.name === 'steppage__steppage')?.status, 'failed');
    assert.equal(await readFile(marker, 'utf8').catch(() => ''), '', 'Never discover or invoke the personal executable');
    await assert.rejects(readFile(join(personal, '.steppage-mcp/bin/steppage-mcp.mjs')), { code: 'ENOENT' });
    // A previously stored disabled-only built-in override may later be enabled.
    // Reconciliation must supply the same explicit Desktop transport in that case.
    await admin.stop();
    await writeFile(join(desktop, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = true\n');
    admin.start(node, resolve('runtime/admin.mjs'), workspace, env);
    await admin.request('reconcile_steppage', { bundlePath, homePath });
    assert.equal((await read()).find((s: any) => s.name === 'steppage__steppage')?.status, 'failed');
    assert.equal(await readFile(marker, 'utf8').catch(() => ''), '', 'Enabling a bare override must not restore personal discovery');
    await mkdir(join(desktop, 'steppage/bin'), { recursive: true });
    await cp(new URL('./fixtures/steppage-mcp-server.mjs', import.meta.url), bundlePath);
    await admin.request('prepare_steppage', { bundlePath, homePath });
    assert.equal((await read()).find((s: any) => s.name === 'steppage__steppage')?.status, 'connected');
    assert.equal(await readFile(marker, 'utf8').catch(() => ''), '', 'Prepared retries also stay inside Desktop');
  } finally {
    await worker.stop(); await admin.stop();
    await rm(root, { recursive: true, force: true });
  }
});
