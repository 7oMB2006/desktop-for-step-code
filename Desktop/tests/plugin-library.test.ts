import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginLibrary, parsePresentation } from '../electron/plugin-library.mjs';
import type { CapabilityCatalog } from '../src/capabilities';

const files = await import(pathToFileURL(resolve('electron/plugin-files.mjs')).href);
const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCj0AAAAASUVORK5CYII=', 'base64');
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-plugin-library-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const directory = join(root, 'plugins', 'example');
  await mkdir(join(directory, 'docs'), { recursive: true });
  await writeFile(join(directory, 'step.plugin.json'), '{"id":"same-id","version":"1.0.0"}');
  await writeFile(join(directory, 'README.md'), '# Guide\n\n[Next](docs/next.md#section)\n![Local](image.png)\n![Remote](https://tracker.invalid/image.png)');
  await writeFile(join(directory, 'docs', 'next.md'), '# Section\n\n[Back](../README.md)');
  await writeFile(join(directory, 'image.png'), icon);
  const descriptor = async () => ({ root: directory, fingerprint: await files.packageFingerprint(directory),
    id: 'same-id', kind: 'installed', provenance: 'unknown', name: 'example' });
  const catalog = async () => ({ plugins: [{ id: 'same-id', name: 'Example', mcpServers: [], warnings: [],
    packageDescriptor: await descriptor() }], available: [], marketplaces: [], mcp: [], skills: [], warnings: [] }) as unknown as CapabilityCatalog;
  return { root, directory, library: new PluginLibrary(root), catalog };
}
test('versioned metadata bounds lists and derives tutorial platform from URL', () => {
  const parsed = parsePresentation({ schemaVersion: 1, authors: [{ name: 'Author' }], maintainers: [{ name: 'Adapter' }],
    tutorials: [{ title: 'Guide', url: 'https://www.bilibili.com/video/test/', creator: 'Creator', kind: 'community', source: 'Wrong' }] });
  assert.equal(parsed.author, 'Author');
  assert.equal(parsed.maintainer, 'Adapter');
  assert.equal(parsed.tutorials[0].source, 'Bilibili');
  for (const value of [{ schemaVersion: 2 }, { schemaVersion: 1, authors: Array(9).fill({ name: 'A' }) },
    { schemaVersion: 1, documentation: { readme: '../secret.md' } },
    { schemaVersion: 1, links: [{ title: 'A', url: 'https://user:password@example.com' }] }])
    assert.throws(() => parsePresentation(value));
});
test('catalog returns opaque stable references, not private package paths or document bodies', async t => {
  const { library, root, catalog } = await fixture(t);
  const first = await library.project(await catalog());
  assert.doesNotMatch(JSON.stringify(first), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(first.plugins[0].package?.documentation.readme, 'README.md');
  assert.equal(first.plugins[0].package?.provenance, 'unknown');
  assert.deepEqual(await library.project(await catalog()), first);
  assert.doesNotMatch(JSON.stringify(first), /# Guide|packageDescriptor/);
});
test('documents are on-demand, images local-only, relative navigation authorized and references invalidated', async t => {
  const { library, directory, catalog } = await fixture(t);
  const first = await library.project(await catalog()), ref = first.plugins[0].package!.ref;
  await assert.rejects(library.document({ ref, path: 'docs/next.md' }), /invalid-path/);
  const guide = await library.document({ ref, path: 'README.md' });
  assert.equal(guide.links['docs/next.md#section'], 'docs/next.md#section');
  assert.equal(guide.images['image.png'], `data:image/png;base64,${icon.toString('base64')}`);
  assert.equal(Object.keys(guide.images).length, 1);
  assert.match((await library.document({ ref, path: 'docs/next.md' })).text, /# Section/);
  for (const path of ['../README.md', 'C:/private.md', '//server/file.md', 'README.md:secret', 'docs\\next.md'])
    await assert.rejects(library.document({ ref, path }));
  await writeFile(join(directory, 'README.md'), '# Changed');
  await assert.rejects(library.document({ ref, path: 'README.md' }), /stale/);
  const next = await library.project(await catalog());
  assert.notEqual(next.plugins[0].package!.ref, ref);
  library.invalidate();
  await assert.rejects(library.document({ ref: next.plugins[0].package!.ref, path: 'README.md' }), /stale/);
});
test('bad optional metadata falls back to installed README without breaking native catalog', async t => {
  const { library, directory, catalog } = await fixture(t);
  for (const value of ['{bad JSON', '{"schemaVersion":88}', ' '.repeat(65537)]) {
    await writeFile(join(directory, 'dfsc.plugin.json'), value);
    const result = await library.project(await catalog());
    assert.equal(result.plugins[0].id, 'same-id');
    assert.equal(result.plugins[0].package?.documentation.readme, 'README.md');
    assert.equal(result.plugins[0].package?.warnings.length, 1);
  }
});
test('junction resources are rejected and two equal runtime IDs never share document references', async t => {
  const { library, root, directory, catalog } = await fixture(t);
  const other = join(root, 'marketplaces', 'other', 'example');
  await mkdir(other, { recursive: true });
  await writeFile(join(other, 'README.md'), '# Other source');
  const base = await catalog();
  const result = await library.project({ ...base, available: [{ name: 'example', marketplace: 'other', installed: false,
    packageDescriptor: { root: other, fingerprint: await files.packageFingerprint(other), id: 'same-id',
      kind: 'available', provenance: 'recorded', source: 'other' } } as never] });
  const ref = result.available[0].package!.ref;
  assert.notEqual(ref, result.plugins[0].package!.ref);
  assert.equal((await library.document({ ref, path: 'README.md' })).text, '# Other source');
  await symlink(other, join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(files.packageFingerprint(directory), /invalid-path/);
});
test('installation receipts retain only host-owned identity and interrupted states', async t => {
  const { root } = await fixture(t);
  const receipt = files.installationReceipt({ name: 'example' }, { kind: 'git', name: 'community',
    origin: 'https://github.com/owner/market' }, { id: 'same-id' }, 'a'.repeat(64));
  await files.writeReceipts(root, { version: 1, installations: [receipt] });
  assert.equal((await files.readReceipts(root)).installations[0].state, 'pending');
  receipt.state = 'installed';
  await files.writeReceipts(root, { version: 1, installations: [receipt] });
  assert.deepEqual((await files.readReceipts(root)).installations, [receipt]);
  await writeFile(join(root, 'desktop-plugins/installations.json'), '{"version":99,"installations":[]}');
  await assert.rejects(files.readReceipts(root), /storage/);
});
test('document images reject missing, oversized, invalid and excessive resources without remote fetches', async t => {
  const { root, directory, catalog } = await fixture(t);
  const oversized = Buffer.alloc(1024 * 1024 + 1);
  icon.copy(oversized);
  await writeFile(join(directory, 'oversized.png'), oversized);
  const dimensions = Buffer.from(icon);
  dimensions.writeUInt32BE(4097, 16);
  await writeFile(join(directory, 'dimensions.png'), dimensions);
  await writeFile(join(directory, 'broken.jpg'), Buffer.from([0xff, 0xd8, 0, 0]));
  await writeFile(join(directory, 'README.md'),
    '![Missing](missing.png)\n![Large](oversized.png)\n![Wide](dimensions.png)\n![Broken](broken.jpg)');
  const strict = new PluginLibrary(root, () => false);
  const rejected = await strict.project(await catalog());
  assert.deepEqual((await strict.document({ ref: rejected.plugins[0].package!.ref, path: 'README.md' })).images, {});
  const paths = Array.from({ length: 10 }, (_, index) => `screenshot-${index}.png`);
  for (const path of paths) await writeFile(join(directory, path), icon);
  await writeFile(join(directory, 'README.md'), paths.map(path => `![Screenshot](${path})`).join('\n'));
  const library = new PluginLibrary(root), current = await library.project(await catalog());
  assert.equal(Object.keys((await library.document({ ref: current.plugins[0].package!.ref, path: 'README.md' })).images).length, 8);
  const padded = Buffer.alloc(700 * 1024);
  icon.copy(padded);
  for (const path of paths) await writeFile(join(directory, path), padded);
  const bounded = await library.project(await catalog());
  assert.equal(Object.keys((await library.document({ ref: bounded.plugins[0].package!.ref, path: 'README.md' })).images).length, 5);
});
