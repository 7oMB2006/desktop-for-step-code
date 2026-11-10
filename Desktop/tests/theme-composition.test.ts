import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ThemePacks } from '../electron/theme-packs';
import type { ThemeImageDecoder } from '../electron/theme-images';
import { hasStellarUi, resolveThemeBackground, themeComposition, type ThemePack } from '../src/theme-packs';
import { normalizeTheme, registerPluginThemes, resolveTheme } from '../src/theme';
import { removeLinkEntry } from './fixtures/artifact-cleanup';

const source = resolve('../theme-marketplace/plugins/stellar-cruise');
const id = 'plugin:stellar-cruise';
const decodePng: ThemeImageDecoder = bytes => ({
  bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
});

interface Fixture {
  root: string;
  directory: string;
  service: ThemePacks;
  legacy: Record<string, any>;
  image: Buffer;
  manifest(value: unknown): Promise<void>;
}

async function fixture(run: (value: Fixture) => Promise<void>, decoder: ThemeImageDecoder | null = decodePng) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-theme-composition-')));
  const directory = join(root, 'stellar-cruise');
  try {
    await cp(source, directory, { recursive: true });
    const legacy = JSON.parse(await readFile(join(directory, 'dfsc.theme.json'), 'utf8'));
    const image = await readFile(join(directory, 'cover.png'));
    await writeFile(join(directory, 'background.png'), image);
    await run({
      root, directory, legacy, image,
      service: new ThemePacks(root, decoder ?? undefined),
      manifest: value => writeFile(join(directory, 'dfsc.theme.json'), JSON.stringify(value)),
    });
  } finally {
    registerPluginThemes([]);
    await rm(root, { recursive: true, force: true });
  }
}

function version2(legacy: Record<string, any>, background: Record<string, unknown>, ui = 'standard-v1') {
  const { renderer: _renderer, scene: _scene, cover: _cover, ...common } = legacy;
  return { ...common, schemaVersion: 2, ui: { renderer: ui }, background };
}

function lightColors() {
  const { tokens } = resolveTheme('original-light', false);
  return {
    bg: tokens['--bg'], side: tokens['--side'], surface: tokens['--surface'],
    ink: tokens['--ink'], muted: tokens['--muted'], border: tokens['--border'],
    code: tokens['--code-bg'], accent: tokens['--primary'],
  };
}

test('legacy packs retain Stellar UI and scene without accepting replacement declarations', async () => fixture(async f => {
  await f.manifest({ ...f.legacy, background: { renderer: 'image-v1', accepts: ['image-v1'] } });
  await f.service.refresh();
  assert.equal(f.service.packs.length, 1);
  const pack = f.service.packs[0];
  assert.deepEqual(themeComposition(pack), {
    ui: 'stellar-v1', background: { renderer: 'stellar-v1', source: 'scene.json' }, accepts: [],
  });
  assert.equal(hasStellarUi(pack), true);
  assert.deepEqual(resolveThemeBackground(pack), { renderer: 'stellar-v1', overridden: false, blocked: false });
  assert.deepEqual(resolveThemeBackground(pack, 'image-v1'), { renderer: 'stellar-v1', overridden: false, blocked: true });
  assert.equal(f.service.scene(id).dragons.groups.length, 2);
  assert.throws(() => f.service.image(id));
}));

test('older snapshots without composition stay closed to background overrides', async () => fixture(async f => {
  await f.service.refresh();
  const { composition: _composition, ...snapshot } = f.service.packs[0];
  assert.equal(hasStellarUi(snapshot), true);
  assert.deepEqual(themeComposition(snapshot), {
    ui: 'stellar-v1', background: { renderer: 'stellar-v1' }, accepts: [],
  });
  assert.equal(resolveThemeBackground(snapshot, 'image-v1').blocked, true);
  assert.equal(hasStellarUi(undefined), false);
}));

test('standard solid themes support readable light palettes without a scene or image decoder', async () => fixture(async f => {
  await f.manifest({
    ...version2(f.legacy, { renderer: 'solid-v1' }),
    scheme: 'light', colors: lightColors(),
  });
  await f.service.refresh();
  assert.equal(f.service.packs.length, 1);
  const pack = f.service.packs[0];
  assert.equal(pack.renderer, 'solid-v1');
  assert.equal(pack.palette.scheme, 'light');
  assert.equal(hasStellarUi(pack), false);
  assert.deepEqual(themeComposition(pack), {
    ui: 'standard-v1', background: { renderer: 'solid-v1' }, accepts: [],
  });
  assert.equal(f.service.poster(id), undefined);
  assert.throws(() => f.service.poster('plugin:unavailable'));
  assert.throws(() => f.service.scene(id));
  assert.throws(() => f.service.image(id));
  registerPluginThemes(f.service.packs);
  assert.equal(normalizeTheme(id), id);
  assert.equal(resolveTheme(id, true).scheme, 'light');
}, null));

