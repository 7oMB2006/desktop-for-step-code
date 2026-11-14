import { _electron as electron } from 'playwright';
import { prepareSessionFixture, waitForSessionFixtureTools } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareDispatchInput, taskSectionIsRevealed, waitForTaskSectionReveal } from './command-dispatch-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-command-dispatch-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
const savedDirectory = join(profile, 'step-runtime', 'workflows', 'saved');
await mkdir(savedDirectory, { recursive: true });
await writeFile(join(profile, 'step-runtime', 'config.toml'),
  '[telemetry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
await writeFile(join(savedDirectory, 'desktop-catalog-fixture.js'), 'throw new Error("Never execute catalog definitions");');
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Loading the font')) console.error(message.text());
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive(); win.setSize(1300, 900);
  });
  await page.waitForFunction(() => document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true');
  const draftBefore = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(draftBefore.draftId);
  assert.equal(draftBefore.runtimeId, undefined);
  const input = page.locator('.composer > .composer-input');
  await prepareDispatchInput(page, input, '/todos');
  await input.press('Enter');
  await page.locator('.sb-steps').getByText('请先打开一个会话', { exact: true }).waitFor();
  const draftAfter = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(draftAfter.draftId, draftBefore.draftId);
  assert.equal(draftAfter.runtimeId, undefined, 'The real draft shortcut does not create a native worker');
  assert.equal(draftAfter.sessions.length, draftBefore.sessions.length, 'Task inspection does not create a saved session');
  await page.locator('.summary-board').getByRole('button', { name: '关闭侧栏', exact: true }).click();
  const owner = await prepareSessionFixture(page);
  const snapshot = await waitForSessionFixtureTools(page, owner.runtimeId);
  const nativeCatalog = await page.evaluate(snapshot =>
    window.desktop.workflows(snapshot.runtimeId, snapshot.state.sessionId), snapshot);
  assert.ok(nativeCatalog.saved.some(item => item.name === 'desktop-catalog-fixture' && item.scope === 'desktop'),
    'Real IPC reads only the isolated Desktop profile without executing scripts');
  assert.equal(await page.evaluate(async snapshot => {
    try { await window.desktop.workflows(snapshot.runtimeId, 'wrong-session'); return false; }
    catch { return true; }
  }, snapshot), true, 'Real IPC rejects mismatched session ownership');
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.dispatchFixture = snapshot;
    globalThis.dispatchCalls = [];
    globalThis.dispatchSummary = { sessionId: snapshot.state.sessionId, tasks: [], mcp: [], skillCount: 0 };
    globalThis.rejectSummary = false;
    globalThis.rejectCompact = false;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.dispatchFixture;
      if (method === 'systemTheme') return { systemDark: true };
      if (method === 'sessions') return snapshot.sessions;
      if (method === 'summary') {
        if (globalThis.rejectSummary) throw new Error('Fixture summary unavailable');
        return globalThis.dispatchSummary;
      }
      if (method === 'repositoryDiff') return { state: 'ready', root: 'C:\\fixture\\repository', branch: 'main',
        base: 'HEAD', added: 0, removed: 0, files: [], truncated: false };
      if (method === 'workflows') {
        globalThis.dispatchCalls.push({ type: 'workflows', args });
        return { saved: [{ id: 'fixture', name: '验收工作流', scope: 'project' }], runs: [], issues: [] };
      }
      if (method === 'clm') return { sessionId: snapshot.state.sessionId, leafId: null, enabled: true, total: 0, revisions: [] };
      if (method === 'cronList') return { tasks: [], hosts: [], issues: [] };
      if (method === 'usageOverview') throw new Error('Isolated usage query unavailable');
      if (method === 'settings') return { account: {}, profiles: [], mcp: {}, skills: [] };
      if (method === 'command') {
        const [type, payload, owner] = args;
        globalThis.dispatchCalls.push({ type, payload, owner });
        if (type === 'get_commands') return { commands: ['usage', 'cron', 'todos', 'workflows'].map(name => ({ name, source: 'extension' })) };
        if (type === 'get_available_thinking_levels') return { levels: [] };
        if (type === 'compact' && globalThis.rejectCompact) throw new Error('Fixture compaction failed');
        return {};
      }
      return {};
    });
  }, snapshot);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true');
  // Overlay inspectors may cover the send button on short native displays.
  const send = async (text, keyboard = true) => {
    await prepareDispatchInput(page, input, text);
    if (keyboard) await input.press('Enter');
    else await page.locator('.composer-action-button').click();
  };
  const calls = type => app.evaluate((_electron, type) => globalThis.dispatchCalls.filter(call => call.type === type), type);
  await send('/workflows', false);
  await page.getByRole('region', { name: '工作流', exact: true }).getByText('验收工作流').waitFor();
  assert.deepEqual((await calls('workflows'))[0].args, [snapshot.runtimeId, snapshot.state.sessionId]);
  assert.equal((await calls('prompt')).length, 0, 'Workflow catalog does not send a model prompt');
  await page.locator('#workflow-catalog-panel').hover();
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#workflow-catalog-panel').evaluate(el => {
    const panel = el.getBoundingClientRect();
    const container = el.parentElement.parentElement.getBoundingClientRect();
    return panel.top >= container.top && panel.bottom <= container.bottom + 1;
  }), true, 'Workflow drawer fits the real conversation surface');
  await mkdir('test-results/workflow-catalog', { recursive: true });
  await page.screenshot({ path: 'test-results/workflow-catalog/electron.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: '工作流', exact: true }).waitFor({ state: 'hidden' });
  await send('/clm');
  await page.getByText('CLM 已启用', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'CLM', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal((await calls('prompt')).length, 0, 'Bare CLM opens the inspector without a model request');
  await page.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await page.locator('.context-panel').waitFor({ state: 'detached' });
  const board = page.getByRole('complementary', { name: '摘要', exact: true });
  const tasks = board.getByRole('region', { name: '推进清单', exact: true });
  const taskHeading = tasks.getByRole('heading', { name: '推进清单', exact: true });
  await send('/todos');
  await tasks.getByText('本轮暂无任务清单', { exact: true }).waitFor();
  await waitForTaskSectionReveal(page, taskHeading);
  assert.equal(await taskHeading.evaluate(element => element === document.activeElement), true,
    'The shortcut focuses the existing task section, not a separate panel');
  assert.equal(await input.evaluate(element => element.value), '');
  assert.equal((await calls('prompt')).length, 0, 'An empty task plan is read-only');
  await app.evaluate(() => {
    globalThis.dispatchSummary = { ...globalThis.dispatchSummary, plan: { id: 'current', title: '当前计划' },
      tasks: [
        { id: 'one', subject: '正在检查', description: '保留已展开的任务详情', status: 'in_progress' },
        { id: 'two', subject: '等待验证', description: '', status: 'failed' },
        { id: 'three', subject: '已完成检查', description: '', status: 'completed' },
      ],
      archivedPlans: [{ id: 'old', title: '上一份计划', tasks: [
        { id: 'old-one', subject: '历史任务', description: '', status: 'completed' },
      ] }],
    };
  });
  await tasks.getByRole('button', { name: '正在检查 · 进行中', exact: true }).waitFor();
  assert.equal(await tasks.getByRole('progressbar').getAttribute('aria-valuenow'), '1');
  assert.equal(await tasks.getByRole('progressbar').getAttribute('aria-valuemax'), '3',
    'History is excluded from current progress');
  const history = tasks.locator('.sb-task-history');
  const historyTrigger = history.getByRole('button', { name: /已完成计划.*1 项/ });
  assert.equal(await historyTrigger.getAttribute('aria-expanded'), 'false', 'History stays initially folded');
  await historyTrigger.click();
  await tasks.getByRole('button', { name: '正在检查 · 进行中', exact: true }).click();
  await tasks.getByText('保留已展开的任务详情', { exact: true }).waitFor();
  await tasks.evaluate(element => { window.taskSectionBeforeCommand = element; });
  await board.locator('.summary-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await send('/todos');
  await waitForTaskSectionReveal(page, taskHeading);
  assert.equal(await tasks.evaluate(element => window.taskSectionBeforeCommand === element), true,
    'Repeated commands do not remount tasks or replay progress');
  assert.equal(await historyTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await tasks.getByRole('button', { name: '正在检查 · 进行中', exact: true }).getAttribute('aria-expanded'), 'true');
  assert.equal(await taskHeading.evaluate(taskSectionIsRevealed), true,
    'Repeated commands reveal the heading after manual scrolling');
  await input.fill('保留输入焦点');
  await page.waitForTimeout(1400);
  assert.equal(await input.evaluate(element => element === document.activeElement), true,
    'Summary polling cannot replay a handled focus request');
  assert.equal(await input.evaluate(element => element.value), '保留输入焦点');
  await input.fill('');
  await app.evaluate(() => { globalThis.rejectSummary = true; });
  await tasks.getByRole('status').getByText('暂时无法读取，正在重试', { exact: true }).waitFor();
  await tasks.getByRole('button', { name: '正在检查 · 进行中', exact: true }).waitFor();
  await app.evaluate(() => { globalThis.rejectSummary = false; });
  await tasks.getByRole('status').waitFor({ state: 'hidden' });
  await mkdir('test-results/todos', { recursive: true });
  for (const { width, theme, language, reduced } of [
    { width: 1440, theme: 'dark', language: 'zh', reduced: false },
    { width: 760, theme: 'light', language: 'zh', reduced: false },
    { width: 1440, theme: 'light', language: 'en', reduced: true },
    { width: 760, theme: 'dark', language: 'en', reduced: true },
  ]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await app.evaluate(({ BrowserWindow }, { width, theme, language }) => {
      const window = BrowserWindow.getAllWindows()[0];
      globalThis.dispatchFixture.preferences = { ...globalThis.dispatchFixture.preferences, theme, language };
      window.setSize(width, 800);
      window.webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
    }, { width, theme, language });
    await page.waitForFunction(({ width, theme, language }) => innerWidth === width
      && document.documentElement.dataset.theme === theme
      && document.querySelector('.sb-steps h4')?.textContent === (language === 'zh' ? '推进清单' : 'Task plan'), { width, theme, language });
    await send('/todos', true);
    await page.waitForTimeout(reduced ? 0 : 400);
    const fit = await page.locator('.summary-board').evaluate(element => {
      const board = element.getBoundingClientRect(), heading = element.querySelector('.sb-steps h4').getBoundingClientRect();
      const viewport = element.querySelector('.summary-content').getBoundingClientRect();
      return { inside: board.left >= 0 && board.right <= innerWidth && board.bottom <= innerHeight,
        focusInside: heading.left - 4 >= viewport.left && heading.right + 4 <= viewport.right
          && heading.top - 4 >= viewport.top && heading.bottom + 4 <= viewport.bottom,
        overflow: element.scrollWidth > element.clientWidth };
    });
    assert.deepEqual(fit, { inside: true, focusInside: true, overflow: false }, JSON.stringify({ width, theme, language, fit }));
    await page.screenshot({ path: `test-results/todos/${language}-${theme}-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    globalThis.dispatchFixture.preferences = { ...globalThis.dispatchFixture.preferences, theme: 'dark', language: 'zh' };
    window.setSize(1300, 900);
    window.webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  });
  await page.getByRole('heading', { name: '推进清单', exact: true }).waitFor();
  assert.equal((await calls('prompt')).length, 0, 'Task inspection, retries and responsive changes never submit prompts');
  await send('/workflows');
  await page.getByRole('region', { name: '工作流', exact: true }).waitFor();
  await send('/usage');
  await page.getByRole('region', { name: '用量统计', exact: true }).waitFor();
  assert.equal((await calls('prompt')).length, 0, 'Usage opens the Desktop page without sending terminal heatmap text');
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  assert.equal(await page.locator('#workflow-catalog-panel').getAttribute('aria-hidden'), 'true',
    'Returning from another page does not reopen an old catalog');
  await send('/usage overview');
  await page.getByRole('region', { name: '用量统计', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  await send('/usage account');
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '账户', exact: true }).getAttribute('aria-current'), 'page');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'detached' });
  await send('/cron');
  await page.locator('.scheduled-tasks').waitFor();
  assert.equal((await calls('prompt')).length, 0, 'Bare Cron opens the existing page');
  // Reload returns to the same fixture without creating a real task.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true');
  await send('/compact 保留接口和测试');
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.dispatchCalls.some(call => call.type === 'compact') && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
  });
  await page.waitForFunction(() => document.querySelector('.composer-input')?.value === ''
    && document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true');
  assert.deepEqual((await calls('compact')).map(call => call.payload), [{ customInstructions: '保留接口和测试' }],
    JSON.stringify(await app.evaluate(() => globalThis.dispatchCalls)));
  assert.equal((await calls('compact'))[0].owner, snapshot.runtimeId);
  assert.equal((await calls('prompt')).length, 0, 'Compact uses its RPC, never prompt');
  await app.evaluate(() => { globalThis.rejectCompact = true; });
  await send('/compact 保留失败草稿');
  await page.getByText(/Fixture compaction failed/).waitFor();
  assert.equal(await input.evaluate(element => element.value), '/compact 保留失败草稿');
  await send('请解释 /clm 和 /usage');
  await send('/cron list');
  await send('/workflows list');
  await send('/todos list');
  await send('请解释 /todos');
  assert.deepEqual((await calls('prompt')).map(call => call.payload.message), ['请解释 /clm 和 /usage', '/cron list', '/workflows list', '/todos list', '请解释 /todos']);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.dispatchFixture.state.isStreaming = true;
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_start', runtimeId: globalThis.dispatchFixture.runtimeId });
  });
  await page.locator('.composer-action-button[data-action="stop"]').waitFor();
  const beforeTasks = await app.evaluate(() => ({
    launch: structuredClone(globalThis.dispatchFixture.launch),
    calls: globalThis.dispatchCalls.length,
  }));
  await send('/todos');
  await tasks.waitFor();
  await waitForTaskSectionReveal(page, taskHeading);
  assert.equal(await taskHeading.evaluate(element => element === document.activeElement), true);
  assert.deepEqual(await app.evaluate(() => globalThis.dispatchFixture.launch), beforeTasks.launch,
    'Opening tasks does not consume the next launch choices');
  assert.equal(await app.evaluate(() => globalThis.dispatchCalls.length), beforeTasks.calls,
    'Busy task inspection does not stop, queue, steer or otherwise command the runtime');
  assert.equal((await calls('prompt')).length, 5, 'Busy task inspection does not submit a main prompt');
  assert.equal(await page.locator('.composer-action-button').getAttribute('data-action'), 'stop');
  await send('/compact');
  await page.getByText(/请等待当前任务结束/).waitFor();
  assert.equal((await calls('compact')).length, 2, 'Busy compact is not sent or queued as prose');
  assert.equal(await input.evaluate(element => element.value), '/compact');
  assert.deepEqual(errors, []);
  console.log('Command dispatch passed: real read-only Workflow IPC, task-section focus/history/retries/responsive layouts, local pages, compact RPC/failure/busy guards and parameter passthrough.');
} finally { await app.close(); }
