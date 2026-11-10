import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CapabilityService } from '../electron/capability-service';
import { dataOnlyThemeFingerprint } from '../electron/plugin-files.mjs';
import { isolatedEnvironment } from '../electron/runtime';
import { ThemePacks } from '../electron/theme-packs';
import { hasStellarUi, resolveThemeBackground } from '../src/theme-packs';

const market = resolve('../examples/plugins/theme-starter');
const source = join(market, 'plugins/dfsc-theme-example');
const id = 'plugin:dfsc-theme-example';
// Unit checks use the header; the separate Electron acceptance verifies native decoding.
const decodePng = (bytes: Buffer) => ({ bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test('the independent v2 starter is a data-only theme with an explicit personal-image slot', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-theme-starter-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'dfsc-theme-example');
  await cp(source, folder, { recursive: true });
  assert.ok(await dataOnlyThemeFingerprint(folder, 'dfsc-theme-example'));
  const packs = new ThemePacks(root, decodePng);
  await packs.refresh();
  assert.equal(packs.packs.length, 1);
  const pack = packs.packs[0];
  assert.equal(pack.id, id);
  assert.equal(hasStellarUi(pack), false);
  assert.deepEqual(pack.composition, {
    ui: 'standard-v1', background: { renderer: 'image-v1', source: 'background.png' }, accepts: ['image-v1'],
  });
  assert.equal(packs.image(id).width, 1280);
  assert.equal(packs.image(id).height, 720);
  assert.equal(resolveThemeBackground(pack).overridden, false);
  assert.equal(resolveThemeBackground(pack, 'image-v1').overridden, true);
  assert.throws(() => packs.scene(id), /Theme unavailable/);
  const icon = await readFile(join(folder, 'icon.png'));
  assert.ok(icon.length <= 128 * 1024);
  assert.equal(icon.readUInt32BE(16), 96);
  assert.equal(icon.readUInt32BE(20), 96);
  const declaration = JSON.parse(await readFile(join(folder, 'dfsc.theme.json'), 'utf8'));
  declaration.background.accepts = [];
  await writeFile(join(folder, 'dfsc.theme.json'), JSON.stringify(declaration));
  await packs.refresh();
  assert.equal(packs.packs.length, 1, 'A new integrated theme need not accept replacements');
  assert.equal(resolveThemeBackground(packs.packs[0], 'image-v1').blocked, true);
});

test('the real marketplace manager discovers, installs and removes the unmodified starter', { timeout: 90000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-theme-starter-market-')));
  await mkdir(join(root, 'agent'));
  const runtime = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  const service = new CapabilityService({ root, runtime,
    node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(root) });
  t.after(async () => {
    await service.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await service.mutate({ action: 'marketplace-add', source: market });
  const entry = (await service.catalog()).available.find(item => item.name === 'dfsc-theme-example');
  assert.ok(entry?.package);
  await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace, ref: entry.package.ref });
  const installed = (await service.catalog()).plugins.find(item => item.id === 'dfsc-theme-example');
  assert.ok(installed);
  assert.deepEqual(installed.mcpServers, []);
  assert.deepEqual(installed.warnings, []);
  const packs = new ThemePacks(join(root, 'plugins'), decodePng);
  await packs.refresh();
  assert.equal(packs.packs[0]?.id, id);
  assert.equal(packs.image(id).width, 1280);
  await service.mutate({ action: 'plugin-remove', id: 'dfsc-theme-example' });
  await packs.refresh();
  assert.deepEqual(packs.packs, []);
});
