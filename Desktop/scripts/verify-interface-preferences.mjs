import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(join(tmpdir(), 'desktop-interface-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: [], autoCheckUpdates: false }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1280, 900);
  });
  await page.waitForFunction(() => document.querySelector('.new-chat') && !document.querySelector('.new-chat').disabled);
  return page;
}
const settings = page => page.getByRole('region', { name: '界面复杂度', exact: true });
async function openSettings(page) {
  await page.locator('.sidebar-settings').click();
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '界面复杂度', exact: true }).click();
  await settings(page).waitFor();
}
async function closeSettings(page) {
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u }).click();
  await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
}
async function preset(page, name) {
  const button = settings(page).getByRole('button', { name, exact: true });
  await button.click();
  await page.waitForFunction(name => document.querySelector('.interface-presets button[aria-pressed="true"]')?.textContent === name && !document.querySelector('.interface-presets button:disabled'), name);
}
async function enableToolDetails(page) {
  const toggle = settings(page).getByRole('switch', { name: '工具详情默认展开' });
  assert.equal(await toggle.isChecked(), false);
  await toggle.click();
  await page.waitForFunction(() => {
    const input = document.querySelector('.interface-option input[aria-label="工具详情默认展开"]');
    return input?.checked && !input.disabled;
  });
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.interfaceSettings.toolsExpanded, true);
}
async function enableLiveThinking(page) {
  const toggle = settings(page).getByRole('switch', { name: '思考时展开，结束后收起' });
  assert.equal(await toggle.isChecked(), false);
  await toggle.click();
  await page.waitForFunction(() => {
    const input = document.querySelector('.interface-option input[aria-label="思考时展开，结束后收起"]');
    return input?.checked && !input.disabled;
  });
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.interfaceSettings.thinkingExpanded, true);
}
const history = [
  { role: 'user', content: '检查这个项目。', timestamp: 1000 },
  { role: 'assistant', content: [
    { type: 'text', text: '正文一：先确认项目结构。' },
    { type: 'thinking', thinking: '先检查入口文件和项目配置。' },
    { type: 'toolCall', id: 'interface-read-1', name: 'read_file', arguments: { path: 'src/main.tsx' } },
    { type: 'toolCall', id: 'interface-read-2', name: 'read_file', arguments: { path: 'package.json' } },
  ] },
  { role: 'toolResult', toolCallId: 'interface-read-1', toolName: 'read_file', content: 'File one' },
  { role: 'toolResult', toolCallId: 'interface-read-2', toolName: 'read_file', content: 'File two' },
  { role: 'assistant', content: [
    { type: 'text', text: '正文二：再核验命令结果。' },
    { type: 'toolCall', id: 'interface-command', name: 'run_command', arguments: { command: 'fixture-only' } },
  ] },
  { role: 'toolResult', toolCallId: 'interface-command', toolName: 'run_command', isError: true, content: 'Fixture command failed' },
  { role: 'assistant', content: [
    { type: 'toolCall', id: 'interface-wait', name: 'run_command', arguments: { command: 'fixture-awaiting' } },
  ] },
];
try {
  let page = await launch();
  const saved = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.interfaceFixture = { snapshot };
    const handler = ipcMain._invokeHandlers.get('desktop');
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'snapshot') return globalThis.interfaceFixture.snapshot;
      // Keep controlled inputs asynchronous even on a fast local filesystem.
      if (method === 'preferences' && args[0]?.interfaceSettings)
        await new Promise(done => setTimeout(done, 150));
      const result = await handler(event, method, ...args);
      if (method === 'preferences') globalThis.interfaceFixture.snapshot.preferences = result;
      return result;
    });
  }, saved);
  const load = async (messages, active = false, requests = []) => app.evaluate(({ BrowserWindow }, data) => {
    const fixture = globalThis.interfaceFixture;
    fixture.snapshot = { ...fixture.snapshot, messages: data.messages, requests: data.requests,
      runtimeRevision: (fixture.snapshot.runtimeRevision ?? 0) + 1,
      state: { ...fixture.snapshot.state, sessionId: 'interface-session', isStreaming: data.active } };
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  }, { messages, active, requests });
  await load(history);
  const messages = page.locator('.messages');
  await messages.getByText('正文一：先确认项目结构。', { exact: true }).waitFor();
  assert.equal(await messages.locator('.compact-process').count(), 1, 'Standard combines thinking and tools');
  assert.equal(await messages.locator('.process-tool[open]').count(), 0);
  assert.equal(await messages.locator('.thinking[open]').count(), 0);
  await page.screenshot({ path: 'test-results/interface-mapped-standard-light.png' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-standard-detail.png' });
  await openSettings(page);
  await preset(page, '详细');
  await closeSettings(page);
  await messages.locator('.tool-group-trigger').click();
  await messages.locator('.process-tool > summary').first().click();
  await messages.locator('.thinking > summary').click();
  await page.evaluate(() => {
    globalThis.interfaceNodes = {
      prose: document.querySelector('.messages .response-text'),
      thinking: document.querySelector('.messages .thinking'),
      tool: document.querySelector('.messages .process-tool'),
    };
  });
  await openSettings(page);
  await preset(page, '详细');
  await closeSettings(page);
  assert.equal(await messages.locator('.process-tool[open]').count(), 0, 'switching presets reapplies unchanged folded-tool defaults to old records');
  assert.equal(await messages.locator('.thinking').getAttribute('data-expanded'), 'false');
  assert.equal(await page.evaluate(() =>
    globalThis.interfaceNodes.prose === document.querySelector('.messages .response-text')
    && globalThis.interfaceNodes.thinking === document.querySelector('.messages .thinking')), true, 'preset changes do not remount prose or independent thinking');
  await messages.locator('.thinking > summary').click();
  await messages.locator('.tool-group-trigger').click();
  await messages.locator('.process-tool > summary').first().click();
  await openSettings(page);
  await preset(page, '详细');
  await closeSettings(page);
  assert.equal(await messages.locator('.thinking').getAttribute('data-expanded'), 'false', 'reselecting Detailed folds completed thinking');
  assert.equal(await messages.locator('.process-tool[open]').count(), 0, 'reselecting the active preset also resets tool overrides');
  await openSettings(page);
  await preset(page, '简洁');
  await closeSettings(page);
  assert.equal(await page.locator('.composer-wrap .performance-metric').count(), 4);
  assert.equal(await messages.locator('.turn-process-trigger').count(), 0, 'history without confirmed settlement stays readable');
  assert.equal(await messages.locator('.thinking').count(), 1);
  await messages.locator('.compact-process').first().locator('.tool-group-trigger').waitFor();
  assert.equal(await messages.locator('.process-tool.failed > summary').isVisible(), false);
  assert.equal(await messages.locator('.process-tool.missing > summary').isVisible(), true);
  assert.equal(await page.evaluate(() =>
    globalThis.interfaceNodes.prose === document.querySelector('.messages .response-text')), true, 'Simple retains the original prose node');
  await page.screenshot({ path: 'test-results/interface-mapped-simple-light.png' });
  await openSettings(page);
  await preset(page, '标准');
  await closeSettings(page);
  const group = messages.locator('.tool-group-trigger').first();
  assert.match(await group.innerText(), /读取文件 2 项/);
  assert.equal(await messages.locator('.process-tool.failed > summary').isVisible(), true);
  assert.equal(await messages.locator('.process-tool.missing > summary').isVisible(), true);
  assert.equal(await group.getAttribute('aria-expanded'), 'false');
  await group.focus();
  await group.press('Enter');
  await messages.locator('.tool-group-disclosure.is-expanded .process-tool > summary').first().waitFor();
  await page.waitForTimeout(280);
  assert.equal(await messages.locator('.tool-group-disclosure .process-tool').count(), 2);
  await load(history, true);
  await page.locator('.working:not(.working-idle)').waitFor();
  assert.equal(await group.getAttribute('aria-expanded'), 'true', 'a fresh snapshot of identical preferences preserves manual expansion');
  await openSettings(page);
  await preset(page, '标准');
  await closeSettings(page);
  assert.equal(await group.getAttribute('aria-expanded'), 'false', 'reselecting Standard folds the existing group');
  await load(history.map((message, index) => index === 3 ? { ...message, desktopToolPending: true } : message), true);
  await group.getByText('正在读取文件', { exact: true }).waitFor();
  assert.equal(await group.locator('.process-group-preview').innerText(), 'package.json');
  assert.equal(await group.getAttribute('aria-expanded'), 'false', 'progress updates retain the same disclosure anchor');
  await load(history, true);
  await group.getByText('已完成：读取文件 2 项', { exact: true }).waitFor();
  const awaiting = {
    type: 'extension_ui_request', method: 'confirm', id: 'interface-approval', runtimeId: saved.runtimeId,
    title: `Approve run_command [${'interface-wait'.slice(-8)}]`,
    message: 'Call: interface-wait\nrun_command can modify the workspace or execute a command\n\nrun_command command=fixture-awaiting\n\nBatch calls may ask separately\nbefore approved tools begin running.',
  };
  await openSettings(page);
  await preset(page, '简洁');
  await closeSettings(page);
  const simpleHistory = [
    history[0],
    { ...history[1], content: [...history[1].content.slice(0, 3), history[4].content[1], history[1].content[3]] },
    history[2], history[5], history[3],
    { ...history[4], content: history[4].content.slice(0, 1) },
    history[6],
  ];
  await load(simpleHistory.filter(message => message.toolCallId !== 'interface-read-2'), true);
  const simpleGroup = messages.locator('.compact-process').first();
  const simpleTrigger = simpleGroup.locator('.tool-group-trigger');
  await simpleTrigger.getByText('1 项工具操作失败 · 正在读取文件', { exact: true }).waitFor();
  await page.locator('.working:not(.working-idle)').waitFor();
  assert.equal(await messages.locator('.turn-process-trigger').count(), 0);
  assert.equal(await simpleTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await simpleGroup.locator('.process-tool').count(), 3, 'Simple groups both reads and the failure between prose blocks');
  assert.match(await simpleTrigger.innerText(), /1 项工具操作失败/, 'a collapsed running group reports completed failures');
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-simple-running.png' });
  await simpleTrigger.press('Enter');
  await simpleGroup.locator('.process-tool.failed > summary').waitFor();
  await load(simpleHistory, true, [awaiting]);
  await simpleTrigger.getByText('1 项工具操作失败', { exact: true }).waitFor();
  assert.equal(await simpleTrigger.getAttribute('aria-expanded'), 'true', 'the group retains manual expansion when a tool completes');
  await messages.locator('.process-tool.waiting > summary').waitFor();
  assert.equal(await messages.locator('.process-tool.waiting').locator('xpath=ancestor::*[contains(@class,"tool-group-disclosure")]').count(), 0);
  await load(simpleHistory, false);
  await page.locator('.permission-approval').waitFor({ state: 'detached' });
  const run = { startedAt: 1000, endedAt: 17000 };
  const settled = simpleHistory.map(message => message.role === 'assistant'
    ? { ...message, stopReason: 'toolUse', desktopTiming: { run, thinking: {} } } : message)
    .concat({ role: 'assistant', stopReason: 'stop', desktopTiming: { run, thinking: {}, completed: true }, content: '最终答复：检查已结束。' });
  await load([...settled.slice(0, -1), { ...settled.at(-1), stopReason: 'error', incomplete: 'no_visible_output', content: '' }]);
  await messages.locator('.incomplete-response.is-failed').waitFor();
  assert.equal(await messages.locator('.turn-process-trigger').count(), 0, 'failed turns do not auto-fold');
  await load(settled, true);
  const final = messages.getByText('最终答复：检查已结束。', { exact: true });
  const commentary = messages.getByText('正文一：先确认项目结构。', { exact: true });
  await final.waitFor();
  assert.equal(await commentary.isVisible(), true, 'streamed final prose does not fold commentary');
  await page.evaluate(() => { globalThis.simpleFinal = [...document.querySelectorAll('.messages .response-text')].at(-1); });
  await load(settled);
  const elapsed = messages.getByRole('button', { name: '1 项工具操作失败 · 用时 16秒', exact: true });
  await elapsed.waitFor();
  assert.equal(await elapsed.getAttribute('aria-expanded'), 'false');
  await commentary.waitFor({ state: 'hidden' });
  assert.equal(await final.isVisible(), true);
  assert.equal(await messages.locator('.process-tool.missing > summary').isVisible(), true);
  assert.equal(await simpleGroup.locator('.process-tool.failed').evaluate(tool =>
    tool.closest('.turn-process-slot')?.inert), true);
  assert.equal(await elapsed.evaluate(button => button.getAttribute('aria-controls').split(' ')
    .every(id => document.getElementById(id)?.inert)), true);
  assert.equal(await page.evaluate(() => globalThis.simpleFinal === [...document.querySelectorAll('.messages .response-text')].at(-1)), true);
  const foldedHeights = () => {
    const slots = [...document.querySelectorAll('.messages .turn-process-slot[data-folded]')];
    return slots.length > 0 && slots.every(slot => slot.offsetHeight === 0 && slot.inert);
  };
  await page.waitForFunction(foldedHeights);
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-simple-settled.png' });
  await elapsed.press('Enter');
  await commentary.waitFor();
  assert.equal(await elapsed.getAttribute('aria-expanded'), 'true');
  await simpleGroup.locator('.process-tool.failed > summary').waitFor();
  assert.equal(await commentary.evaluate((node) =>
    node.getBoundingClientRect().left === globalThis.simpleFinal.firstElementChild.getBoundingClientRect().left), true);
  assert.equal(await commentary.evaluate(node =>
    getComputedStyle(node.closest('.turn-process-slot')).transitionProperty.includes('grid-template-rows')), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await commentary.evaluate(node =>
    getComputedStyle(node.closest('.turn-process-slot')).transitionDuration), '0s');
  await elapsed.press('Enter');
  await page.waitForFunction(foldedHeights);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-simple-detail.png' });
  await load(history);
  await openSettings(page);
  await preset(page, '标准');
  await enableToolDetails(page);
  await closeSettings(page);
  assert.equal(await group.getAttribute('aria-expanded'), 'true', 'custom expansion applies to the group and its records');
  assert.equal(await messages.locator('.process-tool-group .process-tool[open]').count(), 2);
  await openSettings(page);
  await preset(page, '详细');
  await closeSettings(page);
  await page.waitForFunction(() => document.querySelector('.messages .thinking')?.dataset.expanded === 'false');
  assert.equal(await page.locator('.composer-wrap .performance-metric').count(), 4);
  assert.equal(await messages.locator('.compact-process').count(), 0);
  assert.equal(await messages.locator('.process-tool-group').count(), 1);
  assert.equal(await messages.locator('.process-tool[open]').count(), 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/interface-mapped-detailed-light.png' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-detailed-detail.png' });
  await messages.locator('.tool-group-trigger').click();
  await messages.locator('.process-tool > summary').first().click();
  assert.equal(await messages.locator('.process-tool[open]').count(), 1);
  await load([...history, { role: 'assistant', content: [{ type: 'text', text: '后续输出不会覆盖手动展开。' }] }]);
  await messages.getByText('后续输出不会覆盖手动展开。', { exact: true }).waitFor();
  assert.equal(await messages.locator('.process-tool[open]').count(), 1);
  await messages.locator('.thinking > summary').click();
  await messages.locator('.thinking > summary').click();
  await load([...history, { role: 'assistant', content: [{ type: 'text', text: '后续输出不会覆盖手动折叠。' }] }]);
  await messages.getByText('后续输出不会覆盖手动折叠。', { exact: true }).waitFor();
  assert.equal(await messages.locator('.thinking').getAttribute('data-expanded'), 'false');
  await openSettings(page);
  await enableToolDetails(page);
  await closeSettings(page);
  assert.equal(await messages.locator('.process-tool[open]').count(), 4);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.interfaceSettings.preset, 'custom');
  await load(history);
  await messages.getByText('后续输出不会覆盖手动折叠。', { exact: true }).waitFor({ state: 'detached' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1900));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/interface-mapped-custom-light.png' });
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-mapped-custom-detail.png' });
  const before = (await page.evaluate(() => window.desktop.snapshot())).preferences;
  const error = await page.evaluate(async () => {
    try { await window.desktop.preferences({ interfaceSettings: { preset: 'custom', toolsExpanded: 'yes' } }); }
    catch (error) { return error.message; }
  });
  assert.match(error, /Invalid interface option/);
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).preferences, before);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  const longPreview = '最新思考预览，用来检查单行省略与更新。'.repeat(12);
  const thinkingHistory = [
    { role: 'user', content: '测试思考到工具到正文的转换。' },
    { role: 'assistant', content: [
      { type: 'text', text: '先检查项目。' },
      { type: 'thinking', thinking: `第一段思考。\n\n${longPreview}` },
    ] },
  ];
  await openSettings(page);
  await preset(page, '详细');
  await enableLiveThinking(page);
  await closeSettings(page);
  await load(thinkingHistory, true);
  await page.waitForFunction(() => document.querySelector('.messages .thinking')?.dataset.expanded === 'true');
  const liveThinking = messages.locator('.thinking');
  assert.equal(await liveThinking.locator('summary > .lucide-brain').count(), 1, 'thinking uses the same icon-first process-row language');
  assert.equal(await liveThinking.locator('summary > .thinking-chevron svg').count(), 1, 'thinking uses the existing designed disclosure SVG');
  assert.equal(await liveThinking.locator('.tool-summary-shimmer').evaluate(element => getComputedStyle(element, '::before').animationPlayState), 'running');
  await liveThinking.locator('summary').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 800));
  await page.waitForFunction(() => innerWidth <= 660);
  assert.equal(await liveThinking.locator('summary').evaluate(element => {
    const row = element.getBoundingClientRect();
    const prose = element.closest('.response-content').querySelector('.response-text').getBoundingClientRect();
    const preview = element.querySelector('.thinking-preview');
    return Math.abs(row.left - prose.left) <= 1 && Math.abs(row.right - prose.right) <= 1
      && preview.scrollWidth > preview.clientWidth && preview.getBoundingClientRect().right <= row.right + 1;
  }), true, 'Detailed thinking and its long preview stay aligned with prose at narrow width');
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-thinking-aligned-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await load(thinkingHistory.map((message, index) => index === 1 ? {
    ...message, content: [...message.content.slice(0, 1), { type: 'thinking', thinking: '第一段思考。\n\n继续思考，手动折叠保持。' }],
  } : message), true);
  await liveThinking.locator('.thinking-scroll').getByText('继续思考，手动折叠保持。', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await liveThinking.getAttribute('data-expanded'), 'false', 'thinking deltas preserve manual folding');
  await openSettings(page);
  await preset(page, '详细');
  await enableLiveThinking(page);
  await closeSettings(page);
  assert.equal(await liveThinking.getAttribute('data-expanded'), 'true', 'reapplying the custom streaming option opens the current thought');
  const withTool = [...thinkingHistory, { role: 'assistant', content: [
    { type: 'toolCall', id: 'live-tool', name: 'read_file', arguments: { path: 'live.ts' } },
  ] }];
  await load(withTool, true);
  await messages.locator('.process-tool[data-tool-state="running"]').waitFor();
  await liveThinking.locator('xpath=self::*[@data-expanded="false" and not(@data-running)]').waitFor();
  assert.equal(await liveThinking.locator('.tool-summary-shimmer').evaluate(element => getComputedStyle(element, '::before').animationPlayState), 'paused', 'completed thinking stops its label animation when tools start');
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-thinking-unified.png' });
  await liveThinking.locator('summary').click();
  await load([...withTool, { role: 'toolResult', toolCallId: 'live-tool', toolName: 'read_file', content: 'ok' }], true);
  await messages.locator('.process-tool[data-tool-state="done"]').waitFor();
  assert.equal(await liveThinking.getAttribute('data-expanded'), 'true', 'manual reopening after completion survives subsequent activity');
  await openSettings(page);
  await preset(page, '标准');
  await closeSettings(page);
  await load(thinkingHistory, true);
  const compact = messages.locator('.compact-process');
  await compact.locator('.thinking-preview').getByText(longPreview, { exact: true }).waitFor();
  assert.equal(await compact.locator('.thinking-preview').evaluate(element =>
    getComputedStyle(element).whiteSpace === 'nowrap' && element.scrollWidth > element.clientWidth
    && element.getBoundingClientRect().right <= element.parentElement.getBoundingClientRect().right), true, 'long live detail stays inside a single clipped row');
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-compact-process-live.png' });
  assert.equal(await compact.locator('.thinking').getAttribute('data-expanded'), 'false');
  assert.equal(await compact.locator('.tool-group-trigger').isVisible(), false, 'a singleton has only its own disclosure');
  assert.equal(await compact.locator('.tool-group-disclosure > div').evaluate(element => getComputedStyle(element).paddingLeft), '0px');
  await compact.locator('.thinking > summary').click();
  await page.evaluate(() => { globalThis.compactThought = document.querySelector('.messages .compact-process .thinking'); });
  await load(withTool, true);
  await compact.getByRole('button', { name: /读取文件/ }).waitFor();
  assert.equal(await compact.locator('.tool-group-trigger').getAttribute('aria-expanded'), 'true');
  assert.equal(await compact.locator('.tool-group-trigger > .lucide-wrench').count(), 1, 'tool activity does not keep a misleading thinking icon');
  assert.equal(await compact.locator('.thinking .tool-summary-shimmer').evaluate(element => getComputedStyle(element, '::before').animationPlayState), 'paused', 'the running group never reanimates settled children');
  assert.equal(await page.evaluate(() => globalThis.compactThought === document.querySelector('.messages .compact-process .thinking')), true, 'tool arrival retains the singleton member and its manual expansion');
  const completedProcess = [...withTool,
    { role: 'toolResult', toolCallId: 'live-tool', toolName: 'read_file', content: 'ok' },
    { role: 'assistant', content: [{ type: 'text', text: '检查完成。' }] },
  ];
  await load(completedProcess, false);
  await compact.getByRole('button', { name: /已完成：读取文件 1 项/ }).waitFor();
  await compact.locator('.tool-group-trigger').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/interface-compact-process-light.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await compact.locator('.tool-group-disclosure').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  assert.equal(await compact.locator('.thinking .tool-summary-shimmer').evaluate(element => getComputedStyle(element, '::before').animationName), 'none');
  await compact.locator('.tool-group-trigger').click();
  await compact.locator('.thinking > summary').click();
  assert.equal(await compact.locator('.thinking').getAttribute('data-expanded'), 'true', 'full original thought remains accessible inside the group');
  assert.equal(await compact.locator('.thinking > summary').evaluate(element => getComputedStyle(element).display), 'flex');
  assert.equal(await compact.locator('.thinking > summary').evaluate(element => getComputedStyle(element).listStyleType), 'none', 'nested thought uses the designed chevron, not the native marker');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await messages.locator('.response-content').screenshot({ path: 'test-results/interface-compact-process-dark.png' });
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  const olderHistory = Array.from({ length: 8 }, (_, index) => [
    { role: 'user', content: `历史问题 ${index}`, timestamp: index + 1 },
    { role: 'assistant', content: [
      { type: 'text', text: `历史正文 ${index}。` + '保留原始内容与阅读位置。'.repeat(12) },
      { type: 'thinking', thinking: `历史思考 ${index}` },
      { type: 'toolCall', id: `old-${index}`, name: 'read_file', arguments: { path: `old-${index}.ts` } },
    ] },
    { role: 'toolResult', toolCallId: `old-${index}`, toolName: 'read_file', content: 'Historical result' },
  ]).flat().concat(history);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await load(olderHistory);
  await messages.getByText('历史问题 4', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.conversation');
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 120;
  });
  for (const mode of ['标准', '详细', '简洁']) {
    await openSettings(page);
    await preset(page, mode);
    await closeSettings(page);
    assert.equal(await messages.locator('.thinking').count(), 9);
    assert.equal(await messages.locator('.thinking[data-expanded="true"]').count(), 0, 'completed historical thinking remains folded in every preset');
    assert.equal(await messages.locator('.process-tool[open]').count(), 0);
    assert.equal(await page.locator('.jump-to-bottom').isVisible(), true, 'changing presentation must not force an old-history reader to the bottom');
    assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).messages, olderHistory, 'presentation never rewrites history');
  }
  await openSettings(page);
  await preset(page, '详细');
  await enableToolDetails(page);
  await closeSettings(page);
  assert.equal(await messages.locator('.process-tool[open]').count(), 12, 'custom expansion also applies to every historical round');
  await app.close(); app = undefined;
  const persisted = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'));
  assert.equal(persisted.interfaceSettings.toolsExpanded, true);
  assert.equal(persisted.interfaceSettings.preset, 'custom');
  page = await launch();
  await openSettings(page);
  assert.equal(await settings(page).getByRole('switch', { name: '工具详情默认展开' }).isChecked(), true);
  assert.equal(await settings(page).locator('.interface-custom.is-active').count(), 1);
  await settings(page).getByRole('button', { name: '恢复标准预设' }).click();
  await page.waitForFunction(() => !document.querySelector('.interface-option input:disabled'));
  assert.equal(await settings(page).getByRole('switch', { name: '工具详情默认展开' }).isChecked(), false);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.interfaceSettings.preset, 'standard');
  assert.deepEqual(errors, []);
  console.log('Interface preferences: real renderer mapping, existing-history preset reapplication without remount, same-preset reset, stream-safe manual overrides, safe grouping, approval/error visibility, custom expansion, IPC validation, persistence and reset passed.');
} finally {
  if (app) await app.close();
}
