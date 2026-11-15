import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, packageFingerprint, scanInstalled } from '../electron/plugin-files.mjs';
import { PluginLibrary } from '../electron/plugin-library.mjs';
import { CapabilityService } from '../electron/capability-service';
import { isolatedEnvironment } from '../electron/runtime';

const { createCapabilitySettings } = await import(pathToFileURL(resolve('electron/capability-settings.mjs')).href);

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-target-catalog-')));
  const previous = { HOME: process.env.HOME, STEPCODE_STORAGE_ROOT_DIR: process.env.STEPCODE_STORAGE_ROOT_DIR,
    STEP_CODING_AGENT_DIR: process.env.STEP_CODING_AGENT_DIR };
  Object.assign(process.env, { HOME: root, STEPCODE_STORAGE_ROOT_DIR: root, STEP_CODING_AGENT_DIR: join(root, 'agent') });
  for (const folder of ['desktop-plugins', 'plugins', 'marketplaces']) await mkdir(join(root, folder));
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const receipts: any[] = [], marketReads: string[] = [], manifestReads: string[] = [];
  let installedReads = 0;
  const state = { configured: {} as Record<string, unknown> };
  const save = () => writeFile(join(root, 'desktop-plugins/installations.json'),
    JSON.stringify({ version: 1, installations: receipts }));
  const readManifest = async (directory: string) => {
    manifestReads.push(directory);
    return { manifest: JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8')), errors: [] };
  };
  const upstream = {
    readStepPluginManifest: readManifest,
    async diagnoseStepPlugin() { assert.fail('Target reads do not run optional native diagnostics'); },
    async listInstalledStepPlugins() {
      installedReads++;
      const plugins = new Map();
      for (const item of await scanInstalled(root)) {
        const directory = join(root, 'plugins', item.folder);
        if (!plugins.has(item.id)) plugins.set(item.id, {
          id: item.id, name: item.folder, rootPath: directory,
        });
      }
      return { plugins: [...plugins.values()], warnings: [] };
    },
    readStepConfig() { return { mcp_servers: state.configured }; },
    async listMarketplacePlugins(paths: string[]) {
      assert.equal(paths.length, 1, 'Only the selected marketplace may be queried');
      const directory = paths[0];
      marketReads.push(directory);
      const manifest = JSON.parse(await readFile(join(directory, '.step-plugin/marketplace.json'), 'utf8'));
      return { entries: manifest.plugins.map((entry: any) => ({
        name: entry.name, marketplace: manifest.name, description: entry.description,
        sourcePath: resolve(directory, entry.source),
      })), warnings: [] };
    },
    async listMarketplaceSources() { assert.fail('A target read must not enumerate marketplace sources'); },
    async discoverStepPluginResourcePaths() { assert.fail('A target read must not discover skills'); },
  };
  const manager = createCapabilitySettings(upstream, { root });
  async function plugin(folder: string, id = folder, mcpServers: unknown = {}) {
    const directory = join(root, 'plugins', folder);
    await mkdir(directory);
    await writeFile(join(directory, 'step.plugin.json'), JSON.stringify({
      id, name: folder, version: '1.0.0', skills: [], commands: [], agents: [], mcpServers,
      repository: 'https://github.com/example/plugin',
    }));
    await writeFile(join(directory, 'README.md'), '# Fixture\n');
    const receipt = { instance: String(randomUUID()), folder, id, source: 'fixture-source', marketplace: 'fixture-market',
      fingerprint: await packageFingerprint(directory), state: 'installed' };
    receipts.push(receipt);
    await save();
    const descriptor = { root: directory, fingerprint: receipt.fingerprint, kind: 'installed', id, name: folder,
      provenance: 'recorded', instance: receipt.instance, source: receipt.source, marketplace: receipt.marketplace };
    return { directory, receipt, descriptor };
  }
  async function market(folder = 'chosen', options: { kind?: string; origin?: string } = {}) {
    const checkout = join(root, 'marketplaces', folder), directory = join(checkout, 'plugins/example');
    await mkdir(directory, { recursive: true });
    await mkdir(join(checkout, '.step-plugin'));
    await writeFile(join(checkout, '.step-plugin/marketplace.json'), JSON.stringify({
      name: 'fixture-market', plugins: [{ name: 'example', source: './plugins/example', description: 'Selected entry' }],
    }));
    await writeFile(join(directory, 'step.plugin.json'), JSON.stringify({
      id: 'example', name: 'Example', version: '1.0.0', mcpServers: {},
    }));
    await writeFile(join(directory, 'README.md'), '# Available fixture\n');
    if (options.kind === 'git') {
      execFileSync('git', ['-C', checkout, 'init', '--initial-branch=main'], { windowsHide: true });
      execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', options.origin!], { windowsHide: true });
    }
    const info = await lstat(checkout);
    const stamp = digest(JSON.stringify([options.kind ?? 'local', options.origin ?? null,
      resolve(checkout), info.dev, info.ino, info.birthtimeMs]));
    const generation = randomUUID();
    const source = { name: folder, stamp, generation };
    const saveSource = () => writeFile(join(root, 'desktop-plugins/sources.json'),
      JSON.stringify({ version: 1, sources: [source] }));
    await saveSource();
    const descriptor = { root: directory, fingerprint: await packageFingerprint(directory), kind: 'available',
      id: 'example', source: generation, marketplace: 'fixture-market', name: 'example', provenance: 'recorded' };
    return { checkout, directory, descriptor, source, saveSource };
  }
  return { root, manager, plugin, market, state, receipts, save, marketReads, manifestReads,
    installedReads: () => installedReads };
}

