import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BACKGROUND_OPTIONS, normalizeBackgroundOptions, validateBackgroundPatch,
} from '../src/custom-background';
import { CustomBackgroundStore } from '../electron/custom-background';
import { MAX_THEME_IMAGE_BYTES, type ThemeImageDecoder } from '../electron/theme-images';
import { removeLinkEntry } from './fixtures/artifact-cleanup';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const otherPixel = Buffer.from(pixel);
otherPixel[otherPixel.length - 1] ^= 1;
const decode: ThemeImageDecoder = bytes => ({ bytes, width: 1, height: 1 });
const instance = 'installation-one';

async function fixture(run: (value: { root: string; source: string; store: CustomBackgroundStore }) => Promise<void>,
  decoder: ThemeImageDecoder = decode) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-custom-background-')));
  const source = join(root, 'source.png');
  const store = new CustomBackgroundStore(root, decoder);
  try {
    await writeFile(source, pixel);
    await store.initialize();
    await store.bind(instance);
    await run({ root, source, store });
  } finally {
    await store.initialize();
    await rm(root, { recursive: true, force: true });
  }
}

test('background patches are strict, bounded and copied; startup normalization is forgiving', () => {
  const valid = { enabled: true, fit: 'contain', positionX: 0, positionY: 100, zoom: 200,
    brightness: 40, blur: 24, parallax: 12 };
  assert.deepEqual(validateBackgroundPatch(valid), valid);
  assert.notEqual(validateBackgroundPatch(valid), valid);
  assert.deepEqual(validateBackgroundPatch({ positionX: 25.5, parallax: 1.25 }), { positionX: 25.5, parallax: 1.25 });
  for (const value of [null, [], 1, 'cover', new Date(), { enabled: 1 }, { enabled: undefined },
    { fit: 'stretch' }, { zoom: 99 }, { zoom: 201 }, { brightness: 39 }, { brightness: 121 },
    { positionX: -1 }, { positionY: 101 }, { blur: -1 }, { blur: 25 }, { parallax: -1 }, { parallax: 13 },
    { zoom: NaN }, { blur: Infinity }, { enabled: true, path: 'C:\\private.png' },
    JSON.parse('{"__proto__":{"enabled":true}}')])
    assert.throws(() => validateBackgroundPatch(value), /invalid-input/);
  assert.deepEqual(normalizeBackgroundOptions({ enabled: true, fit: 'contain', brightness: 0, zoom: Infinity, extra: 1 }),
    { ...DEFAULT_BACKGROUND_OPTIONS, enabled: true, fit: 'contain' });
  const defaults = normalizeBackgroundOptions(undefined);
  defaults.enabled = true;
  assert.equal(DEFAULT_BACKGROUND_OPTIONS.enabled, false);
});

test('imports persist normalized private PNG and options across restart without exposing paths', async () => fixture(async ({ root, source, store }) => {
  assert.deepEqual(store.state(), { options: { ...DEFAULT_BACKGROUND_OPTIONS } });
  const imported = await store.importFile(source);
  assert.equal(imported.options.enabled, true);
  assert.match(imported.image!.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual([imported.image!.width, imported.image!.height], [1, 1]);
  assert.equal((await store.image(imported.image!.revision)).dataUrl, `data:image/png;base64,${pixel.toString('base64')}`);
  await store.save({ zoom: 132, blur: 3.5, positionY: 25 });
  const next = new CustomBackgroundStore(root, decode);
  assert.equal(next.isBoundTo(instance), false, 'Uninitialized storage cannot prove its binding');
  assert.equal(next.isBoundTo(), false);
  assert.deepEqual(await next.initialize(), store.state());
  assert.equal(next.isBoundTo(instance), true);
  assert.equal(next.isBoundTo(), false);
  assert.deepEqual(await next.bind(instance), store.state());
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(root, 'custom-background/state.json'), 'utf8'))).sort(),
    ['image', 'instance', 'options', 'schemaVersion']);
  assert.doesNotMatch(JSON.stringify(next.state()), /data:|source\.png|state\.json|[A-Z]:\\/);
  imported.options.enabled = false;
  imported.image!.revision = 'mutated';
  assert.equal(store.state().options.enabled, true);
  assert.notEqual(store.state().image!.revision, 'mutated');
}));

