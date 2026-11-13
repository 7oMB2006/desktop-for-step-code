import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { join, resolve } from 'node:path';

const build = resolve(process.argv[2] || '');
const output = resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) throw new Error('Pass the isolated build and evidence directories');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const root = join(profile, 'step-runtime');
const plugins = join(root, 'plugins');
const sample = resolve('../theme-marketplace/plugins/stellar-cruise');
const original = JSON.parse(await readFile(join(sample, 'dfsc.theme.json'), 'utf8'));
await mkdir(plugins, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'plugin:image-png', language: 'en', workspaces: [] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
  models: [{ id: 'fixture', name: 'Offline theme verification', contextWindow: 32768, maxTokens: 1024 }],
} } }));
for (const [id, renderer, source, ui = 'standard-v1'] of [
  ['image-png', 'image-v1', 'background.png'],
  ['image-jpeg', 'image-v1', 'background.jpg'],
  ['stellar-image', 'image-v1', 'background.png', 'stellar-v1'],
  ['stellar-solid', 'solid-v1', undefined, 'stellar-v1'],
  ['legacy', 'stellar-v1', 'scene.json', 'stellar-v1'],
]) {
  const folder = join(plugins, id);
  await cp(sample, folder, { recursive: true });
  await writeFile(join(folder, 'step.plugin.json'), JSON.stringify({
    id, name: id, version: '1.0.0', skills: [], commands: [], agents: [],
  }));
  const { renderer: _renderer, scene: _scene, ...metadata } = original;
  await writeFile(join(folder, 'dfsc.theme.json'), JSON.stringify(id === 'legacy'
    ? { ...original, name: id }
    : { ...metadata, schemaVersion: 2, name: id, ui: { renderer: ui },
      background: { renderer, ...(source ? { source } : {}), accepts: ['image-v1'] } }));
  if (source === 'background.png') await cp(join(sample, 'cover.png'), join(folder, source));
}
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.DESKTOP_DEV_URL;
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE || resolve('node_modules/electron/dist/electron.exe');
const errors = [];
let app, page;
async function launch() {
  app = await electron.launch({ executablePath, args: [join(build, 'main.cjs')], cwd: build, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('**/renderer/index.html');
  await page.waitForFunction(() => Boolean(window.desktop), { timeout: 60000 });
  await page.evaluate(() => window.desktop.finishFirstRun('skipped'));
  await page.reload();
  await page.locator('.sidebar-settings').waitFor({ timeout: 60000 });
}
async function select(id) {
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: id, exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(id => document.documentElement.dataset.palette === `plugin:${id}`, id);
}
async function imageReady() {
  await page.waitForFunction(() => {
    const image = document.querySelector('.theme-workspace-image');
    return image?.complete && image.naturalWidth > 0;
  });
}
try {
  await launch();
  await imageReady();
  assert.equal((await page.evaluate(() => window.desktopTheme.firstFrame())).palette, 'plugin:image-png');
  const png = await page.evaluate(() => window.desktop.themeImage('plugin:image-png'));
  assert.match(png.dataUrl, /^data:image\/png;base64,/);
  const jpeg = await app.evaluate(({ nativeImage }, data) =>
    nativeImage.createFromDataURL(data).toJPEG(85).toString('base64'), png.dataUrl);
  await writeFile(join(plugins, 'image-jpeg/background.jpg'), Buffer.from(jpeg, 'base64'));
  await app.close(); app = undefined;
  await launch();
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.themePacks.length, 5, `Both native image formats and Stellar combinations must load: ${snapshot.themePacks.map(pack => pack.id)}`);
  for (const id of ['image-png', 'image-jpeg', 'stellar-image']) {
    await select(id);
    await imageReady();
    const image = await page.evaluate(id => window.desktop.themeImage(`plugin:${id}`), id);
    assert.equal(image.width, png.width);
    assert.equal(image.height, png.height);
    assert.match(image.dataUrl, /^data:image\/png;base64,/);
    assert.equal(await page.locator('.stellar-workspace-scene').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), id === 'stellar-image' ? 'stellar' : undefined);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(output, `${id}.png`) });
  }
  await select('stellar-solid');
  assert.equal(await page.locator('.stellar-workspace-scene, .theme-workspace-background').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), 'stellar');
  await select('legacy');
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  assert.equal(await page.locator('.theme-workspace-image').count(), 0);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).themePacks.find(pack => pack.id === 'plugin:legacy').composition.accepts.length, 0);
  await select('stellar-image');
  await imageReady();
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.locator('.theme-pack.is-selected').getByLabel('Animate theme', { exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.themeMotion === false);
  await page.waitForFunction(() => document.querySelector('.theme-pack.is-selected input[type=checkbox]')?.checked === false);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.themeMotion, false);
  assert.equal(await page.evaluate(async () => {
    try { await window.desktop.themeImage('../../outside'); return false; } catch { return true; }
  }), true);
  await app.close(); app = undefined;
  await launch();
  await imageReady();
  assert.equal((await page.evaluate(() => window.desktopTheme.firstFrame())).palette, 'plugin:stellar-image');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.themeMotion, false);
  await page.setViewportSize({ width: 760, height: 880 });
  await page.screenshot({ path: join(output, 'stellar-image-narrow.png') });
  await app.close(); app = undefined;
  // Only this test-owned plugin is removed; the user's installation is never opened.
  await rm(join(plugins, 'stellar-image'), { recursive: true });
  await launch();
  assert.equal((await page.evaluate(() => window.desktopTheme.firstFrame())).palette, 'original-dark');
  assert.equal(await page.locator('.theme-workspace-background, .stellar-workspace-scene').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ passed: true, profile, formats: ['png', 'jpeg'], errors }, null, 2));
  console.log(JSON.stringify({ passed: true, profile, formats: ['png', 'jpeg'], errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { await app?.close(); }
