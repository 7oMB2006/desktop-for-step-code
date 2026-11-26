import { _electron as electron, chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { preview } from 'vite';

await mkdir('test-results/startup', { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'step-startup-window-'));
const physical = join(root, 'physical'), alias = join(root, 'alias');
await mkdir(physical);
await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
const profile = join(alias, 'profile');
await mkdir(profile);
assert.notEqual(profile, await realpath(profile), 'Exercise a temporary profile reached through a parent alias');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', DESKTOP_TEST_STARTUP_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
  env, timeout: 60000,
});
let release;
const gate = new Promise(resolve => { release = resolve; });
try {
  // Hold the app module until the splash assertions finish. A wall-clock
  // release can close the splash midway through those checks on a slow runner.
  await app.context().route('**/assets/*.js', async route => { await gate; await route.continue(); });
  const splash = await app.firstWindow({ timeout: 10000 });
  splash.setDefaultTimeout(10000);
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), await realpath(profile),
    'Canonicalize the trusted test profile before plugin update recovery');
  await splash.waitForURL(url => url.pathname.endsWith('/startup-logo.html'), { timeout: 10000 });
  assert.ok(splash.url().includes('startup-logo.html'), 'first window must be the isolated splash');
  const state = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('startup-logo.html'));
    return win && { bounds: win.getBounds(), display: screen.getDisplayMatching(win.getBounds()).workArea, size: win.getSize(), contentSize: win.getContentSize(), shadow: win.hasShadow(), focusable: win.isFocusable(),
      alwaysOnTop: win.isAlwaysOnTop(),
      preferences: win.webContents.getLastWebPreferences() };
  });
  console.log('Splash geometry', JSON.stringify({ outer: state.size, content: state.contentSize,
    viewport: await splash.evaluate(() => [innerWidth, innerHeight]) }));
  if (process.platform === 'darwin') {
    assert.ok(Math.abs(state.bounds.x + state.bounds.width / 2 - (state.display.x + state.display.width / 2)) <= 1, 'splash centered on display horizontally');
    assert.ok(Math.abs(state.bounds.y + 128 - (state.display.y + state.display.height / 2)) <= 1, 'emblem centered on work area vertically, without Cocoa optical offset');
  }
  // Windows native/DIP bounds round-trips can add 1-2px in the packaged executable.
  assert.ok(Math.abs(state.size[0] - 360) <= 2 && state.size[1] <= 482, 'bounded local surface reserves invisible recovery space');
  const geometry = await splash.locator('img').evaluate(img => {
    const rect = img.getBoundingClientRect();
    return { width: rect.width, height: rect.height,
      centerX: rect.x + rect.width / 2 - innerWidth / 2,
      centerY: rect.y + rect.height / 2 - innerHeight / 2 };
  });
  // Use layout dimensions, independent of the temporary entrance transform.
  assert.deepEqual(await splash.locator('img').evaluate(img => [img.offsetWidth, img.offsetHeight]), [88, 88]);
  assert.ok(Math.abs(geometry.centerX) < 1, 'logo stays horizontally centered');
  assert.equal(state.shadow, false);
  assert.equal(state.focusable, false);
  assert.equal(state.alwaysOnTop, true, 'the temporary splash uses the Windows transparent overlay path');
  assert.equal(state.preferences.nodeIntegration, false);
  assert.equal(state.preferences.sandbox, true);
  // Electron's returned preferences omit the preload path. Check the exposed
  // capability surface itself, in addition to native sandbox/isolation flags.
  assert.deepEqual(await splash.evaluate(() => Object.keys(window.startupRecovery).sort()), ['command', 'subscribe']);
  assert.equal(await splash.evaluate(() => typeof window.desktop), 'undefined');
  assert.equal(await splash.evaluate(() => typeof window.require), 'undefined');
  release();
  const main = app.windows().find(page => page !== splash)
    ?? await app.waitForEvent('window', { predicate: page => page !== splash, timeout: 30000 });
  await main.waitForSelector('.app', { timeout: 60000 });
  await main.waitForTimeout(1000);
  assert.equal(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(win => win.webContents.getURL().includes('startup-logo.html'))), false);
  assert.equal(await main.locator('#startup').count(), 0, 'no full-window overlay remains');
  console.log('Separate splash: bridge isolation, geometry, shell handoff and disposal passed');
} finally {
  release();
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await app.close();
}

// Preview the same asset without the native window lifetime cutting off capture.
const server = await preview({ configFile: false, base: './', build: { outDir: 'dist/renderer' },
  preview: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
try {
  browser = await chromium.launch(process.env.DESKTOP_VERIFY_BROWSER ? { executablePath: process.env.DESKTOP_VERIFY_BROWSER } : {});
  const context = await browser.newContext({
    viewport: { width: 256, height: 256 },
    recordVideo: { dir: resolve('test-results/startup'), size: { width: 256, height: 256 } },
  });
  const page = await context.newPage();
  await page.goto(new URL('startup-logo.html', server.resolvedUrls.local[0]).href);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('img').evaluate(img => img.naturalWidth > 0), true);
  await page.screenshot({ path: 'test-results/startup/transparent-logo.png', omitBackground: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.logo').evaluate(logo => getComputedStyle(logo).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  await video.saveAs(resolve('test-results/startup/transparent-logo.webm'));
  console.log('Transparent pixels, logo asset and reduced motion passed');
  const stars = await browser.newContext({
    viewport: { width: 256, height: 256 },
    recordVideo: { dir: resolve('test-results/startup'), size: { width: 256, height: 256 } },
  });
  const stellar = await stars.newPage();
  const stellarErrors = [];
  stellar.on('pageerror', error => stellarErrors.push(error.message));
  let unblock;
  const loading = new Promise(resolve => { unblock = resolve; });
  await stellar.route('**/assets/emblem-*.js', async route => { await loading; await route.continue(); });
  const navigation = stellar.goto(new URL('startup-logo.html?material=stellar', server.resolvedUrls.local[0]).href);
  try {
    await stellar.waitForFunction(() => document.documentElement.dataset.startupMaterial === 'stellar');
    await stellar.waitForTimeout(200);
    assert.equal(await stellar.locator('img').evaluate(img => getComputedStyle(img).visibility), 'hidden',
      'even a slow WebGL import never reveals the ordinary logo');
  } finally { unblock(); }
  await navigation;
  await stellar.locator('.logo[data-ready=true]').waitFor();
  for (const [name, wait] of [['opening', 120], ['gathering', 550], ['settling', 650]]) {
    await stellar.waitForTimeout(wait);
    await stellar.screenshot({ path: `test-results/startup/stellar-${name}.png`, omitBackground: true });
  }
  await stellar.waitForFunction(() => document.documentElement.dataset.startupComplete === 'true');
  await stellar.screenshot({ path: 'test-results/startup/stellar-held.png', omitBackground: true });
  assert.deepEqual(stellarErrors, []);
  const stellarVideo = stellar.video();
  await stars.close();
  await stellarVideo.saveAs(resolve('test-results/startup/stellar-entrance.webm'));
  console.log('Stellar slow-import first frame, nonlinear entrance and settled hold captured');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