test('disable retains the asset and remove deletes only that owned asset', async () => fixture(async ({ root, source, store }) => {
  const imported = await store.importFile(source);
  const image = imported.image!;
  const directory = join(root, 'custom-background');
  const unrelated = join(directory, 'user-notes.txt');
  await writeFile(unrelated, 'keep');
  await store.save({ enabled: false, zoom: 160 });
  assert.deepEqual(store.state().image, image);
  assert.equal((await store.image(image.revision)).width, 1);
  const removed = await store.remove();
  assert.equal(removed.options.enabled, false);
  assert.equal(removed.options.zoom, 160);
  assert.equal(removed.image, undefined);
  assert.deepEqual((await readdir(directory)).sort(), ['state.json', 'user-notes.txt']);
  assert.equal(await readFile(unrelated, 'utf8'), 'keep');
  await assert.rejects(store.image(image.revision), /stale-image/);
}));

test('enable requires a present, validated image and failed enablement preserves options', async () => fixture(async ({ root, source, store }) => {
  const initial = store.state();
  await assert.rejects(store.save({ enabled: true }), /missing/);
  assert.deepEqual(store.state(), initial);
  const imported = await store.importFile(source);
  await store.save({ enabled: false, zoom: 135 });
  const previous = store.state();
  const asset = join(root, 'custom-background', `image-${imported.image!.revision}.png`);
  await unlink(asset);
  await assert.rejects(store.save({ enabled: true, zoom: 180 }), /missing/);
  assert.deepEqual(store.state(), previous);
  await writeFile(asset, 'not an image');
  await assert.rejects(store.save({ enabled: true }), /invalid/);
  assert.deepEqual(store.state(), previous);
  const restarted = new CustomBackgroundStore(root, decode);
  assert.equal((await restarted.initialize()).options.enabled, false);
}));

test('changing or removing the installation marker disables without losing image or edits', async () => fixture(async ({ root, source, store }) => {
  const original = await store.importFile(source);
  await store.save({ zoom: 150, parallax: 4 });
  assert.equal((await store.bind(instance)).options.enabled, true);
  const changed = await store.bind('installation-two');
  assert.equal(store.isBoundTo(instance), false);
  assert.equal(store.isBoundTo('installation-two'), true);
  assert.equal(changed.options.enabled, false);
  assert.equal(changed.options.zoom, 150);
  assert.deepEqual(changed.image, original.image);
  await store.save({ enabled: true });
  await store.bind();
  assert.equal(store.isBoundTo(), true);
  assert.equal(store.state().options.enabled, false);
  assert.equal(JSON.parse(await readFile(join(root, 'custom-background/state.json'), 'utf8')).instance, undefined);
  await assert.rejects(store.save({ enabled: true }), /unavailable/);
  await assert.rejects(store.importFile(source), /unavailable/);
  const next = new CustomBackgroundStore(root, decode);
  assert.equal((await next.initialize()).options.enabled, false);
  assert.equal((await next.bind('installation-three')).options.enabled, false);
  assert.deepEqual(next.state().image, original.image);
}));

test('failed imports and invalid patches preserve prior image, enablement and options', async () => fixture(async ({ root, source, store }) => {
  await store.importFile(source);
  await store.save({ zoom: 145, enabled: false });
  const previous = store.state();
  const bad = join(root, 'bad.png');
  await writeFile(bad, 'not an image');
  for (const path of [bad, 'relative.png', `${source}.svg`, source.replace(/source\.png$/u, 'missing.jpg')])
    await assert.rejects(store.importFile(path), /invalid-image/);
  const large = join(root, 'large.png');
  await writeFile(large, Buffer.alloc(MAX_THEME_IMAGE_BYTES + 1));
  await assert.rejects(store.importFile(large), /invalid-image/);
  await assert.rejects(store.save({ zoom: 40 }), /invalid-input/);
  assert.deepEqual(store.state(), previous);
  const restarted = new CustomBackgroundStore(root, decode);
  assert.deepEqual(await restarted.initialize(), previous);
}));

