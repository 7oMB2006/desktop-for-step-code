import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { CapabilityService } from '../electron/capability-service';
import { digest, packageFingerprint, writeReceipts } from '../electron/plugin-files.mjs';
import { PluginLibrary } from '../electron/plugin-library.mjs';
import type { RpcProcess } from '../electron/runtime';
import type { CapabilityCatalog } from '../src/capabilities';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

const { createCapabilitySettings } = await import(pathToFileURL(resolve('electron/capability-settings.mjs')).href);

type Coverage = { result: { url: string; functions: { functionName: string; ranges: { count: number }[] }[] }[] };
async function fingerprintCalls<T>(action: () => Promise<T>) {
  const session = new Session();
  session.connect();
  const post = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
  try {
    await post('Profiler.enable');
    await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const value = await action();
    const coverage = await post('Profiler.takePreciseCoverage') as Coverage;
    const calls = coverage.result.filter(script => script.url.endsWith('/plugin-files.mjs'))
      .flatMap(script => script.functions.filter(fn => fn.functionName === 'packageFingerprint'))
      .reduce((total, fn) => total + fn.ranges[0].count, 0);
    return { value, calls };
  } finally {
    await post('Profiler.stopPreciseCoverage');
    await post('Profiler.disable');
    session.disconnect();
  }
}

async function file(root: string, path: string, value: unknown) {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
}

async function fixture(t: test.TestContext) {
  const created = await mkdtemp(join(tmpdir(), 'dfsc-catalog-projection-'));
  t.after(() => removeTestProfile(created));
  const root = await realpath(created), installed = join(root, 'plugins', 'example');
  const market = join(root, 'marketplaces', 'community'), available = join(market, 'plugins', 'example');
  const manifest = { id: 'example', name: 'Example', version: '1.0.0',
    skills: [], commands: [], agents: [], mcpServers: {} };
  for (const directory of [installed, available]) {
    await file(directory, 'step.plugin.json', { ...manifest, version: directory === installed ? '1.0.0' : '1.1.0' });
    await file(directory, 'README.md', '# Guide A');
    await file(directory, 'dist/main.mjs', 'export const value = 1;');
  }
  await file(installed, 'dfsc.plugin.json', { schemaVersion: 1, desktop: {
    title: 'Example', surface: 'main-view', pages: [{ id: 'guide', title: 'Guide', document: 'README.md' }],
  } });
  await file(market, '.step-plugin/marketplace.json', { name: 'community',
    plugins: [{ name: 'example', source: 'plugins/example' }] });
  const source = { name: 'community', kind: 'local', path: market };
  const stat = await lstat(market);
  const sourceStamp = digest(JSON.stringify([source.kind, null, market, stat.dev, stat.ino, stat.birthtimeMs]));
  await writeReceipts(root, { version: 1, installations: [{
    id: manifest.id, folder: 'example', instance: randomUUID(), marketplace: source.name, source: sourceStamp,
    state: 'installed', fingerprint: await packageFingerprint(installed),
  }] });
  const upstream = {
    readStepConfig(path: string) { return JSON.parse(readFileSync(path, 'utf8')); },
    SettingsManager: { fromStorage() { return {}; } },
    DefaultPackageManager: class { async resolve() { return { skills: [] }; } },
    async listInstalledStepPlugins() { return { plugins: [{ ...manifest, rootPath: installed, mcpServers: [], warnings: [] }], warnings: [] }; },
    async listMarketplaceSources() { return [source]; },
    async listMarketplacePlugins() { return { entries: [{ name: 'example', marketplace: source.name, sourcePath: available }], warnings: [] }; },
    async discoverStepPluginResourcePaths() { return { skillPaths: [], warnings: [] }; },
    async readStepPluginManifest(directory: string) {
      return { manifest: JSON.parse(await readFile(join(directory, 'step.plugin.json'), 'utf8')), errors: [] };
    },
  };
  const withManager = async <T>(read: (manager: ReturnType<typeof createCapabilitySettings>) => Promise<T>) => {
    const keys = ['HOME', 'STEPCODE_STORAGE_ROOT_DIR', 'STEP_CODING_AGENT_DIR'] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, { HOME: root, STEPCODE_STORAGE_ROOT_DIR: root, STEP_CODING_AGENT_DIR: join(root, 'agent') });
    try { return await read(createCapabilitySettings(upstream, { root })); }
    finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  };
  return { root, installed, available,
    workerCatalog: () => withManager<CapabilityCatalog>(manager => manager.catalog()),
    workerDesktopCatalog: () => withManager<CapabilityCatalog>(manager => manager.desktopCatalog()) };
}

