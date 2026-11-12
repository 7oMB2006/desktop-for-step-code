import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginLibrary, parsePresentation } from '../electron/plugin-library.mjs';
import { packageFingerprint } from '../electron/plugin-files.mjs';
import type { CapabilityCatalog, PluginRequirements } from '../src/capabilities';

const parse = (requirements: unknown) => parsePresentation({ schemaVersion: 1, requirements });
const desktop = {
  title: 'Example workspace', surface: 'main-view',
  pages: [{ id: 'start', title: 'Start', document: 'README.md' }],
};
async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-plugin-requirements-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const directories = {
    installed: join(root, 'plugins', 'example'),
    available: join(root, 'marketplaces', 'catalog', 'plugins', 'example'),
  };
  for (const directory of Object.values(directories)) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'step.plugin.json'), '{"id":"example","version":"1.0.0"}');
    await writeFile(join(directory, 'README.md'), '# Package guide');
  }
  const metadata = (value: Record<string, unknown>, kind: keyof typeof directories = 'installed') =>
    writeFile(join(directories[kind], 'dfsc.plugin.json'), JSON.stringify({
      schemaVersion: 1, authors: [{ name: 'Example author' }], documentation: { readme: 'README.md' }, ...value,
    }));
  const catalog = async () => {
    const plugin = async (kind: keyof typeof directories) => ({
      id: 'example', name: 'Example', mcpServers: [], warnings: [], installed: kind === 'installed', marketplace: 'catalog',
      packageDescriptor: { root: directories[kind], fingerprint: await packageFingerprint(directories[kind]),
        id: 'example', name: 'example', kind, provenance: 'recorded' },
    });
    return { plugins: [await plugin('installed')], available: [await plugin('available')],
      marketplaces: [], mcp: [], skills: [], warnings: [] } as unknown as CapabilityCatalog;
  };
  return { root, metadata, catalog, library: new PluginLibrary(root) };
}

test('requirements remain optional and distinguish undeclared dependencies from an explicit empty list', () => {
  const legacy = parsePresentation({ schemaVersion: 1, authors: [{ name: 'Existing author' }] });
  assert.equal(legacy.author, 'Existing author');
  assert.ok(!Object.hasOwn(legacy, 'requirements'));
  assert.deepEqual(parse({}).requirements, {});
  assert.deepEqual(parse({ dfsc: '>=0.6.0' }).requirements, { dfsc: '>=0.6.0' });
  assert.ok(!Object.hasOwn(parse({ dfsc: '>=0.6.0' }).requirements!, 'external'));
  assert.deepEqual(parse({ external: [] }).requirements, { external: [] });
});

test('DFSC declarations use bounded semver ranges without inventing compatibility detection', () => {
  for (const dfsc of ['>=0.6.0 <1.0.0', '^0.7.0', '~0.6.2', '0.6.x', '*',
    '0.6.0 - 0.9.0', '^0.7.0-beta.1', '>=0.6.0 || >=1.0.0', '  >=0.6.0  '])
    assert.equal(parse({ dfsc }).requirements?.dfsc, dfsc.trim(), dfsc);
  assert.equal(parse({ dfsc: `*${' '.repeat(127)}` }).requirements?.dfsc, '*');
  for (const dfsc of ['', ' ', null, 0, false, [], {}, 'latest', '>=not-a-version',
    '>=0.6.0\n', '\t>=0.6.0', 'x'.repeat(129), ` ${'*'.repeat(128)}`, `*${' '.repeat(128)}`])
    assert.throws(() => parse({ dfsc }), JSON.stringify(dfsc));
  assert.deepEqual(Object.keys(parse({ dfsc: '>=0.6.0' }).requirements!), ['dfsc']);
});

test('external dependencies preserve bounded author copy, safe HTTPS links and explicit optional flags', () => {
  const requirements: PluginRequirements = { external: [
    { name: '  External tool  ', description: '  Installed separately by the user.  ',
      url: 'https://example.com', optional: false },
    { name: 'Optional service', optional: true },
    { name: 'Runtime without a website' },
  ] };
  assert.deepEqual(parse(requirements).requirements, { external: [
    { name: 'External tool', description: 'Installed separately by the user.',
      url: 'https://example.com/', optional: false },
    { name: 'Optional service', optional: true },
    { name: 'Runtime without a website' },
  ] });
  const maximum = { external: Array.from({ length: 12 }, (_, i) =>
    ({ name: `${i}${'x'.repeat(158)}`, description: 'x'.repeat(512), optional: false })) };
  assert.equal(parse(maximum).requirements?.external?.length, 12);
});