test('static-image packs load a controlled image and use it as the optional poster fallback', async () => fixture(async f => {
  await f.manifest(version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }));
  await writeFile(join(f.directory, 'scene.json'), 'not a scene');
  await f.service.refresh();
  assert.equal(f.service.packs.length, 1);
  const pack = f.service.packs[0];
  const image = f.service.image(id);
  assert.equal(pack.renderer, 'image-v1');
  assert.equal(hasStellarUi(pack), false);
  assert.equal(image.width, f.image.readUInt32BE(16));
  assert.equal(image.height, f.image.readUInt32BE(20));
  assert.equal(image.dataUrl, `data:image/png;base64,${f.image.toString('base64')}`);
  assert.equal(f.service.poster(id), image.dataUrl);
  assert.deepEqual(resolveThemeBackground(pack), { renderer: 'image-v1', overridden: false, blocked: false });
  assert.deepEqual(resolveThemeBackground(pack, 'image-v1'), { renderer: 'image-v1', overridden: false, blocked: true });
  assert.throws(() => f.service.scene(id));
  for (const invalid of ['../../credentials', 'plugin:missing', undefined, 1])
    assert.throws(() => f.service.image(invalid));
}));

test('image replacement is explicit and does not change the selected Stellar UI', async () => fixture(async f => {
  await f.manifest(version2(f.legacy, {
    renderer: 'image-v1', source: 'background.png', accepts: ['image-v1'],
  }, 'stellar-v1'));
  await f.service.refresh();
  assert.equal(f.service.packs.length, 1);
  const pack = f.service.packs[0];
  assert.equal(hasStellarUi(pack), true);
  assert.deepEqual(themeComposition(pack), {
    ui: 'stellar-v1', background: { renderer: 'image-v1', source: 'background.png' }, accepts: ['image-v1'],
  });
  assert.deepEqual(resolveThemeBackground(pack, 'image-v1'), { renderer: 'image-v1', overridden: true, blocked: false });
  assert.equal(pack.id, id);
  assert.equal(pack.palette.scheme, 'dark');
  assert.throws(() => f.service.scene(id));
}));

test('Stellar scenes can use the standard UI adapter without implying Stellar skin', async () => fixture(async f => {
  await f.manifest(version2(f.legacy, {
    renderer: 'stellar-v1', source: 'scene.json', accepts: ['image-v1'],
  }));
  await f.service.refresh();
  assert.equal(f.service.packs.length, 1);
  const pack = f.service.packs[0];
  assert.equal(hasStellarUi(pack), false);
  assert.equal(f.service.scene(id).dragons.groups.length, 2);
  assert.deepEqual(resolveThemeBackground(pack), { renderer: 'stellar-v1', overridden: false, blocked: false });
  assert.deepEqual(resolveThemeBackground(pack, 'image-v1'), { renderer: 'image-v1', overridden: true, blocked: false });
  assert.throws(() => f.service.image(id));
}));

test('readable light palettes do not bypass the Stellar UI material restriction', async () => fixture(async f => {
  await f.manifest({
    ...version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }, 'stellar-v1'),
    scheme: 'light', colors: lightColors(),
  });
  await f.service.refresh();
  assert.equal(f.service.packs.length, 0);
  assert.throws(() => f.service.image(id));
  assert.throws(() => f.service.poster(id));
}));

test('unsupported descriptors and resource paths fail closed', async () => fixture(async f => {
  const good = version2(f.legacy, { renderer: 'image-v1', source: 'background.png' });
  for (const invalid of [
    { ...good, ui: { renderer: 'custom-css' } },
    { ...good, ui: { renderer: 'standard-v1', entry: 'skin.js' } },
    { ...good, background: { renderer: 'html-v1', source: 'background.html' } },
    { ...good, background: { renderer: 'image-v1', source: '../outside.png' } },
    { ...good, background: { renderer: 'image-v1', source: 'https://example.com/background.png' } },
    { ...good, background: { renderer: 'image-v1', source: 'background.svg' } },
    { ...good, background: { renderer: 'image-v1', source: 'background.webp' } },
    { ...good, background: { renderer: 'image-v1', source: 'background.png', accepts: ['html-v1'] } },
    { ...good, background: { renderer: 'image-v1', source: 'background.png', accepts: ['image-v1', 'image-v1'] } },
    { ...good, background: { renderer: 'image-v1', source: 'background.png', interactive: true } },
    { ...good, background: { renderer: 'solid-v1', source: 'background.png' } },
    { ...good, background: { renderer: 'stellar-v1', source: 'background.png' } },
    { ...good, renderer: 'stellar-v1' },
    { ...good, scene: 'scene.json' },
    { ...good, entry: 'background.js' },
  ]) {
    await f.manifest(invalid);
    await f.service.refresh();
    assert.equal(f.service.packs.length, 0, JSON.stringify(invalid));
    assert.throws(() => f.service.image(id));
    assert.throws(() => f.service.poster(id));
  }
}));

