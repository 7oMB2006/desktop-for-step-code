import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CapabilityService } from '../electron/capability-service';
import { PluginLibrary } from '../electron/plugin-library.mjs';
import { packageFingerprint } from '../electron/plugin-files.mjs';
import type { CapabilityCatalog } from '../src/capabilities';
import type { RpcProcess } from '../electron/runtime';

const { writeReceipts } = await import(pathToFileURL(resolve('electron/plugin-files.mjs')).href);

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-background-plugin-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const directory = join(root, 'plugins', 'custom-background');
  await mkdir(directory, { recursive: true });
  const manifest = { id: 'custom-background', name: 'Custom Background', version: '0.1.0',
    skills: [], commands: [], agents: [], mcpServers: {} };
  const marker = { schemaVersion: 1, provider: 'custom-background-v1' };
  await writeFile(join(directory, 'step.plugin.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'dfsc.appearance.json'), JSON.stringify(marker));
  await writeFile(join(directory, 'README.md'), '# Custom Background\n');
  const receipt = { instance: randomUUID(), folder: 'custom-background', id: manifest.id,
    source: 'fixture-source', marketplace: 'fixture', fingerprint: '', state: 'installed' };
  const record = async () => {
    receipt.fingerprint = await packageFingerprint(directory);
    await writeReceipts(root, { version: 1, installations: [receipt] });
  };
  await record();
  const descriptor = async () => ({ root: directory, fingerprint: await packageFingerprint(directory),
    id: manifest.id, kind: 'installed', provenance: 'recorded', name: receipt.folder,
    source: receipt.source, marketplace: receipt.marketplace, instance: receipt.instance });
  const catalog = async () => ({ plugins: [{ id: manifest.id, name: manifest.name, mcpServers: [], warnings: [],
    packageDescriptor: await descriptor() }], available: [], marketplaces: [], mcp: [], skills: [], warnings: [] });
  const library = new PluginLibrary(root);
  const service = new CapabilityService({ root, runtime: root, node: process.execPath, environment: () => ({}),
    createWorker: () => ({
      start() {},
      async request(type: string) {
        if (type === 'catalog') return catalog();
        if (type === 'initialize') return {};
        throw new Error(`Unexpected request: ${type}`);
      },
      async stopManagement() {},
    }) as unknown as RpcProcess });
  t.after(() => service.stop());
  const project = async () => library.project(await catalog() as unknown as CapabilityCatalog);
  return { root, directory, manifest, marker, receipt, record, descriptor, catalog, library, service, project };
}

test('recorded data-only background package exposes only the fixed host adapter', async t => {
  const f = await fixture(t), plugin = (await f.project()).plugins[0];
  assert.equal(plugin.package?.hostConfiguration, 'custom-background-v1');
  assert.equal(plugin.package?.configurationAvailable, false, 'No fabricated MCP consumer is needed');
  assert.equal(plugin.package?.dataOnlyTheme, undefined, 'A background provider is not a theme safety exemption');
  assert.deepEqual(await f.library.customBackgroundContext(plugin.package!.ref),
    { ref: plugin.package!.ref, instance: f.receipt.instance });
  assert.doesNotMatch(JSON.stringify(plugin), /fixture-source|desktop-plugins|packageDescriptor|rootPath/);
  assert.ok(!JSON.stringify(plugin).includes(f.root), 'Private package paths stay in main');
});

test('shipped background package declares its author and bounded host requirements without losing the fixed adapter', async t => {
  const f = await fixture(t);
  const source = new URL('../../theme-marketplace/plugins/custom-background/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('step.plugin.json', source), 'utf8'));
  assert.equal(manifest.version, '0.1.1');
  for (const key of ['skills', 'commands', 'agents']) assert.deepEqual(manifest[key], []);
  assert.deepEqual(manifest.mcpServers, {});
  await cp(source, f.directory, { recursive: true });
  await f.record();
  const pkg = (await f.project()).plugins[0].package!;
  assert.equal(pkg.author, 'Desktop for Step Code contributors');
  assert.deepEqual(pkg.requirements, { dfsc: '0.6.0', external: [] });
  assert.deepEqual(pkg.warnings, []);
  assert.equal(pkg.hostConfiguration, 'custom-background-v1');
  assert.equal(pkg.documentation.changelog, 'CHANGELOG.md');
  const readme = await f.library.document({ ref: pkg.ref, path: 'README.md' });
  assert.match(readme.text, /0\.6\.0[\s\S]*custom-background-v1/);
  const changelog = await f.library.document({ ref: pkg.ref, path: pkg.documentation.changelog });
  assert.match(changelog.text, /0\.1\.1/);
  assert.deepEqual(await f.library.customBackgroundContext(pkg.ref),
    { ref: pkg.ref, instance: f.receipt.instance });
  assert.ok(await f.service.customBackgroundContext());
});

test('service validates its current adapter and rejects forged or superseded references', async t => {
  const f = await fixture(t);
  const current = await f.service.customBackgroundContext();
  assert.ok(current);
  assert.equal(current.instance, f.receipt.instance);
  assert.deepEqual(await f.service.customBackgroundContext(current.ref), current);
  await assert.rejects(f.service.customBackgroundContext(randomUUID()), /capability:stale/);
  await assert.rejects(f.service.customBackgroundContext(''), /capability:invalid-input/);
  await writeFile(join(f.directory, 'README.md'), '# Changed\n');
  assert.equal(await f.service.customBackgroundContext(), undefined);
  await assert.rejects(f.service.customBackgroundContext(current.ref), /capability:stale/);
  await f.record();
  const changed = await f.service.customBackgroundContext();
  assert.ok(changed);
  assert.notEqual(changed.ref, current.ref);
  await assert.rejects(f.service.customBackgroundContext(current.ref), /capability:stale/);
});

for (const declaration of [
  {}, { schemaVersion: 2, provider: 'custom-background-v1' },
  { schemaVersion: 1, provider: 'future-background-v1' },
  { schemaVersion: 1, provider: 'custom-background-v1', entry: 'index.js' },
]) {
  test(`background adapter rejects marker ${JSON.stringify(declaration)}`, async t => {
    const f = await fixture(t);
    await writeFile(join(f.directory, 'dfsc.appearance.json'), JSON.stringify(declaration));
    await f.record();
    assert.equal((await f.project()).plugins[0].package?.hostConfiguration, undefined);
    assert.equal(await f.service.customBackgroundContext(), undefined);
  });
}

for (const extra of [
  { id: 'same-looking-background' }, { name: null }, { version: null }, { skills: undefined },
  { commands: ['commands'] }, { agents: ['agents'] }, { mcpServers: 'mcp.json' },
  { mcpServers: { server: { command: 'never-run' } } }, { entry: 'index.js' },
  { provision: {} }, { futureCapability: {} },
]) {
  test(`background adapter rejects executable or ambiguous manifest ${JSON.stringify(extra)}`, async t => {
    const f = await fixture(t);
    await writeFile(join(f.directory, 'step.plugin.json'), JSON.stringify({ ...f.manifest, ...extra }));
    await f.record();
    assert.equal((await f.project()).plugins[0].package?.hostConfiguration, undefined);
    assert.equal(await f.service.customBackgroundContext(), undefined);
  });
}

test('available, unknown and conflict packages cannot acquire host configuration by declaration or ID', async t => {
  const f = await fixture(t);
  for (const overrides of [{ kind: 'available' }, { provenance: 'unknown' }, { provenance: 'conflict' },
    { instance: undefined }, { source: 'different-source' }, { marketplace: 'different-market' },
    { name: 'different-folder' }]) {
    const raw = await f.catalog();
    raw.plugins[0].packageDescriptor = { ...raw.plugins[0].packageDescriptor, ...overrides } as never;
    const plugin = (await f.library.project(raw as unknown as CapabilityCatalog)).plugins[0];
    assert.equal(plugin.package?.hostConfiguration, undefined);
    await assert.rejects(f.library.customBackgroundContext(plugin.package!.ref), /capability:stale/);
  }
});

test('receipt revocation, replacement and duplicate identities fail closed', async t => {
  const f = await fixture(t), plugin = (await f.project()).plugins[0], ref = plugin.package!.ref;
  for (const state of ['pending', 'removing']) {
    await writeReceipts(f.root, { version: 1, installations: [{ ...f.receipt, state }] });
    await assert.rejects(f.library.customBackgroundContext(ref), /capability:stale/);
    assert.equal(await f.service.customBackgroundContext(), undefined);
  }
  await writeReceipts(f.root, { version: 1, installations: [
    f.receipt, { ...f.receipt, instance: randomUUID(), folder: 'other-background' },
  ] });
  assert.equal((await f.project()).plugins[0].package?.hostConfiguration, undefined);
  await f.record();
  await cp(f.directory, join(f.root, 'plugins', 'unrecorded-background'), { recursive: true });
  assert.equal((await f.project()).plugins[0].package?.hostConfiguration, undefined,
    'An unrecorded on-disk duplicate blocks an otherwise valid receipt');
  await assert.rejects(f.library.customBackgroundContext(ref), /capability:stale/);
});

test('multiple catalog owners cannot advertise the host adapter', async t => {
  const f = await fixture(t), raw = await f.catalog();
  raw.plugins.push({ ...raw.plugins[0] });
  const catalog = await f.library.project(raw as unknown as CapabilityCatalog);
  assert.ok(catalog.plugins.every(plugin => plugin.package?.hostConfiguration === undefined));
});

test('package edits invalidate issued adapter refs even if only an undeclared asset changes', async t => {
  const f = await fixture(t), plugin = (await f.project()).plugins[0], ref = plugin.package!.ref;
  await writeFile(join(f.directory, 'extra.txt'), 'Changed asset');
  await assert.rejects(f.library.customBackgroundContext(ref), /capability:stale/);
  assert.equal((await f.project()).plugins[0].package?.hostConfiguration, undefined);
  assert.equal(await f.service.customBackgroundContext(), undefined);
});
