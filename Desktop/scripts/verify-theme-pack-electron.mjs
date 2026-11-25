import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const output = resolve(process.argv[2] || '');
const executablePath = process.env.DESKTOP_VERIFY_EXE || resolve('node_modules/electron/dist/electron.exe');
const stock = process.argv.includes('--stock-v1.0.0');
if (stock && !process.env.DESKTOP_VERIFY_EXE) throw new Error('Pass the released Windows executable in DESKTOP_VERIFY_EXE');
if (!process.argv[2]) throw new Error('Pass evidence directory');
await mkdir(output, { recursive: true });
const market = resolve(process.env.DESKTOP_THEME_MARKETPLACE || '../theme-marketplace');
const index = JSON.parse(await readFile(join(market, '.step-plugin/marketplace.json'), 'utf8'));
const entry = index.plugins.find(plugin => plugin.name === 'stellar-cruise');
assert.ok(entry, 'Selected marketplace must contain stellar-cruise');
const packRoot = resolve(market, entry.source);
const manifest = JSON.parse(await readFile(join(packRoot, 'step.plugin.json'), 'utf8'));
const profile = await mkdtemp(join(output, 'electron-profile-'));
await mkdir(join(profile, 'step-runtime'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'original-dark', language: 'zh', workspaces: [] }));
await writeFile(join(profile, 'step-runtime/config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'step-runtime/models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
  models: [{ id: 'fixture', name: 'Offline theme acceptance', contextWindow: 32768, maxTokens: 1024 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.DESKTOP_DEV_URL;
delete env.ELECTRON_RUN_AS_NODE;
for (const name of ['STEP_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN']) delete env[name];
const launch = () => electron.launch({ executablePath, args: stock ? [] : [resolve('.')],
  cwd: resolve(process.env.DESKTOP_TEST_APP_CWD || '.'), env, timeout: 60000 });
let app, page;
try {
  app = await launch();
  if (stock) assert.deepEqual(await app.evaluate(({ app }) => [app.isPackaged, app.getVersion()]), [true, '1.0.0']);
  page = await app.firstWindow();
  page.on('pageerror', error => console.error('renderer:', error.message));
  await page.waitForURL('**/renderer/index.html');
  await page.locator('.sidebar-settings').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.desktop), { timeout: 60000 });
  await page.evaluate(async ({ source, marketplace }) => {
    await window.desktop.capabilityMutate({ action: 'marketplace-add', source });
    await window.desktop.capabilityMutate({ action: 'plugin-install', name: 'stellar-cruise', marketplace });
  }, { source: market, marketplace: index.name });
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.preferences.theme, 'original-dark');
  assert.equal(snapshot.themePacks[0].id, 'plugin:stellar-cruise');
  assert.equal(snapshot.themePacks[0].version, manifest.version);
  const presentation = JSON.parse(await readFile(join(packRoot, 'dfsc.plugin.json'), 'utf8'));
  if (presentation.documentation) {
    const installed = await page.evaluate(async () => (await window.desktop.capabilityCatalog()).plugins.find(p => p.id === 'stellar-cruise'));
    assert.ok(installed?.package?.ref);
    for (const path of Object.values(presentation.documentation)) {
      const document = await page.evaluate(input => window.desktop.pluginDocument(input), { ref: installed.package.ref, path });
      assert.equal(document.text.replace(/\r\n/g, '\n'), (await readFile(join(packRoot, path), 'utf8')).replace(/\r\n/g, '\n'));
    }
  }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const name of ['scene.json', 'cover.png', 'icon.png', 'dfsc.theme.json', 'dfsc.plugin.json', 'step.plugin.json'])
    assert.equal(hash(await readFile(join(profile, 'step-runtime/plugins', entry.name, name))), hash(await readFile(join(packRoot, name))), name);
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '星辰巡航', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'plugin:stellar-cruise');
  const taskMap = page.getByRole('checkbox', { name: '推进清单星图', exact: true });
  if (stock) assert.equal(await taskMap.count(), 0);
  else {
    assert.equal(await taskMap.isChecked(), true);
    await assert.rejects(page.evaluate(() => window.desktop.preferences({ stellarTaskMap: 'false' })), /Invalid task map preference/);
    await taskMap.click();
    await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.stellarTaskMap === false);
  }
  assert.equal(await page.getByLabel('星海动态背景').isChecked(), true);
  await page.getByLabel('星海动态背景').click();
  await page.waitForFunction(() => document.querySelector('.theme-pack-toggle input')?.checked === false);
  await page.getByLabel('背景亮度').fill('65');
  await page.waitForFunction(() => document.querySelector('.theme-pack-brightness output')?.textContent === '65%');
  assert.match(await page.evaluate(() => window.desktop.themePoster('plugin:stellar-cruise')), /^data:image\/png;base64,/);
  const active = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(active.preferences.themeMotion, false);
  assert.equal(active.preferences.themeBrightness, 65);
  assert.equal(active.preferences.stellarTaskMap, stock ? undefined : false);
  assert.ok((await page.evaluate(() => window.desktop.themeScene('plugin:stellar-cruise'))).dragons.groups.length === 2);
  await page.getByRole('button', { name: '内置浏览器', exact: true }).click();
  const profiles = page.locator('.bs-profile');
  await profiles.first().locator('summary').click();
  await profiles.first().getByRole('textbox', { name: '要打开的域名', exact: true }).waitFor();
  assert.equal(await profiles.count(), 2);
  await page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => (document.querySelector('.terminal-heading-output')?.textContent?.trim().length ?? 0) > 3);
  await page.screenshot({ path: join(output, 'electron-welcome.png') });
  await app.close(); app = undefined;
  app = await launch();
  page = await app.firstWindow();
  await page.waitForURL('**/renderer/index.html');
  await page.locator('.sidebar-settings').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.desktop));
  const restored = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(restored.preferences.theme, 'plugin:stellar-cruise');
  assert.equal(restored.preferences.themeMotion, false);
  assert.equal(restored.preferences.themeBrightness, 65);
  assert.equal(restored.preferences.stellarTaskMap, stock ? undefined : false);
  const bootstrap = await page.evaluate(() => window.desktopTheme.firstFrame());
  assert.equal(bootstrap.palette, 'plugin:stellar-cruise');
  await page.evaluate(() => window.desktop.capabilityMutate({ action: 'plugin-remove', id: 'stellar-cruise' }));
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'original-dark');
  assert.equal(await page.locator('.theme-stellar-stage').count(), 0);
  const saved = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.equal(saved.theme, 'original-dark');
  console.log(JSON.stringify({ passed: true, stock, themeVersion: snapshot.themePacks[0].version, profile, firstFrame: bootstrap }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'electron-failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 3000));
    console.error(await page.locator('button').evaluateAll(buttons => buttons.map(b => [b.getAttribute('aria-label'), b.textContent]).slice(-25)));
  }
  throw error;
} finally { await app?.close(); }
