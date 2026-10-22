import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const requests = [];
const server = createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part;
  requests.push(JSON.parse(body));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'restore', object: 'chat.completion.chunk', created: 1,
    model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  res.end(chunk({ role: 'assistant', content: 'Acknowledged.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-ultracode-restore-'));
const root = join(profile, 'step-runtime');
await mkdir(root);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark' }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions',
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'isolated-test',
  models: [{ id: 'fixture', name: 'Restore fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let generation = 0;
const open = async () => {
  console.log(`[ultracode-restore] launch ${++generation}`);
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive(); });
  await page.waitForFunction(() => !document.querySelector('.composer > .composer-input')?.disabled, undefined, { timeout: 60000 });
  await page.waitForFunction(async () => (await window.desktop.snapshot()).status === 'connected', undefined, { timeout: 60000 });
  console.log(`[ultracode-restore] connected ${generation}`);
  return page;
};
const close = async () => {
  console.log(`[ultracode-restore] closing ${generation}`);
  await closeDesktopFixture(app); app = undefined;
  console.log(`[ultracode-restore] closed ${generation}`);
};
try {
  let page = await open();
  const draft = await page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(id => window.desktop.createDraftSession(id), draft.draftId);
  await page.evaluate(() => window.desktop.command('prompt', { message: '/ultracode on' }));
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.ultracode === true);
  await page.evaluate(() => window.desktop.command('prompt', { message: 'Hello' }));
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const enabled = await page.evaluate(() => window.desktop.snapshot());
  // Presentation-only events complement the real upstream CLM lifecycle tests.
  assert.equal(enabled.state.isStreaming, false);
  await page.reload();
  await page.locator('.messages .message').first().waitFor();
  for (const type of ['auto_clm_start', 'auto_clm_end', 'compaction_start', 'compaction_end']) {
    console.log(`[ultracode-restore] ${type}`);
    await app.evaluate(({ BrowserWindow }, event) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', event), {
      type, runtimeId: enabled.runtimeId, sessionId: enabled.state.sessionId,
    });
    if (type.endsWith('_start')) {
      await page.getByText('正在整理上下文', { exact: true }).waitFor();
      await page.getByRole('textbox', { name: '消息', exact: true }).fill('Next task after maintenance');
      await page.getByRole('button', { name: '加入队列', exact: true }).waitFor();
      const input = page.getByRole('textbox', { name: '消息', exact: true });
      await input.press('Control+a');
      await input.press('Backspace');
      await page.waitForFunction(() => document.querySelector('.composer-input')?.dataset.empty === 'true');
      assert.equal(await page.getByRole('button', { name: '停止此轮', exact: true }).isDisabled(), false);
      assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.isStreaming, false);
    } else {
      await page.getByText('正在整理上下文', { exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '发送', exact: true }).waitFor();
    }
  }
  const sessionId = enabled.state.sessionId;
  const journal = (await readFile(enabled.state.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(journal.some(e => e.customType === 'ultraloop-session-mode' && e.data.enabled === true));
  await close();
  page = await open();
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.ultracode === true);
  assert.equal(Boolean((await page.evaluate(() => window.desktop.snapshot())).launch.ultracodeTurn), false);
  await page.evaluate(() => window.desktop.command('prompt', { message: 'Hello again' }));
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const standingReminders = requests.at(-1).messages.filter(m => {
    const text = typeof m.content === 'string' ? m.content : m.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '';
    return text.includes('Ultraloop is on for the session');
  });
  assert.equal(standingReminders.length, 1, 'Unchanged standing mode does not repeat capability tutorials');
  await page.evaluate(() => window.desktop.command('prompt', { message: '/ultracode off' }));
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.ultracode === false);
  await close();
  page = await open();
  await page.evaluate(id => window.desktop.switchSession(id), sessionId);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.ultracode, false);
  const fresh = await page.evaluate(() => window.desktop.beginSession());
  const created = await page.evaluate(id => window.desktop.createDraftSession(id), fresh.draftId);
  assert.equal(created.launch.ultracode, false, 'New sessions never inherit standing consent');
  await page.evaluate(() => window.desktop.command('prompt', { message: 'ultracode:\n\nOne task only' }));
  await page.waitForFunction(async () => {
    const state = await window.desktop.snapshot();
    return !state.state.isStreaming && state.messages.some(message => message.role === 'assistant');
  });
  const oneTurn = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(oneTurn.launch.ultracode, false);
  assert.equal(Boolean(oneTurn.launch.ultracodeTurn), false, 'Single-turn launch clears after settlement');
  const reminderText = message => typeof message.content === 'string' ? message.content
    : message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
  assert.equal(requests.at(-1).messages.filter(message => reminderText(message).includes('opting this turn into multi-agent orchestration')).length, 1);
  await page.evaluate(() => window.desktop.command('prompt', { message: 'Ordinary follow-up' }));
  await page.waitForFunction(async () => {
    const state = await window.desktop.snapshot();
    return !state.state.isStreaming && state.messages.filter(message => message.role === 'assistant').length === 2;
  });
  const followUp = requests.at(-1).messages;
  const latestUser = followUp.findLastIndex(message => message.role === 'user' && reminderText(message) === 'Ordinary follow-up');
  assert.ok(latestUser >= 0);
  assert.equal(followUp.slice(latestUser + 1).some(message => reminderText(message).includes('opting this turn into multi-agent orchestration')), false,
    'Ordinary follow-up receives no new single-turn authorization reminder');
  assert.equal(followUp.filter(message => reminderText(message).includes('opting this turn into multi-agent orchestration')).length, 1,
    'Historical opt-in remains in its original turn without duplication');
  const oneTurnSessionId = oneTurn.state.sessionId;
  await close();
  page = await open();
  await page.evaluate(id => window.desktop.switchSession(id), oneTurnSessionId);
  const reopened = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(reopened.launch.ultracode, false);
  assert.equal(Boolean(reopened.launch.ultracodeTurn), false, 'Restart does not restore expired single-turn consent');
  console.log('Ultracode on/off survives real runtime restart, reminders are not repeated, new sessions remain opted out.');
} finally {
  if (app) await close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
}
