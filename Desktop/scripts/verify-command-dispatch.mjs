import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-command-dispatch-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Loading the font')) console.error(message.text());
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1300, 900);
  });
  const snapshot = await prepareSessionFixture(page);
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.dispatchFixture = snapshot;
    globalThis.dispatchCalls = [];
    globalThis.rejectCompact = false;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.dispatchFixture;
      if (method === 'systemTheme') return { systemDark: true };
      if (method === 'sessions') return snapshot.sessions;
      if (method === 'summary') return { tasks: [], mcp: [], skillCount: 0 };
      if (method === 'clm') return { sessionId: snapshot.state.sessionId, leafId: null, enabled: true, total: 0, revisions: [] };
      if (method === 'cronList') return { tasks: [], hosts: [], issues: [] };
      if (method === 'usageOverview') throw new Error('Isolated usage query unavailable');
      if (method === 'settings') return { account: {}, profiles: [], mcp: {}, skills: [] };
      if (method === 'command') {
        const [type, payload, owner] = args;
        globalThis.dispatchCalls.push({ type, payload, owner });
        if (type === 'get_commands') return { commands: ['usage', 'cron', 'todos', 'workflows'].map(name => ({ name, source: 'extension' })) };
        if (type === 'get_available_thinking_levels') return { levels: [] };
        if (type === 'compact' && globalThis.rejectCompact) throw new Error('Fixture compaction failed');
        return {};
      }
      return {};
    });
  }, snapshot);
  await page.reload();
  const input = page.locator('.composer > .composer-input');
  await page.waitForFunction(() => document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true');
  const send = async text => {
    await input.fill(text);
    await page.waitForFunction(text => document.querySelector('.composer-input')?.value === text, text);
    await input.press('Escape');
    await page.locator('.composer-action-button').click();
  };
  const calls = type => app.evaluate((_electron, type) => globalThis.dispatchCalls.filter(call => call.type === type), type);
  await send('/clm');
  await page.getByText('CLM 已启用', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'CLM', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal((await calls('prompt')).length, 0, 'Bare CLM opens the inspector without a model request');
  await page.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await page.locator('.context-panel').waitFor({ state: 'detached' });
  await send('/usage');
  await page.getByRole('region', { name: '用量统计', exact: true }).waitFor();
  assert.equal((await calls('prompt')).length, 0, 'Usage opens the Desktop page without sending terminal heatmap text');
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  await send('/usage overview');
  await page.getByRole('region', { name: '用量统计', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  await send('/usage account');
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '账户', exact: true }).getAttribute('aria-current'), 'page');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'detached' });
  await send('/cron');
  await page.locator('.scheduled-tasks').waitFor();
  assert.equal((await calls('prompt')).length, 0, 'Bare Cron opens the existing page');
  // Reload returns to the same fixture without creating a real task.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true');
  await send('/compact 保留接口和测试');
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.dispatchCalls.some(call => call.type === 'compact') && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
  });
  await page.waitForFunction(() => document.querySelector('.composer-input')?.value === ''
    && document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true');
  assert.deepEqual((await calls('compact')).map(call => call.payload), [{ customInstructions: '保留接口和测试' }],
    JSON.stringify(await app.evaluate(() => globalThis.dispatchCalls)));
  assert.equal((await calls('compact'))[0].owner, snapshot.runtimeId);
  assert.equal((await calls('prompt')).length, 0, 'Compact uses its RPC, never prompt');
  await app.evaluate(() => { globalThis.rejectCompact = true; });
  await send('/compact 保留失败草稿');
  await page.getByText(/Fixture compaction failed/).waitFor();
  assert.equal(await input.evaluate(element => element.value), '/compact 保留失败草稿');
  await send('请解释 /clm 和 /usage');
  await send('/cron list');
  assert.deepEqual((await calls('prompt')).map(call => call.payload.message), ['请解释 /clm 和 /usage', '/cron list']);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_start' }));
  await input.fill('/compact');
  await input.press('Escape');
  await input.press('Enter');
  await page.getByText(/请等待当前任务结束/).waitFor();
  assert.equal((await calls('compact')).length, 2, 'Busy compact is not sent or queued as prose');
  assert.equal(await input.evaluate(element => element.value), '/compact');
  assert.deepEqual(errors, []);
  console.log('Command dispatch passed: usage tabs, Cron page, compact RPC/failure/busy guards, inline mentions and Cron parameters.');
} finally { await app.close(); }
