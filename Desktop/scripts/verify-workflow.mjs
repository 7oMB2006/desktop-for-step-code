import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-workflow-ui-'));
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
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1500, 1000);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await prepareSessionFixture(page);
  const agents = [
    ['品牌与时间线', '提取信息', 'completed'], ['数字与市场数据', '提取信息', 'completed'], ['合作主体与商业模式', '提取信息', 'completed'],
    ['合并事实并修订摘要', '整理摘要', 'completed'], ['限定词与断言强度', '交叉审查', 'running'],
    ['主体与合作关系', '交叉审查', 'running'], ['新增信息与来源归属', '交叉审查', 'running'], ['逐项确认修改结果', '最终核验', 'queued'],
  ].map(([label, phase, status], index) => ({ id: `agent-${index}`, label, phase, status,
    task: `对照原始报告与修订摘要，核验${label}。逐项列出差异，保留来源和限定条件。`,
    startedAt: status === 'queued' ? undefined : Date.now() - 32000,
    finishedAt: status === 'completed' ? Date.now() - 5000 : undefined }));
  const progress = { schemaVersion: 1, runId: 'wf_fixture', name: '摘要校准', status: 'running', agents,
    startedAt: Date.now() - 252000, totalAgents: 8, completedAgents: 4, spentTokens: 90000, currentPhase: '交叉审查' };
  const messages = [
    { role: 'user', timestamp: Date.now() - 260000, content: '用 Ultracode 校准摘要，提取事实、交叉审查，最后核验修改结果。' },
    { role: 'assistant', timestamp: Date.now() - 255000, content: [
      { type: 'text', text: '先并行核对三个维度，再整理摘要。之后交叉审查限定词、主体关系和原文之外的信息。' },
      { type: 'toolCall', id: 'workflow-fixture', name: 'workflow', arguments: { name: '摘要校准', script: 'fixture' } },
    ] },
    { role: 'toolResult', toolName: 'workflow', toolCallId: 'workflow-fixture', content: '', details: progress },
  ];
  await app.evaluate(({ ipcMain }, model) => {
    globalThis.workflowFixture = model;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => method === 'snapshot' ? globalThis.workflowFixture
      : method === 'sessions' ? globalThis.workflowFixture.sessions
        : method === 'summary' ? { sessionId: model.state.sessionId, tasks: [], mcp: [], skillCount: 0 }
          : method === 'systemTheme' ? { systemDark: true }
            : method === 'preferences' ? Object.assign(globalThis.workflowFixture.preferences, args[0])
              : method === 'command' && args[0] === 'get_available_thinking_levels' ? { levels: ['off', 'low', 'medium', 'high'] }
                : method === 'command' && args[0] === 'get_commands' ? { commands: [] } : {});
  }, { ...snapshot, messages, state: { ...snapshot.state, isStreaming: true },
    launch: { plan: false, ultracode: false, ultracodeTurn: true, goalArmed: false,
      goal: { id: 'goal-fixture', sessionId: snapshot.state.sessionId, objective: '校准摘要并完成最终核验', status: 'active', ultracode: true,
        tokensUsed: 90000, tokenBudget: 200000, timeUsedSeconds: 252, iteration: 3,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } });
  await page.reload();
  const panel = page.locator('#subagent-panel[aria-hidden="false"]');
  await page.locator('.workflow-inline').waitFor();
  assert.match(await page.locator('.working').innerText(), /正在阶跃/);
  assert.equal(await page.locator('.workflow-inline .workflow-count').innerText(), '4 / 8');
  assert.equal(await page.locator('.composer .launch-status-trigger').count(), 0);
  assert.equal(await page.locator('.working .launch-status-pulse').count(), 1);
  assert.equal(await page.locator('.working .launch-status-pulse svg.lucide-network').count(), 0, 'The actual workflow owns the orchestration entry');
  const entrance = await page.evaluate(async () => {
    document.querySelector('.working .launch-status-pulse').click();
    const frames = [], start = performance.now();
    while (performance.now() - start < 260) {
      await new Promise(requestAnimationFrame);
      frames.push(document.querySelector('.launch-inline-reveal')?.getBoundingClientRect().height ?? 0);
    }
    return frames;
  });
  assert.ok(entrance.some(height => height > 1 && height < entrance.at(-1) - 2), 'Details unfold through intermediate heights');
  await page.getByRole('dialog', { name: '任务状态', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Token 预算', { exact: true }).inputValue(), '200000');
  await page.waitForTimeout(250);
  const anchorBounds = await page.locator('.working .launch-status-pulse').boundingBox();
  const detailBounds = await page.getByRole('dialog', { name: '任务状态', exact: true }).boundingBox();
  assert.ok(detailBounds.y >= anchorBounds.y + anchorBounds.height && Math.abs(detailBounds.x - anchorBounds.x) <= 1,
    'Details open below the original pulse anchor, not over the preceding conversation');
  await page.screenshot({ path: 'test-results/launch-goal-workflow-details-dark.png' });
  const exit = await page.evaluate(async () => {
    const full = document.querySelector('.launch-inline-reveal').getBoundingClientRect().height;
    document.querySelector('.launch-status-panel header button').click();
    const frames = [], start = performance.now();
    while (performance.now() - start < 260) {
      await new Promise(requestAnimationFrame);
      frames.push(document.querySelector('.launch-inline-reveal')?.getBoundingClientRect().height ?? 0);
    }
    return { full, frames };
  });
  assert.equal(exit.frames.at(-1), 0);
  assert.ok(exit.frames.some(height => height > 1 && height < exit.full - 2), 'Details fold back through intermediate heights');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.working .launch-status-pulse').click();
  await page.getByRole('dialog', { name: '任务状态', exact: true }).waitFor();
  assert.equal(await page.locator('.launch-inline-reveal').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.launch-inline-reveal'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.working .workflow-trigger').click();
  await panel.waitFor();
  assert.equal(await panel.locator('.workflow-agent').count(), 8);
  await page.screenshot({ path: 'test-results/workflow-orchestration-running-dark.png' });
  const overviewScroll = panel.locator('.workflow-pane').first();
  await overviewScroll.evaluate(element => element.scrollTop = 100);
  const scrollBefore = await overviewScroll.evaluate(element => element.scrollTop);
  await panel.locator('.workflow-agent').nth(5).click();
  await panel.getByRole('button', { name: '代理', exact: true }).waitFor();
  await panel.locator('.subagent-task').waitFor();
  assert.match(await panel.locator('.subagent-task').innerText(), /主体与合作关系/);
  await page.screenshot({ path: 'test-results/workflow-agent-running-dark.png' });
  await panel.getByRole('button', { name: '编排', exact: true }).click();
  assert.equal(await overviewScroll.evaluate(element => element.scrollTop), scrollBefore);
  await page.locator('.working .workflow-trigger').click();
  await page.locator('#subagent-panel').waitFor({ state: 'detached' });
  await page.locator('button.icon-button[aria-controls="subagent-panel"]').click();
  await panel.waitFor();
  assert.equal(await panel.locator('.workflow-agent').count(), 8);
  await app.evaluate(({ BrowserWindow }, progress) => {
    const settled = { ...progress, status: 'completed', completedAgents: 8, agents: progress.agents.map(a => ({ ...a, status: 'completed', finishedAt: Date.now() })) };
    const final = { schemaVersion: 1, runId: progress.runId, name: progress.name, status: 'completed', startedAt: progress.startedAt,
      finishedAt: Date.now(), agentCalls: 8, spentTokens: 152847 };
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.send('runtime-event', { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'workflow-fixture', partialResult: { content: '', details: settled } });
    window.webContents.send('runtime-event', { type: 'tool_execution_end', toolName: 'workflow', toolCallId: 'workflow-fixture', result: { content: '', details: final } });
    const message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'workflow-fixture', content: '', details: final };
    window.webContents.send('runtime-event', { type: 'message_start', message });
    window.webContents.send('runtime-event', { type: 'message_end', message });
    globalThis.workflowFixture.messages[2] = { ...message, desktopWorkflow: { ...settled, toolCallId: 'workflow-fixture', finishedAt: final.finishedAt } };
  }, progress);
  await page.waitForFunction(() => document.querySelector('.workflow-inline .workflow-count')?.textContent === '8 / 8');
  assert.equal(await panel.locator('.workflow-agent').count(), 8);
  assert.equal(await page.locator('.workflow-inline').count(), 1);
  await page.waitForTimeout(650);
  await page.screenshot({ path: 'test-results/workflow-orchestration-completed-dark.png' });
  // The parent keeps working: a later tool must not displace the pulse entry or duplicate the workflow.
  await app.evaluate(({ BrowserWindow }) => {
    const message = { role: 'assistant', timestamp: Date.now(), content: [{ type: 'text', text: '审查完成，继续读取摘要并整理最终答复。' },
      { type: 'toolCall', id: 'after', name: 'read_file', arguments: { path: '摘要.md' } }] };
    globalThis.workflowFixture.messages.push(message);
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'message_start', message });
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'message_end', message });
  });
  assert.equal(await page.locator('.working .workflow-trigger').count(), 1);
  await app.evaluate(() => {
    const model = globalThis.workflowFixture;
    globalThis.savedWorkflowLaunch = model.launch;
    model.launch = { plan: false, ultracode: false, goalArmed: false };
    model.state.isStreaming = false;
  });
  await page.reload();
  const settledTrigger = page.locator('.working-idle .workflow-settled');
  await settledTrigger.waitFor();
  assert.match(await settledTrigger.innerText(), /编排已完成/);
  assert.equal(await page.locator('.working-idle .working-dot').count(), 0);
  assert.equal(await page.locator('.composer .launch-status-trigger').count(), 0, 'Finished workflow never arms the next send');
  assert.ok(await settledTrigger.evaluate(element => {
    const row = element.closest('.working').getBoundingClientRect();
    return Math.abs(row.right - element.getBoundingClientRect().right) <= 1;
  }), 'Standalone workflow summary anchors at the transcript right edge');
  await page.mouse.move(20, 50);
  await page.waitForTimeout(350);
  const footerLayout = await settledTrigger.evaluate(element => {
    const row = element.closest('.assistant-footer-row');
    const actions = row?.querySelector('.assistant-actions');
    if (!actions) return undefined;
    const left = actions.getBoundingClientRect(), right = element.getBoundingClientRect();
    return { hidden: getComputedStyle(actions).opacity, visible: getComputedStyle(element).opacity,
      centerDifference: Math.abs(left.y + left.height / 2 - right.y - right.height / 2), separate: left.right <= right.left };
  });
  assert.ok(footerLayout?.hidden === '0' && footerLayout.visible === '1'
    && footerLayout.centerDifference <= 1 && footerLayout.separate, `Hidden actions and persistent workflow share one footer row: ${JSON.stringify(footerLayout)}`);
  await page.screenshot({ path: 'test-results/workflow-settled-dark.png' });
  await page.locator('.assistant-footer-row .assistant-actions').hover();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.assistant-footer-row .assistant-actions').evaluate(element => getComputedStyle(element).opacity), '1');
  await page.screenshot({ path: 'test-results/workflow-settled-footer-hover.png' });
  await page.mouse.move(20, 50);
  await settledTrigger.click();
  await panel.waitFor();
  assert.equal(await panel.locator('.workflow-agent').count(), 8);
  await settledTrigger.click();
  await page.locator('#subagent-panel').waitFor({ state: 'detached' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.reload();
  await settledTrigger.waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/workflow-settled-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 700));
  await page.waitForTimeout(350);
  assert.ok(await settledTrigger.evaluate(element => {
    const row = element.closest('.working').getBoundingClientRect();
    const trigger = element.getBoundingClientRect();
    return Math.abs(row.right - trigger.right) <= 1 && trigger.left >= row.left - 1;
  }), 'Idle workflow summary fits the narrow transcript and remains right-aligned');
  await page.screenshot({ path: 'test-results/workflow-settled-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  for (const [status, label] of [['failed', '编排失败'], ['aborted', '编排已中断'], ['budget_exceeded', '编排预算耗尽'], ['unknown', '编排状态待确认'], ['running', '编排状态待确认']]) {
    await app.evaluate(({ BrowserWindow }, status) => {
      const model = globalThis.workflowFixture;
      const result = model.messages[2];
      result.desktopWorkflow = { ...result.desktopWorkflow, status };
      BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', messages: model.messages });
    }, status);
    await settledTrigger.getByText(label, { exact: true }).waitFor();
    assert.equal(await settledTrigger.locator('[data-state="running"]').count(), 0, 'An ended parent turn never shows a running summary');
  }
  await app.evaluate(() => {
    const model = globalThis.workflowFixture;
    model.messages[2].desktopWorkflow.status = 'completed';
    model.launch = globalThis.savedWorkflowLaunch;
    model.state.isStreaming = true;
  });
  await page.reload();
  await page.locator('.workflow-inline').waitFor();
  await page.locator('.workflow-heading').click();
  await panel.waitFor();
  assert.equal(await panel.locator('.workflow-agent').count(), 8, 'history restores agent list');
  await page.evaluate(async () => window.desktop.preferences({ theme: 'light' }));
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/workflow-orchestration-light.png' });
  await app.evaluate(({ BrowserWindow }, progress) => {
    const details = { ...progress, status: 'budget_exceeded', agents: [
      { ...progress.agents[0], status: 'failed' }, { ...progress.agents[1], status: 'aborted' },
      { ...progress.agents[2], status: 'cached' },
    ] };
    const message = { role: 'toolResult', toolName: 'workflow', toolCallId: 'workflow-fixture', content: '', details };
    globalThis.workflowFixture.messages[2] = message;
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'tool_execution_update', toolName: 'workflow', toolCallId: 'workflow-fixture', partialResult: message });
  }, progress);
  await panel.getByText('已达到工作流预算上限', { exact: true }).waitFor();
  assert.equal(await panel.locator('.workflow-agent .subagent-status-icon[data-state="failed"]').count(), 1);
  assert.equal(await panel.locator('.workflow-agent .subagent-status-icon[data-state="stopped"]').count(), 1);
  assert.equal(await panel.getByText('缓存', { exact: true }).count(), 1);
  await app.evaluate(({ BrowserWindow }, progress) => {
    const model = globalThis.workflowFixture;
    for (let index = 2; index <= 16; index++) {
      const callId = `history-${index}`;
      model.messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: callId, name: 'workflow', arguments: {} }] },
        { role: 'toolResult', toolCallId: callId, toolName: 'workflow', content: '',
          details: { ...progress, runId: `wf_history_${index}`, name: 'inline', status: 'completed', agents: [], agentCalls: index } });
    }
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', messages: model.messages });
  }, progress);
  const picker = panel.getByRole('button', { name: '选择编排记录', exact: true });
  await picker.waitFor();
  assert.match(await picker.innerText(), /第 1 次/, 'new runs do not steal the selected workflow');
  assert.equal(await panel.locator('.workflow-run-picker > button').count(), 1);
  const height = await panel.locator('.workflow-run-picker').evaluate(element => element.getBoundingClientRect().height);
  assert.equal(height, 44, 'history count never increases the header height');
  await picker.click();
  const menu = page.getByRole('menu', { name: '编排记录', exact: true });
  await menu.waitFor();
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"][aria-label="编排记录"]'));
  assert.equal(await menu.getByRole('menuitemradio').count(), 16);
  await page.waitForTimeout(250);
  const menuGeometry = await menu.evaluate(element => {
    const rows = [...element.querySelectorAll('button')];
    const style = getComputedStyle(element);
    // clientHeight rounds fractional borders at Windows display scaling.
    const contentHeight = parseFloat(style.height) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)
      - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return { rowHeights: rows.map(row => row.getBoundingClientRect().height), contentHeight, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      scale: devicePixelRatio, boxHeight: element.getBoundingClientRect().height, cssHeight: style.height,
      borderTop: style.borderTopWidth, borderBottom: style.borderBottomWidth,
      paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
  });
  assert.ok(menuGeometry.rowHeights.every(height => Math.abs(height - 33) < .1)
    && Math.abs(menuGeometry.contentHeight - 5 * 33) < 1 && menuGeometry.scrollHeight > menuGeometry.clientHeight,
    `history viewport shows exactly five fixed-height rows and scrolls the remainder: ${JSON.stringify(menuGeometry)}`);
  assert.ok(await menu.evaluate(element => {
    const bar = getComputedStyle(element, '::-webkit-scrollbar');
    const track = getComputedStyle(element, '::-webkit-scrollbar-track');
    const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
    const arrows = getComputedStyle(element, '::-webkit-scrollbar-button');
    return bar.width === '4px' && track.backgroundColor === 'rgba(0, 0, 0, 0)'
      && thumb.borderRadius === '3px' && arrows.display === 'none';
  }), 'workflow history uses the quote-style slim thumb without track or arrows');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/workflow-history-menu.png' });
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.workflow-run-picker > button')?.textContent.includes('第 16 次'));
  assert.equal(await panel.locator('.workflow-run-picker').evaluate(element => element.getBoundingClientRect().height), height);
  await picker.click();
  await menu.waitFor();
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"][aria-label="编排记录"]'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '选择编排记录');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 790));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/workflow-orchestration-narrow.png' });
  const pulseBounds = await page.locator('.working').boundingBox();
  for (const child of await page.locator('.working > button').all()) {
    const bounds = await child.boundingBox();
    assert.ok(bounds.x >= pulseBounds.x - 1 && bounds.x + bounds.width <= pulseBounds.x + pulseBounds.width + 1, 'Task controls fit the narrow pulse row');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await app.evaluate(() => {
    const model = globalThis.workflowFixture;
    model.messages.unshift(
      { role: 'user', content: '旧任务' },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'unfinished-old', name: 'workflow', arguments: { name: '旧的未结束编排' } }] },
    );
    model.messages.push({ role: 'user', content: '与编排无关的新任务' });
    model.state.isStreaming = true;
  });
  await page.reload();
  await page.locator('.working').waitFor();
  assert.equal(await page.locator('.working .workflow-trigger').count(), 0, 'unrelated busy turn never links to a stale workflow');
  const rail = page.locator('button.icon-button[aria-controls="subagent-panel"]');
  assert.equal(await rail.getAttribute('data-workflow-running'), null, 'stale workflow never activates the rail indicator');
  await rail.click();
  await panel.waitFor();
  assert.match(await panel.locator('.workflow-run-picker > button').innerText(), /第 17 次/, 'rail opens latest history instead of oldest unfinished run');
  await app.evaluate(({ BrowserWindow }) => {
    const model = globalThis.workflowFixture;
    model.messages = [{ role: 'user', content: '新的普通任务' }];
    model.state.isStreaming = false;
    model.launch = { plan: false, ultracode: false, goalArmed: false };
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', messages: model.messages });
  });
  await page.waitForFunction(() => !document.querySelector('.workflow-inline'));
  assert.equal(await page.locator('.working .workflow-trigger').count(), 0, 'An unrelated ordinary turn does not retain the prior workflow summary');
  assert.equal(await panel.locator('.workflow-agent').count(), 0, 'history change does not leave another workflow visible');
  assert.deepEqual(errors, []);
  console.log('Workflow UI passed: pulse toggle, fixed rail entry, overview/agent, final snapshot preservation, subsequent tools, history, failure/interruption/cache/budget, light/narrow and session isolation.');
} finally { await app.close(); }
