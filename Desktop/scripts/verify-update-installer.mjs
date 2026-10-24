import { _electron as electron } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

await mkdir('test-results', { recursive: true });
const output = await build({ entryPoints: ['tests/fixtures/update-installer-harness.tsx'], bundle: true, write: false,
  outdir: 'test-results', platform: 'browser', format: 'iife', jsx: 'automatic' });
const js = output.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = output.outputFiles.find(file => file.path.endsWith('.css')).text;
const env = { ...process.env, DESKTOP_TEST_USER_DATA: await mkdtemp(join(tmpdir(), 'step-update-ui-')), DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env });
const errors = [];
try {
  const windowPromise = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ width: 780, height: 660, show: false, focusable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.setOpacity(0); window.setIgnoreMouseEvents(true);
    await window.loadURL('about:blank'); window.showInactive();
  });
  const page = await windowPromise;
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: `${css}\n.test-update-settings{width:min(540px,calc(100vw - 48px));margin:32px auto} .test-update-settings h3{font-size:14px;margin-bottom:24px}` });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.evaluate(platform => { window.fixturePlatform = platform; }, process.platform);
  await page.addScriptTag({ content: js });
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  const progress = page.getByRole('progressbar', { name: '更新下载进度' });
  await progress.waitFor();
  assert.equal(await progress.getAttribute('value'), '42');
  assert.equal(await page.getByRole('button', { name: '检查更新' }).isEnabled(), false);
  assert.equal(await page.getByRole('combobox', { name: '更新通道' }).isEnabled(), false);
  await page.screenshot({ path: 'test-results/updater-download-dark.png' });
  await page.getByRole('button', { name: '取消下载' }).click();
  await page.getByText('下载已取消', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  assert.equal(await page.evaluate(() => window.updateHarness.downloads), 2);
  await page.evaluate(() => window.updateHarness.set({ status: 'ready', percent: 100 }));
  await page.getByRole('button', { name: '重启并安装' }).waitFor();
  assert.equal(await page.evaluate(() => window.updateHarness.installs), 0, 'download completion cannot install');
  await page.screenshot({ path: 'test-results/updater-ready-dark.png' });
  await page.getByRole('button', { name: '重启并安装' }).click();
  await page.getByRole('alert').filter({ hasText: '仍有任务' }).waitFor();
  assert.equal(await page.evaluate(() => window.updateHarness.installs), 0);
  await page.evaluate(() => { window.updateHarness.blocked = false; });
  await page.getByRole('button', { name: '重启并安装' }).click();
  await page.getByText('正在准备重启安装…', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.updateHarness.installs), 1);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.updateHarness.set({ status: 'error', error: 'integrity' }); });
  await page.getByText('安装包校验失败，请重新下载。', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/updater-error-light.png' });
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  await page.evaluate(() => { window.updateHarness.set({ status: 'downloading', percent: 42 }); });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'about:blank').setSize(440, 720); });
  await page.getByRole('progressbar').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/updater-download-narrow.png' });
  assert.deepEqual(errors, []);
  console.log('Update UI acceptance passed: progress, cancel/retry, ready, blocked install, failure, narrow layout.');
} finally { await closeDesktopFixture(app); }
