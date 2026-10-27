import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'desktop-capability-ui-'));
const market = join(profile, 'fixture-market');
const iconPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCj0AAAAASUVORK5CYII=', 'base64');
await mkdir(join(market, '.step-plugin'), { recursive: true });
await mkdir(join(market, 'example', 'skills', 'review'), { recursive: true });
await writeFile(join(market, '.step-plugin', 'marketplace.json'), JSON.stringify({
  name: 'fixture-market', plugins: [{ name: 'example', source: './example', description: 'Local verification plugin' }],
}));
await writeFile(join(market, 'example', 'step.plugin.json'), JSON.stringify({
  id: 'example', name: 'Example plugin', version: '1.0.0', skills: ['skills'], icon: 'logo.png',
  mcpServers: { tools: { command: process.execPath, args: [resolve('tests/fixtures/steppage-mcp-server.mjs')],
    env: { FIXTURE_API_KEY: 'must-not-enter-the-renderer' } } },
}));
await writeFile(join(market, 'example', 'logo.png'), iconPng);
await writeFile(join(market, 'example', 'skills', 'review', 'SKILL.md'),
  '---\nname: review\ndescription: Review fixture\n---\nReview the task.\n');
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'step-runtime', 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(profile, 'step-runtime', 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
  models: [{ id: 'fixture', name: 'Offline management verification', contextWindow: 32768, maxTokens: 1024 }],
} } }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
async function verifyDisclosure(locator, reducedMotion = false) {
  const result = await locator.evaluate(async (panel) => {
    const summary = panel.querySelector('summary');
    const body = panel.querySelector('.cap-disclosure-body');
    const chevron = summary.querySelector('.cap-chevron svg');
    const check = { chevron: chevron?.getAttribute('viewBox'), closed: !panel.open && body.inert };
    summary.click();
    await new Promise(requestAnimationFrame);
    const opening = body.getAnimations();
    check.opening = opening.map(animation => animation.effect.getTiming());
    check.accessible = summary.getAttribute('aria-expanded') === 'true' && !body.inert;
    await Promise.all(opening.map(animation => animation.finished));
    check.open = panel.open && body.getBoundingClientRect().height > 0;
    summary.click();
    await new Promise(requestAnimationFrame);
    const closing = body.getAnimations();
    check.closing = closing.map(animation => animation.effect.getTiming());
    check.inertOnClose = body.inert && body.getAttribute('aria-hidden') === 'true';
    check.retainedDuringClose = panel.open;
    await Promise.all(closing.map(animation => animation.finished));
    check.settled = !panel.open;
    return check;
  });
  assert.equal(result.chevron, '0 0 14 14', 'Use the shared disclosure icon');
  for (const key of ['closed', 'accessible', 'open', 'inertOnClose', 'settled']) assert.equal(result[key], true, key);
  for (const direction of ['opening', 'closing']) {
    assert.equal(result[direction].length, reducedMotion ? 0 : 1, direction);
    if (!reducedMotion) {
      assert.equal(result[direction][0].duration, 240);
      assert.equal(result[direction][0].easing, 'cubic-bezier(0.215, 0.61, 0.355, 1)');
    }
  }
  assert.equal(result.retainedDuringClose, !reducedMotion);
}
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  const draft = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(draft.draftId && !draft.runtimeId, 'Management navigation starts from a draft without a runtime');
  const schedules = page.getByRole('button', { name: '定时任务', exact: true });
  const message = page.getByRole('textbox', { name: '消息', exact: true });
  await message.fill('Preserve this draft when toggling schedules');
  await schedules.click();
  await page.locator('.scheduled-tasks').waitFor();
  assert.equal(await schedules.getAttribute('aria-pressed'), 'true');
  assert.equal(await schedules.getAttribute('data-tooltip'), '返回会话');
  await schedules.click();
  await page.locator('.scheduled-tasks').waitFor({ state: 'detached' });
  assert.equal(await schedules.getAttribute('aria-pressed'), 'false');
  assert.equal(await message.innerText(), 'Preserve this draft when toggling schedules');
  const returned = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(returned.draftId, draft.draftId);
  assert.equal(returned.runtimeId, undefined, 'Toggling schedules does not create a worker');
  const tree = page.locator('.workspace-tree');
  await tree.evaluate(element => {
    const spacer = document.createElement('div');
    spacer.dataset.focusFadeFixture = 'true';
    spacer.style.height = '1200px';
    element.append(spacer);
    element.scrollTop = 24;
  });
  await page.waitForFunction(() => document.querySelector('.workspace-tree')?.dataset.scrolled === 'true');
  assert.match(await tree.evaluate(element => getComputedStyle(element).maskImage), /linear-gradient/);
  await tree.getByRole('button').first().focus();
  await tree.getByRole('button').first().press('ArrowRight');
  assert.equal(await tree.evaluate(element => getComputedStyle(element).maskImage), 'none', 'Keep keyboard-focused controls fully visible');
  await schedules.focus();
  await tree.evaluate(element => { element.scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('.workspace-tree')?.dataset.scrolled === 'false');
  assert.equal(await tree.evaluate(element => getComputedStyle(element).maskImage), 'none', 'Do not fade stationary first rows');
  await tree.locator('[data-focus-fade-fixture]').evaluate(element => element.remove());
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('/mcp');
  await page.getByRole('option', { name: /MCP/ }).click();
  await page.locator('.cap-heading').getByRole('heading', { name: 'MCP', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, undefined, 'Local MCP navigation does not start a runtime');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  const host = await page.evaluate(() => window.desktop.newIndependentSession());
  assert.ok(host.runtimeId);
  const commands = () => page.evaluate(async () => {
    const active = await window.desktop.snapshot();
    return (await window.desktop.command('get_commands', undefined, active.runtimeId)).commands;
  });
  const initialCommands = await commands();
  assert.equal(initialCommands.some(command => command.name === 'skill:local-review'), false);
  await page.reload();
  const sidebarActions = page.getByRole('group', { name: '快捷入口', exact: true });
  const searchButton = sidebarActions.getByRole('button', { name: '搜索', exact: true });
  assert.equal(await searchButton.isEnabled(), true);
  await sidebarActions.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.getByRole('tab', { name: /^发现/ }).waitFor();
  assert.equal(await page.getByRole('tab', { name: /^发现/ }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  const geometry = await page.locator('.sidebar-task-actions').evaluate(element => {
    const primary = element.querySelector('.sidebar-primary-actions').getBoundingClientRect();
    const primaryButtons = [...element.querySelectorAll('.sidebar-primary-actions > button')].map(button => button.getBoundingClientRect());
    const row = element.querySelector('.sidebar-utility-row').getBoundingClientRect();
    const buttons = [...element.querySelectorAll('.sidebar-utility-row button')].map(button => button.getBoundingClientRect());
    return { equalPrimary: primaryButtons.length === 2 && Math.abs(primaryButtons[0].width - primaryButtons[1].width) < 1,
      pairedIcons: Math.abs(buttons[1].left - buttons[0].right - 2) < 1 && Math.abs(buttons[1].right - row.right) < 1,
      sameRow: buttons.every(button => Math.abs(button.top - buttons[0].top) < 1),
      contained: element.scrollWidth <= element.clientWidth,
      compactGap: Math.abs(row.top - primary.bottom - 6) < 1 };
  });
  assert.deepEqual(geometry, { equalPrimary: true, pairedIcons: true, sameRow: true, contained: true, compactGap: true });
  const actionsBox = await page.locator('.sidebar-task-actions').boundingBox();
  const sessionsBox = await page.locator('.workspace-tree').boundingBox();
  assert.ok(Math.abs(sessionsBox.y - actionsBox.y - actionsBox.height) < 1, 'No extra spacer before the session list');
  await page.screenshot({ path: 'test-results/capabilities-sidebar-light.png' });
  const anchorBefore = await page.locator('.sidebar-search-toggle').boundingBox();
  const treeBefore = await page.locator('.workspace-tree').boundingBox();
  await searchButton.press('Enter');
  const searchInput = page.getByRole('textbox', { name: '搜索会话', exact: true });
  await searchInput.waitFor();
  assert.equal(await searchInput.evaluate(input => !input.readOnly && document.activeElement === input), true);
  assert.equal(await page.locator('.sidebar-utility-links').evaluate(element => element.inert), true);
  await page.locator('.sidebar-search-field').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  assert.deepEqual(await page.locator('.sidebar-search-toggle').boundingBox(), anchorBefore, 'Search keeps its original anchor');
  assert.deepEqual(await page.locator('.workspace-tree').boundingBox(), treeBefore, 'Search does not push the session list');
  await page.screenshot({ path: 'test-results/capabilities-sidebar-search-light.png' });
  await searchInput.press('Escape');
  assert.equal(await searchButton.evaluate(button => document.activeElement === button), true);
  await page.locator('.sidebar-search-field').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  assert.equal(await page.locator('.sidebar-search-field').evaluate(element => element.inert), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await searchButton.click();
  assert.equal(await page.locator('.sidebar-search-field').evaluate(element => element.getAnimations().length), 0);
  await page.getByRole('button', { name: '收起搜索', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark', language: 'en' }));
  await page.reload();
  await page.getByRole('button', { name: 'Schedules', exact: true }).waitFor();
  assert.equal(await page.locator('.sidebar-primary-actions > button > span').evaluateAll(elements =>
    elements.length === 2 && elements.every(element => element.scrollWidth <= element.clientWidth)), true, 'English primary labels fit');
  await page.screenshot({ path: 'test-results/capabilities-sidebar-dark-en.png' });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search sessions', exact: true }).press('Escape');
  await page.evaluate(() => window.desktop.preferences({ theme: 'light', language: 'zh' }));
  await page.reload();
  await page.getByRole('button', { name: '定时任务', exact: true }).waitFor();
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByRole('tab', { name: /^已安装/ }).waitFor();
  await page.getByRole('tab', { name: /^市场来源/ }).click();
  await page.getByRole('button', { name: '添加市场', exact: true }).click();
  await page.getByRole('textbox', { name: '市场来源', exact: true }).fill(market);
  await page.locator('.cap-form').getByRole('button', { name: '添加市场', exact: true }).click();
  await page.locator('.cap-form').waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: /^发现/ }).click();
  await page.locator('.cap-row').filter({ hasText: 'steppage' }).locator('[data-icon-kind="step"]').waitFor();
  await page.getByRole('textbox', { name: '搜索资源' }).fill('example');
  await page.waitForFunction(() => document.querySelector('.cap-row .cap-plugin-icon img')?.naturalWidth === 1);
  await page.getByRole('button', { name: '安装 example', exact: true }).click();
  await page.getByText('已安装', { exact: true }).waitFor();
  await page.getByRole('tab', { name: /^已安装/ }).click();
  const examplePanel = page.locator('.cap-resource').filter({ hasText: 'Example plugin' });
  await examplePanel.locator('.cap-plugin-icon img').waitFor();
  await page.waitForFunction(() => document.querySelector('.cap-resource .cap-plugin-icon img')?.naturalWidth === 1);
  await writeFile(join(profile, 'step-runtime', 'plugins', 'example', 'logo.png'), iconPng.subarray(0, 33));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await examplePanel.locator('[data-icon-kind="fallback"]').waitFor();
  await writeFile(join(profile, 'step-runtime', 'plugins', 'example', 'logo.png'), iconPng);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await examplePanel.locator('.cap-plugin-icon img').waitFor();
  await verifyDisclosure(page.locator('.cap-resource').filter({ hasText: 'Example plugin' }));
  const preparation = page.locator('.cap-preparation').filter({ hasText: 'StepPage' });
  await verifyDisclosure(preparation);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await verifyDisclosure(preparation, true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByText('Example plugin', { exact: true }).click();
  await page.locator('.cap-resource[open]').evaluate(async panel => {
    await Promise.all(panel.querySelector('.cap-disclosure-body').getAnimations().map(animation => animation.finished));
  });
  await page.screenshot({ path: 'test-results/capabilities-plugins-light.png' });
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByText('review', { exact: true }).waitFor();
  const sessionCommands = page.locator('.cap-preparation').filter({ hasText: '会话命令' });
  await verifyDisclosure(sessionCommands);
  await sessionCommands.locator('summary').focus();
  await sessionCommands.locator('summary').press('Enter');
  await page.waitForFunction(() => document.querySelector('.cap-preparation > summary')?.getAttribute('aria-expanded') === 'true');
  await sessionCommands.evaluate(async panel => {
    await Promise.all(panel.querySelector('.cap-disclosure-body').getAnimations().map(animation => animation.finished));
  });
  await sessionCommands.locator('summary').press('Space');
  await page.waitForFunction(() => !document.querySelector('.cap-preparation')?.open);
  assert.equal(await page.getByRole('button', { name: '删除 review', exact: true }).count(), 0);
  await page.getByRole('button', { name: '新建 Skill', exact: true }).click();
  const originalViewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const [layout, width, height] of [['wide', 1280, 900], ['narrow', 640, 720]]) {
      await page.setViewportSize({ width, height });
      for (const name of ['名称', '描述', '指令内容']) {
        const field = page.getByRole('textbox', { name, exact: true });
        await field.click();
        await field.focus();
        await field.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        const focus = await field.evaluate(element => {
          const style = getComputedStyle(element);
          const extent = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
          const rect = element.getBoundingClientRect();
          const clipped = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent);
            const box = parent.getBoundingClientRect();
            const left = box.left + parent.clientLeft;
            const top = box.top + parent.clientTop;
            if (css.overflowX !== 'visible' && (rect.left - extent < left - .5 || rect.right + extent > left + parent.clientWidth + .5)) clipped.push(`${parent.className}: horizontal`);
            if (css.overflowY !== 'visible' && (rect.top - extent < top - .5 || rect.bottom + extent > top + parent.clientHeight + .5)) clipped.push(`${parent.className}: vertical`);
          }
          return { focused: document.activeElement === element, extent, clipped };
        });
        assert.equal(focus.focused, true, `${theme}/${layout}/${name}: focus`);
        assert.ok(focus.extent > 0, 'Preserve the shared outer focus outline');
        assert.deepEqual(focus.clipped, [], `${theme}/${layout}/${name}: full focus indicator`);
      }
      await page.screenshot({ path: `test-results/capabilities-form-focus-${theme}-${layout}.png` });
    }
  }
  await page.setViewportSize(originalViewport);
  await page.evaluate(theme => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, originalTheme);
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('local-review');
  await page.getByRole('textbox', { name: '描述', exact: true }).fill('Local review fixture');
  await page.getByRole('textbox', { name: '指令内容', exact: true }).fill('Inspect the current task.');
  await page.getByRole('button', { name: '创建 Skill', exact: true }).click();
  const toggle = page.getByRole('switch', { name: '启用 local-review', exact: true });
  await toggle.waitFor();
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 local-review"]')?.getAttribute('aria-checked') === 'false');
  const catalog = await page.evaluate(() => window.desktop.capabilityCatalog());
  assert.equal(catalog.skills.find(skill => skill.name === 'local-review').enabled, false);
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 local-review"]')?.getAttribute('aria-checked') === 'true');
  assert.equal((await commands()).some(command => command.name === 'skill:local-review'), false, 'Changes never implicitly reload an existing session');
  await page.locator('.cap-footer').getByRole('button', { name: '重启当前会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.cap-footer button')?.disabled);
  assert.ok((await commands()).some(command => command.name === 'skill:local-review'), 'Explicit restart loads the new Skill');
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 local-review"]')?.getAttribute('aria-checked') === 'false');
  assert.ok((await commands()).some(command => command.name === 'skill:local-review'), 'Disabling in configuration does not rewrite a live session');
  await page.locator('.cap-footer').getByRole('button', { name: '重启当前会话', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.cap-footer button')?.disabled);
  assert.equal((await commands()).some(command => command.name === 'skill:local-review'), false, 'Restart respects the upstream disabled pattern');
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  const serverToggle = page.getByRole('switch', { name: '启用 example__tools', exact: true });
  await serverToggle.waitFor();
  const serverRow = serverToggle.locator('..');
  await serverRow.getByText(/已连接 · 1 个工具/).waitFor();
  assert.equal(await serverRow.getByRole('button', { name: /^编辑/ }).count(), 0, 'Plugin declarations are not edited independently');
  await serverToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 example__tools"]')?.getAttribute('aria-checked') === 'false');
  await serverRow.getByText(/配置已停用 · 已连接/).waitFor();
  assert.doesNotMatch(JSON.stringify(await page.evaluate(() => window.desktop.capabilityCatalog())), /must-not-enter-the-renderer/);
  await page.screenshot({ path: 'test-results/capabilities-mcp-light.png' });
  await page.locator('.cap-footer').getByRole('button', { name: '重启当前会话', exact: true }).click();
  await serverRow.getByText(/会话中已停用/).waitFor();
  await serverToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 example__tools"]')?.getAttribute('aria-checked') === 'true');
  await page.locator('.cap-footer').getByRole('button', { name: '重启当前会话', exact: true }).click();
  await serverRow.getByText(/已连接 · 1 个工具/).waitFor();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByText('local-review', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/capabilities-skills-light.png' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'dark' }));
  await page.reload();
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByText('local-review', { exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: 'test-results/capabilities-skills-dark.png' });
  await page.setViewportSize({ width: 640, height: 720 });
  await page.screenshot({ path: 'test-results/capabilities-skills-narrow.png' });
  assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  await page.getByRole('button', { name: '删除 local-review', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await toggle.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByText('Example plugin', { exact: true }).click();
  await page.getByRole('button', { name: '卸载插件', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '插件仍被会话占用' }).waitFor();
  assert.ok((await page.evaluate(() => window.desktop.capabilityCatalog())).plugins.some(plugin => plugin.id === 'example'));
  assert.match(await readFile(join(profile, 'step-runtime', 'plugins', 'example', 'step.plugin.json'), 'utf8'), /Example plugin/);
  assert.match(await readFile(join(profile, 'step-runtime', 'plugins', 'example', 'skills', 'review', 'SKILL.md'), 'utf8'), /Review fixture/);
  await page.getByRole('button', { name: 'MCP', exact: true }).click();
  await page.getByRole('switch', { name: '启用 example__tools', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 example__tools"]')?.getAttribute('aria-checked') === 'false');
  await page.locator('.cap-footer').getByRole('button', { name: '重启当前会话', exact: true }).click();
  await page.getByText(/会话中已停用/).waitFor();
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByText('Example plugin', { exact: true }).click();
  await page.getByRole('button', { name: '卸载插件', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await page.getByText('Example plugin', { exact: true }).waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(() => window.desktop.capabilityCatalog())).plugins.some(plugin => plugin.id === 'example'), false);
  const messagesBefore = (await page.evaluate(() => window.desktop.snapshot())).messages.length;
  for (const [command, heading] of [['/plugin browse', '插件'], ['/mcp', 'MCP'], ['/skills', 'Skills']]) {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-dialog').waitFor({ state: 'detached' });
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(command);
    await page.getByRole('textbox', { name: '消息', exact: true }).press('Escape');
    await page.getByRole('textbox', { name: '消息', exact: true }).press('Enter');
    await page.locator('.cap-heading').getByRole('heading', { name: heading, exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  const composer = page.getByRole('textbox', { name: '消息', exact: true });
  await composer.fill('/plugin install filter-only-for-plugins');
  await composer.press('Escape');
  await composer.press('Enter');
  const resourceSearch = page.getByRole('textbox', { name: '搜索资源', exact: true });
  await resourceSearch.waitFor();
  assert.equal(await resourceSearch.inputValue(), 'filter-only-for-plugins');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  await composer.fill('/mcp');
  await page.getByRole('option', { name: 'MCP 查看与管理服务器', exact: true }).click();
  await page.locator('.cap-heading').getByRole('heading', { name: 'MCP', exact: true }).waitFor();
  assert.equal(await resourceSearch.inputValue(), '', 'Plugin command filters cannot leak into MCP action navigation');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).messages.length, messagesBefore, 'Management commands are local navigation, not model prompts');
  assert.match(await readFile(join(market, 'example', 'step.plugin.json'), 'utf8'), /Example plugin/);
  const savedSettings = await page.evaluate(() => window.desktop.settings());
  await app.evaluate(({ ipcMain }, settings) => {
    globalThis.refreshFixture = {
      plugins: [], available: [{ name: 'refresh-plugin', description: '', marketplace: 'refresh-market', installed: false }],
      marketplaces: [{ name: 'refresh-market', kind: 'git', origin: 'fixture' }],
      mcp: [{ name: 'refresh-mcp', source: 'user', transport: 'stdio', enabled: true, configurable: true }],
      skills: [{ id: 'refresh-skill', name: 'refresh-skill', description: '', source: 'user',
        location: 'agent/skills/refresh-skill/SKILL.md', enabled: true, toggleable: true, deletable: true }],
      warnings: [],
    };
    globalThis.holdCatalog = false;
    globalThis.releaseCatalog = undefined;
    globalThis.refreshMutations = 0;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (_event, method, ...args) => {
      if (method === 'settings') return settings;
      if (method === 'summary') return { tasks: [], mcp: [], skillCount: 1 };
      if (method === 'stepPageState') return { status: 'missing', installed: false };
      if (method === 'capabilityCatalog') {
        const result = structuredClone(globalThis.refreshFixture);
        if (!globalThis.holdCatalog) return result;
        return new Promise((resolve, reject) => {
          globalThis.releaseCatalog = fail => {
            globalThis.holdCatalog = false;
            globalThis.releaseCatalog = undefined;
            if (fail) reject(new Error('capability:marketplace-failed'));
            else resolve(result);
          };
        });
      }
      if (method === 'capabilityMutate') {
        globalThis.refreshMutations++;
        const input = args[0];
        if (input.action === 'mcp-toggle') globalThis.refreshFixture.mcp[0].enabled = input.enabled;
        return { warnings: [] };
      }
      return {};
    });
  }, savedSettings);
  const refreshButton = page.getByRole('button', { name: '刷新', exact: true });
  await refreshButton.click();
  await page.getByRole('switch', { name: '启用 refresh-mcp', exact: true }).waitFor();
  for (const [category, tab] of [['MCP'], ['插件', '发现'], ['插件', '市场来源'], ['Skills']]) {
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: category, exact: true }).click();
    if (tab) await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
    await page.waitForFunction(() => !document.querySelector('.cap-heading [aria-label="刷新"]')?.disabled);
    await app.evaluate(() => { globalThis.holdCatalog = true; });
    await refreshButton.click();
    await page.waitForFunction(() => document.querySelector('.cap-heading [aria-label="刷新"]')?.disabled);
    const controls = page.locator('.cap-heading button, .cap-row button, .cap-footer button');
    assert.ok(await controls.count() > 1, 'The loaded rows remain visible during refresh');
    assert.equal(await controls.evaluateAll(buttons => buttons.every(button => button.disabled)), true,
      `${category}/${tab ?? ''}: mutations and restart are disabled during refresh`);
    assert.equal(await app.evaluate(() => globalThis.refreshMutations), 0);
    await app.evaluate(() => globalThis.releaseCatalog(false));
    await page.waitForFunction(() => !document.querySelector('.cap-heading [aria-label="刷新"]')?.disabled);
  }
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: 'MCP', exact: true }).click();
  const refreshToggle = page.getByRole('switch', { name: '启用 refresh-mcp', exact: true });
  await refreshToggle.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="启用 refresh-mcp"]')?.disabled);
  await app.evaluate(() => { globalThis.holdCatalog = true; });
  await refreshButton.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 refresh-mcp"]')?.disabled);
  await app.evaluate(() => globalThis.releaseCatalog(true));
  await page.getByRole('alert').waitFor();
  await refreshToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 refresh-mcp"]')?.getAttribute('aria-checked') === 'false');
  assert.equal(await app.evaluate(() => globalThis.refreshMutations), 1, 'A failed refresh unlocks mutations and the next catalog reflects the mutation');
  assert.deepEqual(errors, []);
  console.log('Capability Electron acceptance passed (isolated profile, real upstream management APIs).');
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: 'test-results/capabilities-failure.png' }).catch(() => {});
  console.error('Visible errors:', await page.locator('[role="alert"]').allTextContents());
  throw error;
} finally {
  await app.close();
}
