import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(join(tmpdir(), 'desktop-interface-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [], autoCheckUpdates: false }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1280, 900);
  });
  await page.waitForFunction(() => document.querySelector('.new-chat') && !document.querySelector('.new-chat').disabled);
  return page;
}
const settings = page => page.getByRole('region', { name: '界面复杂度', exact: true });
async function openSettings(page) {
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '界面复杂度', exact: true }).click();
  await settings(page).waitFor();
}
async function closeSettings(page) {
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
}
async function preset(page, name) {
  const button = settings(page).getByRole('button', { name, exact: true });
  await button.click();
  await page.waitForFunction(name => document.querySelector('.interface-presets button[aria-pressed="true"]')?.textContent === name && !document.querySelector('.interface-presets button:disabled'), name);
}
const history = [
  { role: 'user', content: '检查这个项目。', timestamp: 1000 },
  { role: 'assistant', content: [
    { type: 'text', text: '正文一：先确认项目结构。' },
    { type: 'thinking', thinking: '先检查入口文件和项目配置。' },
    { type: 'toolCall', id: 'interface-read-1', name: 'read_file', arguments: { path: 'src/main.tsx' } },
    { type: 'toolCall', id: 'interface-read-2', name: 'read_file', arguments: { path: 'package.json' } },
  ] },
  { role: 'toolResult', toolCallId: 'interface-read-1', toolName: 'read_file', content: 'File one' },
  { role: 'toolResult', toolCallId: 'interface-read-2', toolName: 'read_file', content: 'File two' },
  { role: 'assistant', content: [
    { type: 'text', text: '正文二：再核验命令结果。' },
    { type: 'toolCall', id: 'interface-command', name: 'run_command', arguments: { command: 'fixture-only' } },
  ] },
  { role: 'toolResult', toolCallId: 'interface-command', toolName: 'run_command', isError: true, content: 'Fixture command failed' },
  { role: 'assistant', content: [
    { type: 'toolCall', id: 'interface-wait', name: 'run_command', arguments: { command: 'fixture-awaiting' } },
  ] },
];
try {
  let page = await launch();
  const saved = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.interfaceFixture = { snapshot };
    const handler = ipcMain._invokeHandlers.get('desktop');
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'snapshot') return globalThis.interfaceFixture.snapshot;
      const result = await handler(event, method, ...args);
      if (method === 'preferences') globalThis.interfaceFixture.snapshot.preferences = result;
      return result;
    });
  }, saved);
  const load = async (messages, active = false, requests = []) => app.evaluate(({ BrowserWindow }, data) => {
    const fixture = globalThis.interfaceFixture;
    fixture.snapshot = { ...fixture.snapshot, messages: data.messages, requests: data.requests,
      runtimeRevision: (fixture.snapshot.runtimeRevision ?? 0) + 1,
      state: { ...fixture.snapshot.state, sessionId: 'interface-session', isStreaming: data.active } };
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  }, { messages, active, requests });
  await load(history);
  const messages = page.locator('.messages');
  await messages.getByText('正文一：先确认项目结构。', { exact: true }).waitFor();
  assert.equal(await messages.locator('.process-tool-group').count(), 0);
  assert.equal(await messages.locator('.process-tool[open]').count(), 0);
  assert.equal(await messages.locator('.thinking[open]').count(), 0);
  await page.screenshot({ path: 'test-results/interface-mapped-standard-light.png' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-standard-detail.png' });
  await openSettings(page);
  await preset(page, '简洁');
  await closeSettings(page);
  assert.equal(await page.locator('.composer-wrap .performance-bar').count(), 0);
  assert.equal(await messages.locator('.tool-group-trigger').count(), 1);
  const group = messages.locator('.tool-group-trigger');
  assert.match(await group.innerText(), /读取文件 2 项/);
  assert.equal(await messages.locator('.process-tool.failed > summary').isVisible(), true);
  assert.equal(await messages.locator('.process-tool.missing > summary').isVisible(), true);
  assert.equal(await group.getAttribute('aria-expanded'), 'false');
  await group.focus();
  await group.press('Enter');
  await messages.locator('.tool-group-disclosure.is-expanded .process-tool > summary').first().waitFor();
  await page.waitForTimeout(280);
  assert.equal(await messages.locator('.tool-group-disclosure .process-tool').count(), 2);
  await group.press('Enter');
  await load(history.map((message, index) => index === 3 ? { ...message, desktopToolPending: true } : message), true);
  await group.getByText('正在处理工具 · 1 / 2 项已返回', { exact: true }).waitFor();
  assert.equal(await group.getAttribute('aria-expanded'), 'false', 'progress updates retain the same disclosure anchor');
  await load(history, true);
  await group.getByText('已完成：读取文件 2 项', { exact: true }).waitFor();
  const awaiting = {
    type: 'extension_ui_request', method: 'confirm', id: 'interface-approval', runtimeId: saved.runtimeId,
    title: `Approve run_command [${'interface-wait'.slice(-8)}]`,
    message: 'Call: interface-wait\nrun_command can modify the workspace or execute a command\n\nrun_command command=fixture-awaiting\n\nBatch calls may ask separately\nbefore approved tools begin running.',
  };
  await load(history, true, [awaiting]);
  await messages.locator('.process-tool.waiting > summary').waitFor();
  assert.equal(await messages.locator('.process-tool.waiting').locator('xpath=ancestor::*[contains(@class,"tool-group-disclosure")]').count(), 0);
  await load(history, false);
  await page.locator('.permission-approval').waitFor({ state: 'detached' });
  await page.screenshot({ path: 'test-results/interface-mapped-simple-light.png' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-simple-detail.png' });
  await openSettings(page);
  await settings(page).getByRole('switch', { name: '工具详情默认展开' }).check();
  await page.waitForFunction(() => !document.querySelector('.interface-option input:disabled'));
  await closeSettings(page);
  assert.equal(await group.getAttribute('aria-expanded'), 'true', 'custom expansion applies to the group and its records');
  assert.equal(await messages.locator('.process-tool-group .process-tool[open]').count(), 2);
  await openSettings(page);
  await preset(page, '详细');
  await closeSettings(page);
  await messages.locator('.thinking[open]').waitFor();
  assert.equal(await page.locator('.composer-wrap .performance-metric').count(), 4);
  assert.equal(await messages.locator('.process-tool-group').count(), 0);
  assert.equal(await messages.locator('.process-tool[open]').count(), 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/interface-mapped-detailed-light.png' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-detailed-detail.png' });
  await messages.locator('.process-tool > summary').first().click();
  assert.equal(await messages.locator('.process-tool[open]').count(), 1);
  await load([...history, { role: 'assistant', content: [{ type: 'text', text: '后续输出不会覆盖手动展开。' }] }]);
  assert.equal(await messages.locator('.process-tool[open]').count(), 1);
  await messages.locator('.thinking > summary').click();
  await load([...history, { role: 'assistant', content: [{ type: 'text', text: '后续输出不会覆盖手动折叠。' }] }]);
  assert.equal(await messages.locator('.thinking').getAttribute('data-expanded'), 'false');
  await openSettings(page);
  await settings(page).getByRole('switch', { name: '工具详情默认展开' }).check();
  await page.waitForFunction(() => !document.querySelector('.interface-option input:disabled'));
  await closeSettings(page);
  assert.equal(await messages.locator('.process-tool[open]').count(), 4);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.interfaceSettings.preset, 'custom');
  await load(history);
  await messages.getByText('后续输出不会覆盖手动折叠。', { exact: true }).waitFor({ state: 'detached' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1900));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/interface-mapped-custom-light.png' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-custom-detail.png' });
  const before = (await page.evaluate(() => window.desktop.snapshot())).preferences;
  const error = await page.evaluate(async () => {
    try { await window.desktop.preferences({ interfaceSettings: { preset: 'custom', toolsExpanded: 'yes' } }); }
    catch (error) { return error.message; }
  });
  assert.match(error, /Invalid interface option/);
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).preferences, before);
  await app.close(); app = undefined;
  const persisted = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.equal(persisted.interfaceSettings.toolsExpanded, true);
  assert.equal(persisted.interfaceSettings.preset, 'custom');
  page = await launch();
  await openSettings(page);
  assert.equal(await settings(page).getByRole('switch', { name: '工具详情默认展开' }).isChecked(), true);
  assert.equal(await settings(page).locator('.interface-custom.is-active').count(), 1);
  await settings(page).getByRole('button', { name: '恢复标准预设' }).click();
  await page.waitForFunction(() => !document.querySelector('.interface-option input:disabled'));
  assert.equal(await settings(page).getByRole('switch', { name: '工具详情默认展开' }).isChecked(), false);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.interfaceSettings.preset, 'standard');
  assert.deepEqual(errors, []);
  console.log('Interface preferences: real renderer mapping, safe grouping, approval/error visibility, manual overrides, custom expansion, IPC validation, persistence and reset passed.');
} finally {
  if (app) await app.close();
}
