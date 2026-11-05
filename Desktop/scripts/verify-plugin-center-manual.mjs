import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

assert.equal(process.argv[2], '--output');
assert.ok(isAbsolute(process.argv[3] ?? ''));
assert.equal(process.argv.length, 4);
const output = resolve(process.argv[3]), profile = join(output, 'manual-preview-profile');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: join(output, 'win-unpacked/Desktop for Step Code.exe'),
  args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  env, timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.desktop));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  assert.equal((await app.evaluate(({ app }) => app.getPath('userData'))).replaceAll('\\', '/'), profile.replaceAll('\\', '/'));
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.getByRole('button', { name: '配置 Bilibili Video Research', exact: true }).click();
  assert.equal(await page.getByLabel('BVR 运行目录', { exact: true }).inputValue(), join(output, 'bvr-runtime'));
  await page.getByRole('button', { name: '检查环境', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Node.js/ }).waitFor();
  assert.equal(await page.locator('.pc-plugin-identity img').evaluate(image => image.naturalWidth > 0), true);
  await page.getByRole('tab', { name: '能力', exact: true }).click();
  assert.match(await page.locator('.pc-detail-content').innerText(), /bilibili-video-research__bvr/u);
  await page.getByRole('tab', { name: '配置', exact: true }).click();
  await page.screenshot({ path: join(output, 'acceptance/manual-preview.png'), animations: 'disabled' });
  const configuration = await page.evaluate(() => window.desktop.bvrConfiguration());
  assert.equal(configuration.mode, 'dfsc');
  assert.equal(configuration.hasApiKey, false);
  const runtime = JSON.parse(await readFile(join(output, 'bvr-runtime/package.json'), 'utf8'));
  assert.equal(runtime.dfscConfigurationVersion, 1);
  assert.deepEqual(errors, []);
} finally { await closeDesktopFixture(app); }
await assert.rejects(access(join(profile, 'step-runtime/bvr/host.json')), /ENOENT/u);
await writeFile(join(output, 'acceptance/manual-preview-app.json'), JSON.stringify({
  realPackagedExecutable: true, isolatedProfile: profile, realProviderRequests: false,
  checks: ['prepared BVR installed', 'current configuration UI', 'matching runtime environment check',
    'rendered icon', 'capability page', 'no saved API key copied', 'descriptor cleaned on quit'],
}, null, 2) + '\n');
console.log('Prepared BVR profile passed against the shipped executable; no model request or copied account.');
