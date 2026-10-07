import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-subagent-status-'));
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
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1157, 790);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await prepareSessionFixture(page);
  const task = '对一份摘要做事实忠实性审查。只读，严禁修改、创建或删除任何文件。需要读的两个文件都在当前工作目录：原始材料与研究摘要。';
  const tasks = [
    { agent: 'review', task, status: 'running', messages: [] },
    { agent: 'explore', task: '检查工作目录里的相关材料，整理原始信息。', status: 'completed', messages: [] },
    { agent: 'general', task: '整理三步链式任务的结论。', status: 'completed', messages: [] },
  ];
  const messages = [
    { role: 'user', timestamp: Date.now() - 1000, content: '核验摘要的事实来源，并检查相关材料。' },
    { role: 'assistant', timestamp: Date.now(), content: [
      { type: 'thinking', thinking: '分别交给 review 和 explore 核验，保留独立的任务记录。' },
      { type: 'toolCall', id: 'status-fixture', name: 'subagent', arguments: { tasks: tasks.map(({ agent, task }) => ({ agent, task })) } },
    ] },
    { role: 'toolResult', toolCallId: 'status-fixture', toolName: 'subagent', content: '', details: { results: tasks } },
  ];
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.subagentStatusFixture = snapshot;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => method === 'snapshot' ? globalThis.subagentStatusFixture
      : method === 'sessions' ? globalThis.subagentStatusFixture.sessions
        : method === 'command' && args[0] === 'get_available_thinking_levels' ? { levels: ['off', 'low', 'medium', 'high'] }
          : method === 'command' && args[0] === 'get_commands' ? { commands: [] } : {});
  }, { ...snapshot, messages, state: { ...snapshot.state, isStreaming: true } });
  const review = page.locator('.lane-row[data-lane-agent="review"]');
  const icon = review.locator('.subagent-status-icon');
  const check = icon.locator('.subagent-status-check path');
  const update = async status => {
    tasks[0] = { ...tasks[0], status };
    await app.evaluate(({ BrowserWindow }, tasks) => {
      const snapshot = globalThis.subagentStatusFixture;
      const result = { content: '', details: { results: tasks } };
      snapshot.messages[snapshot.messages.length - 1] = { ...snapshot.messages.at(-1), ...result };
      BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
        type: 'tool_execution_update', toolCallId: 'status-fixture', toolName: 'subagent', partialResult: result,
      });
    }, tasks);
  };
  await page.reload();
  await review.waitFor();
  await page.locator('.thinking summary').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.lane-row .process-tool-label').count(), 0);
  assert.equal(await page.locator('.lane-row[data-lane-agent="explore"] .subagent-status-icon').getAttribute('data-settling'), 'false');
  const firstRotation = await icon.locator('.subagent-status-spinner').evaluate(element => getComputedStyle(element).transform);
  await page.waitForTimeout(120);
  const secondRotation = await icon.locator('.subagent-status-spinner').evaluate(element => getComputedStyle(element).transform);
  assert.notEqual(firstRotation, secondRotation, 'running ring rotates');
  const anchor = await review.locator('.lane-type').boundingBox();
  await page.screenshot({ path: 'test-results/subagent-status-running-dark.png' });
  await page.locator('.response-content').screenshot({ path: 'test-results/subagent-status-rows-running.png' });
  // Pause WAAPI only in this fixture to inspect contraction, the hold, and handwriting.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.closest('.subagent-status-icon')) { animation.pause(); animation.currentTime = 0; }
      return animation;
    };
  });
  await update('completed');
  await page.waitForFunction(() => document.querySelector('.lane-row[data-lane-agent="review"] .subagent-status-icon').dataset.settling === 'true');
  const setTime = time => icon.evaluate((element, time) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSAnimation)) animation.currentTime = time;
    }
  }, time);
  await setTime(180);
  const contracted = await icon.evaluate(element => element.getBoundingClientRect().width);
  await setTime(230);
  const held = await icon.evaluate(element => element.getBoundingClientRect().width);
  assert.ok(Math.abs(contracted - 3.24) < .1 && Math.abs(held - contracted) < .1, 'ring stays contracted during the hold');
  const circleOnly = await check.evaluate(element => getComputedStyle(element).strokeDashoffset);
  assert.equal(parseFloat(circleOnly), 1, 'check stays hidden until ring regrowth');
  await page.screenshot({ path: 'test-results/subagent-status-hold-dark.png' });
  await setTime(490);
  const drawn = parseFloat(await check.evaluate(element => getComputedStyle(element).strokeDashoffset));
  assert.ok(drawn > 0 && drawn < 1, 'check has a real intermediate handwriting frame');
  await page.screenshot({ path: 'test-results/subagent-status-drawing-dark.png' });
  await icon.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSAnimation)) animation.finish();
    }
  });
  await page.waitForFunction(() => document.querySelector('.lane-row[data-lane-agent="review"] .subagent-status-icon').dataset.settling === 'false');
  assert.equal(parseFloat(await check.evaluate(element => getComputedStyle(element).strokeDashoffset)), 0);
  const finalAnchor = await review.locator('.lane-type').boundingBox();
  assert.ok(Math.abs(anchor.x - finalAnchor.x) < .1 && Math.abs(anchor.y - finalAnchor.y) < .1, 'task row layout does not move with status animation');
  assert.ok(await icon.locator('.subagent-status-check').evaluate(element => {
    const token = document.createElement('span');
    token.style.color = 'var(--primary)';
    document.body.append(token);
    const matches = getComputedStyle(token).color === getComputedStyle(element).color;
    token.remove();
    return matches && element.getBoundingClientRect().width === 16;
  }), 'completed icon uses the brand accent at a tool-sized scale');
  await page.screenshot({ path: 'test-results/subagent-status-completed-dark.png' });
  await page.locator('.response-content').screenshot({ path: 'test-results/subagent-status-rows-completed.png' });
  await app.evaluate(({ BrowserWindow }, tasks) => {
    const window = BrowserWindow.getAllWindows()[0];
    const message = { role: 'toolResult', toolCallId: 'status-fixture', toolName: 'subagent',
      content: '', details: { results: tasks }, timestamp: Date.now() };
    window.webContents.send('runtime-event', { type: 'tool_execution_end',
      toolCallId: message.toolCallId, toolName: 'subagent', result: message });
    window.webContents.send('runtime-event', { type: 'message_start', message });
  }, tasks);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.lane-row').count(), 3, 'message_start does not duplicate completed chain lanes');
  await app.evaluate(({ BrowserWindow }, tasks) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'message_end',
      message: { role: 'toolResult', toolCallId: 'status-fixture', toolName: 'subagent',
        content: '', details: { results: tasks }, timestamp: Date.now() } });
  }, tasks);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.lane-row').count(), 3, 'completed chain stays three lanes before agent_end');
  await page.locator('.response-content').screenshot({ path: 'test-results/subagent-chain-completed-no-duplicates.png' });
  await review.click({ position: { x: 10, y: 15 } });
  await page.locator('#subagent-panel[aria-hidden="false"]').waitFor();
  await review.click({ position: { x: 10, y: 15 } });
  await page.locator('#subagent-panel').waitFor({ state: 'detached' });

  await page.evaluate(async () => { await window.desktop.preferences({ theme: 'light' }); });
  await app.evaluate(() => { globalThis.subagentStatusFixture.preferences.theme = 'light'; });
  await page.reload();
  await review.waitFor();
  assert.equal(await icon.getAttribute('data-settling'), 'false', 'completed history does not replay');
  await page.screenshot({ path: 'test-results/subagent-status-completed-light.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 780));
  await page.waitForTimeout(300);
  const narrow = await icon.boundingBox();
  assert.equal(Math.round(narrow.width), 18);
  await page.screenshot({ path: 'test-results/subagent-status-completed-narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await update('running');
  await page.waitForTimeout(100);
  assert.equal(await icon.locator('.subagent-status-spinner').evaluate(element => getComputedStyle(element).animationName), 'none');
  await update('completed');
  await page.waitForTimeout(100);
  assert.equal(await icon.getAttribute('data-settling'), 'false');
  await update('failed');
  await review.locator('.lane-failure-label').waitFor();
  assert.match(await review.getAttribute('aria-label'), /已失败/);
  assert.deepEqual(errors, []);
  console.log('Subagent status passed: rotation, shrink/hold/grow/draw, stable layout, history, themes, narrow, reduced motion, failure and click-toggle.');
} finally { await app.close(); }
