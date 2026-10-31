import { closeDesktopFixture } from './close-desktop-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { assertPersistentTurnStatus } from './turn-status-assertions.mjs';

const requests = [];
const streams = new Set();
let finishNext = false;
let plainNext = false;
let awaitingGoalResult = false;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'goal-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const complete = res => {
  awaitingGoalResult = true;
  res.end(chunk({ tool_calls: [{ index: 0, id: 'finish-goal', type: 'function',
    function: { name: 'update_goal', arguments: '{"status":"complete"}' } }] }, 'tool_calls') + 'data: [DONE]\n\n');
};
const server = createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part;
  const payload = JSON.parse(body); requests.push(payload);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (awaitingGoalResult) {
    // Runtime context hooks may append reminders after a valid tool result.
    assert.ok(payload.messages.some(message => message.role === 'tool' && message.tool_call_id === 'finish-goal'),
      'The Goal completion result reaches the provider despite trailing runtime context');
    await writeFile('test-results/launch-goal-provider-shape.json', JSON.stringify({
      messages: payload.messages.map(message => ({ role: message.role, toolCallId: message.tool_call_id })),
      trailingContext: JSON.stringify(payload.messages.at(-1)?.content).slice(0, 1500),
    }, null, 2));
    awaitingGoalResult = false;
    res.end(chunk({ role: 'assistant', content: '目标已完成，验证结果保留在当前会话。' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
    return;
  }
  res.write(chunk({ role: 'assistant', content: '正在检查目标与验证条件。' }));
  if (plainNext) { plainNext = false; res.end(chunk({}, 'stop') + 'data: [DONE]\n\n'); return; }
  if (finishNext) { finishNext = false; complete(res); return; }
  streams.add(res);
  const timer = setInterval(() => res.write(chunk({ content: '继续核验。' })), 700);
  res.on('close', () => { clearInterval(timer); streams.delete(res); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'desktop-launch-modes-'));
const root = join(profile, 'step-runtime');
const reuseDirectory = join(profile, 'reuse-workspace');
await mkdir(root, { recursive: true });
await mkdir(reuseDirectory);
const reuseWorkspace = await realpath(reuseDirectory);
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [reuseWorkspace] }));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture',
  providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-test',
    models: [{ id: 'fixture', name: 'Goal fixture', input: ['text', 'image'], contextWindow: 32768, maxTokens: 2048 }] } } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 960);
  });
  await page.waitForFunction(() => !document.querySelector('.composer-wrap[aria-busy="true"]') && !document.querySelector('.composer > .composer-input')?.disabled, undefined, { timeout: 60000 });
  const initial = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(initial.draftId);
  const permissions = page.getByRole('button', { name: '访问权限', exact: true });
  const mode = name => page.getByRole('menuitemcheckbox', { name, exact: true });
  await permissions.click();
  assert.equal(await page.getByRole('menuitemcheckbox').count(), 3);
  assert.equal(await page.getByRole('menuitemradio').count(), 3);
  assert.equal(await page.getByText('普通', { exact: true }).count(), 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/launch-permissions-dark.png' });
  await mode('计划模式').click();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.plan, true);
  await permissions.click(); await mode('目标模式').click();
  let snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.plan, false); assert.equal(snapshot.launch.goalArmed, true);
  assert.equal(snapshot.sessions.length, initial.sessions.length);
  assert.equal(snapshot.runtimeId, undefined, 'Arming must not create a worker');
  await permissions.click(); await mode('Ultracode').click();
  await page.waitForFunction(() => document.querySelector('.launch-status-composer')?.querySelectorAll('svg').length === 2);
  await page.screenshot({ path: 'test-results/launch-goal-ultracode-armed.png' });
  // Switching projects/draft pages preserves the choices but creates no history.
  await page.evaluate(() => window.desktop.beginSession());
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.goalArmed, true); assert.equal(snapshot.launch.ultracodeArmed, true);
  assert.equal(snapshot.launch.ultracode, false);
  assert.equal(snapshot.sessions.length, initial.sessions.length);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.composer-wrap[aria-busy="true"]') && !document.querySelector('.composer > .composer-input')?.disabled);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==';
  await page.evaluate(data => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], 'goal.png', { type: 'image/png' }));
    document.querySelector('.composer > .composer-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, png);
  await page.locator('.attachments .attachment-card').waitFor();
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  await input.fill('核验这个图片，并完成本地测试目标。');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.launch-status-pulse')?.getAttribute('data-goal-state') === 'active', undefined, { timeout: 60000 });
  await page.locator('.messages .message.user img').waitFor();
  assert.ok(requests.some(request => JSON.stringify(request.messages).includes('image_url')), 'Goal attachments reach the model');
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  const sessionId = snapshot.state.sessionId, runtimeId = snapshot.runtimeId;
  assert.equal(snapshot.launch.goalArmed, false);
  assert.equal(snapshot.launch.goal.objective, '核验这个图片，并完成本地测试目标。');
  assert.equal(snapshot.launch.goal.ultracode, true);
  assert.equal(snapshot.launch.ultracode, false, 'Goal orchestration must not enable session-standing mode');
  assert.equal(snapshot.launch.ultracodeArmed, false);
  assert.equal(await page.locator('.composer .launch-status-trigger').count(), 0, 'Sent choices leave the composer');
  assert.equal(await page.locator('.messages').getByText(/Continue working toward/).count(), 0);
  await page.locator('.launch-status-pulse').click();
  await page.getByRole('dialog', { name: '任务状态', exact: true }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/launch-goal-running-dark.png' });
  await page.getByRole('button', { name: '暂停目标', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.launch-status-pulse')?.getAttribute('data-goal-state') === 'paused');
  assert.equal(await page.locator('.working .working-dot').count(), 0, 'Paused Goal keeps a quiet entry, not a fake running pulse');
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.goal.status, 'paused');
  assert.equal(await page.locator('.message.user').getByRole('button', { name: '编辑并重做', exact: true }).isDisabled(), true,
    'Goal input remains managed through Goal editing rather than ordinary message retry');
  // Exercise actual runtime notifications after creation, not only draft selections.
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  for (const enabled of [true, false]) {
    await permissions.click();
    await mode('Ultracode').click();
    await page.waitForFunction(async enabled => (await window.desktop.snapshot()).launch.ultracodeArmed === enabled, enabled);
    assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.ultracode, false);
    assert.equal(await page.locator('.error-banner, .app-error-banner, .modal-error').count(), 0, 'Actual Ultracode switch must not report a false failure');
    assert.equal(await page.getByText('Ultracode is on for the session.', { exact: false }).count(), 0, 'Inline status replaces redundant runtime info toast');
  }
  await page.locator('.launch-status-pulse').click();
  await page.getByRole('button', { name: '编辑目标', exact: true }).click();
  await page.getByRole('textbox', { name: '目标内容', exact: true }).fill('核验图片并让测试通过');
  await page.getByRole('button', { name: '保存目标', exact: true }).click();
  await page.getByLabel('Token 预算', { exact: true }).fill('100000');
  await page.getByRole('button', { name: '保存预算', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.goal.tokenBudget === 100000);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(async id => {
    await window.desktop.command('set_launch_mode', { mode: 'plan', enabled: true }, id);
  }, runtimeId);
  await page.reload();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).launch.planArmed === true);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.goal.status, 'paused');
  await page.locator('.launch-status-pulse').click();
  await page.waitForTimeout(250);
  finishNext = true;
  await page.getByRole('button', { name: '恢复目标', exact: true }).click();
  // Poll IPC in the test process: browser polling can treat its Promise as truthy.
  let approval;
  const approvalDeadline = Date.now() + 60000;
  while (!approval && Date.now() < approvalDeadline) {
    const snapshot = await page.evaluate(() => window.desktop.snapshot());
    approval = snapshot.requests?.find(request => request.method === 'confirm' && /update_goal/.test(request.title ?? '') && request.message?.includes('Call: finish-goal'));
    if (!approval) await page.waitForTimeout(100);
  }
  assert.ok(approval, 'The specific Goal completion approval must arrive');
  assert.match(approval.message, /Call: finish-goal/);
  await page.getByRole('button', { name: '批准本次操作', exact: true }).click();
  const removalDeadline = Date.now() + 15000;
  while ((await page.evaluate(() => window.desktop.snapshot())).requests?.some(request => request.id === approval.id)) {
    assert.ok(Date.now() < removalDeadline, 'The clicked approval must be consumed');
    await page.waitForTimeout(100);
  }
  await page.waitForFunction(() => document.querySelector('.launch-status-pulse')?.getAttribute('data-goal-state') === 'complete', undefined, { timeout: 60000 });
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.plan, false);
  assert.equal(snapshot.state.sessionId, sessionId);
  assert.equal(snapshot.launch.goal.objective, '核验图片并让测试通过');
  assert.equal(snapshot.launch.goal.tokenBudget, 100000);
  const goalInput = snapshot.messages.find(message => message.customType === 'desktop-goal-input');
  assert.ok(goalInput?.details?.desktopGoalInputId, 'Goal input has a persisted Desktop identity');
  assert.equal(goalInput.entryId, snapshot.launch.goal.completion.userEntryId,
    'Completed Goal belongs to the exact persisted input, not a coincident timestamp');
  await page.locator('.working-idle .launch-status-pulse').waitFor();
  const assertIdleAnchor = async () => {
    await page.waitForFunction(() => {
      const row = document.querySelector('.working-idle')?.getBoundingClientRect();
      const trigger = document.querySelector('.working-idle .launch-status-pulse')?.getBoundingClientRect();
      return row && trigger && Math.abs(row.right - trigger.right) <= 1;
    });
    const rightDifference = await page.evaluate(() => {
      const row = document.querySelector('.working-idle').getBoundingClientRect();
      const trigger = document.querySelector('.working-idle .launch-status-pulse').getBoundingClientRect();
      return Math.abs(row.right - trigger.right);
    });
    assert.ok(rightDifference <= 1, `Idle task entry stays at the transcript right edge (${rightDifference}px)`);
    assert.equal(await page.locator('.working-idle .working-dot').count(), 0, 'Idle entry has no running pulse');
  };
  await assertIdleAnchor();
  await page.waitForFunction(() => {
    const trigger = document.querySelector('.working-idle .launch-status-pulse');
    const actions = trigger?.closest('.assistant-footer-row')?.querySelector('.assistant-actions');
    if (!actions) return false;
    const left = actions.getBoundingClientRect(), right = trigger.getBoundingClientRect();
    return Math.abs(left.y + left.height / 2 - right.y - right.height / 2) <= 1 && left.right <= right.left;
  });
  // Completion can reparent the trigger and start a new entrance after polling.
  await settleLayout(page.locator('.assistant-footer-row:has(.launch-status-pulse[data-goal-state="complete"])'));
  const completedFooter = await page.locator('.working-idle .launch-status-pulse').evaluate(element => {
    const actions = element.closest('.assistant-footer-row')?.querySelector('.assistant-actions');
    if (!actions) return null;
    const left = actions.getBoundingClientRect(), right = element.getBoundingClientRect();
    return { actions: left.toJSON(), trigger: right.toJSON(),
      centerDifference: Math.abs(left.y + left.height / 2 - right.y - right.height / 2) };
  });
  assert.ok(completedFooter && completedFooter.centerDifference <= 1
    && completedFooter.actions.right <= completedFooter.trigger.left,
  `Goal shares the final response footer rather than adding another row: ${JSON.stringify(completedFooter)}`);
  await page.mouse.move(0, 0);
  await page.locator('.composer > .composer-input').focus();
  await page.waitForTimeout(200);
  await assertPersistentTurnStatus(page.locator('.working-idle .launch-status-pulse'));
  await page.screenshot({ path: 'test-results/launch-goal-completed-dark.png' });
  // Completion persists across renderer reload and session navigation.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.launch-status-pulse')?.getAttribute('data-goal-state') === 'complete');
  await page.evaluate(() => window.desktop.preferences({ theme: 'light', language: 'en' }));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await assertIdleAnchor();
  await page.locator('.launch-status-pulse').click();
  await page.waitForTimeout(220);
  const detailRightDifference = await page.evaluate(() => {
    const panel = document.querySelector('.launch-status-panel-inline').getBoundingClientRect();
    const row = document.querySelector('.working-idle').getBoundingClientRect();
    return Math.abs(panel.right - row.right);
  });
  assert.ok(detailRightDifference <= 1, 'Idle details unfold along the right edge');
  await page.screenshot({ path: 'test-results/launch-goal-completed-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 700));
  await page.waitForTimeout(250);
  await assertIdleAnchor();
  await page.screenshot({ path: 'test-results/launch-goal-narrow.png' });
  const bounds = await page.getByRole('dialog', { name: 'Task state', exact: true }).boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(bounds.x >= 0 && bounds.y >= 54 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.locator('.composer > .composer-input').fill('目标完成后的新一轮普通任务。');
  await page.locator('.composer > .composer-input').press('Enter');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.isStreaming);
  assert.equal(await page.locator('.working:not(.assistant-footer-row) .launch-status-pulse').count(), 0,
    'Completed Goal and its Ultracode intent never appear in the next task pulse');
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.goal.status, 'complete', 'A fresh prompt does not resume the completed Goal');
  assert.equal(Boolean(snapshot.launch.ultracodeTurn), false, 'Completed Goal opt-in does not authorize the next task');
  const completedAnchor = page.locator('.assistant-footer-row .launch-status-pulse[data-goal-state="complete"]');
  assert.equal(await completedAnchor.count(), 1, 'Original completed response keeps its marker');
  assert.ok(await completedAnchor.evaluate(element => {
    const owner = element.closest('.message.assistant');
    const nextUser = [...document.querySelectorAll('.message.user')].at(-1);
    return Boolean(owner.compareDocumentPosition(nextUser) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), 'Completed marker remains before the new user turn');
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/launch-goal-next-turn-isolated.png' });
  await page.evaluate(() => window.desktop.command('abort'));
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.reload();
  await completedAnchor.waitFor();
  assert.equal(await page.locator('.message.assistant').last().locator('.launch-status-pulse').count(), 0,
    'Reload never relocates the completed Goal into the latest response');
  await completedAnchor.click();
  await page.getByRole('button', { name: 'Clear goal', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.launch-status-trigger'));
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).launch.goal, undefined);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark', language: 'zh' }));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  // Real ordinary-turn opt-in consumes the chip; a later plain task gets no standing consent.
  await page.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'ultracode', enabled: true }));
  await input.fill('检查本次任务，不要继承到下一条。');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.working .launch-status-pulse'));
  await page.waitForFunction(async () => (await window.desktop.snapshot()).messages.some(message => message.customType === 'ultraloop-opt-in' && JSON.stringify(message.content).includes('opting this turn')));
  assert.equal(await page.locator('.composer .launch-status-trigger').count(), 0);
  assert.equal(await page.locator('.message.user').getByText('检查本次任务，不要继承到下一条。', { exact: true }).count(), 1);
  await page.screenshot({ path: 'test-results/launch-ultracode-pulse-dark.png' });
  await page.evaluate(() => window.desktop.command('abort'));
  await page.waitForFunction(() => !document.querySelector('.working .launch-status-pulse'));
  const remindersBeforeOrdinary = (await page.evaluate(() => window.desktop.snapshot())).messages
    .filter(message => ['ultraloop-opt-in', 'ultraloop-discovery'].includes(message.customType)).length;
  plainNext = true;
  await input.fill('下一条普通任务。');
  await input.press('Enter');
  await page.waitForFunction(async () => {
    const state = await window.desktop.snapshot();
    return !state.state.isStreaming && state.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('下一条普通任务。'));
  });
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.launch.ultracode, false);
  assert.equal(snapshot.launch.ultracodeArmed, false);
  assert.equal(snapshot.messages.filter(message => ['ultraloop-opt-in', 'ultraloop-discovery'].includes(message.customType)).length,
    remindersBeforeOrdinary, 'Ordinary next turn neither repeats discovery guidance nor adds orchestration consent');
  await input.fill('先执行普通任务，等待插队。');
  await input.press('Enter');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.isStreaming);
  await page.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'ultracode', enabled: true }));
  await input.fill('这一条用编排补充检查。');
  await input.press('Enter');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).pendingMessages?.length === 1);
  snapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshot.pendingMessages[0].message, '这一条用编排补充检查。');
  assert.equal(snapshot.launch.ultracodeArmed, false);
  assert.equal(await page.locator('.composer .launch-status-trigger').count(), 0);
  assert.equal(await page.locator('.working .launch-status-pulse').count(), 0, 'Queued opt-in has not yet entered the active task');
  await page.evaluate(() => window.desktop.command('queue_steer_first'));
  for (const stream of streams) stream.end(chunk({}, 'stop') + 'data: [DONE]\n\n');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).pendingMessages?.length === 0);
  await page.waitForFunction(() => document.querySelector('.working .launch-status-pulse'));
  assert.equal(await page.locator('.message.user').getByText('这一条用编排补充检查。', { exact: true }).count(), 1);
  await page.evaluate(() => window.desktop.command('abort'));
  await page.waitForFunction(() => !document.querySelector('.working .launch-status-pulse'));
  await page.evaluate(() => window.desktop.command('set_launch_mode', { mode: 'plan', enabled: true }));
  plainNext = true;
  await input.fill('规划下一步。');
  await input.press('Enter');
  await page.waitForFunction(async () => {
    const state = await window.desktop.snapshot();
    return !state.state.isStreaming && state.launch.plan && !state.launch.planArmed;
  });
  await page.waitForFunction(() => !document.querySelector('.composer .launch-status-trigger')
    && document.querySelector('.working-idle .launch-status-pulse'));
  assert.equal(await page.locator('.composer .launch-status-trigger').count(), 0);
  await page.locator('.launch-status-pulse').click();
  await page.getByRole('button', { name: '关闭计划', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.launch-status-trigger'));
  const firstDraft = await page.evaluate(workspace => window.desktop.beginSession(workspace), reuseWorkspace);
  const firstEmpty = await page.evaluate(id => window.desktop.createDraftSession(id), firstDraft.draftId);
  for (const mode of ['plan', 'goal']) {
    await page.evaluate(async mode => {
      await window.desktop.command('set_launch_mode', { mode, enabled: true });
      await window.desktop.command('set_launch_mode', { mode: 'ultracode', enabled: true });
    }, mode);
    const freshDraft = await page.evaluate(workspace => window.desktop.beginSession(workspace), reuseWorkspace);
    assert.equal(freshDraft.launch.plan, false);
    assert.equal(freshDraft.launch.goalArmed, false);
    assert.equal(Boolean(freshDraft.launch.ultracodeArmed), false);
    const reused = await page.evaluate(id => window.desktop.createDraftSession(id), freshDraft.draftId);
    assert.equal(reused.runtimeId, firstEmpty.runtimeId, 'The same empty resident worker is reused');
    assert.equal(reused.launch.plan, false);
    assert.equal(Boolean(reused.launch.planArmed), false);
    assert.equal(reused.launch.goalArmed, false);
    assert.equal(reused.launch.ultracodeArmed, false);
    assert.equal(reused.messages.length, 0);
  }
  await page.evaluate(() => window.desktop.preferences({ theme: 'light', language: 'en' }));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 700));
  await page.getByRole('button', { name: 'Access permissions', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Access permissions', exact: true });
  await page.waitForTimeout(250);
  const menuBounds = await menu.boundingBox();
  assert.ok(menuBounds.y >= 54 && menuBounds.y + menuBounds.height <= viewport.height + 1, 'Permission menu fits the narrow viewport');
  await menu.press('Home');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Plan');
  await menu.press('End');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Full Access/);
  await menu.press('Escape');
  assert.equal(await menu.count(), 0);
  assert.deepEqual(errors, []);
  console.log('Launch modes: real Goal RPC/SSE, attachments, draft arming, pulse management, pause/resume/edit/budget/complete/clear, single-task Ultracode, queue steering without inherited consent, light/dark and narrow UI passed.');
} catch (error) {
  const page = await app.firstWindow().catch(() => undefined);
  if (page) {
    console.error('Launch failure state:', JSON.stringify(await page.evaluate(async () => {
      const snapshot = await window.desktop.snapshot();
      return {
        launch: snapshot.launch,
        state: snapshot.state,
        requests: snapshot.requests,
        messages: snapshot.messages,
        statuses: [...document.querySelectorAll('.launch-status-pulse')].map(node => ({
          text: node.textContent, goalState: node.getAttribute('data-goal-state'),
        })),
      };
    }).catch(() => undefined)));
  }
  throw error;
} finally {
  for (const stream of streams) stream.destroy();
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => {});
  await closeDesktopFixture(app).catch(() => {});
  await new Promise(resolve => server.close(resolve));
}