test('requirements reject unbounded or executable dependency declarations and unsafe URLs', () => {
  for (const requirements of [null, [], 'node', { external: null }, { external: {} },
    { external: Array.from({ length: 13 }, () => ({ name: 'Tool' })) },
    { command: 'install tool' }, { probe: 'tool --version' }, { permissions: ['filesystem'] },
    { downloads: 1000 }, { external: [{ name: 'Tool', command: 'tool install' }] },
    { external: [{ name: 'Tool', detect: 'exists' }] }, { external: [{ name: 'Tool', installed: true }] }])
    assert.throws(() => parse(requirements), JSON.stringify(requirements));
  for (const item of [null, [], {}, { name: '' }, { name: ' ' }, { name: 'x'.repeat(161) },
    { name: 'Two\nlines' }, { name: 1 }, { name: 'Tool', description: '' },
    { name: 'Tool', description: 'x'.repeat(513) }, { name: 'Tool', description: 'Two\nlines' },
    { name: 'Tool', optional: 'false' }, { name: 'Tool', optional: null }, { name: 'Tool', optional: 0 }])
    assert.throws(() => parse({ external: [item] }), JSON.stringify(item));
  for (const url of ['', 'https://', 'http://example.com', 'javascript:alert(1)', 'file:///C:/tool.exe',
    'https://user:password@example.com', 'https://user@example.com', 'https://example.com\n',
    `https://example.com/${'x'.repeat(2048)}`, 1, null])
    assert.throws(() => parse({ external: [{ name: 'Tool', url }] }), JSON.stringify(url));
});

test('installed and marketplace packages project their own requirements but never author-reported download counts', async t => {
  const f = await fixture(t);
  await f.metadata({ requirements: { dfsc: '>=0.6.0', external: [] }, downloads: 1234 });
  await f.metadata({ requirements: { external: [{ name: 'External service', optional: true }] },
    downloads: 9876 }, 'available');
  const catalog = await f.library.project(await f.catalog());
  const installed = catalog.plugins[0].package!, available = catalog.available[0].package!;
  assert.deepEqual(installed.requirements, { dfsc: '>=0.6.0', external: [] });
  assert.deepEqual(available.requirements, { external: [{ name: 'External service', optional: true }] });
  for (const pkg of [installed, available]) {
    assert.equal(pkg.author, 'Example author');
    assert.ok(!Object.hasOwn(pkg, 'downloads'));
    assert.deepEqual(pkg.warnings, []);
  }
  assert.ok(!JSON.stringify(catalog).includes(f.root));
});

test('invalid optional requirements preserve existing metadata and valid desktop workspaces independently', async t => {
  const f = await fixture(t);
  await f.metadata({ requirements: { dfsc: 'latest', command: 'install' }, desktop });
  let pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(pkg.requirements, undefined);
  assert.equal(pkg.author, 'Example author');
  assert.deepEqual(pkg.desktop, desktop);
  assert.equal(pkg.documentation.readme, 'README.md');
  assert.match(pkg.warnings.join(' '), /requirements declaration/);
  assert.match((await f.library.document({ ref: pkg.ref, path: 'README.md' })).text, /Package guide/);
  await f.metadata({ requirements: { external: [] }, desktop: { ...desktop, command: 'run' } });
  pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.deepEqual(pkg.requirements, { external: [] });
  assert.equal(pkg.desktop, undefined);
  assert.equal(pkg.author, 'Example author');
  assert.match(pkg.warnings.join(' '), /workspace contribution/);
  await f.metadata({ requirements: null, desktop: null });
  pkg = (await f.library.project(await f.catalog())).plugins[0].package!;
  assert.equal(pkg.requirements, undefined);
  assert.equal(pkg.desktop, undefined);
  assert.equal(pkg.author, 'Example author');
  assert.equal(pkg.warnings.length, 2);
});

test('schema documents declarative bounds, empty-list semantics and semver host validation', async () => {
  const schema = JSON.parse(await readFile(new URL('../../docs/plugin-schemas/dfsc.plugin.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.requirements.$ref, '#/definitions/requirements');
  const requirements = schema.definitions.requirements;
  assert.equal(requirements.additionalProperties, false);
  assert.equal(requirements.properties.dfsc.maxLength, 128);
  assert.match(requirements.properties.dfsc.description, /semver/);
  assert.equal(requirements.properties.external.maxItems, 12);
  assert.match(requirements.properties.external.description, /Omitted.*empty array/);
  assert.equal(requirements.properties.external.items.additionalProperties, false);
  assert.deepEqual(requirements.properties.external.items.required, ['name']);
  assert.equal(requirements.properties.external.items.properties.optional.type, 'boolean');
  assert.equal(requirements.properties.external.items.properties.url.$ref, '#/definitions/https');
  assert.ok(!Object.hasOwn(schema.properties, 'downloads'));
  for (const example of schema.examples)
    assert.deepEqual(parsePresentation(example).requirements, example.requirements);
});