test('target metadata never hashes even the selected package or walks unrelated marketplace copies', async t => {
  const f = await fixture(t);
  const selected = await f.plugin('selected'), unrelated = await f.plugin('unrelated');
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  for (const directory of [selected.directory, unrelated.directory])
    await symlink(outside, join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(f.root, 'marketplaces', 'unused'), process.platform === 'win32' ? 'junction' : 'dir');
  selected.receipt.fingerprint = 'a'.repeat(64);
  selected.descriptor.fingerprint = selected.receipt.fingerprint;
  await f.save();
  const before = await readFile(join(f.root, 'desktop-plugins/installations.json'));
  const catalog = await f.manager.targetCatalog({ descriptor: selected.descriptor });
  assert.deepEqual(catalog.plugins.map((item: any) => item.id), ['selected']);
  assert.equal(JSON.stringify(catalog.plugins[0].packageDescriptor), JSON.stringify(selected.descriptor));
  assert.deepEqual(catalog.available, []);
  assert.deepEqual(catalog.mcp, []);
  assert.equal(f.installedReads(), 0);
  assert.deepEqual(f.marketReads, []);
  assert.ok(f.manifestReads.every(directory => directory === selected.directory));
  assert.deepEqual(await readFile(join(f.root, 'desktop-plugins/installations.json')), before);
});

test('a verified single-target projection keeps the same issued reference and other navigation entries', async t => {
  const f = await fixture(t);
  const selected = await f.plugin('selected'), unrelated = await f.plugin('unrelated');
  const library = new PluginLibrary(f.root);
  const entry = (plugin: typeof selected) => ({ id: plugin.descriptor.id, name: plugin.descriptor.id,
    mcpServers: [], warnings: [], packageDescriptor: plugin.descriptor });
  const menu = await library.project({ plugins: [entry(selected), entry(unrelated)], available: [],
    marketplaces: [], mcp: [], skills: [], warnings: [] }, { partial: true });
  const ref = menu.plugins[0].package!.ref, other = menu.plugins[1].package!.ref;
  const target = await library.project(await f.manager.targetCatalog({ descriptor: selected.descriptor }), { retain: true });
  assert.equal(target.plugins[0].package!.ref, ref, 'Descriptor field order must not reissue the opaque reference');
  assert.equal(library.referenceSnapshot(other).descriptor.id, 'unrelated');
});

for (const field of ['instance', 'fingerprint', 'source', 'marketplace', 'id', 'state'] as const)
test(`recorded target rejects changed ${field} without granting a replacement identity`, async t => {
  const f = await fixture(t), selected = await f.plugin('selected');
  selected.receipt[field] = field === 'state' ? 'pending' : field === 'instance' ? randomUUID()
    : field === 'fingerprint' ? 'b'.repeat(64) : 'replacement';
  await f.save();
  await assert.rejects(f.manager.targetCatalog({ descriptor: selected.descriptor }), { code: 'stale' });
});

test('recorded targets reject duplicate IDs and wrong target folders', async t => {
  const f = await fixture(t), selected = await f.plugin('selected');
  await f.plugin('duplicate', 'selected');
  await assert.rejects(f.manager.targetCatalog({ descriptor: selected.descriptor }), { code: 'stale' });
  await assert.rejects(f.manager.targetCatalog({ descriptor: { ...selected.descriptor, root: join(f.root, 'plugins/duplicate') } }),
    { code: 'stale' });
});

