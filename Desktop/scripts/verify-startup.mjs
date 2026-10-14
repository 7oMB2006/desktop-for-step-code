import { _electron as electron, chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

await mkdir('test-results/startup', { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'step-startup-window-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1', DESKTOP_TEST_STARTUP_WINDOW: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
  env, timeout: 60000,
});
try {
  // Hold the app module while inspecting the short-lived native splash.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const timeout = setTimeout(() => release(), 5000);
  await app.context().route('**/assets/*.js', async route => { await gate; await route.continue(); });
  const splash = await app.firstWindow();
  await splash.waitForURL('**/startup-logo.html', { timeout: 10000 });
  assert.ok(splash.url().includes('startup-logo.html'), 'first window must be the isolated splash');
  const state = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('startup-logo.html'));
    return win && { size: win.getSize(), contentSize: win.getContentSize(), shadow: win.hasShadow(), focusable: win.isFocusable(),
      preferences: win.webContents.getLastWebPreferences() };
  });
  console.log('Splash geometry', JSON.stringify({ outer: state.size, content: state.contentSize,
    viewport: await splash.evaluate(() => [innerWidth, innerHeight]) }));
  // Windows native/DIP bounds round-trips can add 1-2px in the packaged executable.
  assert.ok(state.size.every(size => Math.abs(size - 256) <= 2), 'splash remains a small 256px window');
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
  assert.equal(state.preferences.nodeIntegration, false);
  assert.equal(state.preferences.sandbox, true);
  assert.equal(state.preferences.preload, undefined);
  release();
  clearTimeout(timeout);
  const main = app.windows().find(page => page !== splash)
    ?? await app.waitForEvent('window', { predicate: page => page !== splash, timeout: 30000 });
  await main.waitForSelector('.app', { timeout: 60000 });
  await main.waitForTimeout(1000);
  assert.equal(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(win => win.webContents.getURL().includes('startup-logo.html'))), false);
  assert.equal(await main.locator('#startup').count(), 0, 'no full-window overlay remains');
  console.log('Separate splash: bridge isolation, geometry, shell handoff and disposal passed');
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await app.close();
}

// Preview the same asset without the native window lifetime cutting off capture.
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 256, height: 256 },
    recordVideo: { dir: resolve('test-results/startup'), size: { width: 256, height: 256 } },
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve('dist/renderer/startup-logo.html')).href);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('img').evaluate(img => img.naturalWidth > 0), true);
  await page.screenshot({ path: 'test-results/startup/transparent-logo.png', omitBackground: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('img').evaluate(img => getComputedStyle(img).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  await video.saveAs(resolve('test-results/startup/transparent-logo.webm'));
  console.log('Transparent pixels, logo asset and reduced motion passed');
} finally {
  await browser.close();
}