function serviceFor(root: string, catalog: CapabilityCatalog) {
  const requests: string[] = [];
  const service = new CapabilityService({ root, node: 'unused', runtime: 'unused', environment: () => ({}),
    createWorker: () => ({
      start() {},
      async stopManagement() {},
      async request(type: string) {
        requests.push(type);
        assert.equal(type, 'catalog');
        return structuredClone(catalog);
      },
    } as unknown as RpcProcess),
  });
  return { service, requests };
}

test('catalog keeps worker fingerprints but performs no main-process hashes for non-theme packages', async t => {
  const f = await fixture(t);
  const worker = await fingerprintCalls(f.workerCatalog);
  assert.ok(worker.calls >= 2, 'The worker still hashes installed and marketplace candidates');
  const { service, requests } = serviceFor(f.root, worker.value);
  try {
    const main = await fingerprintCalls(() => service.catalog());
    assert.equal(main.calls, 0, 'Presentation and version comparisons must not rehash non-theme packages');
    assert.deepEqual(requests, ['catalog']);
    assert.equal(main.value.plugins[0].package?.provenance, 'recorded');
    assert.equal(main.value.plugins[0].update?.status, 'available');
    assert.equal(main.value.plugins[0].update?.version, '1.1.0');
  } finally { await service.stop(); }
});

test('theme affordances still require complete matching content after the metadata probe', async t => {
  const f = await fixture(t);
  await file(f.installed, 'dfsc.theme.json', { schemaVersion: 1, renderer: 'stellar-v1' });
  const raw = await f.workerCatalog(), { service } = serviceFor(f.root, raw);
  try {
    const current = await fingerprintCalls(() => service.catalog());
    assert.ok(current.calls >= 2);
    assert.equal(current.value.plugins[0].package?.dataOnlyTheme, true);
    await file(f.installed, 'README.md', '# Guide B');
    const changed = await fingerprintCalls(() => service.catalog());
    assert.ok(changed.calls >= 2);
    assert.equal(changed.value.plugins[0].package?.dataOnlyTheme, undefined);
  } finally { await service.stop(); }
});

test('metadata snapshots do not authorize same-size tampered installed or marketplace documents', async t => {
  const f = await fixture(t), library = new PluginLibrary(f.root);
  const catalog = await library.project(await f.workerCatalog());
  const refs = [catalog.plugins[0].package!.ref, catalog.available[0].package!.ref];
  const snapshot = library.referenceSnapshot(refs[0]);
  snapshot.descriptor.fingerprint = 'b'.repeat(64);
  assert.notEqual(library.referenceSnapshot(refs[0]).descriptor.fingerprint, snapshot.descriptor.fingerprint);
  for (const [index, directory] of [f.installed, f.available].entries()) {
    const before = await lstat(join(directory, 'README.md'));
    await file(directory, 'README.md', '# Guide B');
    assert.equal((await lstat(join(directory, 'README.md'))).size, before.size);
    assert.ok(library.referenceSnapshot(refs[index]).descriptor.fingerprint);
    await assert.rejects(library.document({ ref: refs[index], path: 'README.md' }), /stale/);
    await assert.rejects(library.reference(refs[index]), /stale/);
  }
});

test('partial desktop projection preserves stable full-catalog references without authorizing background controls', async t => {
  const f = await fixture(t), library = new PluginLibrary(f.root), raw = await f.workerCatalog();
  const menu = await library.project(await f.workerDesktopCatalog(), { partial: true });
  const menuRef = menu.plugins[0].package!.ref;
  const full = await library.project(raw), installedRef = full.plugins[0].package!.ref;
  assert.equal(installedRef, menuRef, 'The real narrow menu and full worker catalog must issue the same package reference');
  const availableRef = full.available[0].package!.ref;
  const partial = await library.project({ ...raw, available: [] }, { partial: true });
  assert.equal(partial.plugins[0].package!.ref, installedRef);
  assert.ok(library.referenceSnapshot(availableRef));
  const nextFull = await library.project({ ...raw, available: [] });
  assert.equal(nextFull.plugins[0].package!.ref, installedRef);
  assert.throws(() => library.referenceSnapshot(availableRef), /stale/);
  const appearance = join(f.root, 'plugins', 'appearance');
  await file(appearance, 'README.md', '# Appearance');
  await file(appearance, 'dfsc.plugin.json', { schemaVersion: 1, desktop: {
    title: 'Appearance', surface: 'main-view', pages: [{ id: 'guide', title: 'Guide', document: 'README.md' }],
  } });
  const appearanceCatalog = { ...raw, plugins: [{ id: 'custom-background', name: 'Appearance', mcpServers: [], warnings: [],
    packageDescriptor: { root: appearance, id: 'custom-background', name: 'appearance', kind: 'installed',
      provenance: 'recorded', instance: randomUUID(), fingerprint: await packageFingerprint(appearance) } }],
    available: [] } as unknown as CapabilityCatalog;
  const projected = await fingerprintCalls(() => library.project(appearanceCatalog, { partial: true }));
  assert.equal(projected.calls, 0);
  assert.equal(projected.value.plugins[0].package?.desktop?.surface, 'main-view');
  assert.equal(projected.value.plugins[0].package?.hostConfiguration, undefined);
  assert.ok(library.referenceSnapshot(installedRef));
});

