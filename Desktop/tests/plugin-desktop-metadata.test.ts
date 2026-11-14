import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginLibrary, parsePresentation } from '../electron/plugin-library.mjs';
import { packageFingerprint } from '../electron/plugin-files.mjs';
import type { CapabilityCatalog, PluginDesktop } from '../src/capabilities';
import { CapabilityService } from '../electron/capability-service';
import type { RpcProcess } from '../electron/runtime';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCj0AAAAASUVORK5CYII=', 'base64');
const desktop = (patch: Partial<PluginDesktop> = {}): PluginDesktop => ({
  title: 'Engineering Bridge', surface: 'main-view', symbol: 'bot', defaultPage: 'start',
  pages: [{ id: 'start', title: 'Get started', document: 'docs/start.md' },
    { id: 'connections', title: 'Connections', document: 'docs/connections.md' }], ...patch,
});
async function fixture(t: test.TestContext, validateImage?: (bytes: Buffer, maxDimension?: number) => boolean) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-plugin-desktop-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const directory = join(root, 'plugins', 'bridge');
  await mkdir(join(directory, 'docs'), { recursive: true });
  await writeFile(join(directory, 'step.plugin.json'), '{"id":"bridge","version":"0.2.0"}');
  await writeFile(join(directory, 'README.md'), '# Package guide');
  await writeFile(join(directory, 'docs/start.md'), '# Get started');
  await writeFile(join(directory, 'docs/connections.md'), '# Connections');
  const metadata = (value: unknown = desktop()) => writeFile(join(directory, 'dfsc.plugin.json'),
    JSON.stringify({ schemaVersion: 1, documentation: { readme: 'README.md' }, authors: [{ name: 'Author' }], desktop: value }));
  await metadata();
  const catalog = async (kind = 'installed', provenance = 'recorded') => {
    const plugin = { id: 'bridge', name: 'Bridge', mcpServers: [], warnings: [],
      packageDescriptor: { root: directory, fingerprint: await packageFingerprint(directory),
        id: 'bridge', name: 'bridge', kind, provenance, instance: '12345678-1234-1234-1234-123456789abc' } };
    return { plugins: kind === 'installed' ? [plugin] : [], available: kind === 'installed' ? [] : [plugin],
      marketplaces: [], mcp: [], skills: [], warnings: [] } as unknown as CapabilityCatalog;
  };
  return { root, directory, metadata, catalog, library: new PluginLibrary(root, validateImage) };
}
test('desktop presentation accepts only bounded data-only pages and supported surface hints', () => {
  for (const surface of ['main-view', 'side-panel', 'window'] as const)
    assert.deepEqual(parsePresentation({ schemaVersion: 1, desktop: desktop({ surface }) }).desktop, desktop({ surface }));
  const withoutDefault = desktop();
  delete withoutDefault.defaultPage;
  assert.equal(parsePresentation({ schemaVersion: 1, desktop: withoutDefault }).desktop?.defaultPage, undefined);
  assert.equal(parsePresentation({ schemaVersion: 1 }).desktop, undefined);
  const maximum = desktop({ pages: Array.from({ length: 8 }, (_, i) =>
    ({ id: `page-${i}`, title: `Page ${i}`, document: `docs/page-${i}.md` })), defaultPage: 'page-0' });
  assert.equal(parsePresentation({ schemaVersion: 1, desktop: maximum }).desktop?.pages.length, 8);
  const invalid: unknown[] = [null, [], {}, desktop({ title: '' }), desktop({ title: 'x'.repeat(161) }),
    desktop({ title: 'Two\nlines' }), desktop({ surface: 'iframe' as never }), desktop({ symbol: 'shell' as never }),
    desktop({ pages: [] }), desktop({ pages: Array(9).fill(desktop().pages[0]) }),
    desktop({ pages: [desktop().pages[0], desktop().pages[0]] }),
    desktop({ defaultPage: 'missing' }), desktop({ defaultPage: 'Start' }),
    { ...desktop(), script: 'console.log(1)' }, { ...desktop(), command: 'powershell.exe' },
    desktop({ pages: [{ ...desktop().pages[0], id: '../start' }] }),
    desktop({ pages: [{ ...desktop().pages[0], id: ' start ' }] }),
    desktop({ defaultPage: ' start ' }),
    desktop({ pages: [{ ...desktop().pages[0], id: 'x'.repeat(65) }] }),
    desktop({ pages: [{ ...desktop().pages[0], title: ' ' }] }),
    desktop({ pages: [{ ...desktop().pages[0], script: 'alert(1)' } as never] }),
    desktop({ icon: { light: 'assets/icon.svg' } }), desktop({ icon: { light: 'https://example.com/icon.png' } }),
    desktop({ icon: { light: '../icon.png' } }), desktop({ icon: { dark: 'dark.png' } as never }),
    desktop({ icon: { light: 'icon.png', url: 'https://example.com' } as never })];
  for (const value of invalid)
    assert.throws(() => parsePresentation({ schemaVersion: 1, desktop: value }), JSON.stringify(value));
  for (const document of ['../README.md', '/README.md', 'C:/README.md', '//host/README.md', 'docs\\start.md',
    'docs/start.md:stream', 'docs/start.md#section', 'https://example.com/start.md', 'docs/start.txt', 'docs/\nstart.md'])
    assert.throws(() => parsePresentation({ schemaVersion: 1,
      desktop: desktop({ pages: [{ ...desktop().pages[0], document }] }) }), document);
});
test('confirmation sources bind installation identity, survive updates and reject missing or broken declarations', async t => {
  const f = await fixture(t);
  const notice = { id: 'delegate', version: '1', action: 'external.delegate', policy: 'always',
    title: 'Delegate review', message: 'The agent may make mistakes.', confirmLabel: 'Continue' };
  const metadata = { schemaVersion: 1, desktop: desktop(), confirmations: [notice] };
  await writeFile(join(f.directory, 'dfsc.plugin.json'), JSON.stringify(metadata));
  let instance = '12345678-1234-1234-1234-123456789abc';
  const service = () => new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => ({
      start() {}, async stopManagement() {},
      async request() {
        const value = await f.catalog() as any;
        value.plugins[0].packageDescriptor.instance = instance;
        return value;
      },
    } as unknown as RpcProcess) });
  const first = service(), plugins = await first.confirmationPlugins();
  assert.equal(plugins.length, 1);
  const initial = await first.confirmationSource(plugins[0].ref);
  assert.deepEqual(initial.confirmations, [notice]);
  assert.deepEqual(await service().confirmationSource(initial.binding), initial);
  await writeFile(join(f.directory, 'docs/start.md'), '# Updated');
  const updated = await first.confirmationSource(initial.binding);
  assert.deepEqual(updated.binding, initial.binding);
  assert.notEqual(updated.revision, initial.revision);
  instance = '22345678-1234-1234-1234-123456789abc';
  await assert.rejects(first.confirmationSource(initial.binding), /stale/);
  instance = '12345678-1234-1234-1234-123456789abc';
  await writeFile(join(f.directory, 'dfsc.plugin.json'), JSON.stringify({ ...metadata, confirmations: [] }));
  await assert.rejects(first.confirmationSource(initial.binding), /invalid-confirmation/);
  await f.metadata();
  await assert.rejects(first.confirmationSource(initial.binding), /invalid-confirmation/);
  assert.equal((await first.confirmationPlugins()).length, 0);
});
test('only recorded installed packages expose desktop pages and authorize their documents', async t => {
  const f = await fixture(t);
  const projected = await f.library.project(await f.catalog());
  const pkg = projected.plugins[0].package!;
  assert.deepEqual(pkg.desktop, desktop());
  assert.match((await f.library.document({ ref: pkg.ref, path: 'docs/start.md' })).text, /Get started/);
  assert.match((await f.library.document({ ref: pkg.ref, path: 'docs/connections.md' })).text, /Connections/);
  assert.ok(!JSON.stringify(projected).includes(f.root));
  for (const provenance of ['unknown', 'conflict']) {
    const library = new PluginLibrary(f.root), catalog = await library.project(await f.catalog('installed', provenance));
    assert.equal(catalog.plugins[0].package?.desktop, undefined);
    await assert.rejects(library.document({ ref: catalog.plugins[0].package!.ref, path: 'docs/start.md' }), /invalid-path/);
  }
  const library = new PluginLibrary(f.root), market = await library.project(await f.catalog('available'));
  assert.equal(market.available[0].package?.desktop, undefined);
  await assert.rejects(library.document({ ref: market.available[0].package!.ref, path: 'docs/start.md' }), /invalid-path/);
});
test('read-only bridge declarations accept only the fixed main-view protocol without executable targets', () => {
  const connection = { protocol: 'agent-bridge-v1' as const };
  assert.deepEqual(parsePresentation({ schemaVersion: 1, desktop: desktop({ connection }) }).desktop?.connection, connection);
  for (const patch of [
    { connection: null }, { connection: { protocol: 'http', url: 'http://localhost' } },
    { connection: { ...connection, method: 'task.create' } }, { connection: { ...connection, profile: 'C:/private' } },
    { connection, surface: 'window' }, { connection, surface: 'side-panel' },
    { connection, defaultPage: 'connection', pages: [{ id: 'connection', title: 'Conflict', document: 'docs/start.md' }] },
  ]) assert.throws(() => parsePresentation({ schemaVersion: 1, desktop: { ...desktop(), ...patch } }));
});
test('connection guides only reference declared package pages and preserve optional defaults', () => {
  const protocol = 'agent-bridge-v1' as const;
  const pages = [...desktop().pages, { id: 'first-task', title: 'First task', document: 'docs/first-task.md' }];
  for (const guides of [undefined, {}, { setup: 'connections' },
    { setup: 'connections', firstTask: 'first-task', troubleshooting: 'start' }]) {
    const connection = { protocol, ...(guides !== undefined ? { guides } : {}) };
    assert.deepEqual(parsePresentation({ schemaVersion: 1,
      desktop: desktop({ pages, connection }) }).desktop?.connection, connection);
  }
  for (const guides of [null, [], 'start', 1, { setup: 'missing' }, { setup: 'connection' },
    { firstTask: 'https://example.com' }, { troubleshooting: '../start' }, { setup: 'docs/start.md' },
    { setup: ' start ' }, { setup: '' }, { setup: null }, { setup: undefined }, { setup: 42 },
    { setup: 'start', command: 'powershell.exe' }, { execute: 'start' }]) {
    assert.throws(() => parsePresentation({ schemaVersion: 1,
      desktop: { ...desktop({ pages }), connection: { protocol, guides } } }), JSON.stringify(guides));
  }
});
test('installed connection guide references survive safe package projection without granting extra documents', async t => {
  const f = await fixture(t);
  const connection = { protocol: 'agent-bridge-v1' as const,
    guides: { setup: 'connections', firstTask: 'start', troubleshooting: 'connections' } };
  await f.metadata(desktop({ connection }));
  const pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.deepEqual(pkg.desktop?.connection, connection);
  assert.match((await f.library.document({ ref: pkg.ref, path: 'docs/connections.md' })).text, /Connections/);
  await assert.rejects(f.library.document({ ref: pkg.ref, path: 'docs/undeclared.md' }), /invalid-path/);
  await f.metadata(desktop({ connection: { protocol: 'agent-bridge-v1',
    guides: { setup: 'missing' } } }));
  const rejected = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(rejected.desktop, undefined);
  assert.equal(rejected.author, 'Author');
  assert.equal(rejected.documentation.readme, 'README.md');
});
test('connection scope keys survive client restart but not package or installation changes, and require recorded provenance', async t => {
  const f = await fixture(t);
  await f.metadata(desktop({ connection: { protocol: 'agent-bridge-v1' } }));
  let instance = 'first-installation', provenance = 'recorded';
  const service = () => new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => ({
      start() {}, async stopManagement() {},
      async request(type: string) {
        assert.equal(type, 'catalog');
        const value = await f.catalog('installed', provenance) as any;
        value.plugins[0].packageDescriptor.instance = instance;
        return value;
      },
    } as unknown as RpcProcess),
  });
  const first = service(), firstRef = (await first.catalog()).plugins[0].package!.ref;
  const key = await first.connection(firstRef);
  assert.match(key, /^[a-f0-9]{64}$/);
  const restarted = service(), restartedRef = (await restarted.catalog()).plugins[0].package!.ref;
  assert.notEqual(restartedRef, firstRef);
  assert.equal(await restarted.connection(restartedRef), key);
  await writeFile(join(f.directory, 'docs/start.md'), '# Updated guide');
  await assert.rejects(first.connection(firstRef), /stale/);
  const updatedRef = (await first.catalog()).plugins[0].package!.ref;
  const updatedKey = await first.connection(updatedRef);
  assert.notEqual(updatedKey, key);
  instance = 'replacement-installation';
  const reinstalledRef = (await first.catalog()).plugins[0].package!.ref;
  assert.notEqual(await first.connection(reinstalledRef), updatedKey);
  provenance = 'unknown';
  const unknownRef = (await first.catalog()).plugins[0].package!.ref;
  await assert.rejects(first.connection(unknownRef), /stale/);
  assert.ok(!key.includes(f.root));
});
test('invalid optional desktop metadata preserves author and existing package documentation', async t => {
  const f = await fixture(t);
  await f.metadata(desktop({ defaultPage: 'missing' }));
  let pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(pkg.desktop, undefined);
  assert.equal(pkg.author, 'Author');
  assert.equal(pkg.documentation.readme, 'README.md');
  assert.match(pkg.warnings.join(' '), /workspace contribution/);
  assert.match((await f.library.document({ ref: pkg.ref, path: 'README.md' })).text, /Package guide/);
  await f.metadata(desktop({ pages: [{ id: 'missing', title: 'Missing', document: 'missing.md' }], defaultPage: 'missing' }));
  pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(pkg.desktop, undefined);
  assert.equal(pkg.author, 'Author');
  assert.match(pkg.warnings.join(' '), /workspace document/);
  await assert.rejects(f.library.document({ ref: pkg.ref, path: 'docs/start.md' }), /invalid-path/);
});
test('desktop documents are bounded regular files and old entry references become stale', async t => {
  const f = await fixture(t);
  let pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  await writeFile(join(f.directory, 'docs/start.md'), '# Updated start');
  await assert.rejects(f.library.document({ ref: pkg.ref, path: 'docs/start.md' }), /stale/);
  pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.match((await f.library.document({ ref: pkg.ref, path: 'docs/start.md' })).text, /Updated start/);
  await writeFile(join(f.directory, 'docs/start.md'), 'x'.repeat(256 * 1024 + 1));
  pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(pkg.desktop, undefined);
  assert.match(pkg.warnings.join(' '), /workspace document/);
  await rm(join(f.directory, 'docs/start.md'));
  await mkdir(join(f.directory, 'docs/start.md'));
  pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(pkg.desktop, undefined);
});
test('desktop documents cannot pass through a linked package directory', async t => {
  const f = await fixture(t), external = join(f.root, 'external');
  await mkdir(external);
  await writeFile(join(external, 'private.md'), '# Private');
  try { await symlink(external, join(f.directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Directory links unavailable'); return; }
    throw error;
  }
  await f.metadata(desktop({ defaultPage: 'private',
    pages: [{ id: 'private', title: 'Private', document: 'linked/private.md' }] }));
  const catalog = await f.library.project({ plugins: [{ id: 'bridge', name: 'Bridge', mcpServers: [], warnings: [],
    packageDescriptor: { root: f.directory, fingerprint: 'untrusted', id: 'bridge', kind: 'installed', provenance: 'recorded' } }],
    available: [], marketplaces: [], mcp: [], skills: [], warnings: [] } as unknown as CapabilityCatalog);
  assert.equal(catalog.plugins[0].package?.desktop, undefined);
});
test('desktop icons are native-validated bounded raster data URLs with independent dark fallback', async t => {
  const calls: { bytes: Buffer; maxDimension?: number }[] = [];
  const f = await fixture(t, (bytes, maxDimension) => { calls.push({ bytes, maxDimension }); return true; });
  await writeFile(join(f.directory, 'light.png'), png);
  await writeFile(join(f.directory, 'dark.png'), png);
  await f.metadata(desktop({ icon: { light: 'light.png', dark: 'dark.png' } }));
  let pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.deepEqual(pkg.desktop?.icon, { light: `data:image/png;base64,${png.toString('base64')}`,
    dark: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.maxDimension === 512));
  assert.ok(!JSON.stringify(pkg.desktop).includes('light.png'));
  await rm(join(f.directory, 'dark.png'));
  pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.deepEqual(pkg.desktop?.icon, { light: `data:image/png;base64,${png.toString('base64')}` });
  assert.match(pkg.warnings.join(' '), /workspace icon/);
  const noNative = new PluginLibrary(f.root);
  assert.equal((await noNative.project(await f.catalog())).plugins[0].package?.desktop?.icon, undefined);
  const rejected = new PluginLibrary(f.root, () => false);
  assert.equal((await rejected.project(await f.catalog())).plugins[0].package?.desktop?.icon, undefined);
});
test('desktop icons reject oversized, invalid-signature and oversized-dimension images without losing pages', async t => {
  const f = await fixture(t, () => true);
  const tooWide = Buffer.from(png);
  tooWide.writeUInt32BE(513, 16);
  const invalid = [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.alloc(128 * 1024 + 1),
    tooWide, Buffer.from([0, 0, 1, 0, 0, 0]), Buffer.from('not an image')];
  for (const bytes of invalid) {
    await writeFile(join(f.directory, 'icon.png'), bytes);
    await f.metadata(desktop({ icon: { light: 'icon.png' } }));
    const pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
    assert.equal(pkg.desktop?.icon, undefined);
    assert.equal(pkg.desktop?.pages.length, 2);
    assert.match(pkg.warnings.join(' '), /workspace icon/);
  }
  await f.metadata(desktop({ icon: { light: 'missing.png' } }));
  assert.equal((await f.library.project(await f.catalog())).plugins[0].package?.desktop?.icon, undefined);
});
test('desktop icons recognize only PNG JPEG WebP and ICO signatures before native validation', async t => {
  const f = await fixture(t, () => true);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const webp = Buffer.from('RIFFxxxxWEBPdata');
  const ico = Buffer.alloc(22);
  ico.writeUInt32LE(0x00010000, 0); ico.writeUInt16LE(1, 4);
  for (const [name, bytes, mime] of [['icon.png', png, 'image/png'], ['icon.jpg', jpeg, 'image/jpeg'],
    ['icon.webp', webp, 'image/webp'], ['icon.ico', ico, 'image/x-icon']] as const) {
    await writeFile(join(f.directory, name), bytes);
    await f.metadata(desktop({ icon: { light: name } }));
    assert.equal((await f.library.project(await f.catalog())).plugins[0].package?.desktop?.icon?.light,
      `data:${mime};base64,${bytes.toString('base64')}`);
  }
});
test('published schema examples match the runtime desktop contract and path constraints', async () => {
  const schema = JSON.parse(await readFile(new URL('../../docs/plugin-schemas/dfsc.plugin.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.definitions.desktop.additionalProperties, false);
  assert.equal(schema.definitions.desktop.properties.pages.minItems, 1);
  assert.equal(schema.definitions.desktop.properties.pages.maxItems, 8);
  assert.deepEqual(schema.definitions.desktop.properties.surface.enum, ['main-view', 'side-panel', 'window']);
  const guides = schema.definitions.desktop.properties.connection.properties.guides;
  assert.equal(guides.additionalProperties, false);
  assert.equal(guides.maxProperties, 3);
  assert.deepEqual(Object.keys(guides.properties), ['setup', 'firstTask', 'troubleshooting']);
  assert.ok(Object.values(guides.properties).every(value =>
    (value as { $ref: string }).$ref === '#/definitions/desktopPageId'));
  const pageId = new RegExp(schema.definitions.desktopPageId.pattern), rasterPath = new RegExp(schema.definitions.rasterPath.pattern);
  assert.ok(schema.examples.length > 0);
  for (const example of schema.examples) {
    const parsed = parsePresentation(example);
    assert.ok(parsed.desktop);
    for (const page of parsed.desktop!.pages) assert.match(page.id, pageId);
    for (const path of Object.values(parsed.desktop!.icon ?? {})) assert.match(path, rasterPath);
  }
  for (const path of ['../icon.png', '/icon.png', 'C:/icon.png', 'https://host/icon.png', 'icon.svg', 'icons\\light.png', 'x\n.png'])
    assert.ok(!rasterPath.test(path), path);
});
test('the installable resource starter ships every declared desktop page without requiring special host identity', async t => {
  const f = await fixture(t);
  const source = new URL('../../examples/plugins/resource-starter/plugins/dfsc-example/', import.meta.url);
  const value = JSON.parse(await readFile(new URL('dfsc.plugin.json', source), 'utf8'));
  const parsed = parsePresentation(value);
  assert.equal(parsed.desktop?.surface, 'main-view');
  assert.equal(parsed.desktop?.symbol, 'book');
  for (const page of parsed.desktop!.pages)
    await writeFile(join(f.directory, page.document), await readFile(new URL(page.document, source)));
  await writeFile(join(f.directory, 'dfsc.plugin.json'), JSON.stringify(value));
  const pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(pkg.desktop?.title, 'Checklist workspace');
  assert.equal(pkg.desktop?.pages.length, 3);
  assert.equal(pkg.warnings.length, 0);
  for (const page of pkg.desktop!.pages)
    assert.ok((await f.library.document({ ref: pkg.ref, path: page.document })).text.startsWith('# '));
});
