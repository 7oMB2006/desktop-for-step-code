import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-hidden-messages-'));
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
  const snapshot = await prepareSessionFixture(page);
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.hiddenFixture = snapshot;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => method === 'snapshot' ? globalThis.hiddenFixture
      : method === 'sessions' ? globalThis.hiddenFixture.sessions
        : method === 'copyText' ? (globalThis.hiddenCopied = args[0], undefined)
          : method === 'command' && args[0] === 'get_available_thinking_levels' ? { levels: ['off', 'low', 'medium', 'high'] }
            : method === 'command' && args[0] === 'get_commands' ? { commands: [] } : {});
  }, { ...snapshot, messages: [{ role: 'user', content: 'Read-only presentation test', entryId: 'user' }],
    state: { ...snapshot.state, isStreaming: true } });
  await page.reload();
  await page.locator('.message.user').waitFor();
  const send = async message => {
    await app.evaluate(({ BrowserWindow }, message) => {
      const previous = message.role === 'toolResult' ? globalThis.hiddenFixture.messages.findIndex(item =>
        item.role === 'toolResult' && item.toolCallId === message.toolCallId) : -1;
      if (previous >= 0) globalThis.hiddenFixture.messages[previous] = message;
      else globalThis.hiddenFixture.messages.push(message);
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      for (const type of ['message_start', 'message_update', 'message_end']) {
        contents.send('runtime-event', { type, message });
      }
    }, message);
    // Flush the event listener and React commit before checking absence.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const hidden = { role: 'custom', customType: 'ultraloop-discovery', display: false,
    content: 'HIDDEN_DISCOVERY_SENTINEL', entryId: 'discovery' };
  await send(hidden);
  assert.equal(await page.locator('.message.assistant').count(), 0, 'hidden-only output must not create an empty response');
  assert.equal(await page.getByText(hidden.content, { exact: true }).count(), 0);
  await send({ role: 'assistant', content: 'Visible answer', entryId: 'answer' });
  await page.getByText('Visible answer', { exact: true }).waitFor();
  await send({ role: 'custom', customType: 'visible-extension', display: true, content: 'Visible extension notice' });
  await page.getByText('Visible extension notice', { exact: true }).waitFor();
  const childHidden = { ...hidden, content: 'HIDDEN_CHILD_SENTINEL' };
  await send({ role: 'assistant', content: [{ type: 'toolCall', id: 's1', name: 'subagent',
    arguments: { agent: 'explore', task: 'Check files' } }], entryId: 'call' });
  await send({ role: 'toolResult', toolName: 'subagent', toolCallId: 's1', content: 'Started', entryId: 'dispatch',
    details: { agentId: 'lane-a', status: 'running', results: [{ agent: 'explore', task: 'Check files',
      status: 'running', messages: [childHidden, { role: 'assistant', content: 'Visible child answer' }] }] } });
  const row = page.locator('.lane-row');
  await page.waitForFunction(() => document.querySelector('.lane-row')?.getAttribute('data-tool-state') === 'running');
  await row.click();
  await page.getByText('Visible child answer', { exact: true }).waitFor();
  assert.equal(await page.getByText(childHidden.content, { exact: true }).count(), 0);
  await send({ role: 'custom', customType: 'agent-notification', display: false, content: 'HIDDEN_LANE_SENTINEL',
    details: { agentId: 'lane-a', event: 'background_done', status: 'completed' }, entryId: 'notification' });
  await page.waitForFunction(() => document.querySelector('.lane-row')?.getAttribute('data-tool-state') === 'done');
  await page.locator('#subagent-panel .subagent-status[data-lane-state="completed"]').waitFor();
  assert.equal(await page.getByText('HIDDEN_LANE_SENTINEL', { exact: true }).count(), 0);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.hiddenFixture.state.isStreaming = false;
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_end' });
  });
  const copy = page.locator('.assistant-actions button[aria-label="复制"]');
  await copy.waitFor();
  await copy.click();
  assert.equal(await app.evaluate(() => globalThis.hiddenCopied), 'Visible answer\n\nVisible extension notice');
  assert.equal(await page.locator('.message.assistant').count(), 1);
  assert.equal(await page.locator('.message.assistant').getAttribute('data-message-index'), '2', 'source anchor remains stable');
  await page.reload();
  await page.getByText('Visible answer', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.lane-row')?.getAttribute('data-tool-state') === 'done');
  assert.equal(await page.locator('.message.assistant').count(), 1);
  assert.equal(await page.locator('.message.assistant').getAttribute('data-message-index'), '2');
  assert.equal(await page.getByText(/HIDDEN_.*_SENTINEL/).count(), 0, 'saved hidden records do not reappear after reload');
  await page.screenshot({ path: 'test-results/hidden-messages-replay.png' });
  await send({ role: 'toolResult', toolName: 'subagent', toolCallId: 's1', content: 'Failed', entryId: 'dispatch',
    details: { status: 'failed', results: [{ agent: 'explore', task: 'Check files',
      status: 'failed', messages: [{ role: 'user', content: 'Check files' }, childHidden] }] } });
  await page.waitForFunction(() => document.querySelector('.lane-row')?.getAttribute('data-tool-state') === 'failed');
  await row.click();
  await page.locator('#subagent-panel .panel-empty').filter({ hasText: '无过程记录。' }).waitFor();
  assert.equal(await page.locator('#subagent-panel .lane-text').count(), 0);
  assert.equal(await page.getByText(childHidden.content, { exact: true }).count(), 0);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.lane-row')?.getAttribute('data-tool-state') === 'failed');
  await row.click();
  await page.locator('#subagent-panel .panel-empty').filter({ hasText: '无过程记录。' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Hidden messages passed: live lifecycle, no empty turns, visible extension notice, copy, child transcript, lane settlement and history reload.');
} finally { await app.close(); }
