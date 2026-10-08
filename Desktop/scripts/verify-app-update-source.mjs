import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Opt-in live check; never part of CI, never uses a personal profile or downloads an executable.
const profile = await mkdtemp(join(tmpdir(), 'desktop-live-update-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'light', language: 'zh', workspaces: [], autoCheckUpdates: false,
}));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  // A local test can explicitly opt into the host's temporary proxy; production never assumes it exists.
  if (process.argv.includes('--local-proxy')) await app.evaluate(({ session }) =>
    session.defaultSession.setProxy({ proxyRules: 'http://127.0.0.1:7897', proxyBypassRules: '<-loopback>' }));
  await page.waitForFunction(() => Boolean(window.desktop));
  const result = await page.evaluate(() => window.desktop.checkUpdates());
  if (result.release) assert.ok(result.release.url.startsWith('https://github.com/7oMB2006/desktop-for-step-code/releases/tag/'));
  console.log(JSON.stringify({ currentVersion: result.currentVersion, status: result.status,
    latestVersion: result.release?.version, prerelease: result.release?.prerelease,
    installer: result.release?.installer?.name, source: result.source, checkedAt: result.checkedAt, error: result.error, retryAt: result.retryAt }, null, 2));
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '版本更新', exact: true }).click();
  const updates = page.getByRole('region', { name: '应用更新' });
  await updates.waitFor();
  await updates.scrollIntoViewIfNeeded();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/app-updates-live-github.png' });
  assert.notEqual(result.status, 'error', `Live check failed: ${result.error}`);
  assert.ok(['current', 'available', 'no-release'].includes(result.status));
} finally { await app.close(); }
