import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { createPatch } from 'diff';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-turn-changes-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1440, 1000);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const original = await prepareSessionFixture(page);
  const now = Date.now();
  const edit = (path, before, after, id) => [
    { role: 'assistant', content: [{ type: 'toolCall', name: 'edit_file', id, arguments: { path, edits: [{ oldText: before, newText: after }] } }], timestamp: now - 30000 },
    { role: 'toolResult', toolCallId: id, toolName: 'edit_file', content: [{ type: 'text', text: 'Successfully replaced 1 block.' }],
      details: { patch: createPatch(path, before, after) }, timestamp: now - 25000 },
  ];
  const before = [
    'export function consumeEvent(event: StreamEvent) {',
    '  const session = sessions.get(event.sessionId);',
    '  if (!session) return;',
    '',
    "  if (event.type === 'tool_end') {",
    "    session.status = 'idle';",
    '    session.currentTool = null;',
    '    return;',
    '  }',
    '',
    "  if (event.type === 'text_delta') {",
    '    session.text += event.delta;',
    '  }',
    '}',
    '',
  ].join('\n');
  const first = before.replace("    session.status = 'idle';\n", '');
  const second = first.replace("  if (event.type === 'text_delta') {", [
    "  if (event.type === 'agent_end') {",
    "    session.status = 'idle';",
    '    session.currentTool = null;',
    '    return;',
    '  }',
    '',
    '  // Text may continue after one tool finishes.',
    "  if (event.type === 'text_delta' && typeof event.delta === 'string') {",
  ].join('\n'));
  const paths = ['src/stream/events.ts', 'src/state/session.ts', 'src/components/Conversation.tsx', 'src/styles/conversation.css'];
  const messages = [
    { role: 'user', content: '先把结束事件的类型补齐。', timestamp: now - 200000 },
    ...edit('src/stream/types.ts', "type EndEvent = { type: 'tool_end' };\n", "type EndEvent = { type: 'tool_end' | 'agent_end' };\n", 'historical-edit'),
    { role: 'assistant', content: [{ type: 'text', text: '结束事件已区分为工具结束和整轮结束。下一步检查消费端的状态处理。' }], stopReason: 'stop', timestamp: now - 180000 },
    { role: 'user', content: '继续修复流式输出。工具执行完以后，正文也应该继续接收。', timestamp: now - 100000 },
    ...edit(paths[0], before, first, 'stream-1'),
    ...edit(paths[0], first, second, 'stream-2'),
    ...edit(paths[1], "export const state = { status: 'idle', text: '' };\n",
      "export const state = { status: 'idle', text: '', currentTool: null };\n", 'state'),
    ...edit(paths[2], 'export function Conversation({ session }) {\n  return <Message text={session.text} />;\n}\n',
      'export function Conversation({ session }) {\n  return <Message text={session.text} streaming={session.status === "running"} />;\n}\n', 'component'),
    ...edit(paths[3], '.response-text {\n  opacity: 1;\n}\n', '.response-text {\n  opacity: 1;\n  overflow-anchor: none;\n}\n', 'style'),
    { role: 'assistant', content: [{ type: 'text', text: '## 工具结束后，正文继续输出\n\n已把工具完成与整轮结束拆开：工具结果只更新当前工具，只有 `agent_end` 会结束运行状态。\n\n文字仍然按已有的流式节奏追加，不会重新播放旧内容。\n\n**验证**：连续工具调用、工具结束后的正文续流，以及重新打开历史会话均已覆盖。' }], stopReason: 'stop', timestamp: now - 5000 },
  ];
  const fixture = { ...original, messages, status: 'connected',
    state: { ...original.state, isStreaming: true, sessionName: '修复流式续流',
      model: { id: 'step-5-preview', name: 'Step 5 Preview', provider: 'stepfun', reasoning: true } },
    sessions: original.sessions.map(session => session.id === original.state?.sessionId ? { ...session, name: '修复流式续流' } : session) };
  // Presentation fixture at the existing IPC boundary, never a provider request
  // or a write to the user's profile/clipboard/workspace.
  await app.evaluate(({ ipcMain }, fixture) => {
    globalThis.turnFixture = fixture; globalThis.turnCopies = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.turnFixture;
      if (method === 'preferences') { Object.assign(globalThis.turnFixture.preferences, args[0]); return globalThis.turnFixture.preferences; }
      if (method === 'copyText') { globalThis.turnCopies.push(args[0]); return; }
      if (method === 'settings') return { account: { loggedIn: false, validity: 'unknown' }, profiles: [], mcp: {}, skills: [] };
      if (method === 'command' && args[0] === 'get_session_stats') return globalThis.turnFixture.stats;
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: ['off', 'low', 'medium', 'high'] };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      return {};
    });
  }, fixture);
  await page.reload();
  await page.locator('.response-active').waitFor();
  assert.equal(await page.locator('#conversation-scroll .turn-changes').count(), 1, 'active turn must not have a transcript summary');
  const liveChip = page.getByRole('button', { name: '查看运行中的变更', exact: true });
  await liveChip.waitFor();
  assert.ok((await liveChip.innerText()).includes('4 个文件'));
  await page.evaluate(() => {
    const element = document.querySelector('.response-text > p');
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const range = document.createRange();
    range.selectNodeContents(element);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.getByRole('toolbar', { name: '选中文字' }).getByRole('button', { name: '引用', exact: true }).click();
  await page.locator('#conversation-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.jump-to-bottom').waitFor();
  async function verifyAuxiliaryRow() {
    const [strip, quote, live, jump] = await Promise.all([
      page.locator('.composer-context-bar').boundingBox(), page.locator('.quote-chip').boundingBox(),
      liveChip.boundingBox(), page.locator('.jump-to-bottom').boundingBox(),
    ]);
    assert.equal(strip.height, 34);
    assert.ok(Math.abs(live.x + live.width / 2 - strip.x - strip.width / 2) < 1, 'live diff stays centered');
    assert.ok(quote.x + quote.width <= live.x - 7 && live.x + live.width <= jump.x - 7, 'auxiliary controls must not overlap');
    assert.ok(Math.abs(quote.y - live.y) < 1 && Math.abs(jump.y - live.y) < 1);
  }
  await verifyAuxiliaryRow();
  await liveChip.click();
  const livePanel = page.getByRole('dialog', { name: '运行中的变更', exact: true });
  await livePanel.waitFor();
  assert.equal(await livePanel.locator('.turn-undo-action').count(), 0);
  assert.equal(await livePanel.locator('.live-turn-files li').count(), 4);
  assert.equal(await livePanel.locator('button, .turn-diff').count(), 0, 'running list is not a diff preview');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/turn-changes-live-fixture.png' });
  await livePanel.screenshot({ path: 'test-results/turn-changes-live-list-light.png' });
  async function publish(nextMessages) {
    await app.evaluate(({ BrowserWindow }, messages) => {
      globalThis.turnFixture.messages = messages;
      BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_history', messages });
    }, nextMessages);
  }
  const animatedMessages = [...messages];
  animatedMessages.splice(-1, 0, ...edit(paths[0], 'old\n', 'new\n'.repeat(8), 'motion-1'));
  await publish(animatedMessages);
  await page.waitForFunction(() => document.querySelector('.live-turn-chip .diff-added')?.dataset.count === '19');
  await page.waitForTimeout(260);
  animatedMessages.splice(-1, 0, ...edit(paths[0], 'old\n'.repeat(5), 'new\n', 'motion-2'));
  await publish(animatedMessages);
  await page.waitForFunction(() => document.querySelector('.live-turn-chip .diff-added')?.dataset.count === '20');
  const rolling = await page.locator('.live-turn-chip').evaluate(element =>
    [...element.querySelectorAll('number-flow-react')].map(flow => ({
      trend: flow.computedTrend, animated: flow.computedAnimated,
      values: flow.shadowRoot.getAnimations().map(animation => animation.effect.getKeyframes())
        .flat().filter(frame => frame['--_number-flow-d'] !== undefined).map(frame => Number(frame['--_number-flow-d'])),
    })));
  assert.ok(rolling[0].animated && rolling[0].trend === 1 && rolling[0].values.some(value => value < 0), 'added digits must roll up');
  assert.ok(rolling[1].animated && rolling[1].trend === -1 && rolling[1].values.some(value => value > 0), 'removed digits must roll down');
  const countBounds = await liveChip.boundingBox();
  const digitHeight = await liveChip.locator('.diff-count').first().evaluate(element => element.getBoundingClientRect().height);
  for (let i = 0; i < 3; i++) {
    animatedMessages.splice(-1, 0, ...edit(paths[0], 'old\n', 'new\n', `motion-rapid-${i}`));
    await publish(animatedMessages);
  }
  await page.waitForFunction(() => document.querySelector('.live-turn-chip .diff-added')?.dataset.count === '23');
  await page.waitForTimeout(300);
  assert.equal(await liveChip.locator('.diff-removed').getAttribute('data-count'), '13');
  assert.equal((await liveChip.boundingBox()).height, countBounds.height);
  assert.equal(await liveChip.locator('.diff-count').first().evaluate(element => element.getBoundingClientRect().height), digitHeight);
  assert.ok(await liveChip.evaluate(element => [...element.querySelectorAll('number-flow-react')]
    .every(flow => flow.shadowRoot.getAnimations().length === 0)), 'rapid updates must settle to the latest counts');
  assert.equal(await livePanel.locator('.live-turn-files li').count(), 4);
  await verifyAuxiliaryRow();
  await page.screenshot({ path: 'test-results/live-diff-counts-updated.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  animatedMessages.splice(-1, 0, ...edit(paths[0], 'old\n', 'new\n', 'motion-reduced'));
  await publish(animatedMessages);
  await page.waitForFunction(() => document.querySelector('.live-turn-chip .diff-added')?.dataset.count === '24');
  assert.ok(await liveChip.evaluate(element => [...element.querySelectorAll('number-flow-react')]
    .every(flow => !flow.computedAnimated && flow.shadowRoot.getAnimations().length === 0)));
  await publish(messages);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.live-turn-popover').evaluate(element => getComputedStyle(element).display), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await liveChip.click();
  await page.waitForTimeout(250);
  const closeFrames = await page.evaluate(async () => {
    const panel = document.querySelector('.live-turn-popover');
    const initial = panel.getBoundingClientRect();
    panel.hidePopover();
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 300) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const style = getComputedStyle(panel);
      const box = panel.getBoundingClientRect();
      frames.push({ opacity: Number(style.opacity), display: style.display, inert: panel.inert,
        x: box.x, y: box.y, startX: initial.x, startY: initial.y });
    }
    return frames;
  });
  assert.ok(closeFrames.some(frame => frame.opacity > .01 && frame.opacity < .99 && frame.display !== 'none'));
  assert.ok(closeFrames.filter(frame => frame.display !== 'none').every(frame =>
    Math.abs(frame.x - frame.startX) < 1 && Math.abs(frame.y - frame.startY) <= 4.5), 'exit keeps the anchored position');
  assert.equal(closeFrames.at(-1).display, 'none');
  await writeFile('test-results/live-popover-close-frames.json', JSON.stringify({ rolling, closeFrames }, null, 2));
  await liveChip.click();
  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    document.querySelector('.live-turn-popover').hidePopover();
    await new Promise(resolve => setTimeout(resolve, 60));
    document.querySelector('.live-turn-chip').click();
  });
  await page.waitForTimeout(260);
  assert.equal(await page.locator('.live-turn-popover').evaluate(element => element.matches(':popover-open')), true);
  assert.equal(await page.locator('.live-turn-popover').evaluate(element => getComputedStyle(element).opacity), '1');
  assert.equal(await page.locator('.live-turn-popover').evaluate(element => element.inert), false);
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.turnFixture.preferences.theme = 'dark';
    BrowserWindow.getAllWindows()[0].setSize(640, 850);
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(350);
  await verifyAuxiliaryRow();
  await liveChip.click();
  await livePanel.waitFor();
  const liveBounds = await livePanel.boundingBox();
  assert.ok(liveBounds.x >= 0 && liveBounds.x + liveBounds.width <= 640);
  assert.ok(liveBounds.y >= 46 && liveBounds.y + liveBounds.height <= (await liveChip.boundingBox()).y);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/turn-changes-live-narrow.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.turnFixture.preferences.theme = 'light';
    BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.getByRole('button', { name: '清空引用', exact: true }).click();
  await liveChip.click();
  await page.waitForTimeout(250);
  const stripBeforeEnd = await page.locator('.composer-context-bar').boundingBox();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.turnFixture.state.isStreaming = false;
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_end' });
  });
  const completionFrames = await page.evaluate(async () => {
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 300) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const context = document.querySelector('.live-turn-context');
      frames.push({ opacity: context ? Number(getComputedStyle(context).opacity) : null,
        height: document.querySelector('.composer-context-bar').getBoundingClientRect().height });
    }
    return frames;
  });
  assert.ok(completionFrames.some(frame => frame.opacity !== null && frame.opacity > .01 && frame.opacity < .99));
  assert.equal(completionFrames.at(-1).opacity, null);
  assert.ok(completionFrames.every(frame => frame.height === stripBeforeEnd.height));
  await writeFile('test-results/live-summary-completion-frames.json', JSON.stringify(completionFrames, null, 2));
  await page.waitForFunction(() => document.querySelectorAll('.turn-changes').length === 2);
  await liveChip.waitFor({ state: 'hidden' });
  assert.ok(await page.locator('.turn-changes').last().evaluate(element =>
    element.previousElementSibling?.classList.contains('response-content') &&
    element.nextElementSibling?.classList.contains('assistant-actions')));
  await page.reload();
  await page.locator('.turn-changes').nth(1).waitFor();
  const summaryToggle = page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true });
  if (await summaryToggle.getAttribute('aria-pressed') === 'true') await summaryToggle.click();
  const report = page.locator('.turn-changes').last();
  const history = page.locator('.turn-changes').first();
  assert.ok((await history.innerText()).includes('1 个文件'));
  assert.ok((await report.innerText()).includes('4 个文件'));
  assert.ok((await report.innerText()).includes('按次累计'));
  assert.equal(await report.locator('.turn-change-row').count(), 3);
  assert.equal(await report.locator('.turn-change-row svg, .turn-changes-more svg').count(), 0, 'disclosure controls should not have expand icons');
  async function verifyInsets() {
    assert.ok(await report.locator('.turn-change-row').first().evaluate(element => {
      const row = element.getBoundingClientRect();
      const first = element.firstElementChild.getBoundingClientRect();
      const last = element.lastElementChild.getBoundingClientRect();
      return first.left - row.left >= 8 && row.right - last.right >= 8;
    }), 'file ordinal and diff totals need edge insets');
  }
  await verifyInsets();
  await report.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.mouse.move(1000, 30);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/turn-changes-light.png' });
  await report.screenshot({ path: 'test-results/turn-changes-summary-detail.png' });
  await report.getByRole('button', { name: `预览变更 ${paths[0]}`, exact: true }).click();
  await report.locator('.turn-diff').waitFor();
  assert.equal(await report.locator('.diff-line-text code').first().evaluate(element => getComputedStyle(element).whiteSpace), 'pre');
  assert.equal(await report.locator('.diff-line-number').first().evaluate(element => getComputedStyle(element).width), '34px');
  assert.ok(await report.locator('.turn-diff .hljs-keyword').count() > 0);
  assert.ok((await report.locator('.turn-diff').innerText()).includes('agent_end'));
  await report.getByRole('button', { name: `预览变更 ${paths[0]}`, exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await report.locator('.turn-diff').count(), 0);
  await page.keyboard.press('Enter');
  await report.locator('.turn-diff').waitFor();
  await report.getByRole('combobox', { name: '编辑记录' }).selectOption('0');
  assert.ok(!(await report.locator('.turn-diff').innerText()).includes('agent_end'));
  await report.getByRole('combobox', { name: '编辑记录' }).selectOption('1');
  await report.getByRole('button', { name: '复制变更片段' }).click();
  assert.ok(await app.evaluate(() => globalThis.turnCopies.at(-1).includes('agent_end')));
  await report.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/turn-changes-preview-light.png' });
  await report.screenshot({ path: 'test-results/turn-changes-preview-detail.png' });
  await report.getByRole('button', { name: '另外 1 个文件', exact: true }).click();
  assert.equal(await report.locator('.turn-change-row').count(), 4);
  for (const path of paths) {
    await report.getByRole('button', { name: `预览变更 ${path}`, exact: true }).click();
    assert.equal(await report.locator('.turn-diff').count(), 1);
  }
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('dark');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await report.getByRole('button', { name: `预览变更 ${paths[0]}`, exact: true }).click();
  await report.evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.mouse.move(1000, 30);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/turn-changes-dark.png' });
  await report.screenshot({ path: 'test-results/turn-changes-dark-detail.png' });
  const diffStyles = await report.locator('.turn-diff-scroll').evaluate(element => ({
    width: getComputedStyle(element, '::-webkit-scrollbar').width,
    track: getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
    buttons: getComputedStyle(element, '::-webkit-scrollbar-button').display,
  }));
  assert.deepEqual(diffStyles, { width: '4px', track: 'rgba(0, 0, 0, 0)', buttons: 'none' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await report.getByRole('button', { name: `预览变更 ${paths[0]}`, exact: true }).click();
  await report.getByRole('button', { name: `预览变更 ${paths[0]}`, exact: true }).click();
  assert.equal(await report.locator('.turn-diff').evaluate(element => getComputedStyle(element).animationName), 'none');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 850));
  await page.waitForTimeout(400);
  await report.evaluate(element => element.scrollIntoView({ block: 'center' }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok(await report.evaluate(element => element.scrollWidth <= element.clientWidth));
  await verifyInsets();
  await page.screenshot({ path: 'test-results/turn-changes-narrow.png' });
  const preview = report.getByRole('region', { name: `${paths[0]} 变更预览`, exact: true });
  assert.ok(await preview.evaluate(element => element.scrollWidth > element.clientWidth));
  await preview.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.turn-diff-scroll').scrollLeft > 0);
  // Force an unsupported successful write: the list remains truthful about scope.
  await app.evaluate(() => {
    const index = globalThis.turnFixture.messages.length - 1;
    globalThis.turnFixture.messages.splice(index, 0,
      { role: 'assistant', content: [{ type: 'toolCall', name: 'write_file', id: 'unrecorded', arguments: { path: 'new.txt', content: 'new' } }] },
      { role: 'toolResult', toolCallId: 'unrecorded', content: 'Done' });
  });
  await page.reload();
  await page.locator('.turn-changes').last().getByText('部分记录', { exact: true }).waitFor();
  assert.equal(await page.locator('.turn-changes').count(), 2);
  await app.evaluate(() => { globalThis.turnFixture.preferences.language = 'en'; });
  await page.reload();
  await page.getByRole('region', { name: 'Turn changes', exact: true }).last().waitFor();
  await page.getByRole('region', { name: 'Turn changes', exact: true }).last().getByRole('button', { name: `Preview changes ${paths[0]}`, exact: true }).click();
  await page.getByRole('combobox', { name: 'Edit record' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Turn changes passed: centered live file list, cubic native popover enter/exit and interrupted reopen, up/down rolling digits including carry/rapid updates/reduced motion, same-row alignment, edge insets, end-only ledgers, immutable history, previews, copy, themes and narrow layout. Screenshots use isolated tool-result fixtures.');
} finally { await app.close(); }
