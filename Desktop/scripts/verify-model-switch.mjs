import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-model-switch-')));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
const requests = [], streams = new Set();
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'switch-fixture', object: 'chat.completion.chunk', created: 1, choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const finish = () => {
  for (const response of streams) if (!response.destroyed && !response.writableEnded)
    response.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
};
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(chunk({ role: 'assistant', content: `Reply from ${body.model}.\n\n` }));
    streams.add(res); res.on('close', () => streams.delete(res));
  } catch { res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "switch-fixture"\ndefaultModel = "model-a"\npermissionPreset = "bypass"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'switch-fixture': {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-fixture',
  models: ['a', 'b'].map(id => ({ id: `model-${id}`, name: id === 'a' ? 'Step-3.5-Flash' : 'Step-3.5-Pro',
    contextWindow: 32768, maxTokens: 2048, reasoning: true,
    thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null } })),
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
let app = await launch();
const waitRequest = async count => {
  const deadline = Date.now() + 60000;
  while (requests.length < count) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for request ${count}; got ${requests.length}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
try {
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.setSize(1400, 900); window.showInactive();
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const fixture = await prepareSessionFixture(page), id = fixture.runtimeId;
  const command = (type, args) => page.evaluate(({ type, args, id }) => window.desktop.command(type, args, id), { type, args, id });
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  await command('set_thinking_level', { level: 'low' });
  await page.reload();
  const input = page.locator('.composer > textarea');
  await input.waitFor(); await input.fill('FIRST: keep the current task on its original model.'); await input.press('Enter');
  await waitRequest(1);
  assert.equal(requests[0].model, 'model-a'); assert.equal(requests[0].reasoning_effort, 'low');
  const trigger = page.getByRole('button', { name: '模型与思考强度', exact: true });
  assert.equal(await trigger.isEnabled(), true, 'picker remains available during execution');
  await trigger.click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('option', { name: 'Step-3.5-Pro', exact: true }).click();
  await page.getByText('下一轮生效', { exact: true }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/model-switch-pending-layout.png' });
  const pendingLayout = await page.locator('.model-effort-popover').evaluate(popover => {
    const bounds = popover.getBoundingClientRect();
    const info = popover.querySelector('.model-effort-info').getBoundingClientRect();
    const fader = popover.querySelector('.model-effort-fader').getBoundingClientRect();
    return { panel: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      info: { left: info.left, top: info.top, right: info.right, bottom: info.bottom, width: info.width },
      fader: { left: fader.left, top: fader.top, right: fader.right, bottom: fader.bottom } };
  });
  assert.ok(pendingLayout.fader.left >= pendingLayout.info.right && pendingLayout.fader.bottom <= pendingLayout.panel.bottom,
    `Pending selection must keep the fader beside the model and inside the popover: ${JSON.stringify(pendingLayout)}`);
  assert.ok(pendingLayout.info.width >= 200, 'Pending notice must not consume the model column');
  const slider = page.getByRole('slider', { name: '思考强度', exact: true });
  await slider.focus(); await slider.press('End');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).modelSelection?.thinkingLevel === 'high');
  let state = await snapshot();
  assert.equal(state.state.model.id, 'model-a'); assert.equal(state.state.thinkingLevel, 'low');
  assert.equal(state.modelChanges.length, 0);
  await command('set_model', { provider: 'switch-fixture', modelId: 'model-a' });
  await command('set_thinking_level', { level: 'low' });
  assert.equal((await snapshot()).modelSelection, undefined, 'choosing back cancels');
  await command('set_model', { provider: 'switch-fixture', modelId: 'model-b' });
  await command('set_thinking_level', { level: 'high' });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.model-effort-name')?.textContent === 'Step-3.5-Pro');
  assert.equal((await snapshot()).state.model.id, 'model-a');
  await command('prompt', { message: 'STEER: still the same task.' });
  await command('queue_steer_first');
  await command('prompt', { message: 'SECOND: a fresh queued task.' });
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  const proposal = await snapshot();
  assert.ok(proposal.draftId); assert.equal(proposal.modelSelection, undefined);
  await page.locator('.session-row > button:first-child').filter({ hasText: 'FIRST:' }).click();
  await page.waitForFunction(() => document.querySelector('.model-effort-name')?.textContent === 'Step-3.5-Pro');
  assert.equal((await snapshot()).modelSelection.model.id, 'model-b');
  finish(); await waitRequest(2);
  assert.equal(requests[1].model, 'model-a', 'steering retains active model'); assert.equal(requests[1].reasoning_effort, 'low');
  assert.equal((await snapshot()).modelChanges.length, 0);
  finish(); await waitRequest(3);
  assert.equal(requests[2].model, 'model-b', 'queued new task receives selected model'); assert.equal(requests[2].reasoning_effort, 'high');
  await page.locator('.client-model-change').waitFor();
  assert.equal(await page.locator('.client-model-change').count(), 1);
  assert.equal(await page.locator('.client-model-change strong').innerText(), '模型已切换');
  assert.equal(await page.locator('.client-model-change details, .client-model-change button').count(), 0);
  const styles = await page.locator('.client-model-change').evaluate(row => {
    const old = getComputedStyle(row.querySelector('.change-models > span:first-child'));
    const next = getComputedStyle(row.querySelector('.change-models > span:last-child'));
    return { old: old.color, next: next.color, oldWeight: old.fontWeight, nextWeight: next.fontWeight,
      labelStyle: getComputedStyle(row.querySelector('strong')).fontStyle };
  });
  assert.notEqual(styles.old, styles.next); assert.equal(styles.oldWeight, '400');
  assert.equal(styles.nextWeight, '600'); assert.equal(styles.labelStyle, 'italic');
  for (const body of requests) assert.equal(JSON.stringify(body.messages).includes('模型已切换'), false, 'client note never enters context');
  state = await snapshot();
  assert.equal(state.modelChanges[0].to.id, 'model-b');
  assert.equal(state.messages.some(message => JSON.stringify(message).includes('模型已切换')), false);
  finish();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.reload();
  await page.locator('.client-model-change').waitFor();
  assert.equal(await page.locator('.client-model-change').count(), 1, 'history refresh cannot duplicate');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/model-switch-dark.png' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.reload(); await page.locator('.client-model-change').waitFor();
  await page.screenshot({ path: 'test-results/model-switch-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 850));
  await page.locator('.client-model-change').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.client-model-change').evaluate(row => row.scrollWidth > row.clientWidth), false);
  await page.screenshot({ path: 'test-results/model-switch-narrow.png' });
  assert.equal((await readFile(state.state.sessionFile, 'utf8')).includes('模型已切换'), false, 'upstream JSONL contains no client notice');
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  const reopened = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await reopened.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await reopened.locator('.session-row > button:first-child').filter({ hasText: 'FIRST:' }).click();
  await reopened.locator('.client-model-change').waitFor();
  assert.equal(await reopened.locator('.client-model-change').count(), 1, 'sidecar survives a full application restart');
  const history = await reopened.evaluate(() => window.desktop.snapshot());
  const cloned = await reopened.evaluate(id => window.desktop.cloneSession(id), history.state.sessionId);
  assert.notEqual(cloned.state.sessionId, history.state.sessionId);
  assert.equal(cloned.modelChanges.length, 1, 'whole-session copy inherits switch history');
  await reopened.reload();
  await reopened.locator('.client-model-change').waitFor();
  const lastReply = cloned.messages.findLast(message => message.role === 'assistant' && message.display !== false);
  assert.ok(lastReply?.entryId);
  const branched = await reopened.evaluate(({ entryId, runtimeId }) => window.desktop.branchSession('clone', entryId, runtimeId),
    { entryId: lastReply.entryId, runtimeId: cloned.runtimeId });
  assert.equal(branched.modelChanges.length, 1, 'reply branch inherits switch history');
  await reopened.reload();
  await reopened.locator('.client-model-change').waitFor();
  assert.equal(await reopened.locator('.client-model-change').count(), 1);
  console.log('Model switch passed: active selection, effort, cancellation, reload, navigation, old-model steering, new-model FIFO dispatch, sidecar history, styles and context isolation.');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  finish(); await app.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