test('JPEG extensions are normalized and signature mismatches never reach the decoder', async () => {
  let calls = 0;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x11, 0xff, 0xd9]);
  await fixture(async ({ root, source, store }) => {
    for (const extension of ['jpg', 'jpeg', 'JPEG']) {
      const file = join(root, `input.${extension}`);
      await writeFile(file, jpeg);
      const imported = await store.importFile(file);
      assert.equal((await store.image(imported.image!.revision)).dataUrl, `data:image/png;base64,${pixel.toString('base64')}`);
    }
    const before = calls;
    const mismatch = join(root, 'mismatch.jpg');
    await writeFile(mismatch, pixel);
    await assert.rejects(store.importFile(mismatch), /invalid-image/);
    assert.equal(calls, before);
    await writeFile(source, jpeg);
    await assert.rejects(store.importFile(source), /invalid-image/);
    assert.equal(calls, before);
  }, bytes => { calls++; return { bytes: bytes[0] === 0xff ? pixel : bytes, width: 1, height: 1 }; });
});

test('import, edit and remove serialize and reject stale revisions', async () => fixture(async ({ root, source, store }) => {
  const second = join(root, 'second.png');
  await writeFile(second, otherPixel);
  const first = await store.importFile(source);
  const imported = store.importFile(second);
  const saved = store.save({ brightness: 75, zoom: 180 });
  await Promise.all([imported, saved]);
  assert.notEqual(store.state().image!.revision, first.image!.revision);
  assert.equal(store.state().options.brightness, 75);
  await assert.rejects(store.image(first.image!.revision), /stale-image/);
  assert.deepEqual((await readdir(join(root, 'custom-background'))).filter(name => name.endsWith('.png')),
    [`image-${store.state().image!.revision}.png`]);
  const pendingImport = store.importFile(source);
  const removed = store.remove();
  await Promise.all([pendingImport, removed]);
  assert.equal(store.state().image, undefined);
  assert.equal(store.state().options.enabled, false);
  assert.equal(store.state().options.zoom, 180);
  const restarted = new CustomBackgroundStore(root, decode);
  assert.deepEqual(await restarted.initialize(), store.state());
}));

test('queued edits are copied and an installation change defeats later enablement', async () => fixture(async ({ root, source, store }) => {
  await store.importFile(source);
  const patch = { zoom: 142 };
  const edited = store.save(patch);
  patch.zoom = 199;
  await edited;
  assert.equal(store.state().options.zoom, 142);
  const imported = store.importFile(source);
  const unbound = store.bind();
  const enabled = store.save({ enabled: true });
  await Promise.all([imported, unbound]);
  await assert.rejects(enabled, /unavailable/);
  assert.equal(store.state().options.enabled, false);
  const restarted = new CustomBackgroundStore(root, decode);
  assert.deepEqual(await restarted.initialize(), store.state());
}));

test('an atomic state-write failure preserves the prior asset and removes its own candidate', async () => fixture(async ({ root, source, store }) => {
  const first = await store.importFile(source);
  const directory = join(root, 'custom-background');
  await unlink(join(directory, 'state.json'));
  await mkdir(join(directory, 'state.json'));
  const next = join(root, 'next.png');
  await writeFile(next, otherPixel);
  await assert.rejects(store.importFile(next), /storage/);
  await assert.rejects(store.save({ zoom: 190 }), /storage/);
  await assert.rejects(store.remove(), /storage/);
  await assert.rejects(store.bind('installation-rejected'), /storage/);
  assert.deepEqual(store.state(), first);
  assert.deepEqual((await readdir(directory)).sort(), [`image-${first.image!.revision}.png`, 'state.json'].sort());
  assert.equal((await store.image(first.image!.revision)).width, 1);
}));

