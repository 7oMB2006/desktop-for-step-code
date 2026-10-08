import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'desktop-appearance-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [], autoCheckUpdates: false }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [resolve('.')], env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); const win = BrowserWindow.getAllWindows()[0]; win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1280, 960); });
  await page.waitForFunction(() => {
    const button = document.querySelector('.new-chat');
    return button && !button.disabled;
  });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('region', { name: '文字与排版' }).waitFor();
  return page;
}
try {
  let page = await launch();
  const body = page.locator('.appearance-preview .message-body');
  assert.equal(await body.evaluate(el => getComputedStyle(el).fontSize), '15px');
  await page.screenshot({ path: 'test-results/appearance-default-light.png' });
  await page.locator('.appearance-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/appearance-default-preview.png' });
  await page.getByRole('spinbutton', { name: '正文字号', exact: true }).fill('18');
  await page.getByRole('spinbutton', { name: '正文字号', exact: true }).press('Enter');
  await page.getByRole('combobox', { name: '正文行间距', exact: true }).selectOption('2');
  await page.getByRole('combobox', { name: '正文字体', exact: true }).selectOption('serif');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.appearance-preview .message-body')).lineHeight === '36px');
  await page.locator('.appearance-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/appearance-serif-relaxed.png' });
  assert.equal(await page.locator('.appearance-heading .icon-button').evaluate(el => el.getBoundingClientRect().width), 30);
  await app.close(); app = undefined;
  assert.equal(JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).appearance.bodySize, 18);
  page = await launch();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.appearance.bodySize, 18);
  assert.equal(await page.getByRole('spinbutton', { name: '正文字号', exact: true }).inputValue(), '18');
  assert.equal(await page.getByRole('combobox', { name: '正文字体', exact: true }).inputValue(), 'serif');
  await page.getByRole('button', { name: '恢复默认排版', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.appearance-preview .message-body')).fontSize === '15px');
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark', appearance: { uiSize: 18, bodySize: 22, codeSize: 20, lineHeight: 2 } }));
  // Refresh the snapshot through the application lifecycle rather than editing React state.
  await page.reload();
  await page.waitForFunction(() => {
    const button = document.querySelector('.new-chat');
    return button && !button.disabled;
  });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 880));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const content = page.locator('.settings-content');
  assert.ok(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'settings must not overflow horizontally');
  await content.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.screenshot({ path: 'test-results/appearance-large-narrow-dark.png' });
  assert.deepEqual(errors, []);
  console.log('Appearance: immediate updates, independent sizing, restart persistence, reset and narrow dark layout passed.');
} finally { if (app) await app.close(); }
