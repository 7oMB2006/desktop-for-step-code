import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessionFixture, waitForSessionFixtureTools } from './session-fixture.mjs';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-background-replies-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await mkdir('test-results/background-replies', { recursive: true });
const releases = new Map(), seen = [], failures = [];
const scenarios = new Set(['REPLY-PARENT', 'REPLY-PARENT-HOLD', 'REPLY-CHILD-A',
  'REPLY-CHILD-B', 'REPLY-QUEUED', 'REPLY-CONTINUE']);
const text = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const part of request) { raw += part; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    const task = body.messages.filter(message => message.role === 'user').map(text)
      .findLast(value => scenarios.has(value));
    assert.ok(task, 'Expected an explicit reply fixture scenario');
    seen.push(task);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
      id: 'background-replies', object: 'chat.completion.chunk', model: body.model, created: 1,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (['REPLY-CHILD-A', 'REPLY-CHILD-B', 'REPLY-QUEUED', 'REPLY-CONTINUE', 'REPLY-PARENT-HOLD'].includes(task)) {
      if (task === 'REPLY-QUEUED' || task === 'REPLY-CONTINUE') {
        assert.ok(body.messages.some(message => text(message).includes('REPLY-CHILD-A-DONE')), 'Original child history remains');
        if (task === 'REPLY-CONTINUE') assert.ok(body.messages.some(message => text(message).includes('REPLY-QUEUED-DONE')));
      }
      if (task === 'REPLY-CONTINUE') send({ content: Array.from({ length: 20 },
        (_, index) => `Output paragraph ${index + 1}: the original child continues independently.`).join('\n\n')
        + '\n\nFOLLOW-UP-LONG-OUTPUT-END' });
      releases.set(task, () => {
        if (response.destroyed) return;
        send({ content: `${task}-DONE` }, 'stop');
        response.end('data: [DONE]\n\n');
      });
      return;
    }
    if (task === 'REPLY-PARENT' && !body.messages.some(message => message.role === 'tool')) {
      send({ tool_calls: ['A', 'B'].map((id, index) => ({
        index, id: `reply-${id}`, type: 'function', function: { name: 'subagent',
          arguments: JSON.stringify({ agent: 'general', task: `REPLY-CHILD-${id}`, run_in_background: true }) },
      })) }, 'tool_calls');
    } else send({ content: 'Parent remains independent.' }, 'stop');
    response.end('data: [DONE]\n\n');
  } catch (error) { failures.push(error.message); if (!response.headersSent) response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [] }));
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-fixture-only',
  models: [{ id: 'fixture', name: 'Background reply fixture', contextWindow: 100000, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
    env, timeout: 60000,
  });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1400, 900);
  });
  const owner = await prepareSessionFixture(page);
  await waitForSessionFixtureTools(page, owner.runtimeId);
  await page.evaluate(id => window.desktop.command('prompt', { message: 'REPLY-PARENT' }, id), owner.runtimeId);
  const waitFor = async predicate => {
    const deadline = Date.now() + 30000;
    while (!await predicate()) {
      assert.deepEqual(failures, []);
      assert.ok(Date.now() < deadline, `Reply fixture timed out; requests=${seen.length}`);
      await page.waitForTimeout(30);
    }
  };
  await waitFor(() => releases.has('REPLY-CHILD-A') && releases.has('REPLY-CHILD-B'));
  await waitFor(async () => !(await page.evaluate(() => window.desktop.snapshot())).state.isStreaming);
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  const query = () => page.evaluate(({ runtimeId, sessionId }) =>
    window.desktop.backgroundAgents(runtimeId, sessionId), { runtimeId: owner.runtimeId, sessionId: snapshot.state.sessionId });
  const initial = await query();
  assert.equal(initial.replyAvailable, true);
  const first = initial.lanes.find(lane => lane.steps[0].task === 'REPLY-CHILD-A');
  const second = initial.lanes.find(lane => lane.steps[0].task === 'REPLY-CHILD-B');
  assert.ok(first && second);
  const before = await readFile(snapshot.state.sessionFile, 'utf8'), beforeRequests = seen.length;
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('desktop');
    globalThis.backgroundReplyFixture = { mode: 'lost-receipt', requests: [] };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      const fixture = globalThis.backgroundReplyFixture;
      if (method !== 'replyBackgroundAgent') return original(event, method, ...args);
      fixture.requests.push({ laneId: args[0].laneId, requestId: args[0].requestId });
      const result = await original(event, method, ...args);
      if (fixture.mode === 'lost-receipt') throw new Error('Injected lost receipt after delivery');
      if (fixture.mode === 'hold-receipt') await new Promise(resolve => { fixture.release = resolve; });
      return result;
    });
  });
  await page.locator('.right-tool-rail').getByRole('button', { name: '子代理', exact: true }).click();
  const panel = page.locator('#subagent-panel'), details = panel.locator('.background-agent-inspector');
  const lane = id => panel.locator(`.background-agent-lane[data-lane-id="${id}"]`);
  const open = async id => {
    await lane(id).getByRole('button', { name: '查看代理详情', exact: true }).click();
    await details.getByRole('textbox', { name: '追加任务内容', exact: true }).waitFor();
  };
  const editor = details.getByRole('textbox', { name: '追加任务内容', exact: true });
  const send = details.getByRole('button', { name: '发送追加任务', exact: true });
  await open(first.id);
  assert.equal(await editor.getAttribute('contenteditable'), 'true', 'Reuse the real shared composer');
  assert.equal(await details.locator('textarea').count(), 0);
  await editor.fill('REPLY-QUEUED'); await send.click();
  await details.getByRole('alert').filter({ hasText: '发送结果未确认' }).waitFor();
  assert.equal(await editor.evaluate(element => element.value), 'REPLY-QUEUED');
  await page.waitForTimeout(1700);
  assert.equal(await app.evaluate(() => globalThis.backgroundReplyFixture.requests.length), 1, 'No automatic retry');
  assert.equal(seen.length, beforeRequests, 'Queuing does not interrupt or invoke the model immediately');
  assert.equal(await readFile(snapshot.state.sessionFile, 'utf8'), before);
  await app.evaluate(() => { globalThis.backgroundReplyFixture.mode = ''; });
  await send.click();
  await details.getByRole('status').filter({ hasText: /^已排队$/ }).waitFor();
  assert.equal(await editor.evaluate(element => element.value), '');
  const attempts = await app.evaluate(() => globalThis.backgroundReplyFixture.requests);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].requestId, attempts[1].requestId);
  releases.get('REPLY-CHILD-A')();
  await waitFor(() => releases.has('REPLY-QUEUED'));
  assert.equal(seen.filter(task => task === 'REPLY-QUEUED').length, 1, 'Lost receipt retry delivers once');
  assert.equal((await query()).lanes.find(lane => lane.id === second.id).status, 'running');
  releases.get('REPLY-QUEUED')();
  await waitFor(async () => {
    const current = (await query()).lanes.find(lane => lane.id === first.id);
    return current.status === 'completed' && !current.settling;
  });
  await page.evaluate(id => window.desktop.command('prompt', { message: 'REPLY-PARENT-HOLD' }, id), owner.runtimeId);
  await waitFor(() => releases.has('REPLY-PARENT-HOLD'));
  await editor.fill('REPLY-CONTINUE');
  await app.evaluate(() => { globalThis.backgroundReplyFixture.mode = 'hold-receipt'; });
  await send.click();
  await waitFor(() => releases.has('REPLY-CONTINUE'));
  assert.equal(await send.isDisabled(), true);
  await details.getByRole('button', { name: '返回后台任务', exact: true }).click();
  await open(second.id);
  await editor.fill('A separate unsent draft.');
  await app.evaluate(() => { globalThis.backgroundReplyFixture.mode = ''; globalThis.backgroundReplyFixture.release(); });
  await page.waitForTimeout(100);
  assert.equal(await editor.evaluate(element => element.value), 'A separate unsent draft.', 'Late receipt cannot replace another lane draft');
  await details.getByRole('button', { name: '返回后台任务', exact: true }).click();
  await open(first.id);
  await details.getByRole('status').filter({ hasText: /^已启动$/ }).waitFor();
  assert.equal(await editor.evaluate(element => element.value), '');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.isStreaming, true, 'Parent was not interrupted');
  const main = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(main.messages.some(message => message.role === 'user'
    && ['REPLY-QUEUED', 'REPLY-CONTINUE'].includes(text(message))), false, 'Follow-ups are not parent user turns');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await page.reload();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.locator('.right-tool-rail').getByRole('button', { name: '子代理', exact: true }).click();
    await open(first.id);
    await details.getByText('FOLLOW-UP-LONG-OUTPUT-END', { exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(620, 780));
    await editor.fill('A multiline draft.\nCheck the complete focus ring.'); await editor.focus();
    await page.waitForTimeout(350);
    const focus = await editor.evaluate(element => {
      const composer = element.closest('.composer'), box = composer.getBoundingClientRect(), clips = [];
      for (let node = composer.parentElement; node; node = node.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflow)) clips.push(node.getBoundingClientRect().toJSON());
      }
      return { box: box.toJSON(), clips, outline: getComputedStyle(composer).outlineWidth };
    });
    assert.equal(focus.outline, '2px');
    for (const clip of focus.clips) {
      assert.ok(focus.box.left - 4 >= clip.left - 1 && focus.box.right + 4 <= clip.right + 1, 'Horizontal focus gutter');
      assert.ok(focus.box.top - 4 >= clip.top - 1 && focus.box.bottom + 4 <= clip.bottom + 1, 'Vertical focus gutter');
    }
    await page.screenshot({ path: `test-results/background-replies/${theme}-narrow.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await send.isDisabled(), false, 'A nonempty draft remains sendable');
  const beforeClear = await app.evaluate(() => globalThis.backgroundReplyFixture.requests.length);
  await editor.press('ControlOrMeta+a');
  await editor.press('Backspace');
  await waitFor(() => editor.evaluate(element => element.value === '' && element.dataset.empty === 'true'));
  assert.equal(await send.isDisabled(), true);
  assert.equal(await app.evaluate(() => globalThis.backgroundReplyFixture.requests.length), beforeClear,
    'Clearing the draft never submits a follow-up');
  releases.get('REPLY-CONTINUE')(); releases.get('REPLY-CHILD-B')(); releases.get('REPLY-PARENT-HOLD')();
  await waitFor(async () => (await query()).lanes.every(lane => lane.status === 'completed' && !lane.settling));
  assert.equal(seen.filter(task => task === 'REPLY-CONTINUE').length, 1);
  assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  console.log('Background replies passed: real composer/IPC/RPC, queued delivery, retained child context, lost-receipt deduplication, continuation, independent parent/peer, per-lane drafts, focus gutters and reduced motion. Isolated loopback provider only.');
} catch (error) {
  const page = await app?.firstWindow().catch(() => undefined);
  await page?.screenshot({ path: 'test-results/background-replies/failure.png' }).catch(() => {});
  throw error;
} finally {
  await app?.evaluate(() => globalThis.backgroundReplyFixture?.release?.()).catch(() => {});
  for (const release of releases.values()) release();
  try {
    if (app) await closeDesktopFixtureAndWait(app);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