test('interrupted image candidates are repaired on import, including after restart and UI removal', async () => {
  for (const damaged of [Buffer.alloc(0), pixel.subarray(0, 20), Buffer.alloc(MAX_THEME_IMAGE_BYTES + 1)]) {
    await fixture(async ({ root, source }) => {
      const directory = join(root, 'custom-background');
      const revision = createHash('sha256').update(pixel).digest('hex');
      const asset = join(directory, `image-${revision}.png`);
      await writeFile(asset, damaged);
      const restarted = new CustomBackgroundStore(root, decode);
      await restarted.initialize();
      await restarted.remove();
      const imported = await restarted.importFile(source);
      assert.equal(imported.image!.revision, revision);
      assert.equal(imported.options.enabled, true);
      assert.deepEqual(await readFile(asset), pixel);
      assert.deepEqual((await readdir(directory)).sort(), [`image-${revision}.png`, 'state.json']);
      assert.deepEqual(await restarted.importFile(source), imported);
    });
  }
});

test('repairing a committed damaged image survives a later metadata-write failure', async () => fixture(async ({ root, source, store }) => {
  const first = await store.importFile(source);
  const directory = join(root, 'custom-background');
  const asset = join(directory, `image-${first.image!.revision}.png`);
  await writeFile(asset, pixel.subarray(0, 20));
  const restarted = new CustomBackgroundStore(root, decode);
  assert.equal((await restarted.initialize()).issue, 'invalid');
  await unlink(join(directory, 'state.json'));
  await mkdir(join(directory, 'state.json'));
  await assert.rejects(restarted.importFile(source), /storage/);
  assert.deepEqual(await readFile(asset), pixel);
  assert.equal((await restarted.image(first.image!.revision)).width, 1);
  assert.deepEqual(restarted.state(), first);
  assert.deepEqual((await readdir(directory)).sort(), [`image-${first.image!.revision}.png`, 'state.json']);
}));

test('candidate directory links are not repaired or followed and abandoned temporary files stay untouched', async () => fixture(async ({ root, source, store }) => {
  const directory = join(root, 'custom-background');
  const revision = createHash('sha256').update(pixel).digest('hex');
  const asset = join(directory, `image-${revision}.png`);
  const abandoned = join(directory, 'image-interrupted.tmp');
  await writeFile(abandoned, 'partial');
  await mkdir(asset);
  await assert.rejects(store.importFile(source), /storage/);
  assert.equal(store.state().image, undefined);
  await rm(asset, { recursive: true });
  const external = join(root, 'external-candidate');
  await mkdir(external);
  await writeFile(join(external, 'keep.txt'), 'untouched');
  await symlink(external, asset, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(store.importFile(source), /storage/);
    assert.equal(await readFile(join(external, 'keep.txt'), 'utf8'), 'untouched');
  } finally { await removeLinkEntry(asset); }
  await store.importFile(source);
  assert.equal(await readFile(abandoned, 'utf8'), 'partial');
  assert.deepEqual((await readdir(directory)).sort(), [`image-${revision}.png`, 'image-interrupted.tmp', 'state.json'].sort());
}));

test('missing, corrupt and malformed startup state fail closed without losing valid selections', async () => fixture(async ({ root, source, store }) => {
  const first = await store.importFile(source);
  await store.save({ zoom: 155 });
  const directory = join(root, 'custom-background');
  const asset = join(directory, `image-${first.image!.revision}.png`);
  await unlink(asset);
  let restarted = new CustomBackgroundStore(root, decode);
  let loaded = await restarted.initialize();
  assert.equal(loaded.issue, 'missing');
  assert.deepEqual(loaded.image, first.image);
  assert.equal(loaded.options.zoom, 155);
  await assert.rejects(restarted.image(first.image!.revision), /missing/);
  await writeFile(asset, 'damaged');
  restarted = new CustomBackgroundStore(root, decode);
  loaded = await restarted.initialize();
  assert.equal(loaded.issue, 'invalid');
  await writeFile(join(directory, 'state.json'), '{"schemaVersion":99}');
  restarted = new CustomBackgroundStore(root, decode);
  assert.deepEqual(await restarted.initialize(), { options: { ...DEFAULT_BACKGROUND_OPTIONS }, issue: 'invalid' });
}));

