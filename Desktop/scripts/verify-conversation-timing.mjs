import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-elapsed-ui-'));
const workspace = join(profile, 'workspace');
await mkdir(workspace);
await mkdir(join(profile, 'step-runtime', 'sessions'), { recursive: true });
await mkdir(join(profile, 'conversation-timing'));
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
const sessionId = 'elapsed-fixture';
const start = Date.now() - 85000;
const user = { role: 'user', content: '检查思考耗时和整轮共耗时的展示。', timestamp: start };
const assistant = { role: 'assistant', timestamp: start + 1000, stopReason: 'stop', content: [
  { type: 'thinking', thinking: '检查事件计时，思考结束后冻结该段时间。' },
  { type: 'toolCall', id: 'clock-read', name: 'read_file', arguments: { path: 'clock.ts' } },
] };
const result = { role: 'toolResult', toolCallId: 'clock-read', toolName: 'read_file', timestamp: start + 25000, content: 'ok' };
const final = { role: 'assistant', timestamp: start + 26000, stopReason: 'stop', content: [
  { type: 'thinking', thinking: '确认工具执行时间属于整轮耗时，不属于这一段思考。' },
  { type: 'text', text: '已完成计时展示。\n\n每段思考分别记录，工具执行和等待纳入整轮耗时。切换会话后仍保留已经记录的时间。' },
] };
const messages = [user, assistant, result, final];
for (const message of [assistant, final]) {
  message.usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  message.api = 'openai-completions'; message.provider = 'fixture'; message.model = 'fixture';
}
await writeFile(join(profile, 'step-runtime', 'sessions', 'elapsed.jsonl'), [
  { type: 'session', version: 3, id: sessionId, cwd: workspace, timestamp: new Date(start).toISOString() },
  ...messages.map((message, i) => ({ type: 'message', id: `m${i}`, parentId: i ? `m${i - 1}` : null, timestamp: new Date(message.timestamp).toISOString(), message })),
].map(value => JSON.stringify(value)).join('\n') + '\n');
await writeFile(join(profile, 'conversation-timing', `${createHash('sha256').update(sessionId).digest('hex')}.json`), JSON.stringify({
  [assistant.timestamp]: { run: { startedAt: start, endedAt: start + 83000 }, thinking: { 0: { startedAt: start + 1000, endedAt: start + 18000 } } },
  [final.timestamp]: { run: { startedAt: start, endedAt: start + 83000 }, thinking: { 0: { startedAt: start + 26000, endedAt: start + 41000 } } },
}));
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
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 850);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText(user.content, { exact: true }).click();
  await page.locator('.elapsed-total').waitFor();
  assert.deepEqual(await page.locator('.thinking .elapsed-label').allTextContents(), ['已耗时 17s', '已耗时 15s']);
  assert.equal(await page.locator('.elapsed-total').textContent(), '共耗时 1m23s');
  assert.equal(await page.locator('.assistant-actions .message-time').evaluate(element => getComputedStyle(element).opacity), '1');
  await page.screenshot({ path: 'test-results/conversation-elapsed-dark.png' });
  await page.reload();
  await page.locator('.elapsed-total').waitFor();
  assert.equal(await page.locator('.elapsed-total').textContent(), '共耗时 1m23s');
  await page.evaluate(async () => { await window.desktop.preferences({ theme: 'light' }); });
  await page.reload();
  await page.locator('.elapsed-total').waitFor();
  await page.screenshot({ path: 'test-results/conversation-elapsed-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 780));
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.elapsed-total').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth;
  }));
  await page.screenshot({ path: 'test-results/conversation-elapsed-narrow.png' });
  // Exercise renderer ticking and freezing without a paid model.
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.elapsedSnapshot = snapshot;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method) => method === 'snapshot' ? globalThis.elapsedSnapshot : {});
  }, snapshot);
  const stamp = Date.now();
  const emit = event => app.evaluate(({ BrowserWindow }, event) => {
    const snapshot = globalThis.elapsedSnapshot;
    if (event.type === 'message_start') snapshot.messages.push(event.message);
    if (event.type === 'agent_start') snapshot.state.isStreaming = true;
    if (event.type === 'agent_end') {
      snapshot.state.isStreaming = false;
      snapshot.messages = snapshot.messages.map(message => event.desktopTimings[message.timestamp]
        ? { ...message, desktopTiming: event.desktopTimings[message.timestamp] } : message);
    }
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', event);
  }, event);
  await emit({ type: 'agent_start' });
  await emit({ type: 'message_start', message: { role: 'user', timestamp: stamp, content: '实时计时示例' } });
  await emit({ type: 'message_start', message: { role: 'assistant', timestamp: stamp + 1, content: [{ type: 'thinking', thinking: '等待事件' }],
    desktopTiming: { run: { startedAt: stamp }, thinking: { 0: { startedAt: stamp } } } } });
  const label = page.locator('.thinking .elapsed-label').last();
  await page.waitForTimeout(1200);
  assert.match(await label.textContent(), /已耗时 [1-9]s/);
  const frozen = { run: { startedAt: stamp, endedAt: stamp + 5000 }, thinking: { 0: { startedAt: stamp, endedAt: stamp + 2000 } } };
  await emit({ type: 'agent_end', desktopTimings: { [stamp + 1]: frozen } });
  await page.waitForTimeout(150);
  assert.equal(await label.textContent(), '已耗时 2s');
  await page.waitForTimeout(1100);
  assert.equal(await label.textContent(), '已耗时 2s');
  assert.deepEqual(errors, []);
  console.log('Elapsed UI: history/reload, dark/light/narrow, ticking/freeze passed.');
} catch (error) {
  console.log(JSON.stringify(await (await app.firstWindow()).evaluate(() => window.desktop.snapshot()), null, 2));
  await (await app.firstWindow()).screenshot({ path: 'test-results/conversation-elapsed-failure.png' });
  throw error;
} finally { await app.close(); }
