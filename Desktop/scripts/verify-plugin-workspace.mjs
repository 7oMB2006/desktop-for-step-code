import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

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
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshots: output, checks: ['delayed fixture readiness', 'titlebar isolation', 'MiniChat order', 'safe icon fallback', 'document retry', 'tab/history/scroll preservation', 'overflow keyboard/outside/Escape', 'main draft retention', 'responsive layouts and full focus outlines', 'native plugin window isolation', 'theme/preferences refresh', 'native package-ref remount', 'stale-response protection', 'unavailable retry'] }, null, 2));
} finally {
  releaseIcon?.();
  await browser?.close();
  await server?.close();
}