test('native decoder failures preserve prior data and reveal no decoder details', async () => {
  let rejecting = false;
  await fixture(async ({ root, source, store }) => {
    const first = await store.importFile(source);
    rejecting = true;
    await assert.rejects(store.importFile(source), error => {
      assert.equal((error as Error).message, 'custom-background:invalid-image');
      return true;
    });
    assert.deepEqual(store.state(), first);
    const restarted = new CustomBackgroundStore(root, bytes => {
      if (rejecting) throw new Error('private decoder path');
      return decode(bytes);
    });
    assert.equal((await restarted.initialize()).issue, 'invalid');
    await assert.rejects(restarted.image(first.image!.revision), /^Error: custom-background:invalid$/);
  }, bytes => {
    if (rejecting) throw new Error('private decoder path');
    return decode(bytes);
  });
});

test('private-directory links never read, write or remove external files', async t => fixture(async ({ root, source, store }) => {
  const first = await store.importFile(source);
  const directory = join(root, 'custom-background');
  const external = join(root, 'external');
  await mkdir(external);
  const sentinel = join(external, 'state.json');
  await writeFile(sentinel, 'private sentinel');
  await rm(directory, { recursive: true });
  try { await symlink(external, directory, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Directory links are unavailable'); return; }
    throw error;
  }
  try {
    await assert.rejects(store.save({ zoom: 170 }), /storage/);
    await assert.rejects(store.remove(), /storage/);
    await assert.rejects(store.importFile(source), /storage/);
    assert.deepEqual(store.state(), first);
    assert.equal(await readFile(sentinel, 'utf8'), 'private sentinel');
  } finally { await removeLinkEntry(directory); }
}));

test('private state-leaf directory links are refused even when file links require privileges', async t => fixture(async ({ root, source, store }) => {
  const first = await store.importFile(source);
  const state = join(root, 'custom-background/state.json');
  const external = join(root, 'external-state');
  await mkdir(external);
  const sentinel = join(external, 'private.txt');
  await writeFile(sentinel, 'keep');
  await unlink(state);
  try { await symlink(external, state, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Directory links are unavailable'); return; }
    throw error;
  }
  try {
    await assert.rejects(store.importFile(source), /storage/);
    await assert.rejects(store.save({ blur: 5 }), /storage/);
    await assert.rejects(store.remove(), /storage/);
    assert.deepEqual(store.state(), first);
    const restarted = new CustomBackgroundStore(root, decode);
    assert.equal((await restarted.initialize()).issue, 'storage');
    assert.equal(await readFile(sentinel, 'utf8'), 'keep');
  } finally { await removeLinkEntry(state); }
}));

test('a replaced private directory cannot become a new write target in a live store', async () => fixture(async ({ root, source, store }) => {
  const first = await store.importFile(source);
  const directory = join(root, 'custom-background');
  await rm(directory, { recursive: true });
  await mkdir(directory);
  const sentinel = join(directory, 'keep.txt');
  await writeFile(sentinel, 'untouched');
  await assert.rejects(store.importFile(source), /storage/);
  await assert.rejects(store.save({ zoom: 170 }), /storage/);
  assert.deepEqual(store.state(), first);
  assert.deepEqual(await readdir(directory), ['keep.txt']);
}));

test('linked selected files and linked private images are refused without deleting their targets', async t => fixture(async ({ root, source, store }) => {
  const linked = join(root, 'linked.png');
  try { await symlink(source, linked, 'file'); }
  catch (error: any) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('File links are unavailable'); return; }
    throw error;
  }
  try { await assert.rejects(store.importFile(linked), /invalid-image/); }
  finally { await unlink(linked); }
  const imported = await store.importFile(source);
  const asset = join(root, 'custom-background', `image-${imported.image!.revision}.png`);
  await unlink(asset);
  await symlink(source, asset, 'file');
  try {
    await assert.rejects(store.image(imported.image!.revision), /storage/);
    await store.remove();
    assert.deepEqual(await readFile(source), pixel);
  } finally { await unlink(asset); }
}));