for (const provenance of ['unknown', 'conflict'])
test(`${provenance} installations remain available for read-only documents without receipt promotion`, async t => {
  const f = await fixture(t), selected = await f.plugin('selected');
  if (provenance === 'conflict') await f.plugin('duplicate', 'selected');
  else {
    f.receipts.length = 0;
    await f.save();
  }
  const descriptor = { root: selected.directory, fingerprint: selected.descriptor.fingerprint, kind: 'installed',
    id: 'selected', name: 'selected', provenance };
  const catalog = await f.manager.targetCatalog({ descriptor });
  assert.equal(catalog.plugins[0].packageDescriptor.provenance, provenance);
  assert.equal(catalog.plugins[0].packageDescriptor.instance, undefined);
  assert.equal(catalog.plugins[0].marketplace, undefined);
  const library = new PluginLibrary(f.root);
  const projected = await library.project(catalog);
  assert.equal(projected.plugins[0].package!.configurationAvailable, false);
  assert.equal((await library.document({ ref: projected.plugins[0].package!.ref, path: 'README.md' })).text, '# Fixture\n');
});

test('an unknown target is revoked when matching bytes acquire a valid installation receipt', async t => {
  const f = await fixture(t), selected = await f.plugin('selected');
  f.receipts.length = 0;
  await f.save();
  const descriptor = { root: selected.directory, fingerprint: selected.descriptor.fingerprint, kind: 'installed',
    id: 'selected', name: 'selected', provenance: 'unknown' };
  assert.equal((await f.manager.targetCatalog({ descriptor })).plugins[0].packageDescriptor.provenance, 'unknown');
  f.receipts.push(selected.receipt);
  await f.save();
  await assert.rejects(f.manager.targetCatalog({ descriptor }), { code: 'stale' });
});

test('MCP target reads retain disabled declarations, global overrides and exact qualified-name collisions', async t => {
  const f = await fixture(t);
  const selected = await f.plugin('selected', 'alpha', { beta__tool: { command: 'fixture', enabled: false } });
  await f.plugin('other', 'alpha__beta', { tool: { command: 'fixture' } });
  const duplicate = await f.manager.targetCatalog({ descriptor: selected.descriptor, mcp: true });
  const rows = duplicate.mcp.filter((server: any) => server.name === 'alpha__beta__tool');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((server: any) => server.pluginId).sort(), ['alpha', 'alpha__beta']);
  assert.equal(rows.find((server: any) => server.pluginId === 'alpha').enabled, false,
    'Disabled services must still be inspectable and configurable');
  f.state.configured = { alpha__beta__tool: { command: 'user-override', enabled: false } };
  const overridden = await f.manager.targetCatalog({ descriptor: selected.descriptor, mcp: true });
  assert.equal(overridden.mcp.filter((server: any) => server.name === 'alpha__beta__tool').length, 1);
  assert.equal(overridden.mcp[0].source, 'user', 'A global executable override is not a plugin-owned consumer');
  assert.deepEqual(f.marketReads, []);
});

test('an enabled-only global override does not hide a disabled plugin-owned consumer', async t => {
  const f = await fixture(t), selected = await f.plugin('selected', 'selected', { tool: { command: 'fixture' } });
  f.state.configured = { selected__tool: { enabled: false } };
  const catalog = await f.manager.targetCatalog({ descriptor: selected.descriptor, mcp: true });
  assert.deepEqual(catalog.mcp, [{ name: 'selected__tool', source: 'plugin', pluginId: 'selected',
    pluginName: 'selected', transport: 'stdio', enabled: false, configurable: true }]);
});

test('string MCP declaration files participate in cross-plugin collision checks', async t => {
  const f = await fixture(t), selected = await f.plugin('selected', 'alpha', { beta__tool: { command: 'fixture' } });
  const other = await f.plugin('other', 'alpha__beta', 'servers.json');
  await writeFile(join(other.directory, 'servers.json'), JSON.stringify({ mcpServers: { tool: { command: 'fixture' } } }));
  const catalog = await f.manager.targetCatalog({ descriptor: selected.descriptor, mcp: true });
  assert.equal(catalog.mcp.filter((server: any) => server.name === 'alpha__beta__tool').length, 2);
});

test('available target reads query only their source and preserve issued identity without hashing the target', async t => {
  const f = await fixture(t), selected = await f.market();
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(selected.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(f.root, 'marketplaces', 'unused'), process.platform === 'win32' ? 'junction' : 'dir');
  const catalog = await f.manager.targetCatalog({ descriptor: selected.descriptor });
  assert.deepEqual(f.marketReads, [selected.checkout]);
  assert.deepEqual(catalog.plugins, []);
  assert.equal(JSON.stringify(catalog.available[0].packageDescriptor), JSON.stringify(selected.descriptor));
  assert.equal(catalog.available[0].blocked, false);
  assert.equal(f.installedReads(), 0);
});

