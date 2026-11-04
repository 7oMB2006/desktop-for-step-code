import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-background-controls-'));
const root = join(profile, 'step-runtime');
await mkdir(root, { recursive: true });
await mkdir('test-results', { recursive: true });
const children = new Map();
const failures = [];
let modelRequests = 0;
const text = message => typeof message?.content === 'string' ? message.content
  : message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const part of request) { raw += part; assert.ok(raw.length < 8 * 1024 * 1024); }
    const body = JSON.parse(raw);
    modelRequests++;
    const task = text(body.messages.findLast(message => message.role === 'user'));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
      id: 'background-controls', object: 'chat.completion.chunk', model: body.model, created: 1,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (task === 'CONTROL-CHILD-A' || task === 'CONTROL-CHILD-B') {
      children.set(task, () => {
        if (!response.destroyed) response.end(
          `data: ${JSON.stringify({ id: 'child-result', object: 'chat.completion.chunk', model: body.model, created: 1,
            choices: [{ index: 0, delta: { content: 'Background child finished.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      });
      return;
    }
    if (task === 'CONTROL-PARENT' && !body.messages.some(message => message.role === 'tool')) {
      send({ tool_calls: ['A', 'B'].map((id, index) => ({
        index, id: `background-${id}`, type: 'function', function: { name: 'subagent',
          arguments: JSON.stringify({ agent: 'general', task: `CONTROL-CHILD-${id}`, run_in_background: true }) },
      })) }, 'tool_calls');
    } else send({ content: 'Parent is idle; background work continues.' }, 'stop');
    response.end('data: [DONE]\n\n');
  } catch (error) { failures.push(error.message); if (!response.headersSent) response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'dark', language: 'zh', workspaces: [] }));
await writeFile(join(root, 'config.toml'),
  'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-fixture-only',
  models: [{ id: 'fixture', name: 'Background controls fixture', contextWindow: 100000, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
  env, timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1400, 900);
  });
  const owner = await prepareSessionFixture(page);
  await page.evaluate(runtimeId => window.desktop.command('prompt', { message: 'CONTROL-PARENT' }, runtimeId), owner.runtimeId);
  const until = Date.now() + 45000;
  while (children.size < 2) {
    assert.deepEqual(failures, []);
    if (Date.now() > until) throw new Error(`Background children not started (${children.size})`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  const query = () => page.evaluate(({ runtimeId, sessionId }) =>
    window.desktop.backgroundAgents(runtimeId, sessionId), { runtimeId: snapshot.runtimeId, sessionId: snapshot.state.sessionId });
  const initial = await query();
  assert.equal(initial.lanes.length, 2);
  const first = initial.lanes.find(lane => lane.steps.some(step => step.task === 'CONTROL-CHILD-A'));
  const second = initial.lanes.find(lane => lane.steps.some(step => step.task === 'CONTROL-CHILD-B'));
  assert.ok(first && second);
  const before = await readFile(snapshot.state.sessionFile, 'utf8');
  const requests = modelRequests;
  await query();
  assert.equal(modelRequests, requests);
  assert.equal(await readFile(snapshot.state.sessionFile, 'utf8'), before);
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('desktop');
    globalThis.backgroundControlsFixture = { mode: '', stops: 0, reads: 0, release: undefined,
      holdRuntimeId: undefined, readHeld: false, releaseRead: undefined };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      const fixture = globalThis.backgroundControlsFixture;
      if (method === 'backgroundAgents') {
        fixture.reads++;
        if (fixture.mode === 'read-error') throw new Error('Injected read error');
        if (fixture.mode === 'missing-step') {
          const value = await original(event, method, ...args);
          return { ...value, lanes: value.lanes.map(lane => lane.id === fixture.dropLaneId ? { ...lane, steps: [] } : lane) };
        }
        if (fixture.mode === 'hold-read' && args[0] === fixture.holdRuntimeId) {
          const result = await original(event, method, ...args);
          fixture.readHeld = true;
          await new Promise(resolve => { fixture.releaseRead = resolve; });
          return result;
        }
      }
      if (method === 'stopBackgroundAgent') {
        fixture.stops++;
        if (fixture.mode === 'stop-error') throw new Error('Injected unconfirmed stop');
        if (fixture.mode === 'hold-stop') await new Promise(resolve => { fixture.release = resolve; });
      }
      return original(event, method, ...args);
    });
  });
  await page.locator('.right-tool-rail').getByRole('button', { name: '子代理', exact: true }).click();
  const panel = page.locator('#subagent-panel');
  await panel.getByRole('button', { name: '后台任务', exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: '后台任务', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await panel.getByRole('group', { name: '总览与管理' }).getByRole('button').allTextContents(),
    ['编排', '后台任务']);
  const checkViewGroups = async () => {
    const overview = await panel.locator('.subagent-view-overviews').boundingBox();
    const detail = await panel.getByRole('button', { name: '代理详情', exact: true }).boundingBox();
    assert.ok(overview && detail && detail.x >= overview.x + overview.width + 11,
      'Agent details remain separate to the right of the overview and management group');
    assert.equal(await panel.locator('.subagent-view-tabs button[aria-pressed="true"]').count(), 1);
  };
  await checkViewGroups();
  assert.equal(await panel.getByRole('button', { name: '代理详情', exact: true }).isDisabled(), true);
  await panel.getByText('2 个进行中 · 0 个已结束', { exact: true }).waitFor();
  const lane = id => panel.locator(`.background-agent-lane[data-lane-id="${id}"]`);
  await page.locator('.lane-row').filter({ hasText: 'CONTROL-CHILD-A' }).click();
  await panel.getByRole('button', { name: '查看后台详情', exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`.background-agent-lane[data-lane-id="${id}"]`)
    ?.getAttribute('data-expanded') === 'true', first.id);
  await lane(first.id).locator('.background-agent-disclosure > summary').click();
  await panel.getByRole('button', { name: '代理详情', exact: true }).click();
  await panel.getByRole('button', { name: '查看后台详情', exact: true }).click();
  await page.waitForFunction(id => document.querySelector(`.background-agent-lane[data-lane-id="${id}"]`)
    ?.getAttribute('data-expanded') === 'true', first.id);
  await lane(first.id).getByRole('button', { name: '停止任务', exact: true }).waitFor();
  assert.equal(await lane(first.id).locator('.agent-role-label code').textContent(), 'general',
    'Production renders the native role name without inferring an agent identity');
  await lane(first.id).getByRole('heading', { name: '任务产出', exact: true }).waitFor();
  assert.equal(await lane(first.id).getByRole('button', { name: '停止任务', exact: true }).isEnabled(), true);
  await lane(first.id).getByRole('button', { name: '停止任务', exact: true }).click();
  await lane(first.id).getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.backgroundControlsFixture.stops), 0, 'Cancel sends nothing');
  const details = panel.locator('.background-agent-inspector');
  const inspectFirst = lane(first.id).getByRole('button', { name: '查看代理详情', exact: true });
  assert.equal(await inspectFirst.evaluate(button => Boolean(button.closest('details'))), false,
    'Agent details are a sibling header action, never nested inside the disclosure');
  await inspectFirst.scrollIntoViewIfNeeded();
  const listScroll = await panel.locator('.background-agents-list').evaluate(element => element.scrollTop);
  await inspectFirst.click();
  await details.locator('.background-agent-task').getByText('CONTROL-CHILD-A', { exact: true }).waitFor();
  assert.equal(await details.getAttribute('data-lane-id'), first.id);
  assert.equal(await details.getAttribute('data-step-index'), '0');
  assert.equal(await panel.getByRole('button', { name: '代理详情', exact: true }).getAttribute('aria-pressed'), 'true');
  await checkViewGroups();
  assert.equal(await details.getByRole('button', { name: '停止任务', exact: true }).count(), 0, 'Step details do not imply step stop authority');
  const readCount = await app.evaluate(() => globalThis.backgroundControlsFixture.reads);
  await details.getByRole('button', { name: '刷新代理详情', exact: true }).click();
  const refreshDeadline = Date.now() + 10000;
  while (await app.evaluate(() => globalThis.backgroundControlsFixture.reads) <= readCount) {
    assert.ok(Date.now() < refreshDeadline, 'Details refresh the current native snapshot');
    await page.waitForTimeout(50);
  }
  assert.equal(modelRequests, requests, 'Opening and refreshing details never invokes a model');
  assert.equal(await readFile(snapshot.state.sessionFile, 'utf8'), before, 'Details never append transcript messages');
  await details.getByRole('button', { name: '返回后台任务', exact: true }).click();
  assert.equal(await lane(first.id).getAttribute('data-expanded'), 'true');
  assert.equal(await inspectFirst.evaluate(button => button === document.activeElement), true, 'Return restores the originating step focus');
  assert.ok(Math.abs(await panel.locator('.background-agents-list').evaluate(element => element.scrollTop) - listScroll) <= 1,
    'Return restores the list scroll position');
  await page.screenshot({ path: 'test-results/background-controls-dark.png' });
  await inspectFirst.click();
  await app.evaluate(() => { globalThis.backgroundControlsFixture.mode = 'read-error'; });
  await panel.getByRole('button', { name: '刷新代理详情', exact: true }).click();
  await details.getByText('当前显示上次记录，不代表实时运行状态。', { exact: true }).waitFor();
  await details.getByRole('button', { name: '返回后台任务', exact: true }).click();
  await panel.getByText(/无法刷新后台任务/).waitFor();
  await panel.getByText('2 条上次记录', { exact: true }).waitFor();
  assert.equal(await panel.locator('.background-agent-lane .subagent-status-icon[data-state="running"]').count(), 0,
    'Stale records never animate as live execution');
  assert.equal(await lane(first.id).getByRole('button', { name: '停止任务', exact: true }).isDisabled(), true);
  assert.equal(await panel.locator('.background-agent-lane').count(), 2, 'Failed reads retain labelled stale rows');
  await app.evaluate(() => { globalThis.backgroundControlsFixture.mode = ''; });
  await panel.getByRole('button', { name: '刷新后台任务', exact: true }).click();
  await panel.getByText(/无法刷新后台任务/).waitFor({ state: 'hidden' });
  await app.evaluate(() => { globalThis.backgroundControlsFixture.mode = 'stop-error'; });
  await lane(first.id).getByRole('button', { name: '停止任务', exact: true }).click();
  await lane(first.id).getByRole('button', { name: '停止此任务', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: '停止结果未确认' }).waitFor();
  await page.waitForTimeout(1600);
  assert.equal(await app.evaluate(() => globalThis.backgroundControlsFixture.stops), 1, 'No automatic stop retry');
  assert.equal((await query()).lanes.find(lane => lane.id === first.id).status, 'running');
  await app.evaluate(() => { globalThis.backgroundControlsFixture.mode = 'hold-stop'; });
  await lane(first.id).getByRole('button', { name: '停止任务', exact: true }).click();
  await lane(first.id).getByRole('button', { name: '停止此任务', exact: true }).click();
  await lane(first.id).getByRole('button', { name: '等待收尾', exact: true }).waitFor();
  assert.equal(await lane(first.id).getByRole('button', { name: '等待收尾', exact: true }).isDisabled(), true);
  await page.waitForTimeout(1700);
  assert.equal(await app.evaluate(() => globalThis.backgroundControlsFixture.stops), 2);
  await app.evaluate(() => { globalThis.backgroundControlsFixture.mode = ''; globalThis.backgroundControlsFixture.release(); });
  await page.waitForFunction(id => {
    const lane = document.querySelector(`.background-agent-lane[data-lane-id="${id}"]`);
    return lane?.getAttribute('data-lane-status') === 'aborted' && lane.getAttribute('data-settling') === 'false';
  }, first.id);
  assert.equal((await query()).lanes.find(lane => lane.id === second.id).status, 'running');
  assert.equal(await lane(first.id).getByRole('button', { name: '停止任务', exact: true }).count(), 0);
  await page.evaluate(runtimeId => window.desktop.command('prompt', { message: 'CONTROL-PARENT-AGAIN' }, runtimeId), snapshot.runtimeId);
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await page.reload();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.locator('.right-tool-rail').getByRole('button', { name: '子代理', exact: true }).click();
    await lane(second.id).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(620, 780));
    await checkViewGroups();
    await lane(second.id).locator('.background-agent-disclosure > summary').click();
    await page.waitForTimeout(300);
    await lane(second.id).getByRole('button', { name: '停止任务', exact: true }).focus();
    const focus = await lane(second.id).getByRole('button', { name: '停止任务', exact: true }).evaluate(button => {
      const box = button.getBoundingClientRect(), clips = [];
      for (let node = button.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) clips.push(node.getBoundingClientRect().toJSON());
      }
      return { box: box.toJSON(), clips, outline: getComputedStyle(button).outlineStyle };
    });
    for (const clip of focus.clips) {
      assert.ok(focus.box.left - 4 >= clip.left - 1 && focus.box.right + 4 <= clip.right + 1, 'Four-sided focus horizontal gutter');
      assert.ok(focus.box.top - 4 >= clip.top - 1 && focus.box.bottom + 4 <= clip.bottom + 1, 'Four-sided focus vertical gutter');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/background-controls-${theme}-narrow.png` });
    await lane(second.id).locator('.background-agent-disclosure > summary').click();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await lane(second.id).locator('.background-agent-disclosure > summary').click();
  await lane(second.id).getByRole('button', { name: '停止任务', exact: true }).waitFor();
  assert.equal(await lane(second.id).locator('.background-agent-disclosure > [inert]').count(), 0, 'Expanded controls are accessible');
  await lane(second.id).locator('.background-agent-disclosure > summary').click();
  assert.equal(await lane(second.id).locator('.background-agent-disclosure > [inert]').count(), 1, 'Collapsed controls are inert');
  await lane(second.id).getByRole('button', { name: '查看代理详情', exact: true }).click();
  assert.equal(await lane(second.id).getAttribute('data-expanded'), 'false', 'Opening details never expands a collapsed task');
  await details.locator('.background-agent-task').getByText('CONTROL-CHILD-B', { exact: true }).waitFor();
  assert.equal(await details.getAttribute('data-lane-id'), second.id, 'Agents with the same role remain distinct');
  children.get('CONTROL-CHILD-B')();
  await page.waitForFunction(id => document.querySelector(`.background-agent-lane[data-lane-id="${id}"]`)
    ?.getAttribute('data-lane-status') === 'completed', second.id);
  await details.getByText('Background child finished.', { exact: true }).waitFor();
  assert.equal(await details.getAttribute('data-lane-id'), second.id, 'Completion updates the selected step in place');
  assert.equal((await query()).lanes.find(lane => lane.id === first.id).status, 'aborted');
  await app.evaluate((_electron, laneId) => {
    Object.assign(globalThis.backgroundControlsFixture, { mode: 'missing-step', dropLaneId: laneId });
  }, second.id);
  await details.getByRole('button', { name: '刷新代理详情', exact: true }).click();
  await details.getByText('这个代理步骤已不在当前运行时快照中，未替换为其他代理。', { exact: true }).waitFor();
  assert.equal(await details.locator('.background-agent-step').count(), 0, 'A missing native step never falls back to a foreground record');
  assert.equal(await details.getAttribute('data-lane-id'), second.id);
  await app.evaluate(() => { globalThis.backgroundControlsFixture.mode = ''; });
  await details.getByRole('button', { name: '刷新代理详情', exact: true }).click();
  await details.getByText('Background child finished.', { exact: true }).waitFor();
  await page.reload();
  await page.locator('.right-tool-rail').getByRole('button', { name: '子代理', exact: true }).click();
  await panel.getByRole('button', { name: '后台任务', exact: true }).click();
  await lane(second.id).waitFor();
  assert.equal(await lane(second.id).getAttribute('data-lane-status'), 'completed', 'Reload reads the same current runtime');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
  const other = await page.evaluate(async () => {
    const next = await window.desktop.newIndependentSession();
    await window.desktop.command('prompt', { message: 'CONTROL-OTHER-SESSION' }, next.runtimeId);
    return next;
  });
  assert.notEqual(other.runtimeId, snapshot.runtimeId);
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.reload();
  const navigate = async sessionId => {
    await page.locator(`.session-row[data-reorder-id="${sessionId}"] > button`).first().click();
    await page.waitForFunction(async sessionId => (await window.desktop.snapshot()).state.sessionId === sessionId
      && document.querySelector(`.session-row[data-reorder-id="${sessionId}"] > button`)?.getAttribute('aria-current') === 'page'
      && !document.querySelector('.session-reading-preview')
      && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') !== 'true'
      && !document.querySelector('.composer > .composer-input')?.disabled, sessionId);
    assert.equal(await details.count(), 0, 'Actual session navigation clears the old step selection');
    await page.locator('.right-tool-rail').getByRole('button', { name: '子代理', exact: true }).click();
    await panel.getByRole('button', { name: '后台任务', exact: true }).click();
  };
  await navigate(snapshot.state.sessionId);
  await lane(second.id).waitFor();
  await lane(second.id).getByRole('button', { name: '查看代理详情', exact: true }).click();
  await details.locator('.background-agent-task').getByText('CONTROL-CHILD-B', { exact: true }).waitFor();
  await app.evaluate((_electron, runtimeId) => {
    Object.assign(globalThis.backgroundControlsFixture, { mode: 'hold-read', holdRuntimeId: runtimeId });
  }, snapshot.runtimeId);
  await panel.getByRole('button', { name: '刷新代理详情', exact: true }).click();
  const readDeadline = Date.now() + 10000;
  while (!await app.evaluate(() => globalThis.backgroundControlsFixture.readHeld)) {
    assert.ok(Date.now() < readDeadline, 'The outgoing session query reaches the delayed response');
    await page.waitForTimeout(50);
  }
  await navigate(other.state.sessionId);
  await panel.getByText('当前运行时没有后台任务记录', { exact: true }).waitFor();
  await app.evaluate(() => {
    globalThis.backgroundControlsFixture.mode = '';
    globalThis.backgroundControlsFixture.releaseRead();
  });
  await page.waitForTimeout(1700);
  assert.equal(await panel.locator('.background-agent-lane').count(), 0, 'Late results never enter another session');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, other.state.sessionId);
  await navigate(snapshot.state.sessionId);
  await lane(second.id).waitFor();
  assert.equal(await panel.locator('.background-agent-lane').count(), 2, 'Returning reads only the original runtime');
  assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  console.log('Background controls passed: real IPC/RPC, read-only step details, return focus/scroll, live completion, targeted stop, independent parent/peer, stale reads, unconfirmed stop, no retry, reload, late-response session isolation, narrow focus and reduced motion.');
} finally {
  await app.evaluate(() => globalThis.backgroundControlsFixture?.releaseRead?.()).catch(() => {});
  for (const release of children.values()) release();
  await closeDesktopFixture(app);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
