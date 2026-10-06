import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-background-ui-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1400, 900);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  const task = '只读盘点 Markdown 文件，整理结果。';
  const messages = [
    { role: 'user', content: '派发两个后台任务。' },
    { role: 'assistant', content: ['a', 'b'].map(id => ({
      type: 'toolCall', id, name: 'subagent', arguments: { agent: 'explore', task, run_in_background: true },
    })) },
    ...['a', 'b'].map(id => ({ role: 'toolResult', toolName: 'subagent', toolCallId: id, content: 'Started',
      details: { agentId: `lane-${id}`, status: 'running', results: [] } })),
    { role: 'assistant', content: '主会话已结束本轮，后台继续运行。' },
    { role: 'user', content: '继续查看后台状态。' },
    { role: 'assistant', content: '等待后台通知。' },
  ];
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.backgroundFixture = snapshot;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => method === 'snapshot' ? globalThis.backgroundFixture
      : method === 'sessions' ? globalThis.backgroundFixture.sessions
        : method === 'command' && args[0] === 'get_available_thinking_levels' ? { levels: ['off', 'low', 'medium', 'high'] }
          : method === 'command' && args[0] === 'get_commands' ? { commands: [] } : {});
  }, { ...snapshot, messages, state: { ...snapshot.state, isStreaming: true } });
  const rows = page.locator('.lane-row');
  const state = async (index, expected) => {
    await page.waitForFunction(({ index, expected }) =>
      document.querySelectorAll('.lane-row')[index]?.getAttribute('data-tool-state') === expected, { index, expected });
  };
  const send = async message => {
    await app.evaluate(({ BrowserWindow }, message) => {
      globalThis.backgroundFixture.messages.push(message);
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.send('runtime-event', { type: 'message_start', message });
      window.webContents.send('runtime-event', { type: 'message_end', message });
    }, message);
  };
  const notify = (id, event, status) => send({
    role: 'custom', customType: 'agent-notification', content: '后台状态通知。',
    details: { agentId: `lane-${id}`, event, status }, timestamp: Date.now(),
  });
  await page.reload();
  await state(0, 'running');
  await state(1, 'running');
  await rows.nth(0).click();
  await page.locator('#subagent-panel .subagent-status[data-lane-state="running"]').waitFor();
  await notify('a', 'background_done', 'completed');
  await state(0, 'done');
  await state(1, 'running');
  await page.locator('#subagent-panel .subagent-status[data-lane-state="completed"]').waitFor();
  await page.waitForTimeout(750);
  assert.equal(await rows.count(), 2, 'completion updates the original row, not a duplicate');
  assert.equal(await rows.nth(0).locator('.subagent-status-check').count(), 1);
  assert.equal(await page.locator('#subagent-panel .lane-text').count(), 0, 'no invented activity');
  await page.screenshot({ path: 'test-results/background-subagent-completed.png' });
  await page.reload();
  await state(0, 'done');
  assert.equal(await rows.nth(0).locator('.subagent-status-icon').getAttribute('data-settling'), 'false');
  await rows.nth(1).click();
  await page.locator('#subagent-panel .subagent-status[data-lane-state="running"]').waitFor();
  await notify('b', 'background_failed', 'failed');
  await state(1, 'failed');
  await page.locator('#subagent-panel .subagent-status[data-lane-state="failed"]').waitFor();
  await notify('a', 'background_restarted', 'running');
  await state(0, 'running');
  await rows.nth(0).click();
  await page.locator('#subagent-panel .subagent-status[data-lane-state="running"]').waitFor();
  await notify('a', 'background_interrupted', 'aborted');
  await state(0, 'failed');
  await page.locator('#subagent-panel .subagent-status[data-lane-state="aborted"]').waitFor();
  assert.equal(await page.locator('#subagent-panel .subagent-status').innerText(), '已终止');
  assert.match(await rows.nth(0).getAttribute('aria-label'), /已终止/);
  await send({ role: 'toolResult', toolName: 'agent_send', toolCallId: 'follow-up', content: 'Follow-up',
    details: { agentId: 'lane-a', status: 'running' } });
  await state(0, 'running');
  await notify('a', 'background_done', 'completed');
  await state(0, 'done');
  await page.locator('#subagent-panel .subagent-status[data-lane-state="completed"]').waitFor();
  await rows.nth(0).click();
  await page.locator('#subagent-panel').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('Background subagents passed: cross-turn completion, panel sync, identical task isolation, reload, failure, interruption and follow-up.');
} finally { await app.close(); }
