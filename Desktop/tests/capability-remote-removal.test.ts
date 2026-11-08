import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CapabilityService, assertPluginUnused } from '../electron/capability-service';
import { isolatedEnvironment } from '../electron/runtime';
import { SessionRuntimes, type SessionRuntime, type WorkerTransport } from '../electron/session-runtimes';
import type { CapabilityMutation } from '../src/capabilities';
import type { CapabilityPolicy } from '../electron/capability-policy';

class Transport implements WorkerTransport {
  stopped = false;
  mcp: { name: string; status: string }[] | undefined = [];
  state: Record<string, unknown> = { sessionId: 'remote-removal', isStreaming: false };
  start() {}
  async request(type: string): Promise<any> {
    if (type === 'get_state') return this.state;
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    if (type === 'get_desktop_summary') return { mcp: this.mcp };
    return {};
  }
  respond() {}
  async stop() { this.stopped = true; }
}

async function fixture(t: test.TestContext, nativeMarket = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-remote-removal-')));
  const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  const service = new CapabilityService({ root, runtime,
    node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(root) });
  const transport = new Transport();
  const pool = new SessionRuntimes(() => {}, () => transport);
  const worker = await pool.open('node', 'step', root, {});
  worker.remoteAttached = true;
  const plugin = join(root, 'plugins', 'theme');
  await mkdir(plugin, { recursive: true });
  const manifest = { id: 'theme', name: 'Data-only theme', version: '1.0.0', skills: [], commands: [], agents: [] };
  const saveManifest = (value: unknown) => writeFile(join(plugin, 'step.plugin.json'), JSON.stringify(value));
  await saveManifest(manifest);
  await writeFile(join(plugin, 'dfsc.theme.json'), JSON.stringify({ schemaVersion: 1, renderer: 'stellar-v1' }));
  await writeFile(join(plugin, 'scene.json'), '{"fixture":true}');
  const source = join(root, 'source');
  await mkdir(join(source, '.step-plugin'), { recursive: true });
  await writeFile(join(source, '.step-plugin/marketplace.json'), JSON.stringify({ name: 'fixture', plugins: [] }));
  let market = { name: 'fixture' };
  if (nativeMarket) {
    await service.mutate({ action: 'marketplace-add', source });
    market = (await service.catalog()).marketplaces.find(item => item.kind === 'local')!;
    assert.ok(market);
  } else {
    await mkdir(join(root, 'marketplaces', market.name, '.step-plugin'), { recursive: true });
    await writeFile(join(root, 'marketplaces', market.name, '.step-plugin/marketplace.json'), '{"plugins":[]}');
  }
  const guard = async (input: CapabilityMutation, policy: Readonly<CapabilityPolicy>) => {
    if (policy.scope === 'runtime') await pool.assertAllIdle({ stopHost: false, resources: true });
    if (policy.pluginId) await assertPluginUnused(policy.pluginId, pool.workers.values());
  };
  t.after(async () => {
    await service.stop();
    await pool.stopAll();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { root, plugin, source, manifest, saveManifest, service, pool, transport, worker, market, guard };
}

async function installFixture(t: test.TestContext) {
  const f = await fixture(t, true);
  const marketRoot = join(f.root, 'marketplaces', f.market.name);
  const candidate = join(marketRoot, 'plugins', 'voyager');
  await mkdir(candidate, { recursive: true });
  const manifest = { ...f.manifest, id: 'voyager', name: 'Voyager theme' };
  await writeFile(join(candidate, 'step.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(candidate, 'dfsc.theme.json'), '{"schemaVersion":1,"renderer":"stellar-v1"}');
  await writeFile(join(candidate, 'README.md'), '# Voyager fixture');
  await writeFile(join(marketRoot, '.step-plugin/marketplace.json'), JSON.stringify({
    name: 'fixture', plugins: [{ name: 'voyager', source: 'plugins/voyager' }],
  }));
  const input = async () => {
    const available = (await f.service.catalog()).available.find(item => item.name === 'voyager');
    assert.ok(available?.package);
    return { action: 'plugin-install', name: available.name, marketplace: available.marketplace, ref: available.package.ref } as const;
  };
  return { ...f, candidate, candidateManifest: manifest, input };
}

test('idle Remote installs a referenced data-only theme without restarting its worker', async t => {
  const f = await installFixture(t), input = await f.input();
  await f.service.mutate(input, options => f.guard(input, options));
  const installed = (await f.service.catalog()).plugins.find(item => item.id === 'voyager');
  assert.equal(installed?.package?.provenance, 'recorded');
  assert.equal(f.worker.remoteAttached, true);
  assert.equal(f.pool.workers.get(f.worker.id), f.worker);
  assert.equal(f.transport.stopped, false);
  assert.match(await readFile(join(f.root, 'plugins/voyager/README.md'), 'utf8'), /Voyager fixture/);
});

test('a busy Remote updates a proven theme without replacing its runtime, RPC, session or installation instance', async t => {
  const f = await installFixture(t), install = await f.input();
  await f.service.mutate(install, policy => f.guard(install, policy));
  const receiptFile = join(f.root, 'desktop-plugins/installations.json');
  const before = JSON.parse(await readFile(receiptFile, 'utf8')).installations.find((item: any) => item.id === 'voyager');
  const rpc = f.worker.rpc, sessionId = f.worker.state?.sessionId;
  await writeFile(join(f.candidate, 'step.plugin.json'), JSON.stringify({ ...f.candidateManifest, version: '1.1.0' }));
  const plugin = (await f.service.catalog()).plugins.find(item => item.id === 'voyager')!;
  assert.equal(plugin.update?.status, 'available');
  const input = { action: 'plugin-update', id: plugin.id, ref: plugin.package!.ref, candidate: plugin.update!.ref! } as const;
  f.worker.busy = true;
  f.transport.state.isStreaming = true;
  await f.service.mutate(input, async policy => {
    assert.equal(policy.scope, 'theme');
    await f.guard(input, policy);
  });
  const after = JSON.parse(await readFile(receiptFile, 'utf8')).installations.find((item: any) => item.id === 'voyager');
  assert.equal(after.instance, before.instance);
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.equal(JSON.parse(await readFile(join(f.root, 'plugins/voyager/step.plugin.json'), 'utf8')).version, '1.1.0');
  assert.equal(f.pool.workers.get(f.worker.id), f.worker);
  assert.equal(f.worker.rpc, rpc);
  assert.equal(f.worker.state?.sessionId, sessionId);
  assert.equal(f.worker.remoteAttached, true);
  assert.equal(f.transport.stopped, false);
});

test('theme update refuses a candidate changed after classification and preserves the installed version', async t => {
  const f = await installFixture(t), install = await f.input();
  await f.service.mutate(install, policy => f.guard(install, policy));
  await writeFile(join(f.candidate, 'step.plugin.json'), JSON.stringify({ ...f.candidateManifest, version: '1.1.0' }));
  const plugin = (await f.service.catalog()).plugins.find(item => item.id === 'voyager')!;
  const input = { action: 'plugin-update', id: plugin.id, ref: plugin.package!.ref, candidate: plugin.update!.ref! } as const;
  await assert.rejects(f.service.mutate(input, async policy => {
    assert.equal(policy.scope, 'theme');
    await f.guard(input, policy);
    await writeFile(join(f.candidate, 'step.plugin.json'),
      JSON.stringify({ ...f.candidateManifest, version: '1.1.0', commands: ['commands'] }));
  }), /capability:stale/);
  assert.equal(JSON.parse(await readFile(join(f.root, 'plugins/voyager/step.plugin.json'), 'utf8')).version, '1.0.0');
  assert.equal(f.transport.stopped, false);
});

test('theme installation refuses executable, malformed, unreferenced and forged candidates under Remote', async t => {
  const f = await installFixture(t);
  for (const extra of [
    { entry: 'index.js' }, { skills: ['skills'] }, { commands: ['commands'] }, { agents: ['agents'] },
    { mcpServers: { tools: { command: 'never-run' } } }, { mcpServers: 'mcp.json' },
    { skills: null }, { futureCapability: {} }, { provision: {} },
  ]) {
    await writeFile(join(f.candidate, 'step.plugin.json'), JSON.stringify({ ...f.candidateManifest, ...extra }));
    const input = await f.input();
    await assert.rejects(f.service.mutate(input, options => f.guard(input, options)), /Unbind Remote/);
  }
  await writeFile(join(f.candidate, 'step.plugin.json'), JSON.stringify(f.candidateManifest));
  const input = await f.input();
  for (const forged of [
    { ...input, ref: undefined }, { ...input, ref: 'not-issued' },
    { ...input, name: 'other' }, { ...input, marketplace: 'other' },
  ]) {
    const input = { ...forged, preserveRuntime: true };
    await assert.rejects(f.service.mutate(input, options => f.guard(forged, options)), /Unbind Remote/);
  }
  await assert.rejects(readFile(join(f.root, 'plugins/voyager/step.plugin.json')), { code: 'ENOENT' });
});

test('theme installation rejects a changed candidate after the idle guard without publishing it', async t => {
  const f = await installFixture(t), input = await f.input();
  await assert.rejects(f.service.mutate(input, async options => {
    assert.equal(options.scope, 'theme');
    await f.guard(input, options);
    await writeFile(join(f.candidate, 'step.plugin.json'), JSON.stringify({ ...f.candidateManifest, entry: 'changed.js' }));
  }), /capability:stale/);
  await assert.rejects(readFile(join(f.root, 'plugins/voyager/step.plugin.json')), { code: 'ENOENT' });
  assert.equal(f.worker.remoteAttached, true);
  assert.equal(f.transport.stopped, false);
});

test('theme installation refuses pending recovery before and after the guard without recovering it', async t => {
  const f = await installFixture(t), input = await f.input();
  const journal = join(f.root, 'desktop-plugins/update-transaction.json');
  await mkdir(join(f.root, 'desktop-plugins'), { recursive: true });
  const bytes = '{"pending":"must remain untouched"}';
  await writeFile(journal, bytes);
  await assert.rejects(f.service.mutate(input, options => f.guard(input, options)), /update-recovery-required/);
  assert.equal(await readFile(journal, 'utf8'), bytes);
  await rm(journal);
  await assert.rejects(f.service.mutate(input, async options => {
    assert.equal(options.scope, 'theme');
    await f.guard(input, options);
    await writeFile(journal, bytes);
  }), /capability:update-recovery-required/);
  assert.equal(await readFile(journal, 'utf8'), bytes);
  await assert.rejects(readFile(join(f.root, 'plugins/voyager/step.plugin.json')), { code: 'ENOENT' });
});

test('idle Remote survives marketplace removal and data-only theme uninstall without restarting its worker', async t => {
  const f = await fixture(t, true);
  for (const input of [
    { action: 'marketplace-remove', name: f.market.name },
    { action: 'plugin-remove', id: 'theme' },
  ] as const) {
    await f.service.mutate(input, options => f.guard(input, options));
    assert.equal(f.worker.remoteAttached, true);
    assert.equal(f.pool.workers.get(f.worker.id), f.worker);
    assert.equal(f.transport.stopped, false);
    if (input.action === 'marketplace-remove')
      assert.match(await readFile(join(f.plugin, 'step.plugin.json'), 'utf8'), /Data-only theme/);
  }
  const catalog = await f.service.catalog();
  assert.equal(catalog.plugins.length, 0);
  assert.equal(catalog.marketplaces.some(item => item.name === f.market.name), false);
});

test('idle Remote can add and refresh Git markets and check updates without changing installed plugins', async t => {
  const f = await fixture(t);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: f.source, encoding: 'utf8', stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '--', '.');
  const commit = () => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-am', 'Offline market revision');
  commit();
  const installed = await readFile(join(f.plugin, 'step.plugin.json'), 'utf8');
  const add = { action: 'marketplace-add', source: pathToFileURL(f.source).href } as const;
  await f.service.mutate(add, options => f.guard(add, options));
  const market = (await f.service.catalog()).marketplaces.find(item => item.kind === 'git')!;
  assert.ok(market);
  for (const [revision, action] of ['marketplace-update', 'plugin-check-updates'].entries()) {
    await writeFile(join(f.source, '.step-plugin/marketplace.json'),
      JSON.stringify({ name: 'fixture', plugins: [], revision }));
    commit();
    const input: CapabilityMutation = action === 'marketplace-update'
      ? { action, name: market.name } : { action: 'plugin-check-updates' };
    await f.service.mutate(input, options => f.guard(input, options));
    assert.equal(JSON.parse(await readFile(join(f.root, 'marketplaces', market.name, '.step-plugin/marketplace.json'), 'utf8')).revision, revision);
    assert.equal(await readFile(join(f.plugin, 'step.plugin.json'), 'utf8'), installed);
    assert.equal(f.worker.remoteAttached, true);
    assert.equal(f.pool.workers.get(f.worker.id), f.worker);
    assert.equal(f.transport.stopped, false);
  }
});

const busyCases: [string, (worker: SessionRuntime, transport: Transport) => void, RegExp][] = [
  ['task', worker => { worker.busy = true; }, /Stop this session/],
  ['queue', worker => { worker.queued = true; }, /pending messages/],
  ['operation', worker => { worker.mutating = true; }, /Session operation/],
  ['side question', worker => { worker.btwActive = true; }, /side question/],
  ['background work', worker => { worker.backgroundActive = true; }, /background/],
  ['approval', worker => { worker.pendingUI.set('approval', { id: 'approval' } as any); }, /Stop this session/],
  ['active goal', worker => {
    worker.launch!.goal = { status: 'active' } as any;
  }, /Pause the active goal/],
  ['stream observed by RPC', (_worker, transport) => { transport.state.isStreaming = true; }, /Stop this session/],
  ['compaction observed by RPC', (_worker, transport) => { transport.state.isCompacting = true; }, /Stop this session/],
  ['pending messages observed by RPC', (_worker, transport) => { transport.state.pendingMessageCount = 1; }, /Stop this session/],
];
for (const [label, setBusy, message] of busyCases) {
  test(`data-only theme installation leaves Remote ${label} undisturbed`, async t => {
    const f = await installFixture(t), input = await f.input();
    setBusy(f.worker, f.transport);
    await f.service.mutate(input, options => f.guard(input, options));
    assert.ok(await readFile(join(f.root, 'plugins/voyager/step.plugin.json')));
    assert.equal(f.worker.remoteAttached, true);
    assert.equal(f.transport.stopped, false);
  });
}
for (const action of ['plugin-remove', 'marketplace-remove', 'marketplace-add', 'marketplace-update', 'plugin-check-updates'] as const) {
  for (const [label, setBusy, message] of busyCases) {
    test(`${action} leaves Remote ${label} undisturbed`, async t => {
      const f = await fixture(t);
      setBusy(f.worker, f.transport);
      const input: CapabilityMutation = action === 'plugin-remove' ? { action, id: 'theme' }
        : action === 'marketplace-add' ? { action, source: f.source }
        : action === 'plugin-check-updates' ? { action } : { action, name: f.market.name };
      if (action === 'marketplace-update') {
        const classified = new Error('classification complete');
        await assert.rejects(f.service.mutate(input, async policy => {
          await f.guard(input, policy);
          assert.equal(policy.scope, 'discovery');
          throw classified;
        }), error => error === classified);
      } else await f.service.mutate(input, options => f.guard(input, options));
      assert.equal(f.worker.remoteAttached, true);
      assert.equal(f.transport.stopped, false);
      if (action !== 'plugin-remove') assert.ok(await readFile(join(f.plugin, 'step.plugin.json')));
      if (action !== 'marketplace-remove')
        assert.ok(await readFile(join(f.root, 'marketplaces', f.market.name, '.step-plugin/marketplace.json')));
    });
  }
}

test('theme files do not exempt executable, malformed or unknown plugin declarations from Remote ownership', async t => {
  const f = await fixture(t);
  const sentinel = new Error('classification only');
  for (const extra of [
    { entry: 'index.js' }, { skills: ['skills'] }, { commands: ['commands'] }, { agents: ['agents'] },
    { mcpServers: { tools: { command: 'never-run' } } }, { mcpServers: 'mcp.json' },
    { skills: null }, { extensions: [] }, { futureCapability: {} }, { provision: {} },
  ]) {
    await f.saveManifest({ ...f.manifest, ...extra });
    await assert.rejects(f.service.mutate({ action: 'plugin-remove', id: 'theme' }, async options => {
      assert.equal(options.scope, 'runtime', JSON.stringify(extra));
      throw sentinel;
    }), error => error === sentinel);
  }
});

test('duplicate IDs, missing theme metadata and links cannot authorize a Remote-preserving removal', async t => {
  const f = await fixture(t);
  const probe = async () => {
    const sentinel = new Error('classification only');
    await assert.rejects(f.service.mutate({ action: 'plugin-remove', id: 'theme' }, async options => {
      assert.equal(options.scope, 'runtime');
      throw sentinel;
    }), error => error === sentinel);
  };
  const duplicate = join(f.root, 'plugins/duplicate');
  await mkdir(duplicate);
  await writeFile(join(duplicate, 'step.plugin.json'), JSON.stringify(f.manifest));
  await probe();
  await rm(duplicate, { recursive: true });
  await rm(join(f.plugin, 'dfsc.theme.json'));
  await probe();
  await writeFile(join(f.plugin, 'dfsc.theme.json'), '{"schemaVersion":1,"renderer":"stellar-v1"}');
  await symlink(f.root, join(f.plugin, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await probe();
});

test('theme removal revalidates its frozen fingerprint after the idle and resource checks', async t => {
  const f = await fixture(t);
  const input = { action: 'plugin-remove', id: 'theme' } as const;
  await assert.rejects(f.service.mutate(input, async options => {
    assert.equal(options.scope, 'theme');
    await f.guard(input, options);
    await f.saveManifest({ ...f.manifest, entry: 'changed-after-check.js' });
  }), /capability:stale/);
  assert.match(await readFile(join(f.plugin, 'step.plugin.json'), 'utf8'), /changed-after-check/);
  assert.equal(f.worker.remoteAttached, true);
  assert.equal(f.transport.stopped, false);
});

test('data-only removal retains MCP usage and unavailable-observation guards', async t => {
  const f = await fixture(t);
  const input = { action: 'plugin-remove', id: 'theme' } as const;
  for (const mcp of [[{ name: 'theme__tools', status: 'connected' }], undefined]) {
    f.transport.mcp = mcp;
    await assert.rejects(f.service.mutate(input, options => f.guard(input, options)), /resource-in-use/);
    assert.ok(await readFile(join(f.plugin, 'step.plugin.json')));
  }
});

test('pending plugin recovery cannot be disguised as Remote-preserving market maintenance', async t => {
  const f = await fixture(t);
  const journal = join(f.root, 'desktop-plugins/update-transaction.json');
  await mkdir(join(f.root, 'desktop-plugins'), { recursive: true });
  await writeFile(journal, '{"pending":"must remain untouched"}');
  for (const input of [
    { action: 'marketplace-add', source: f.source }, { action: 'marketplace-update', name: f.market.name },
    { action: 'plugin-check-updates' }, { action: 'marketplace-remove', name: f.market.name },
    { action: 'plugin-remove', id: 'theme' },
  ] as const) {
    await assert.rejects(f.service.mutate(input, options => f.guard(input, options)), /update-recovery-required/);
    assert.equal(await readFile(journal, 'utf8'), '{"pending":"must remain untouched"}');
  }
});

test('recovery appearing after the guard is refused inside the native management worker', async t => {
  const f = await fixture(t);
  const input = { action: 'plugin-check-updates' } as const;
  const journal = join(f.root, 'desktop-plugins/update-transaction.json');
  await assert.rejects(f.service.mutate(input, async options => {
    assert.equal(options.scope, 'discovery');
    await f.guard(input, options);
    await mkdir(join(f.root, 'desktop-plugins'), { recursive: true });
    await writeFile(journal, '{"pending":"must remain untouched"}');
  }), /capability:update-recovery-required/);
  assert.equal(await readFile(journal, 'utf8'), '{"pending":"must remain untouched"}');
  assert.equal(f.worker.remoteAttached, true);
  assert.equal(f.transport.stopped, false);
});

test('renderer-supplied flags cannot exempt other capability mutations from Remote ownership', async t => {
  const f = await fixture(t);
  for (const mutation of [
    { action: 'plugin-toggle', id: 'theme', enabled: false },
    { action: 'plugin-update', id: 'theme', ref: 'fixture-ref', candidate: 'fixture-candidate' },
    { action: 'plugin-install', name: 'theme', marketplace: f.market.name },
    { action: 'skill-create', name: 'fixture', description: 'Fixture', instructions: 'Never execute.' },
    { action: 'mcp-toggle', name: 'fixture', enabled: false },
  ] satisfies CapabilityMutation[]) {
    const input = { ...mutation, allowRemote: true, preserveRuntime: true };
    await assert.rejects(f.service.mutate(input, options => f.guard(input, options)),
      mutation.action === 'plugin-update' ? /capability:stale/ : /Unbind Remote/);
  }
  await assert.rejects(f.pool.assertIdle(f.worker, { allowRemote: true }), /Unbind Remote/);
  await assert.rejects(f.pool.assertAllIdle({ stopHost: true, allowRemote: true }), /Unbind Remote/);
  await assert.rejects(f.pool.assertIdle(f.worker, { stopHost: false }), /Unbind Remote/);
});
