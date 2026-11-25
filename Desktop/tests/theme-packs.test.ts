import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ThemePacks, validateScene } from '../electron/theme-packs';
import { registerPluginThemes, normalizeTheme, resolveTheme, themePreferencePatch } from '../src/theme';
import { themeBrightnessPatch } from '../src/theme-packs';
import { resolveThemeMaterial } from '../src/theme-material';
import { dataOnlyThemeFingerprint, packageFingerprint } from '../electron/plugin-files.mjs';
import { PluginLibrary, parsePresentation } from '../electron/plugin-library.mjs';
import type { CapabilityCatalog } from '../src/capabilities';
import { removeLinkEntry } from './fixtures/artifact-cleanup';

const source = resolve('../theme-marketplace/plugins/stellar-cruise');
test('source theme metadata and documents remain a complete data-only package', async () => {
  const root = await realpath(source);
  const fingerprint = await dataOnlyThemeFingerprint(root, 'stellar-cruise');
  assert.match(fingerprint!, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, await packageFingerprint(root));
  const manifest = JSON.parse(await readFile(join(root, 'step.plugin.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
  const presentation = parsePresentation(JSON.parse(await readFile(join(root, 'dfsc.plugin.json'), 'utf8')));
  assert.equal(presentation.author, '7oMB2006');
  assert.deepEqual(presentation.requirements, { dfsc: '^1.0.0', external: [] });
  assert.deepEqual(presentation.documentation, { readme: 'README.md', changelog: 'CHANGELOG.md' });
  const library = new PluginLibrary(await realpath(resolve(root, '../..')));
  const catalog = { plugins: [{ id: manifest.id, name: manifest.name, version: manifest.version, mcpServers: [], warnings: [],
    packageDescriptor: { root, fingerprint, id: manifest.id, kind: 'installed', provenance: 'recorded', name: manifest.name } }],
    available: [], marketplaces: [], mcp: [], skills: [], warnings: [] } as unknown as CapabilityCatalog;
  const pack = (await library.project(catalog)).plugins[0].package!;
  assert.deepEqual(pack.warnings, []);
  const readme = await library.document({ ref: pack.ref, path: 'README.md' });
  assert.match(readme.images['cover.png'], /^data:image\/png;base64,/);
  assert.match(readme.text, /0\.2\.0/);
  assert.match((await library.document({ ref: pack.ref, path: 'CHANGELOG.md' })).text, /0\.2\.0/);
  await assert.rejects(library.document({ ref: pack.ref, path: 'scene.json' }), /invalid-path/);
});
async function fixture(run: (root: string, service: ThemePacks) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-theme-test-'));
  try {
    await cp(source, join(root, 'stellar-cruise'), { recursive: true });
    await run(root, new ThemePacks(root));
  } finally { registerPluginThemes([]); await rm(root, { recursive: true, force: true }); }
}
test('installed pack registers without changing default; original artwork remains data', async () => fixture(async (_root, service) => {
  await service.refresh();
  assert.equal(service.packs.length, 1);
  assert.equal(service.packs[0].author, '7oMB2006');
  assert.equal(service.packs[0].hasCover, true);
  assert.equal(resolveThemeMaterial(service.packs, 'plugin:stellar-cruise'), 'stellar');
  assert.equal(resolveThemeMaterial([{ ...service.packs[0], renderer: 'image-v1',
    composition: { ui: 'stellar-v1', background: { renderer: 'image-v1' }, accepts: [] },
  }], 'plugin:stellar-cruise'), 'stellar', 'material follows the UI, not the background renderer');
  assert.equal(resolveThemeMaterial([{ ...service.packs[0],
    composition: { ui: 'standard-v1', background: { renderer: 'stellar-v1' }, accepts: [] },
  }], 'plugin:stellar-cruise'), undefined, 'a stellar background alone does not select stellar chrome');
  assert.equal(resolveThemeMaterial(service.packs, 'dark'), undefined);
  assert.equal(resolveThemeMaterial([], 'plugin:stellar-cruise'), undefined);
  assert.match(service.poster('plugin:stellar-cruise')!, /^data:image\/png;base64,/);
  assert.throws(() => service.poster('../../credentials'));
  registerPluginThemes(service.packs);
  assert.equal(normalizeTheme('system'), 'system');
  assert.equal(normalizeTheme('plugin:stellar-cruise'), 'plugin:stellar-cruise');
  assert.equal(resolveTheme('plugin:stellar-cruise', false).scheme, 'dark');
  assert.equal(themePreferencePatch({ theme: 'plugin:stellar-cruise' }).theme, 'plugin:stellar-cruise');
  const scene = service.scene('plugin:stellar-cruise');
  assert.equal(scene.dragons.groups.length, 2);
  assert.ok(scene.duck.points.length > 100);
  assert.throws(() => service.scene('../../credentials'));
}));
test('removing a pack unregisters it and releases scene data', async () => fixture(async (root, service) => {
  await service.refresh();
  await rm(join(root, 'stellar-cruise'), { recursive: true });
  await service.refresh();
  registerPluginThemes(service.packs);
  assert.equal(normalizeTheme('plugin:stellar-cruise'), 'system');
  assert.equal(resolveThemeMaterial(service.packs, 'plugin:stellar-cruise'), undefined);
  assert.throws(() => themePreferencePatch({ theme: 'plugin:stellar-cruise' }));
  assert.throws(() => service.scene('plugin:stellar-cruise'));
  assert.throws(() => service.poster('plugin:stellar-cruise'));
}));
test('brightness patches accept bounded integers only', () => {
  assert.equal(themeBrightnessPatch(undefined), undefined);
  for (const value of [40, 65, 90, 120]) assert.equal(themeBrightnessPatch(value), value);
  for (const value of [null, '90', NaN, Infinity, 39, 121, 90.5]) assert.throws(() => themeBrightnessPatch(value));
});
test('stellar materials reject readable light palettes and clear previously loaded data', async () => fixture(async (root, service) => {
  const { readFile } = await import('node:fs/promises');
  const path = join(root, 'stellar-cruise', 'dfsc.theme.json');
  const good = JSON.parse(await readFile(path, 'utf8'));
  await service.refresh();
  assert.equal(service.packs.length, 1);
  registerPluginThemes(service.packs);
  assert.equal(normalizeTheme('plugin:stellar-cruise'), 'plugin:stellar-cruise');
  const light = resolveTheme('original-light', false);
  await writeFile(path, JSON.stringify({ ...good, scheme: 'light', colors: {
    bg: light.tokens['--bg'], side: light.tokens['--side'], surface: light.tokens['--surface'],
    ink: light.tokens['--ink'], muted: light.tokens['--muted'], border: light.tokens['--border'],
    code: light.tokens['--code-bg'], accent: light.tokens['--primary'],
  } }));
  await service.refresh();
  assert.equal(service.packs.length, 0);
  registerPluginThemes(service.packs);
  assert.equal(normalizeTheme('plugin:stellar-cruise'), 'system');
  assert.throws(() => themePreferencePatch({ theme: 'plugin:stellar-cruise' }));
  assert.throws(() => service.scene('plugin:stellar-cruise'));
  assert.throws(() => service.poster('plugin:stellar-cruise'));
}));
test('bad or missing covers do not disable a valid theme', async () => fixture(async (root, service) => {
  const { readFile } = await import('node:fs/promises');
  const path = join(root, 'stellar-cruise', 'dfsc.theme.json');
  const good = JSON.parse(await readFile(path, 'utf8'));
  for (const cover of ['../secret.png', 'https://example.com/cover.png', undefined]) {
    await writeFile(path, JSON.stringify({ ...good, cover }));
    await service.refresh();
    assert.equal(service.packs.length, 1);
    assert.equal(service.poster('plugin:stellar-cruise'), undefined);
  }
  await writeFile(path, JSON.stringify(good));
  for (const data of [Buffer.from('not png'), Buffer.alloc(513 * 1024)]) {
    await writeFile(join(root, 'stellar-cruise', 'cover.png'), data);
    await service.refresh();
    assert.equal(service.packs.length, 1);
    assert.equal(service.poster('plugin:stellar-cruise'), undefined);
  }
}));
test('unknown schema, traversal and unreadable palette are rejected', async () => fixture(async (root, service) => {
  const { readFile } = await import('node:fs/promises');
  const path = join(root, 'stellar-cruise', 'dfsc.theme.json');
  const good = JSON.parse(await readFile(path, 'utf8'));
  for (const invalid of [
    { ...good, schemaVersion: 2 }, { ...good, renderer: 'arbitrary-js' },
    { ...good, scene: '../secret.json' }, { ...good, colors: { ...good.colors, ink: good.colors.bg } },
  ]) {
    await writeFile(path, JSON.stringify(invalid));
    await service.refresh();
    assert.equal(service.packs.length, 0);
  }
}));
test('malformed geometry is rejected before rendering', async () => fixture(async (_root, service) => {
  await service.refresh();
  const original = service.scene('plugin:stellar-cruise');
  for (const mutate of [
    (s: any) => { s.dragons.stride = 0; },
    (s: any) => { s.duck.points[0] = Infinity; },
    (s: any) => { s.dragons.groups[0].palette = []; },
    (s: any) => { s.dragons.groups[0].eye.rx = 0; },
  ]) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => validateScene(value));
  }
}));
test('linked plugin directories are not read', async () => fixture(async (root, service) => {
  const outside = await mkdtemp(join(tmpdir(), 'dfsc-theme-external-'));
  const link = join(root, 'linked');
  let created = false;
  try {
    await cp(source, outside, { recursive: true });
    await rm(join(root, 'stellar-cruise'), { recursive: true });
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    created = true;
    await service.refresh();
    assert.equal(service.packs.length, 0);
  } finally {
    // Remove the link entry before its target: a dangling junction makes the
    // fixture's recursive rm fail on Windows and can mask the real result.
    if (created) await removeLinkEntry(link);
    await rm(outside, { recursive: true, force: true });
  }
}));
test('missing and malformed packages leave the built-in themes available', async () => fixture(async (root, service) => {
  await writeFile(join(root, 'stellar-cruise', 'scene.json'), '{broken');
  await mkdir(join(root, 'unrelated-plugin'));
  await service.refresh();
  registerPluginThemes(service.packs);
  assert.equal(service.packs.length, 0);
  assert.equal(normalizeTheme('original-dark'), 'original-dark');
}));
