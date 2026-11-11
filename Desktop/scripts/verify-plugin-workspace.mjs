import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { settleLayout } from './settle-layout.mjs';

const output = process.env.PLUGIN_WORKSPACE_OUTPUT || 'test-results/plugin-workspace';
await mkdir(output, { recursive: true });
let server, browser, releaseIcon;
const errors = [];
try {
  if (!process.env.DESKTOP_PREVIEW_URL) {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
  }
  const base = process.env.DESKTOP_PREVIEW_URL || server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    ...(process.env.DESKTOP_VERIFY_BROWSER ? { executablePath: process.env.DESKTOP_VERIFY_BROWSER } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  page.on('pageerror', error => errors.push(error.message));
  const url = `${base}/tests/fixtures/plugin-workspace.html`;
  // Navigation can finish before the fixture's top-level icon fetch and React mount.
  const iconPattern = '**/plugin-center-assets/bvr.png';
  const iconGate = new Promise(resolve => { releaseIcon = resolve; });
  const delayIcon = async route => { await iconGate; await route.continue(); };
  await page.route(iconPattern, delayIcon);
  const iconRequested = page.waitForRequest(iconPattern);
  await page.goto(url);
  await iconRequested;
  const group = page.getByRole('group', { name: '插件快捷入口', exact: true });
  const main = page.locator('[data-plugin-workspace="plugin-0"]');
  const button = page.getByRole('button', { name: 'Hermes 工程桥', exact: true });
  assert.equal(await group.count(), 0, 'navigation alone does not establish fixture readiness');
  releaseIcon();
  await group.waitFor();
  await page.unroute(iconPattern, delayIcon);
  assert.equal(await group.locator(':scope > button').count(), 4, 'three visible entries plus overflow');
  const mini = page.getByRole('button', { name: 'MiniChat', exact: true });
  const minimize = page.getByRole('button', { name: '最小化', exact: true });
  const [groupBox, miniBox, minimizeBox] = await Promise.all([group.boundingBox(), mini.boundingBox(), minimize.boundingBox()]);
  assert.ok(groupBox.x + groupBox.width <= miniBox.x + 1, 'plugin group is before official controls');
  assert.equal(miniBox.x + miniBox.width, minimizeBox.x, 'MiniChat adjacency is unchanged');
  assert.equal(await group.evaluate(element => element.parentElement.classList.contains('window-bar')), true);
  assert.equal(await button.evaluate(element => getComputedStyle(element).webkitAppRegion), 'no-drag');
  const fallbackIcon = group.locator('[data-plugin-action="plugin-1"] svg');
  await fallbackIcon.waitFor();
  assert.equal(await fallbackIcon.count(), 1, 'bad PNG falls back to a fixed Lucide icon');
  await page.locator('#draft').fill('保留这个需求');
  await button.click();
  await main.getByRole('heading', { name: '从第一项委托开始', exact: true }).waitFor();
  await main.getByRole('button', { name: '查看连接准备', exact: true }).click();
  await main.getByRole('heading', { name: '连接准备', exact: true }).waitFor();
  await main.getByRole('button', { name: '返回上一页', exact: true }).waitFor();
  const pagePanel = main.getByRole('tabpanel');
  await pagePanel.evaluate(element => { element.scrollTop = 380; });
  await main.getByRole('tab', { name: '第一项任务', exact: true }).click();
  await main.getByRole('heading', { name: '第一项任务', exact: true }).waitFor();
  await main.getByRole('tab', { name: '开始使用', exact: true }).click();
  assert.equal(await main.getByRole('button', { name: '返回上一页', exact: true }).isVisible(), true, 'per-page local navigation survives tab switching');
  assert.ok(await pagePanel.evaluate(element => element.scrollTop) > 300, 'per-page scroll survives tab switching');
  await button.click();
  assert.equal(await page.locator('#draft').inputValue(), '保留这个需求', 'opening a plugin never replaces the main draft');
  await button.click();
  assert.ok(await pagePanel.evaluate(element => element.scrollTop) > 300, 'scroll survives workspace hide/reopen');
  await main.getByRole('tab', { name: '连接准备', exact: true }).click();
  await main.getByRole('tab', { name: '连接准备', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await main.getByRole('tab', { name: '第一项任务', exact: true }).getAttribute('aria-selected'), 'true');
  await main.getByRole('tab', { name: '离线帮助', exact: true }).click();
  await main.getByRole('alert').waitFor();
  const before = await page.evaluate(() => window.pluginWorkspaceFixture.reads.length);
  await main.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(count => window.pluginWorkspaceFixture.reads.length > count, before);
  await page.getByRole('button', { name: '更多插件', exact: true }).click();
  const menu = page.getByRole('menu', { name: '更多插件', exact: true });
  await menu.waitFor();
  await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]') !== null);
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('图像工作台')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '更多插件', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: '更多插件', exact: true }).click();
  await page.mouse.click(50, 130);
  await menu.waitFor({ state: 'hidden' });
  for (const [name, width, height, theme, surface] of [
    ['main-light', 1440, 940, 'light', 'main'], ['main-dark', 1440, 940, 'dark', 'main'],
    ['main-narrow', 390, 844, 'dark', 'main'], ['side-light', 1440, 940, 'light', 'side'],
    ['side-narrow', 390, 844, 'light', 'side'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width < 700 ? 'reduce' : 'no-preference' });
    await page.goto(`${url}?open=1&theme=${theme}&surface=${surface}`);
    await main.getByRole('heading', { name: '从第一项委托开始', exact: true }).waitFor();
    const visibleEntries = width <= 900 ? 1 : 3;
    assert.equal(await group.locator(':scope > [data-plugin-action]').count(), visibleEntries);
    const overflowEntries = await page.getByRole('button', { name: '更多插件', exact: true });
    await overflowEntries.click();
    assert.equal(await page.getByRole('menu', { name: '更多插件', exact: true }).getByRole('menuitemradio').count(), 5 - visibleEntries);
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal viewport overflow');
    const nativeClose = page.getByRole('button', { name: '关闭窗口', exact: true });
    const closeBox = await nativeClose.boundingBox();
    assert.ok(closeBox.x >= 0 && closeBox.x + closeBox.width <= width + 1, 'native controls stay inside the viewport');
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    await main.getByRole('tab', { name: '开始使用', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    const focused = main.getByRole('tab', { name: '连接准备', exact: true });
    const extent = await focused.evaluate(element => {
      const box = element.getBoundingClientRect();
      const clip = element.parentElement.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        visible: element.matches(':focus-visible'),
        gutter: parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)),
        top: box.top - clip.top, bottom: clip.bottom - box.bottom,
        left: box.left - clip.left, right: clip.right - box.right,
      };
    });
    assert.ok(extent.visible, `${name}: keyboard tab focus is visible`);
    for (const edge of ['top', 'bottom', 'left', 'right'])
      assert.ok(extent[edge] >= extent.gutter - 0.5, `${name}: complete ${edge} focus outline stays inside the tab scroller`);
    await main.getByRole('heading', { name: '连接准备', exact: true }).waitFor();
    await page.screenshot({ path: `${output}/${name}-focused.png`, fullPage: true });
  }
  await page.goto(`${url}?mode=single&open=1`);
  await group.waitFor();
  assert.equal(await page.getByRole('button', { name: '更多插件', exact: true }).count(), 0);
  assert.equal(await group.locator(':scope > button').count(), 1);
  await page.goto(`${base}/tests/fixtures/plugin-window.html`);
  await page.getByRole('heading', { name: 'Hermes 工程桥', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '侧栏', exact: true }).count(), 0, 'plugin window does not expose a dead sidebar action');
  assert.equal(await page.getByRole('button', { name: 'MiniChat', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '返回工作区', exact: true }).count(), 0,
    'a separate window must not claim its close action returns to the workspace');
  await page.getByRole('button', { name: '插件设置', exact: true }).click();
  assert.equal(await page.evaluate(() => window.pluginWindowFixture.configured), 1);
  await page.getByRole('button', { name: '查看连接准备', exact: true }).click();
  await page.getByRole('heading', { name: '连接准备', exact: true }).waitFor();
  const reads = await page.evaluate(() => window.pluginWindowFixture.reads);
  await page.evaluate(() => window.pluginWindowFixture.emit('desktop_system_theme', { dark: true }));
  await page.waitForFunction(count => window.pluginWindowFixture.reads > count, reads);
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await page.getByRole('button', { name: '返回上一页', exact: true }).isVisible(), true, 'theme refresh preserves document navigation');
  await page.evaluate(() => {
    window.pluginWindowFixture.theme = 'light';
    window.pluginWindowFixture.emit('desktop_plugin_preferences_changed');
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await page.getByRole('button', { name: '返回上一页', exact: true }).isVisible(), true, 'preferences refresh preserves document navigation');
  await page.evaluate(() => {
    window.pluginWindowFixture.theme = 'system';
    window.pluginWindowFixture.emit('desktop_plugin_preferences_changed');
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.evaluate(() => {
    window.pluginWindowFixture.ref = 'bridge-package-2';
    window.pluginWindowFixture.emit('desktop_plugin_catalog_changed');
  });
  await page.getByRole('heading', { name: '开始使用', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '返回上一页', exact: true }).count(), 0, 'changed package ref resets stale document history');
  await page.evaluate(() => { window.pluginWindowFixture.manual = true; window.pluginWindowFixture.emit('desktop_plugin_catalog_changed'); });
  await page.waitForFunction(() => window.pluginWindowFixture.requests.length === 1);
  await page.evaluate(() => window.pluginWindowFixture.emit('desktop_plugin_catalog_changed'));
  await page.waitForFunction(() => window.pluginWindowFixture.requests.length === 2);
  await page.evaluate(() => {
    const fixture = window.pluginWindowFixture;
    fixture.requests[1].resolve(fixture.snapshot('新的插件标题'));
    fixture.requests[0].reject(new Error('STALE_PRIVATE_ERROR'));
  });
  await page.getByRole('heading', { name: '新的插件标题', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'stale failure cannot clear a newer successful snapshot');
  await page.evaluate(() => {
    const fixture = window.pluginWindowFixture;
    fixture.manual = false; fixture.unavailable = true; fixture.emit('desktop_plugin_catalog_changed');
  });
  await page.getByRole('heading', { name: '插件暂不可用', exact: true }).waitFor();
  assert.equal(await page.locator('[data-plugin-workspace]').count(), 0, 'failed refresh clears stale plugin content');
  assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE_'));
  await page.evaluate(() => { window.pluginWindowFixture.unavailable = false; });
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.getByRole('heading', { name: 'Hermes 工程桥', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.pluginWindowFixture.illegal), 0, 'plugin window never reads conversations or submits commands');
  await page.getByRole('button', { name: '关闭插件窗口', exact: true }).click();
  assert.ok(await page.evaluate(() => window.pluginWindowFixture.controls.includes('close')));
  await page.screenshot({ path: `${output}/native-window-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 1060, height: 780 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/native-window-desktop-dark.png`, fullPage: true });
  await page.goto(`${url}?open=1&mode=single&connection=1`);
  const connection = main.locator('.plugin-connection');
  const preparation = connection.getByRole('region', { name: '准备情况', exact: true });
  const preparationResults = () => preparation.locator('[data-preparation-step]').evaluateAll(elements =>
    elements.map(element => [element.getAttribute('data-preparation-step'), element.getAttribute('data-result')]));
  const assertPreparation = async (results, label) => {
    assert.deepEqual(await preparationResults(), ['profile', 'companion', 'bridge', 'roots'].map((id, index) =>
      [id, results[index]]), `${label}: preparation reports only established evidence`);
  };
  const assertGuideNavigation = async (trigger, tabName, heading) => {
    const beforeCalls = await page.evaluate(() => [...window.pluginWorkspaceFixture.connection.calls]);
    await trigger.click();
    await main.getByRole('heading', { name: heading, exact: true }).waitFor();
    assert.equal(await main.getByRole('tab', { name: tabName, exact: true }).getAttribute('aria-selected'), 'true');
    await page.waitForFunction(name => document.activeElement?.getAttribute('role') === 'tab'
      && document.activeElement.textContent === name, tabName);
    assert.deepEqual(await page.evaluate(() => window.pluginWorkspaceFixture.connection.calls), beforeCalls,
      `${tabName}: a guide only opens its declared document without reading, choosing or forgetting a profile`);
  };
  await connection.locator('[role="status"]').getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  await assertPreparation(['unchecked', 'unchecked', 'unchecked', 'unchecked'], 'unselected');
  assert.equal(await main.getByRole('tab', { name: '连接', exact: true }).getAttribute('aria-selected'), 'true');
  await assertGuideNavigation(connection.getByRole('button', { name: '安装指南', exact: true }), '连接准备', '连接准备');
  await main.getByRole('tab', { name: '连接', exact: true }).click();
  await connection.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  for (const id of ['companion', 'bridge', 'roots']) {
    await assertGuideNavigation(preparation.locator(`[data-preparation-step="${id}"]`)
      .getByRole('button', { name: '查看准备步骤', exact: true }), '连接准备', '连接准备');
    await main.getByRole('tab', { name: '连接', exact: true }).click();
    await connection.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  }
  await assertGuideNavigation(preparation.getByRole('button', { name: '查看第一项任务', exact: true }),
    '第一项任务', '第一项任务');
  await main.getByRole('tab', { name: '连接', exact: true }).click();
  await connection.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  assert.equal(await connection.getByRole('button', { name: '选择身份目录', exact: true }).count(), 1,
    'the profile card owns the only profile chooser');
  await connection.getByRole('button', { name: '选择身份目录', exact: true }).click();
  await connection.getByRole('heading', { name: '只读连接已核验', exact: true }).waitFor();
  await assertPreparation(['found', 'configured', 'verified', 'authorized'], 'ready');
  assert.ok((await preparation.innerText()).includes('组件是否已被 Agent 加载，仍需在 Agent 侧确认'));
  assert.ok((await preparation.innerText()).includes('不代表实时在线或已经可以派工'));
  assert.ok((await preparation.innerText()).includes('只读连接成功不代表整条链路已通过'));
  assert.ok((await connection.innerText()).includes('task-42'));
  await page.evaluate(() => { window.pluginWorkspaceFixture.connection.canceled = true; });
  await connection.getByRole('button', { name: '更换身份目录', exact: true }).click();
  await connection.getByRole('heading', { name: '只读连接已核验', exact: true }).waitFor();
  assert.ok((await connection.innerText()).includes('task-42'), 'cancel preserves selected profile');
  await page.evaluate(() => {
    const fixture = window.pluginWorkspaceFixture.connection;
    fixture.result = fixture.snapshot('ready'); fixture.result.roots = []; fixture.result.tasks = [];
  });
  await connection.getByRole('button', { name: '重新检查', exact: true }).click();
  await connection.getByRole('heading', { name: '只读连接已核验', exact: true }).waitFor();
  await assertPreparation(['found', 'configured', 'verified', 'no-roots'], 'ready without authorization');
  assert.equal(await preparation.locator('[data-preparation-step="roots"] .is-attention').count(), 1);
  assert.ok((await preparation.innerText()).includes('请在配套宿主授权专用练习目录后重新检查'));
  assert.equal(await connection.locator('.plugin-connection-tasks > li').count(), 0);
  for (const [status, heading, results] of [
    ['profile-missing', 'Profile 不可用', ['missing', 'unchecked', 'unchecked', 'unchecked']],
    ['companion-missing', '缺少 companion 配置', ['found', 'missing', 'unchecked', 'unchecked']],
    ['configuration-invalid', '连接配置无效', ['found', 'invalid', 'unchecked', 'unchecked']],
    ['pairing-required', '缺少配对凭据', ['found', 'configured', 'pairing', 'unchecked']],
    ['connection-unavailable', '无法连接 Agent Bridge', ['found', 'configured', 'unavailable', 'unchecked']],
    ['identity-mismatch', '连接身份不匹配', ['found', 'configured', 'mismatch', 'unchecked']],
  ]) {
    await page.evaluate(status => {
      const fixture = window.pluginWorkspaceFixture.connection;
      fixture.result = fixture.snapshot(status);
    }, status);
    await connection.getByRole('button', { name: '重新检查', exact: true }).click();
    await connection.getByRole('heading', { name: heading, exact: true }).waitFor();
    await assertPreparation(results, status);
    assert.ok(!(await connection.innerText()).includes('task-42'), `${status}: old task results cleared`);
    if (status === 'configuration-invalid' || status === 'identity-mismatch') {
      const card = status === 'configuration-invalid' ? 'companion' : 'bridge';
      await assertGuideNavigation(preparation.locator(`[data-preparation-step="${card}"]`)
        .getByRole('button', { name: '查看排查步骤', exact: true }), '排查问题', '排查问题');
      await main.getByRole('tab', { name: '连接', exact: true }).click();
      await connection.getByRole('heading', { name: heading, exact: true }).waitFor();
    }
  }
  await page.evaluate(() => { window.pluginWorkspaceFixture.connection.failed = true; });
  await connection.getByRole('button', { name: '重新检查', exact: true }).click();
  await connection.getByRole('alert').waitFor();
  await assertPreparation(['unchecked', 'unchecked', 'unchecked', 'unchecked'], 'failed check');
  assert.ok(!(await connection.innerText()).includes('PRIVATE_'));
  await connection.getByRole('button', { name: '选择身份目录', exact: true }).click();
  await connection.getByRole('alert').waitFor();
  await connection.getByRole('heading', { name: '连接检查未完成，请重试。', exact: true }).waitFor();
  await page.evaluate(() => {
    const fixture = window.pluginWorkspaceFixture.connection;
    fixture.failed = false; fixture.hold = true; fixture.result = fixture.snapshot('ready');
  });
  await connection.getByRole('button', { name: '重新检查', exact: true }).click();
  await page.waitForFunction(() => window.pluginWorkspaceFixture.connection.releases.length === 1);
  await assertPreparation(['unchecked', 'unchecked', 'unchecked', 'unchecked'], 'pending check');
  assert.equal(await preparation.getByRole('button', { name: '选择身份目录', exact: true }).isDisabled(), true);
  assert.equal(await connection.locator('.plugin-connection-tasks > li').count(), 0);
  await main.getByRole('tab', { name: '开始使用', exact: true }).click();
  await page.evaluate(() => {
    const fixture = window.pluginWorkspaceFixture.connection;
    fixture.hold = false; fixture.result = fixture.snapshot('unselected');
  });
  await main.getByRole('tab', { name: '连接', exact: true }).click();
  await connection.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  await page.evaluate(() => window.pluginWorkspaceFixture.connection.releases.shift()());
  assert.ok(!(await connection.innerText()).includes('task-42'), 'hidden stale read cannot replace a newer result');
  await page.evaluate(() => { window.pluginWorkspaceFixture.connection.canceled = false; });
  await connection.getByRole('button', { name: '选择身份目录', exact: true }).click();
  await connection.getByRole('heading', { name: '只读连接已核验', exact: true }).waitFor();
  await connection.getByRole('button', { name: '忘记此选择', exact: true }).click();
  await connection.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  await assertPreparation(['unchecked', 'unchecked', 'unchecked', 'unchecked'], 'forgotten profile');
  await page.waitForFunction(() => document.activeElement?.matches(
    '[data-plugin-workspace="plugin-0"] [data-preparation-step="profile"] button'));
  assert.equal(await preparation.getByRole('button', { name: '选择身份目录', exact: true })
    .evaluate(element => element === document.activeElement), true,
  'forgetting a profile returns keyboard focus to its remaining profile-card chooser');
  for (const destination of ['guide', 'conversation']) {
    await connection.getByRole('button', { name: '选择身份目录', exact: true }).click();
    await connection.getByRole('heading', { name: '只读连接已核验', exact: true }).waitFor();
    await page.evaluate(() => { window.pluginWorkspaceFixture.connection.hold = true; });
    await connection.getByRole('button', { name: '忘记此选择', exact: true }).click();
    await page.waitForFunction(() => window.pluginWorkspaceFixture.connection.releases.length === 1
      && window.pluginWorkspaceFixture.connection.calls.at(-1) === 'forget');
    await assertPreparation(['unchecked', 'unchecked', 'unchecked', 'unchecked'], `pending forget before ${destination}`);
    const target = destination === 'guide'
      ? main.getByRole('tab', { name: '连接准备', exact: true }) : page.locator('#draft');
    if (destination === 'guide') {
      await assertGuideNavigation(connection.getByRole('button', { name: '安装指南', exact: true }),
        '连接准备', '连接准备');
    } else {
      await main.getByRole('button', { name: '返回工作区', exact: true }).click();
      await page.locator('#draft').click();
      assert.equal(await main.isVisible(), false);
    }
    await page.evaluate(async () => {
      const fixture = window.pluginWorkspaceFixture.connection;
      fixture.hold = false;
      fixture.releases.shift()();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await target.evaluate(element => element === document.activeElement), true,
      `a late forget result must not steal ${destination} focus`);
    if (destination === 'guide') {
      assert.equal(await target.getAttribute('aria-selected'), 'true', 'a late forget result does not change the selected guide');
      await main.getByRole('tab', { name: '连接', exact: true }).click();
    } else {
      assert.equal(await main.isVisible(), false, 'a late forget result does not reopen the closed workspace');
      await button.click();
      await page.getByRole('button', { name: '打开完整工作台', exact: true }).click();
    }
    await connection.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
    await assertPreparation(['unchecked', 'unchecked', 'unchecked', 'unchecked'], `return after late forget from ${destination}`);
    assert.equal(await connection.locator('.plugin-connection-profile').count(), 0, 'returning observes that the profile was forgotten');
    assert.equal(await connection.locator('.plugin-connection-tasks > li').count(), 0, 'returning cannot restore the old identity task results');
  }
  await page.goto(`${url}?open=1&mode=single&connection=1&no-guides=1`);
  await connection.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  assert.equal(await preparation.getByRole('button', { name: '查看第一项任务', exact: true }).count(), 0,
    'legacy declarations do not expose an undeclared first-task entry');
  await assertGuideNavigation(connection.getByRole('button', { name: '安装指南', exact: true }),
    '开始使用', '从第一项委托开始');
  for (const [language, theme, width] of [['zh', 'light', 1440], ['zh', 'dark', 390], ['en', 'light', 390], ['en', 'dark', 1440]]) {
    await page.setViewportSize({ width, height: 880 });
    await page.goto(`${url}?open=1&mode=single&connection=1&language=${language}&theme=${theme}`);
    await connection.getByRole('button', { name: language === 'zh' ? '选择身份目录' : 'Choose profile', exact: true }).click();
    await connection.getByRole('heading', { name: language === 'zh' ? '只读连接已核验' : 'Read-only connection verified', exact: true }).waitFor();
    const refresh = connection.getByRole('button', { name: language === 'zh' ? '重新检查' : 'Check again', exact: true });
    await refresh.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const bounds = await refresh.evaluate(element => {
      const box = element.getBoundingClientRect(), clip = element.closest('[role="tabpanel"]').getBoundingClientRect();
      const style = getComputedStyle(element);
      return { visible: element.matches(':focus-visible'), gutter: parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)),
        edges: [box.top - clip.top, clip.bottom - box.bottom, box.left - clip.left, clip.right - box.right] };
    });
    assert.ok(bounds.visible && bounds.edges.every(edge => edge >= bounds.gutter), `connection focus stays fully visible: ${JSON.stringify(bounds)}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'connection page has no viewport overflow');
    const overlapping = await connection.locator('.plugin-connection-tasks strong').evaluate(element => {
      const box = element.getBoundingClientRect(), phase = element.nextElementSibling.getBoundingClientRect();
      return box.right > phase.left;
    });
    assert.equal(overlapping, false, 'task title does not overlap phase');
    const preparationButtons = connection.locator('.plugin-preparation button');
    assert.equal(await preparationButtons.count(), 5, 'four preparation actions and the declared first-task entry are available');
    for (const cardButton of await preparationButtons.all()) {
      await cardButton.scrollIntoViewIfNeeded();
      await cardButton.focus();
      const extent = await cardButton.evaluate(element => {
        const box = element.getBoundingClientRect(), clip = element.closest('[role="tabpanel"]').getBoundingClientRect();
        const style = getComputedStyle(element);
        return { visible: element.matches(':focus-visible'),
          gutter: parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)),
          edges: [box.top - clip.top, clip.bottom - box.bottom, box.left - clip.left, clip.right - box.right],
          textFits: element.scrollWidth <= element.clientWidth };
      });
      assert.ok(extent.visible && extent.edges.every(edge => edge >= extent.gutter),
        `preparation action focus stays fully visible: ${JSON.stringify(extent)}`);
      assert.ok(extent.textFits, 'preparation action text fits without horizontal clipping');
    }
    await refresh.focus();
    await page.screenshot({ path: `${output}/connection-${language}-${theme}-${width}.png`, fullPage: true });
  }
  const quick = page.getByRole('dialog', { name: 'Hermes 工程桥 · 智能体状态', exact: true });
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto(`${url}?mode=single&connection=1`);
  await button.waitFor();
  await page.locator('#draft').fill('查看状态时保留的需求');
  await button.click();
  await quick.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  assert.equal(await main.isVisible(), false, 'titlebar status does not navigate to the workspace');
  assert.equal(await page.locator('#draft').isVisible(), true, 'current conversation remains visible');
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  assert.equal(await quick.getByRole('button', { name: '选择身份目录', exact: true }).count(), 0,
    'profile mutations stay in the full connection page');
  await button.click();
  await quick.waitFor({ state: 'hidden' });
  await button.click();
  await quick.waitFor();
  await page.keyboard.press('Escape');
  await quick.waitFor({ state: 'hidden' });
  assert.equal(await button.evaluate(element => element === document.activeElement), true);
  await button.click();
  await quick.waitFor();
  await page.locator('#draft').click();
  await quick.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#draft').evaluate(element => element === document.activeElement), true,
    'outside dismissal does not steal composer focus');
  await button.click();
  await quick.getByRole('button', { name: '打开完整工作台', exact: true }).click();
  await main.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
  await quick.waitFor({ state: 'hidden' });
  await button.click();
  await quick.getByRole('button', { name: '打开完整工作台', exact: true }).click();
  assert.equal(await main.isVisible(), true, 'opening the full page twice never toggles it closed');
  await main.getByRole('button', { name: '返回工作区', exact: true }).click();
  assert.equal(await page.locator('#draft').inputValue(), '查看状态时保留的需求');
  await page.evaluate(() => {
    const fixture = window.pluginWorkspaceFixture.connection;
    fixture.result = fixture.snapshot('ready');
    fixture.result.tasks = Array.from({ length: 20 }, (_, index) => ({
      ...fixture.result.tasks[0], id: `quick-task-${index}`,
    }));
  });
  await button.click();
  await quick.getByRole('heading', { name: '只读连接已核验', exact: true }).waitFor();
  assert.equal(await quick.locator('.plugin-connection-tasks > li').count(), 5);
  assert.equal(await quick.locator('.plugin-connection-roots').count(), 0);
  assert.ok(!(await quick.innerText()).includes('C:/Isolated profiles'));
  assert.ok((await quick.innerText()).includes('检查于'));
  await page.evaluate(() => {
    const fixture = window.pluginWorkspaceFixture.connection;
    fixture.hold = true;
  });
  await quick.getByRole('button', { name: '重新检查', exact: true }).click();
  await page.waitForFunction(() => window.pluginWorkspaceFixture.connection.releases.length === 1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const fixture = window.pluginWorkspaceFixture.connection;
    fixture.hold = false; fixture.result = fixture.snapshot('connection-unavailable');
  });
  await button.click();
  await quick.getByRole('heading', { name: '无法连接 Agent Bridge', exact: true }).waitFor();
  await page.evaluate(() => window.pluginWorkspaceFixture.connection.releases.shift()());
  assert.equal(await quick.locator('.plugin-connection-tasks > li').count(), 0, 'dismissed stale reads cannot restore a verified summary');
  await page.keyboard.press('Escape');
  for (const [language, theme, width, height, overflow] of [
    ['zh', 'light', 1440, 940, false], ['zh', 'dark', 390, 620, false],
    ['en', 'light', 390, 420, false], ['en', 'dark', 1440, 940, true],
  ]) {
    const zh = language === 'zh';
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width < 700 ? 'reduce' : 'no-preference' });
    await page.goto(`${url}?connection=1&language=${language}&theme=${theme}${overflow ? '&overflow=1' : '&mode=single'}`);
    await group.or(page.getByRole('group', { name: 'Plugin shortcuts', exact: true })).waitFor();
    await page.evaluate(() => {
      const fixture = window.pluginWorkspaceFixture.connection;
      fixture.result = fixture.snapshot('ready');
      fixture.result.tasks = Array.from({ length: 20 }, (_, index) => ({
        ...fixture.result.tasks[0], id: `quick-task-${index}`,
      }));
    });
    let anchor = button;
    if (overflow) {
      anchor = page.getByRole('button', { name: 'More plugins', exact: true });
      await anchor.click();
      await page.getByRole('menuitemradio', { name: 'Hermes 工程桥', exact: true }).click();
    } else await anchor.click();
    const popup = page.getByRole('dialog', { name: `Hermes 工程桥 · ${zh ? '智能体状态' : 'Agent status'}`, exact: true });
    await popup.getByRole('heading', { name: zh ? '只读连接已核验' : 'Read-only connection verified', exact: true }).waitFor();
    await settleLayout(popup);
    const box = await popup.boundingBox(), anchorBox = await anchor.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'status panel stays within the horizontal viewport');
    assert.ok(box.y >= anchorBox.y + anchorBox.height && box.y + box.height <= height,
      'status panel is below its titlebar anchor and fits the viewport');
    assert.ok(box.height <= 520 && box.width <= 400, 'status stays compact');
    const refresh = popup.getByRole('button', { name: zh ? '重新检查' : 'Check again', exact: true });
    await refresh.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const extent = await refresh.evaluate(element => {
      const box = element.getBoundingClientRect(), clip = element.closest('.plugin-status-body').getBoundingClientRect();
      const style = getComputedStyle(element);
      return { visible: element.matches(':focus-visible'),
        gutter: parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)),
        edges: [box.top - clip.top, clip.bottom - box.bottom, box.left - clip.left, clip.right - box.right] };
    });
    assert.ok(extent.visible && extent.edges.every(edge => edge >= extent.gutter), `status focus stays fully visible: ${JSON.stringify(extent)}`);
    await settleLayout(popup);
    await page.screenshot({ path: `${output}/status-${language}-${theme}-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await anchor.evaluate(element => element === document.activeElement), true, 'status returns to direct or overflow anchor');
    assert.equal(await main.isVisible(), false, 'status never opens the main plugin page implicitly');
  }
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto(`${url}?connection=1&overflow=1`);
  await page.getByRole('button', { name: '更多插件', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Hermes 工程桥', exact: true }).click();
  await quick.waitFor();
  await page.setViewportSize({ width: 390, height: 620 });
  await quick.waitFor();
  await page.waitForFunction(() => {
    const box = document.querySelector('.plugin-status-popover')?.getBoundingClientRect();
    return box && box.left >= 0 && box.right <= innerWidth;
  });
  const resized = await quick.boundingBox();
  assert.ok(resized.x >= 0 && resized.x + resized.width <= 390, 'open status follows its anchor after native resize');
  for (const action of ['replacePackage', 'removePlugin', 'block']) {
    await page.goto(`${url}?mode=single&connection=1`);
    await button.click();
    await quick.getByRole('heading', { name: '尚未选择 profile', exact: true }).waitFor();
    await page.evaluate(action => window.pluginWorkspaceFixture.controls[action](), action);
    await quick.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.plugin-status-popover').count(), 0, `${action}: stale or blocked status is removed`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshots: output, checks: ['delayed fixture readiness', 'titlebar isolation', 'MiniChat order', 'safe icon fallback', 'document retry', 'tab/history/scroll preservation', 'overflow keyboard/outside/Escape', 'main draft retention', 'responsive layouts and full focus outlines', 'native plugin window isolation', 'theme/preferences refresh', 'native package-ref remount', 'stale-response protection', 'unavailable retry', 'read-only connection diagnostics, controls, cancellation and stale results', 'connection language, theme, narrow, focus and task layout', 'titlebar quick status toggle, Escape, outside focus and explicit full-page navigation', 'bounded quick summary and dismissed stale reads', 'status language, theme, narrow, short, overflow anchoring and full focus outlines', 'open status resize, package replacement, removal and modal blocking', 'four preparation cards distinguish all eight observations and missing authorization', 'pending, failed and forgotten observations clear previously verified preparation evidence', 'declared setup, troubleshooting and first-task guides navigate documents without connection mutations; legacy setup fallback remains compatible', 'late forget completion preserves guide and conversation focus and reopening observes the forgotten identity'] }, null, 2));
} finally {
  releaseIcon?.();
  await browser?.close();
  await server?.close();
}