test('image themes cannot activate without a host image decoder', async () => fixture(async f => {
  await f.manifest(version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }));
  await f.service.refresh();
  assert.equal(f.service.packs.length, 0);
  assert.throws(() => f.service.image(id));
}, null));

test('missing, corrupt and oversized image files are rejected before the test decoder runs', async () => {
  let decoded = 0;
  await fixture(async f => {
    await f.manifest(version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }));
    await rm(join(f.directory, 'background.png'));
    await f.service.refresh();
    assert.equal(f.service.packs.length, 0);
    await writeFile(join(f.directory, 'background.png'), Buffer.from('not an image'));
    await f.service.refresh();
    assert.equal(f.service.packs.length, 0);
    await writeFile(join(f.directory, 'background.png'), Buffer.alloc(12 * 1024 * 1024 + 1));
    await f.service.refresh();
    assert.equal(f.service.packs.length, 0);
    assert.equal(decoded, 0);
  }, bytes => { decoded++; return decodePng(bytes); });
});

test('invalid header dimensions are rejected before the test decoder runs', async () => {
  let decoded = 0;
  await fixture(async f => {
    await f.manifest(version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }));
    for (const [width, height] of [[0, 1], [1, 0], [8193, 1], [1, 8193], [8192, 8192]]) {
      const image = Buffer.from(f.image);
      image.writeUInt32BE(width, 16);
      image.writeUInt32BE(height, 20);
      await writeFile(join(f.directory, 'background.png'), image);
      await f.service.refresh();
      assert.equal(f.service.packs.length, 0, `${width}x${height}`);
    }
    assert.equal(decoded, 0);
  }, bytes => { decoded++; return decodePng(bytes); });
});

test('invalid decoded dimensions cannot bypass bounded header validation', async () => fixture(async f => {
  await f.manifest(version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }));
  await f.service.refresh();
  assert.equal(f.service.packs.length, 0);
  assert.throws(() => f.service.image(id));
}, bytes => ({ bytes, width: 8193, height: 1 })));

test('changing an installed asset clears old scenes, images, covers and theme registration', async () => fixture(async f => {
  await f.service.refresh();
  assert.equal(f.service.packs.length, 1);
  assert.ok(f.service.scene(id));
  assert.ok(f.service.poster(id));
  await f.manifest({
    ...version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }, 'stellar-v1'),
    cover: 'cover.png',
  });
  await f.service.refresh();
  assert.equal(f.service.packs.length, 1);
  assert.ok(f.service.image(id));
  assert.ok(f.service.poster(id));
  assert.throws(() => f.service.scene(id));
  registerPluginThemes(f.service.packs);
  assert.equal(normalizeTheme(id), id);
  await writeFile(join(f.directory, 'background.png'), Buffer.from('damaged asset'));
  await f.service.refresh();
  registerPluginThemes(f.service.packs);
  assert.equal(f.service.packs.length, 0);
  assert.equal(normalizeTheme(id), 'system');
  assert.throws(() => f.service.scene(id));
  assert.throws(() => f.service.image(id));
  assert.throws(() => f.service.poster(id));
}));

test('linked image-theme directories are not read and cleanup preserves their external target', async () => fixture(async f => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-theme-image-external-')));
  let linked = false;
  try {
    await f.manifest(version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }));
    await cp(f.directory, outside, { recursive: true });
    await rm(f.directory, { recursive: true });
    await symlink(outside, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
    await f.service.refresh();
    assert.equal(f.service.packs.length, 0);
    assert.throws(() => f.service.image(id));
    assert.deepEqual(await readFile(join(outside, 'background.png')), f.image);
  } finally {
    if (linked) await removeLinkEntry(f.directory);
    await rm(outside, { recursive: true, force: true });
  }
}));