test('available conflicts retain read-only documents without scanning other marketplaces to upgrade provenance', async t => {
  const f = await fixture(t), selected = await f.market();
  const descriptor = { ...selected.descriptor, provenance: 'conflict' };
  const catalog = await f.manager.targetCatalog({ descriptor });
  assert.equal(catalog.available[0].blocked, true);
  assert.equal(catalog.available[0].packageDescriptor.provenance, 'conflict');
  const projected = await new PluginLibrary(f.root).project(catalog);
  assert.equal(projected.available[0].package!.configurationAvailable, false);
  assert.deepEqual(f.marketReads, [selected.checkout]);
});

test('available target identity rejects source generations and same-content source replacement', async t => {
  const f = await fixture(t), selected = await f.market();
  const initialGeneration = selected.source.generation;
  selected.source.generation = randomUUID();
  await selected.saveSource();
  await assert.rejects(f.manager.targetCatalog({ descriptor: selected.descriptor }), { code: 'stale' });
  selected.source.generation = initialGeneration;
  await selected.saveSource();
  const moved = join(f.root, 'old-market');
  await rename(selected.checkout, moved);
  await cp(moved, selected.checkout, { recursive: true });
  await assert.rejects(f.manager.targetCatalog({ descriptor: selected.descriptor }), { code: 'stale' });
});

test('available target identity tracks only the selected Git checkout origin', async t => {
  const f = await fixture(t), selected = await f.market('chosen', {
    kind: 'git', origin: 'https://example.invalid/fixture/original.git',
  });
  assert.equal((await f.manager.targetCatalog({ descriptor: selected.descriptor })).available.length, 1);
  execFileSync('git', ['-C', selected.checkout, 'remote', 'set-url', 'origin', 'https://example.invalid/fixture/replaced.git'],
    { windowsHide: true });
  await assert.rejects(f.manager.targetCatalog({ descriptor: selected.descriptor }), { code: 'stale' });
  assert.deepEqual(f.marketReads, [selected.checkout], 'Changed source identity is rejected before reading package entries');
});

test('target reads reject pending recovery without changing its journal or reading plugin metadata', async t => {
  const f = await fixture(t), selected = await f.plugin('selected');
  const journal = join(f.root, 'desktop-plugins/update-transaction.json'), bytes = '{"pending":"preserve"}';
  await writeFile(journal, bytes);
  await assert.rejects(f.manager.targetCatalog({ descriptor: selected.descriptor }), { code: 'update-recovery-required' });
  assert.deepEqual(f.manifestReads, []);
  assert.equal(await readFile(journal, 'utf8'), bytes);
});

test('native available documents preserve builtin and local source identities and repository metadata', { timeout: 30000 }, async t => {
  const f = await fixture(t), runtime = join(f.root, 'test-runtime');
  const local = await f.market();
  await mkdir(join(f.root, 'agent'));
  await mkdir(runtime);
  const cached = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  for (const folder of ['step', 'node'])
    await symlink(join(cached, folder), join(runtime, folder), process.platform === 'win32' ? 'junction' : 'dir');
  for (const file of ['capability-admin.mjs', 'capability-failure.mjs', 'marketplace-refresh.mjs',
    'capability-settings.mjs', 'plugin-files.mjs', 'plugin-read-scope.mjs', 'plugin-release.mjs',
    'theme-composition.mjs', 'plugin-update.mjs', 'plugin-configuration.mjs', 'plugin-schema-update.mjs',
    'windows-runtime-job.ps1'])
    await copyFile(resolve('electron', file), join(runtime, file));
  const service = new CapabilityService({ root: f.root, runtime,
    node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(f.root) });
  try {
    await service.initialize();
    const initial = await service.catalog();
    assert.equal(initial.marketplaces.find(source => source.name === 'builtin')?.kind, 'builtin');
    await writeFile(join(f.root, 'marketplaces/builtin/playwright/README.md'), '# Native builtin fixture\n');
    const catalog = await service.catalog();
    const available = catalog.available.find(entry => entry.name === 'playwright')!;
    assert.equal(available.marketplace, 'builtin');
    const ref = available.package!.ref;
    assert.equal((await service.document({ ref, path: 'README.md' })).text, '# Native builtin fixture\n');
    const descriptor = (service as unknown as { library: PluginLibrary }).library.referenceSnapshot(ref).descriptor;
    assert.equal(descriptor.repository, 'https://github.com/microsoft/playwright-mcp');
    const localRef = catalog.available.find(entry => entry.name === 'example')!.package!.ref;
    assert.equal((await service.document({ ref: localRef, path: 'README.md' })).text, '# Available fixture\n');
    const localDescriptor = (service as unknown as { library: PluginLibrary }).library.referenceSnapshot(localRef).descriptor;
    assert.equal(localDescriptor.source, local.source.generation);
  } finally { await service.stop(); }
});