test('partial metadata cannot authorize undeclared documents or poison a later verified repository', async t => {
  const f = await fixture(t), library = new PluginLibrary(f.root);
  await file(f.installed, 'README.md', '# Guide\n[Next](docs/NEXT.md)');
  await file(f.installed, 'docs/NEXT.md', '# Next');
  await file(f.installed, 'PRIVATE.md', '# Private');
  await file(f.installed, 'SECRET.md', '# Secret');
  const metadataPath = join(f.installed, 'dfsc.plugin.json'), originalMetadata = await readFile(metadataPath);
  const expected = await packageFingerprint(f.installed);
  const plugin = { id: 'example', name: 'Example', repository: 'https://example.com/verified',
    mcpServers: [], warnings: [], packageDescriptor: { root: f.installed, fingerprint: expected,
      kind: 'installed', id: 'example', name: 'example', provenance: 'recorded', instance: randomUUID(),
      source: 'fixture', marketplace: 'fixture' } };
  const raw = { plugins: [plugin], available: [], marketplaces: [], mcp: [], skills: [], warnings: [] } as unknown as CapabilityCatalog;
  const unverified = { ...raw, plugins: [{ ...plugin, repository: 'https://example.com/unverified' }] } as unknown as CapabilityCatalog;
  const first = await library.project(unverified, { partial: true }), ref = first.plugins[0].package!.ref;
  await file(f.installed, 'dfsc.plugin.json', { schemaVersion: 1, documentation: { readme: 'PRIVATE.md' },
    desktop: { title: 'Example', surface: 'main-view',
      pages: [{ id: 'private', title: 'Private', document: 'SECRET.md' }] } });
  const tampered = await library.project(unverified, { partial: true });
  assert.equal(tampered.plugins[0].package!.ref, ref);
  assert.equal(tampered.plugins[0].package!.documentation.readme, 'PRIVATE.md');
  assert.equal(tampered.plugins[0].package!.desktop!.pages[0].document, 'SECRET.md');
  await writeFile(metadataPath, originalMetadata);
  assert.equal(await packageFingerprint(f.installed), expected);
  const full = await library.project(raw);
  assert.equal(full.plugins[0].package!.ref, ref);
  assert.equal(library.referenceSnapshot(ref).descriptor.repository, plugin.repository);
  await assert.rejects(library.document({ ref, path: 'PRIVATE.md' }), /invalid-path/);
  await assert.rejects(library.document({ ref, path: 'SECRET.md' }), /invalid-path/);
  const readme = await library.document({ ref, path: 'README.md' });
  assert.equal(readme.text, '# Guide\n[Next](docs/NEXT.md)');
  assert.equal(readme.links['docs/NEXT.md'], 'docs/NEXT.md');
  assert.equal((await library.document({ ref, path: 'docs/NEXT.md' })).text, '# Next');
});

test('partial projection retains the registry size bound and full projection still revokes absent references', async t => {
  const f = await fixture(t), library = new PluginLibrary(f.root);
  const registry = (library as unknown as { references: Map<string, unknown> }).references;
  for (let index = 0; index < 1001; index++) registry.set(`ref-${index}`, {});
  const empty: CapabilityCatalog = { plugins: [], available: [], marketplaces: [], mcp: [], skills: [], warnings: [] };
  await library.project(empty, { partial: true });
  assert.equal(registry.size, 1000);
  assert.equal(registry.has('ref-0'), false);
  await library.project(empty);
  assert.equal(registry.size, 0);
});
