import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const output = resolve(process.argv[2] || '');
const executablePath = process.env.DESKTOP_VERIFY_EXE || resolve('node_modules/electron/dist/electron.exe');
if (!process.argv[2]) throw new Error('Pass evidence directory');
await mkdir(output, { recursive: true });
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
delete env.STEP_API_KEY;
const launch = () => electron.launch({ executablePath, args: [resolve('dist/main.cjs')],
  cwd: resolve(process.env.DESKTOP_TEST_APP_CWD || '.'), env, timeout: 60000 });
let app, page;
try {
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', error => console.error('renderer:', error.message));
  await page.waitForURL('**/renderer/index.html');
  await page.locator('.sidebar-bottom > button').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.desktop), { timeout: 60000 });
  const market = resolve('../theme-marketplace');
  await page.evaluate(async source => {
    await window.desktop.capabilityMutate({ action: 'marketplace-add', source });
    await window.desktop.capabilityMutate({ action: 'plugin-install', name: 'stellar-cruise', marketplace: 'dfsc-themes' });
  }, market);
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.preferences.theme, 'original-dark');
  assert.equal(snapshot.themePacks[0].id, 'plugin:stellar-cruise');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '星辰巡航', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'plugin:stellar-cruise');
  await page.getByLabel('星海动态背景').click();
  await page.waitForFunction(() => document.querySelector('.theme-pack-toggle input')?.checked === false);
  await page.getByLabel('背景亮度').fill('65');
  await page.waitForFunction(() => document.querySelector('.theme-pack-brightness output')?.textContent === '65%');
  assert.match(await page.evaluate(() => window.desktop.themePoster('plugin:stellar-cruise')), /^data:image\/png;base64,/);
  const active = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(active.preferences.themeMotion, false);
  assert.equal(active.preferences.themeBrightness, 65);
  assert.ok((await page.evaluate(() => window.desktop.themeScene('plugin:stellar-cruise'))).dragons.groups.length === 2);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => (document.querySelector('.terminal-heading-output')?.textContent?.trim().length ?? 0) > 3);
  await page.screenshot({ path: join(output, 'electron-welcome.png') });
  await app.close(); app = undefined;
  app = await launch();
  page = await app.firstWindow();
  await page.waitForURL('**/renderer/index.html');
  await page.locator('.sidebar-bottom > button').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.desktop));
  const restored = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(restored.preferences.theme, 'plugin:stellar-cruise');
  assert.equal(restored.preferences.themeMotion, false);
  assert.equal(restored.preferences.themeBrightness, 65);
  const bootstrap = await page.evaluate(() => window.desktopTheme.firstFrame());
  assert.equal(bootstrap.palette, 'plugin:stellar-cruise');
  await page.evaluate(() => window.desktop.capabilityMutate({ action: 'plugin-remove', id: 'stellar-cruise' }));
  await page.waitForFunction(() => document.documentElement.dataset.palette === 'original-dark');
  assert.equal(await page.locator('.theme-stellar-stage').count(), 0);
  const saved = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.equal(saved.theme, 'original-dark');
  console.log(JSON.stringify({ passed: true, profile, firstFrame: bootstrap }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'electron-failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 3000));
    console.error(await page.locator('button').evaluateAll(buttons => buttons.map(b => [b.getAttribute('aria-label'), b.textContent]).slice(-25)));
  }
  throw error;
} finally { await app?.close(); }
