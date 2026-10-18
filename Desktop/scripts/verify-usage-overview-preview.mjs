import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const evidence = resolve(process.env.DESKTOP_PREVIEW_EVIDENCE ?? 'test-results/usage-overview-preview');
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, 'profile-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let app;
try {
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const errors = [];
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const main = BrowserWindow.getAllWindows()[0];
    main.setOpacity(0); main.setIgnoreMouseEvents(true); main.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  const composer = page.getByRole('textbox', { name: '消息', exact: true });
  await composer.fill('Keep this unsent draft when browsing usage');
  const composerNode = await composer.elementHandle();
  const snapshotBefore = await page.evaluate(() => window.desktop.snapshot());
  await page.locator('.sidebar-bottom > button').click();
  const windowCount = app.windows().length;
  const beforeStyles = await page.locator('.settings-dialog > header').evaluate(element => {
    const style = getComputedStyle(element);
    return { font: style.font, background: style.backgroundColor };
  });
  await page.getByRole('button', { name: '用量统计预览（示例数据）', exact: true }).click();
  const preview = page.locator('.usage-overview-preview');
  await preview.getByRole('heading', { name: '用量', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 0,
    'Settings entry must dismiss the modal and open the main view');
  assert.equal(await composer.isVisible(), false, 'Composer must be hidden in usage view');
  assert.equal(await page.locator('.sidebar').isVisible(), true, 'Sidebar must stay visible');
  assert.equal(await preview.evaluate(element => element.closest('main') !== null), true);
  assert.equal(app.windows().length, windowCount, 'Preview must stay in the main window');
  assert.equal(await preview.locator('.heat-cell').count(), 365);
  assert.equal(await preview.locator('.heat-cell').evaluateAll(cells => cells.every(cell => {
    const rect = cell.getBoundingClientRect();
    return rect.width === 14 && rect.height === 14;
  })), true, 'Heatmap cells must remain 14px squares in the main view');
  assert.equal(await preview.locator('.hour-bar').count(), 24);
  assert.equal(await preview.locator('.model-row').count(), 5);
  const coloredCell = preview.locator('.heat-cell.level-4').first();
  const originalColor = await coloredCell.evaluate(element => getComputedStyle(element).backgroundColor);
  await coloredCell.click();
  await page.waitForFunction(color => {
    const selected = document.querySelector('.heat-cell.is-selected');
    return selected && getComputedStyle(selected).backgroundColor === color;
  }, originalColor);
  assert.equal(await coloredCell.getAttribute('aria-pressed'), 'true');
  await preview.locator('.heat-cell').last().click();
  await preview.getByRole('button', { name: '近 7 天', exact: true }).click();
  await preview.getByRole('img', { name: '近7天全部 Token 柱状图', exact: true }).waitFor();
  assert.equal(await preview.locator('.usage-chart .bar-official').count(), 7);
  await preview.getByRole('button', { name: '近 30 天', exact: true }).click();
  const rates = await preview.locator('.hour-bar').evaluateAll(bars => bars.map(bar => ({
    input: Number(bar.getAttribute('data-input')), cached: Number(bar.getAttribute('data-cached')),
    rate: bar.getAttribute('data-cache-rate'),
  })));
  for (const hour of rates) {
    if (hour.input + hour.cached === 0) assert.equal(hour.rate, null);
    else assert.equal(Number(hour.rate), hour.cached / (hour.input + hour.cached));
  }
  assert.equal(await preview.locator('.cache-rate-point').count(), rates.filter(hour => hour.rate !== null).length);
  await preview.getByRole('button', { name: '缓存命中率', exact: true }).click();
  assert.equal(await preview.locator('.cache-rate-series').count(), 0);
  await preview.getByRole('button', { name: '缓存命中率', exact: true }).click();
  assert.equal(await page.evaluate(() => typeof require), 'undefined');
  assert.equal(await preview.locator('.usage-title img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  assert.equal(await preview.getByRole('link', { name: /套餐与余额/ }).count(), 0);
  await preview.getByRole('button', { name: '自定义第三方', exact: true }).click();
  assert.equal(await preview.locator('.model-row').count(), 3);
  await preview.getByRole('button', { name: '全部', exact: true }).click();
  await preview.locator('.model-row').first().click();
  assert.equal(await preview.locator('.daily-analysis').getAttribute('data-model'), 'official-flash');
  await preview.getByRole('button', { name: '清除模型筛选', exact: true }).click();
  await preview.locator('.usage-overview-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(evidence, 'packaged-preview-light.png'), fullPage: true });
  await preview.locator('.daily-hours').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, 'cache-rate-chart-light.png') });
  await preview.locator('.usage-overview-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: join(evidence, 'packaged-preview-dark.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  assert.equal(await preview.getByRole('button', { name: '切换主题', exact: true }).count(), 0);
  for (const width of [760, 390]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      const main = BrowserWindow.getAllWindows()[0];
      main.setMinimumSize(390, 540);
      main.setContentSize(width, 844);
    }, width);
    await page.waitForFunction(width => innerWidth === width, width);
    assert.equal(await preview.locator('.usage-overview-scroll').evaluate(element =>
      element.scrollWidth <= element.clientWidth), true, `Main usage view overflow at ${width}px`);
    assert.equal(await preview.locator('.heat-cell').evaluateAll(cells => cells.every(cell =>
      cell.getBoundingClientRect().width === 14 && cell.getBoundingClientRect().height === 14)), true);
    await page.screenshot({ path: join(evidence, `main-view-${width}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1320, 880));
  await page.getByRole('button', { name: '返回会话', exact: true }).focus();
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  assert.equal(await page.locator('.usage-overview-preview').count(), 0);
  await composer.waitFor({ state: 'visible' });
  assert.equal(await composer.innerText(), 'Keep this unsent draft when browsing usage');
  assert.equal(await composerNode.evaluate(element => element.isConnected), true, 'Conversation must not remount');
  const snapshotAfter = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(snapshotAfter.draftId, snapshotBefore.draftId);
  assert.equal(snapshotAfter.state?.sessionId, snapshotBefore.state?.sessionId);
  await page.getByRole('button', { name: '用量统计', exact: true }).click();
  await preview.getByRole('heading', { name: '用量', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '用量统计', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await page.getByRole('heading', { name: '定时任务', exact: true }).waitFor();
  assert.equal(await page.locator('.usage-overview-preview').count(), 0, 'Schedules must replace usage');
  await page.getByRole('button', { name: '用量统计', exact: true }).click();
  await preview.getByRole('heading', { name: '用量', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '定时任务', exact: true }).count(), 0, 'Usage must replace schedules');
  await page.locator('.sidebar-bottom > button').click();
  assert.deepEqual(await page.locator('.settings-dialog > header').evaluate(element => {
    const style = getComputedStyle(element);
    return { font: style.font, background: style.backgroundColor };
  }), beforeStyles, 'Preview styles must not leak into settings');
  await page.getByRole('button', { name: '用量统计预览（示例数据）', exact: true }).click();
  await preview.getByRole('heading', { name: '用量', exact: true }).waitFor();
  await page.locator('.new-chat').click();
  await composer.waitFor({ state: 'visible' });
  assert.equal(await page.locator('.usage-overview-preview').count(), 0, 'New session must return to conversation');
  assert.equal(app.windows().length, windowCount);
  assert.deepEqual(errors, []);
  console.log('Usage preview Electron passed: logo/settings entries open main view, no modal or extra window, draft and mounted composer preserved, new session returns, local charts and filters.');
} catch (error) {
  if (app) for (const [index, page] of app.windows().entries()) {
    await page.screenshot({ path: join(evidence, `failure-${index}.png`) }).catch(() => {});
    console.log('Preview failure text:', (await page.locator('body').innerText().catch(() => '')).slice(-1800));
  }
  throw error;
} finally {
  if (app) await app.close();
}
