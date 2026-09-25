import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'step-desktop-electron-'));
const workspace = join(profile, '中文项目 with spaces'); await mkdir(workspace);
const secondWorkspace = join(profile, 'Second project'); await mkdir(secondWorkspace);
const independentCwd = join(profile, 'Independent cwd'); await mkdir(independentCwd);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspace, workspaces: [secondWorkspace, workspace] }));
// Isolated on-disk history fixtures; no live model or personal session data.
for (const [index, cwd] of [workspace, secondWorkspace, independentCwd].entries()) {
  const dir = join(profile, 'step-runtime', 'sessions');
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const entries = [
    { type: 'session', version: 3, id: `fixture-${index}`, cwd, timestamp },
    { type: 'message', id: 'user-1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: 'Fixture history' }], timestamp: Date.now() } },
    { type: 'session_info', id: 'name-1', parentId: 'user-1', timestamp, name: index === 0 ? '历史验证会话' : index === 1 ? 'Second session' : '独立验证会话' },
  ];
  await writeFile(join(dir, `fixture-${index}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: '让想法阶跃星辰' }).waitFor();
  assert.equal(await page.locator('.window-identity').innerText(), '');
  assert.equal(await page.locator('.window-identity img').getAttribute('src'), './StepCode.svg');
  assert.equal(await page.locator('.sidebar-wordmark img:visible').getAttribute('alt'), 'Desktop for Step Code');
  assert.equal(await page.locator('.sidebar-wordmark img:visible').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await page.locator('.sidebar-identity > img').getAttribute('src'), './StepCode.svg');
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  assert.equal(await page.locator('.sidebar-identity').isVisible(), false);
  assert.equal(await page.locator('.window-identity img').isVisible(), true);
  await page.screenshot({ path: 'test-results/brand-sidebar-hidden.png' });
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  assert.equal(await page.locator('.sidebar-identity').isVisible(), true);
  await page.getByRole('button', { name: '最大化', exact: true }).click();
  await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true);
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  await page.getByRole('button', { name: '最大化', exact: true }).waitFor();
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.focus(); });
  await page.getByRole('button', { name: '中文项目 with spaces', exact: true }).waitFor();
  await page.getByRole('button', { name: '独立会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '独立验证会话', exact: true }).waitFor();
  const disclosureCases = [
    {
      region: page.getByRole('region', { name: '独立会话', exact: true }),
      toggleName: '独立会话',
    },
    {
      region: page.getByRole('region', { name: workspace, exact: true }),
      toggleName: '中文项目 with spaces',
    },
  ];
  for (const { region, toggleName } of disclosureCases) {
    const toggle = region.getByRole('button', { name: toggleName, exact: true });
    const disclosure = region.locator('.workspace-disclosure');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await toggle.locator('svg.lucide-chevron-down, svg.lucide-chevron-right').count(), 0);
    assert.equal(await disclosure.getAttribute('aria-hidden'), 'false');
    assert.equal(await disclosure.evaluate(element => element.inert), false);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await disclosure.getAttribute('aria-hidden'), 'true');
    assert.equal(await disclosure.evaluate(element => element.inert), true);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await disclosure.getAttribute('aria-hidden'), 'false');
  }
  const projectToggle = disclosureCases[1].region.getByRole('button', { name: '中文项目 with spaces', exact: true });
  const projectDisclosure = disclosureCases[1].region.locator('.workspace-disclosure');
  assert.equal(await projectToggle.locator('svg.lucide-folder-open').count(), 1);
  await projectToggle.click();
  assert.equal(await projectToggle.locator('svg.lucide-folder').count(), 1);
  assert.equal(await projectToggle.locator('svg.lucide-folder-open').count(), 0);
  await projectToggle.click();
  assert.equal(await projectToggle.locator('svg.lucide-folder-open').count(), 1);
  assert.equal(await disclosureCases[0].region.getByRole('button', { name: '独立会话', exact: true }).locator('svg.lucide-message-square').count(), 1);
  const reduceMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const transitionStyle = await projectDisclosure.evaluate(element => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, timing: style.transitionTimingFunction };
  });
  if (!reduceMotion) {
    assert.match(transitionStyle.timing, /cubic-bezier\(0\.65, 0, 0\.35, 1\)/);
    assert.ok(transitionStyle.duration.split(',').some(value => parseFloat(value) >= 0.24));
    const openHeight = await projectDisclosure.evaluate(element => element.getBoundingClientRect().height);
    await projectToggle.click();
    await page.waitForTimeout(60);
    const closingHeight = await projectDisclosure.evaluate(element => element.getBoundingClientRect().height);
    assert.ok(closingHeight > 0 && closingHeight < openHeight);
    await projectToggle.click();
    await page.waitForTimeout(280);
  }
  assert.equal(await page.getByRole('button', { name: 'Independent cwd', exact: true }).count(), 0);
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const startupState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(startupState.independent, true);
  const independentRoot = await realpath(join(profile, 'workspaces', 'independent'));
  const activeWorkspace = await realpath(startupState.preferences.workspace);
  assert.ok(activeWorkspace.toLowerCase().startsWith(`${independentRoot.toLowerCase()}\\`), `${activeWorkspace} is outside ${independentRoot}`);
  assert.equal(startupState.preferences.workspaces.length, 2);
  assert.equal(startupState.preferences.workspaces.includes(startupState.preferences.workspace), false);
  assert.equal(startupState.messages.length, 0);
  assert.notEqual(startupState.state.sessionId, 'fixture-0');
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.getByRole('button', { name: '独立验证会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.breadcrumb > strong')?.textContent === '独立验证会话');
  let independentState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(independentState.independent, true);
  assert.equal(independentState.preferences.workspaces.length, 2);
  assert.equal(independentState.preferences.workspaces.includes(independentCwd), false);
  await page.getByRole('region', { name: '独立会话', exact: true }).getByRole('button', { name: '独立验证会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '重启运行时', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  independentState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(independentState.independent, true);
  assert.equal(independentState.state.sessionId, 'fixture-2');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  independentState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(independentState.independent, true);
  assert.equal(independentState.messages.length, 0);
  assert.notEqual(independentState.preferences.workspace, independentCwd);
  assert.notEqual(independentState.preferences.workspace, startupState.preferences.workspace);
  assert.equal(independentState.preferences.workspaces.length, 2);
  await page.screenshot({ path: 'test-results/desktop-light.png' });
  await page.getByRole('button', { name: '账户设置', exact: true }).click();
  await page.getByText('尚未登录', { exact: true }).waitFor();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  assert.equal(await page.evaluate(() => CSS.supports('appearance', 'base-select')), true);
  const themePicker = page.getByRole('dialog').getByRole('combobox').first();
  await themePicker.click();
  await page.screenshot({ path: 'test-results/select-light.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('combobox').first().selectOption('dark');
  await themePicker.click();
  await page.screenshot({ path: 'test-results/select-dark.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const modelPicker = page.getByRole('combobox', { name: '模型', exact: true });
  await modelPicker.focus();
  await page.keyboard.press('Space');
  assert.equal(await modelPicker.evaluate(element => element.matches(':open')), true);
  await page.screenshot({ path: 'test-results/select-composer.png' });
  const pickerFits = await modelPicker.locator('option').first().evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 36 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
  });
  assert.equal(pickerFits, true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('textbox', { name: '搜索会话' }).count(), 0);
  await page.getByRole('button', { name: '在 中文项目 with spaces 新建会话', exact: true }).click();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.composer > textarea').disabled);
  const projectState = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(projectState.independent, false);
  assert.equal(await realpath(projectState.preferences.workspace), await realpath(workspace));
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).isEnabled(), true);
  await page.screenshot({ path: 'test-results/desktop-dark-connected.png' });
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('窗口验证会话');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const firstGroup = page.getByRole('region', { name: workspace, exact: true });
  await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '在 Second project 新建会话', exact: true }).click();
  await page.waitForFunction(path => document.querySelector('.breadcrumb > span')?.textContent === path, 'Second project');
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Second session');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const secondGroup = page.getByRole('region', { name: secondWorkspace, exact: true });
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).waitFor();
  assert.equal(await firstGroup.getByRole('button', { name: 'Second session', exact: true }).count(), 0);
  await firstGroup.getByRole('button', { name: '中文项目 with spaces', exact: true }).click();
  assert.equal(await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).count(), 0);
  await firstGroup.getByRole('button', { name: '中文项目 with spaces', exact: true }).click();
  await secondGroup.getByRole('button', { name: 'Second session', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.breadcrumb > strong')?.textContent === 'Second session');
  await firstGroup.getByRole('button', { name: '历史验证会话', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.breadcrumb > strong')?.textContent === '历史验证会话');
  await page.screenshot({ path: 'test-results/workspace-tree.png' });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Add MCP', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'MCP', exact: true });
  await modal.getByLabel('名称', { exact: true }).fill('disabled-test');
  await modal.getByLabel('可执行文件', { exact: true }).fill('node');
  await modal.getByLabel('启用', { exact: true }).uncheck();
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  await page.getByText('disabled-test', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/settings-mcp.png' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 620));
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.screenshot({ path: 'test-results/desktop-narrow.png' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
  // Exercise the real renderer subscriber with the upstream JSON wire shape.
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'assistant', content: [] } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '流式白屏回归验证' } });
    send({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 'fixture', toolName: 'read_file' } });
  });
  await page.getByText('流式白屏回归验证', { exact: true }).waitFor();
  await page.getByRole('button', { name: /read_file/ }).waitFor();
  await page.screenshot({ path: 'test-results/layout-conversation-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const send = value => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', value);
    send({ type: 'message_start', message: { role: 'user', content: '帮我检查项目的目录结构。' } });
    send({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '我会先检查入口与配置，再查看主要模块。\n\n- 确认项目运行方式\n- 查看目录与依赖\n- 汇总需要关注的问题' }] } });
  });
  await page.getByText('帮我检查项目的目录结构。', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/layout-conversation-wide.png' });
  const geometry = await page.evaluate(() => {
    const transcript = document.querySelector('.messages').getBoundingClientRect();
    const composer = document.querySelector('.composer-wrap').getBoundingClientRect();
    return { aligned: Math.abs(transcript.left - composer.left) < 2 && Math.abs(transcript.width - composer.width) < 2, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(geometry.aligned, true);
  assert.equal(geometry.overflow, false);
  assert.deepEqual(errors, []);
  console.log('Electron acceptance passed: isolated profile, real RPC, settings, rename, MCP, themes, narrow window, no renderer Node access.');
} catch (error) {
  const pages = app.windows();
  if (pages[0]) { console.log(await pages[0].locator('body').innerText()); await pages[0].screenshot({ path: 'test-results/failure.png' }); }
  throw error;
} finally { await app.close(); }

// Both repeat launch and a brand-new profile must open an independent draft.
const cleanProfile = await mkdtemp(join(tmpdir(), 'step-desktop-first-run-'));
for (const userData of [profile, cleanProfile]) {
  const relaunched = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env: { ...env, DESKTOP_TEST_USER_DATA: userData }, timeout: 60000 });
  try {
    const page = await relaunched.firstWindow();
    await page.waitForFunction(() => { const input = document.querySelector('.composer > textarea'); return input && !input.disabled; }, { timeout: 60000 });
    const home = await page.evaluate(() => window.desktop.snapshot());
    assert.equal(home.independent, true);
    assert.equal(home.status, 'connected');
    assert.equal(home.messages.length, 0);
    assert.equal(home.preferences.workspaces.length, userData === profile ? 2 : 0);
    assert.equal(home.sessions.some(s => !s.independent && s.cwd.startsWith(join(userData, 'workspaces', 'independent'))), false);
    if (userData === profile) {
      await page.getByRole('button', { name: '独立验证会话', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.breadcrumb > strong')?.textContent === '独立验证会话');
      assert.equal((await page.evaluate(() => window.desktop.snapshot())).independent, true);
    }
    await page.screenshot({ path: `test-results/home-${userData === profile ? 'reopened' : 'first-run'}.png` });
  } finally { await relaunched.close(); }
}
console.log('Independent home passed: new/reopened profiles, fresh draft and persistent independent history.');