test('linked image files do not grant access outside the installed package', async t => fixture(async f => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-theme-image-file-')));
  const target = join(f.directory, 'background.png');
  let linked = false;
  try {
    const external = join(outside, 'private.png');
    await writeFile(external, f.image);
    await f.manifest(version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }));
    await rm(target);
    try {
      await symlink(external, target, 'file');
      linked = true;
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Windows file symlinks require Developer Mode or the symbolic-link privilege');
        return;
      }
      throw error;
    }
    await f.service.refresh();
    assert.equal(f.service.packs.length, 0);
    assert.throws(() => f.service.image(id));
    assert.deepEqual(await readFile(external), f.image);
  } finally {
    if (linked) await unlink(target);
    await rm(outside, { recursive: true, force: true });
  }
}));

test('background resolution is a pure decision and never mutates the theme declaration', () => {
  const pack: ThemePack = {
    id: 'plugin:sample', name: 'Sample', version: '1.0.0', renderer: 'solid-v1',
    palette: {
      id: 'plugin:sample', scheme: 'dark', group: 'plugin',
      name: ['Sample', 'Sample'], title: ['Sample', 'Sample'], mood: ['', ''],
      bg: '#141414', side: '#0d0d0d', surface: '#1f1f1f', ink: '#e8e8e8',
      muted: '#a4a4a4', border: '#303030', code: '#101010', accent: '#de4672',
    },
    composition: {
      ui: 'standard-v1', background: { renderer: 'solid-v1' }, accepts: ['image-v1'],
    },
  };
  const before = structuredClone(pack);
  assert.deepEqual(resolveThemeBackground(pack, 'image-v1'), { renderer: 'image-v1', overridden: true, blocked: false });
  assert.deepEqual(resolveThemeBackground(pack), { renderer: 'solid-v1', overridden: false, blocked: false });
  assert.deepEqual(pack, before);
});

test('resource revisions are stable until normalized image, cover or composition changes', async () => fixture(async f => {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJmQAAAAASUVORK5CYII=', 'base64');
  const raw = {
    ...version2(f.legacy, { renderer: 'image-v1', source: 'background.png' }),
    cover: 'cover.png',
  };
  await f.manifest(raw);
  await f.service.refresh();
  const initial = f.service.packs[0];
  assert.match(initial.revision ?? '', /^[0-9a-f]{64}$/);
  await f.service.refresh();
  assert.equal(f.service.packs[0].revision, initial.revision);

  await writeFile(join(f.directory, 'background.png'), pixel);
  await f.service.refresh();
  const imageRevision = f.service.packs[0].revision;
  assert.equal(f.service.packs[0].id, initial.id);
  assert.equal(f.service.packs[0].version, initial.version);
  assert.notEqual(imageRevision, initial.revision);
  assert.equal(f.service.image(id).dataUrl, `data:image/png;base64,${pixel.toString('base64')}`);
  await f.service.refresh();
  assert.equal(f.service.packs[0].revision, imageRevision);

  await writeFile(join(f.directory, 'cover.png'), pixel);
  await f.service.refresh();
  const coverRevision = f.service.packs[0].revision;
  assert.notEqual(coverRevision, imageRevision);
  assert.equal(f.service.poster(id), f.service.image(id).dataUrl);

  await f.manifest({ ...raw, background: { ...raw.background, accepts: ['image-v1'] } });
  await f.service.refresh();
  assert.notEqual(f.service.packs[0].revision, coverRevision);
  assert.equal(f.service.packs[0].id, initial.id);
  assert.equal(f.service.packs[0].version, initial.version);
}));

test('same-version Stellar geometry changes update the scene resource revision', async () => fixture(async f => {
  await f.service.refresh();
  const initial = f.service.packs[0];
  assert.match(initial.revision ?? '', /^[0-9a-f]{64}$/);
  const scene = structuredClone(f.service.scene(id));
  const original = scene.duck.points[0];
  scene.duck.points[0] = original === 0 ? 1 : 0;
  await writeFile(join(f.directory, 'scene.json'), JSON.stringify(scene));
  await f.service.refresh();
  assert.equal(f.service.packs[0].id, initial.id);
  assert.equal(f.service.packs[0].version, initial.version);
  assert.notEqual(f.service.packs[0].revision, initial.revision);
  assert.equal(f.service.scene(id).duck.points[0], scene.duck.points[0]);
  const next = f.service.packs[0].revision;
  await f.service.refresh();
  assert.equal(f.service.packs[0].revision, next);
}));
