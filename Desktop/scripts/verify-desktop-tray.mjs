import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let chunks = 0;
let streamClosed = false;
const chunk = delta => `data: ${JSON.stringify({ id: 'tray-fixture', object: 'chat.completion.chunk',
  created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
const server = createServer(async (req, res) => {
  for await (const _ of req) {}
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(chunk({ role: 'assistant', content: 'Tray fixture running. ' }));
  const timer = setInterval(() => { chunks++; res.write(chunk({ content: 'Still running. ' })); }, 100);
  res.on('close', () => { clearInterval(timer); streamClosed = true; });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-tray-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({
  defaultProvider: 'fixture', defaultModel: 'fixture',
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions',
    apiKey: 'local-test-only', models: [{ id: 'fixture', name: 'Tray fixture', contextWindow: 32768, maxTokens: 2048 }] } },
}));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let exited = false;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow, Tray, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    globalThis.trayFixture = { confirmations: 0, response: 0 };
    const original = Tray.prototype.setToolTip;
    Tray.prototype.setToolTip = function (text) {
      globalThis.trayFixture.tray = this;
      return original.call(this, text);
    };
    dialog.showMessageBox = async () => {
      globalThis.trayFixture.confirmations++;
      return { response: globalThis.trayFixture.response };
    };
  });
  await page.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled, undefined, { timeout: 60000 });
  await page.evaluate(() => window.desktop.preferences({ language: 'zh' }));
  assert.equal(await app.evaluate(() => globalThis.trayFixture.tray.isDestroyed()), false);
  const newPopup = app.waitForEvent('window');
  await app.evaluate(() => globalThis.trayFixture.tray.emit('right-click', {}, globalThis.trayFixture.tray.getBounds()));
  const popup = await newPopup;
  popup.setDefaultTimeout(15000);
  const openMenu = async () => {
    await app.evaluate(() => globalThis.trayFixture.tray.emit('right-click', {}, globalThis.trayFixture.tray.getBounds()));
    await popup.waitForFunction(() => document.querySelector('.tray-menu')?.dataset.visible === 'true');
  };
  await popup.waitForFunction(() => document.querySelector('.tray-menu')?.dataset.visible === 'true');
  assert.deepEqual(await popup.getByRole('menuitem').allTextContents(), ['打开 Desktop for Step Code', '退出应用']);
  assert.ok(await popup.locator('.tray-menu').evaluate(menu => {
    const label = menu.querySelector('.app-menu-label');
    const range = document.createRange();
    range.selectNodeContents(label);
    const width = menu.getBoundingClientRect().width;
    return width - range.getBoundingClientRect().width <= 34 && label.scrollWidth <= label.clientWidth;
  }), 'menu width follows its longest label with compact padding and no clipping');
  assert.equal(await popup.evaluate(() => typeof window.desktop), 'undefined', 'tray renderer has no main-window bridge');
  assert.equal(await popup.evaluate(() => typeof window.require), 'undefined');
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('tray-menu.html'));
    ipcMain.emit('tray-menu:action', { sender: main.webContents, senderFrame: main.webContents.mainFrame }, 'quit');
  });
  assert.equal(await app.evaluate(() => globalThis.trayFixture.confirmations), 0, 'main renderer cannot impersonate the tray');
  await popup.evaluate(() => window.desktopTray.action('unsupported'));
  assert.equal(await popup.evaluate(() => window.desktopTray.state().visible), true);
  assert.ok(await popup.locator('.tray-menu').evaluate(element =>
    getComputedStyle(element).transitionTimingFunction.includes('cubic-bezier(0.22, 1, 0.36, 1)')));
  await popup.getByRole('menuitem').first().focus();
  await popup.keyboard.press('ArrowDown');
  assert.equal(await popup.getByRole('menuitem').last().evaluate(element => element === document.activeElement), true);
  await mkdir('test-results', { recursive: true });
  await popup.waitForFunction(() => getComputedStyle(document.querySelector('.tray-menu')).opacity === '1');
  await popup.screenshot({ path: 'test-results/tray-menu-light.png', omitBackground: true });
  await popup.keyboard.press('Escape');
  await popup.waitForFunction(() => document.querySelector('.tray-menu')?.dataset.visible === 'false');
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    window.webContents.getURL().includes('tray-menu.html')).isVisible()), false);
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await openMenu();
  assert.equal(await popup.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await popup.waitForFunction(() => getComputedStyle(document.querySelector('.tray-menu')).opacity === '1');
  await popup.screenshot({ path: 'test-results/tray-menu-dark.png', omitBackground: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    window.webContents.getURL().includes('tray-menu.html')).emit('blur'));
  await popup.waitForFunction(() => document.querySelector('.tray-menu')?.dataset.visible === 'false');
  await popup.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await popup.locator('.tray-menu').evaluate(element =>
    getComputedStyle(element).transitionDuration.split(',').every(value => value.trim() === '0s')));
  await popup.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Run until explicitly stopped.');
  await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent.includes('Tray fixture running.'));
  const before = await page.evaluate(() => window.desktop.snapshot());
  const terminal = await page.evaluate(id => window.desktop.terminalCreate(id), before.runtimeId);
  await page.evaluate(() => window.desktop.windowControl('close'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    !window.webContents.getURL().includes('tray-menu.html')).isVisible()), false);
  assert.equal(await app.evaluate(() => globalThis.trayFixture.confirmations), 0);
  const previousChunks = chunks;
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.ok(chunks > previousChunks, 'the real fixture stream continues while hidden');
  assert.equal(streamClosed, false);
  const hidden = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(hidden.runtimeId, before.runtimeId);
  assert.equal(hidden.state.isStreaming, true);
  assert.ok((await page.evaluate(id => window.desktop.terminalList(id), before.runtimeId)).some(item => item.id === terminal.id),
    'window close preserves terminal ownership');
  await openMenu();
  await popup.getByRole('menuitem', { name: '打开 Desktop for Step Code', exact: true }).click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    !window.webContents.getURL().includes('tray-menu.html')).isVisible()), true);
  await page.evaluate(() => window.desktop.windowControl('close'));
  const second = spawn(await app.evaluate(() => process.execPath), process.env.DESKTOP_VERIFY_EXE ? [] : [resolve('.')],
    { env, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    second.once('error', reject);
    second.once('exit', code => code === 0 ? resolve() : reject(new Error(`Second instance exited with ${code}`)));
  });
  await app.evaluate(({ BrowserWindow }) => new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('tray-menu.html')).isVisible()) { clearInterval(timer); clearTimeout(timeout); resolve(); }
    }, 50);
    const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Second instance did not restore the window')); }, 5000);
  }));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    !window.webContents.getURL().includes('tray-menu.html')).isVisible()), true);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window =>
    !window.webContents.getURL().includes('tray-menu.html')).length), 1);
  await page.evaluate(() => window.desktop.preferences({ language: 'en' }));
  await openMenu();
  assert.deepEqual(await popup.getByRole('menuitem').allTextContents(), ['Open Desktop for Step Code', 'Quit application']);
  await page.evaluate(() => window.desktop.windowControl('close'));
  await popup.getByRole('menuitem', { name: 'Quit application', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await app.evaluate(() => globalThis.trayFixture.confirmations), 1);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    !window.webContents.getURL().includes('tray-menu.html')).isVisible()), true);
  assert.equal(streamClosed, false, 'cancelled quit keeps the task running');
  // Exercise the independent in-app Quit entry as well as tray Quit.
  await page.reload();
  await page.getByRole('button', { name: 'File', exact: true }).waitFor();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Quit application', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await app.evaluate(() => globalThis.trayFixture.confirmations), 2);
  const exit = new Promise(resolve => app.process().once('exit', resolve));
  await app.evaluate(() => { globalThis.trayFixture.response = 1; });
  await openMenu();
  await popup.getByRole('menuitem', { name: 'Quit application', exact: true }).click();
  await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Confirmed quit did not terminate')), 15000).unref())]);
  exited = true;
  assert.equal(streamClosed, true, 'confirmed quit stops the runtime stream');
  console.log('Tray acceptance passed: hide preserves streaming/terminal; restore, relabel, cancel and confirmed quit.');
} finally {
  if (app && !exited) {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
    await app.close().catch(() => {});
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
