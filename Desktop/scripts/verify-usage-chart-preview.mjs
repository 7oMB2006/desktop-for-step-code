import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { seedUsageCharts } from './usage-chart-test-data.mjs';

const evidence = resolve(process.env.DESKTOP_PREVIEW_EVIDENCE ?? 'test-results/usage-chart-preview');
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(join(evidence, 'profile-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await seedUsageCharts(profile);
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
  });
  async function openUsage() {
    await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
    await page.getByRole('button', { name: '用量统计', exact: true }).click();
    await page.locator('.usage-overview-preview h1').waitFor();
  }
  await openUsage();
  const card = page.getByRole('tooltip', { name: '图表数据', exact: true });
  const hour = page.locator('.hour-bar[data-hour="18"]');
  async function hoverHour() {
    const target = hour.locator('.chart-hit-area');
    await target.hover({ position: { x: 4, y: 20 } });
    await card.waitFor();
    await card.evaluate(async element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const bounds = await target.boundingBox();
    return { x: bounds.x + 4, y: bounds.y + 20 };
  }
  async function checkPosition(pointer) {
    const actual = await card.boundingBox();
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const left = pointer.x + 28 + actual.width <= size.width - 10 ? pointer.x + 28 : pointer.x - actual.width - 28;
    const top = pointer.y + 24 + actual.height <= size.height - 10 ? pointer.y + 24 : pointer.y - actual.height - 24;
    assert.ok(Math.abs(actual.x - Math.max(10, Math.min(size.width - actual.width - 10, left))) < 1, 'Card must follow the pointer horizontally');
    assert.ok(Math.abs(actual.y - Math.max(10, Math.min(size.height - actual.height - 10, top))) < 1, 'Card must follow the pointer vertically');
    assert.ok(actual.x >= 10 && actual.y >= 10 && actual.x + actual.width <= size.width - 9 &&
      actual.y + actual.height <= size.height - 9, 'Card must remain inside the viewport');
  }
  const pointer = await hoverHour();
  await checkPosition(pointer);
  const readRow = label => card.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText();
  const input = Number(await hour.getAttribute('data-input')), cached = Number(await hour.getAttribute('data-cached'));
  assert.equal(await readRow('未缓存输入'), input.toLocaleString('zh-CN'));
  assert.equal(await readRow('缓存读取'), cached.toLocaleString('zh-CN'));
  const written = Number((await readRow('缓存写入')).replaceAll(',', ''));
  assert.equal(await readRow('缓存命中率'), `${(cached / (input + cached + written) * 100).toFixed(1)}%`);
  assert.equal(await readRow('Token 合计'), Number(await hour.getAttribute('data-tokens')).toLocaleString('zh-CN'));
  assert.equal(await page.locator('.app-tooltip').count(), 0, 'Chart hover must not also open the text tooltip');
  const cardNode = await card.elementHandle();
  await page.mouse.move(pointer.x + 4, pointer.y + 8);
  await page.waitForFunction(id => {
    const element = document.getElementById(id);
    return element && Number.parseFloat(element.style.left) > 0;
  }, await card.getAttribute('id'));
  await card.evaluate(() => new Promise(requestAnimationFrame));
  await checkPosition({ x: pointer.x + 4, y: pointer.y + 8 });
  assert.equal(await cardNode.evaluate(element => element.isConnected), true, 'Pointer motion must not remount the card');
  await page.screenshot({ path: join(evidence, 'hour-card-light.png') });
  await page.keyboard.press('Escape');
  await card.waitFor({ state: 'hidden' });
  await page.keyboard.press('Tab');
  await hour.focus();
  await card.waitFor();
  assert.equal(await hour.getAttribute('aria-describedby'), await card.getAttribute('id'));
  await page.keyboard.press('Escape');
  await card.waitFor({ state: 'hidden' });
  assert.equal(await hour.evaluate(element => document.activeElement === element), true);
  await page.locator('.heat-cell.level-4').first().hover();
  await card.waitFor();
  assert.equal(await card.locator('dl > div').count(), 4);
  await page.locator('.model-row').first().hover();
  await card.waitFor();
  assert.equal(await card.locator('header strong').innerText(), 'step-3.7-flash');
  await page.locator('.model-segment').first().focus();
  await card.waitFor();
  assert.equal(await readRow('当日占比'), `${(507100 / 641300 * 100).toFixed(1)}%`);
  await page.locator('.usage-chart').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '折线图', exact: true }).click();
  for (const days of [7, 30, 90]) {
    await page.getByRole('button', { name: `近 ${days} 天`, exact: true }).click();
    await page.locator('.trend-sample').last().hover();
    await card.waitFor();
    assert.equal(await card.locator('header strong').innerText(), await page.locator('.daily-analysis').getAttribute('data-date'));
    assert.equal(await readRow('Token 合计'), (await page.locator('.trend-sample').last().getAttribute('aria-label')).split('，')[1].replace(' Token', ''));
  }
  assert.equal(await page.locator('.usage-chart title').count(), 0);
  const end = (await page.locator('.trend-sample').last().getAttribute('aria-label')).split('，')[0];
  const start = (await page.locator('.trend-sample').nth(83).getAttribute('aria-label')).split('，')[0];
  await page.getByRole('button', { name: '自定义日期', exact: true }).click();
  const rangeDialog = page.getByRole('dialog', { name: '选择日期范围', exact: true });
  await rangeDialog.getByLabel('开始日期', { exact: true }).fill(start);
  await rangeDialog.getByLabel('结束日期', { exact: true }).fill(end);
  await rangeDialog.getByRole('button', { name: '应用', exact: true }).click();
  assert.equal(await page.locator('.trend-sample').count(), 7);
  const rangeTotal = await page.locator('.trend-sample').evaluateAll(elements => elements.reduce((sum, element) =>
    sum + Number(element.getAttribute('aria-label').split('，')[1].replace(/[^\d]/g, '')), 0));
  assert.equal(await page.getByTestId('trend-total').innerText(), rangeTotal.toLocaleString('zh-CN'));
  const unitCycle = page.locator('.usage-unit-cycle');
  for (const [unit, divisor] of [['K', 1e3], ['M', 1e6], ['B', 1e9]]) {
    await unitCycle.click();
    const scaled = rangeTotal / divisor;
    const expected = rangeTotal > 0 && scaled < .01 ? `<0.01${unit}`
      : `${scaled.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`;
    assert.equal(await page.getByTestId('trend-total').innerText(), expected);
    assert.equal(await page.locator('.trend-sample').count(), 7);
  }
  await unitCycle.click();
  assert.equal(await page.getByTestId('trend-total').innerText(), rangeTotal.toLocaleString('zh-CN'));
  await page.getByRole('button', { name: '近 90 天', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'trend-card-light.png') });
  await page.locator('.usage-overview-scroll').evaluate(element => { element.scrollTop -= 10; });
  await card.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.desktop.preferences({ theme: 'wine' }));
  await page.reload();
  await openUsage();
  await hoverHour();
  await page.screenshot({ path: join(evidence, 'hour-card-wine.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await hoverHour();
  assert.equal(await card.evaluate(element => getComputedStyle(element).animationName), 'none');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(390, 540);
    window.setContentSize(390, 844);
  });
  await page.waitForFunction(() => innerWidth === 390);
  await checkPosition(await hoverHour());
  await page.screenshot({ path: join(evidence, 'hour-card-narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
  await page.waitForFunction(() => innerWidth === 1280);
  await page.evaluate(() => window.desktop.preferences({ language: 'en', theme: 'light' }));
  await page.reload();
  await page.getByRole('button', { name: 'Usage overview', exact: true }).click();
  await page.getByRole('heading', { name: 'Usage', exact: true }).waitFor();
  const englishCard = page.getByRole('tooltip', { name: 'Chart data', exact: true });
  const assertEnglish = async () => {
    const chinese = await page.locator('.usage-overview-preview, .usage-range-panel, .usage-chart-preview').evaluateAll(elements =>
      elements.flatMap(root => [root, ...root.querySelectorAll('*')]).flatMap(element =>
        [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent)
          .concat(['aria-label', 'data-tooltip'].map(name => element.getAttribute(name) ?? '')))
        .filter(value => /[\u3400-\u9fff]/u.test(value)));
    assert.deepEqual(chinese, [], 'All usage text, tooltips and accessibility names must follow English preferences');
  };
  await page.getByRole('group', { name: 'Daily usage heatmap', exact: true }).waitFor();
  const date = await page.locator('.daily-analysis').getAttribute('data-date');
  const expectedDate = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  assert.ok((await page.locator('.daily-date h2').innerText()).includes(expectedDate));
  await page.locator('.hour-bar[data-hour="18"] .chart-hit-area').hover({ position: { x: 4, y: 20 } });
  await englishCard.waitFor();
  assert.equal(await englishCard.locator('dt').filter({ hasText: /^Uncached input$/ }).count(), 1);
  assert.equal(await englishCard.locator('dt').filter({ hasText: /^Cache hit rate$/ }).count(), 1);
  await assertEnglish();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Custom dates', exact: true }).click();
  const englishRange = page.getByRole('dialog', { name: 'Select date range', exact: true });
  await englishRange.getByRole('columnheader', { name: 'Mo', exact: true }).first().waitFor();
  await englishRange.getByLabel('Start date', { exact: true }).fill(start);
  await englishRange.getByLabel('End date', { exact: true }).fill('invalid');
  await englishRange.getByRole('alert').waitFor();
  await assertEnglish();
  await englishRange.getByLabel('End date', { exact: true }).fill(end);
  await englishRange.getByRole('button', { name: 'Apply', exact: true }).click();
  assert.equal(await page.locator('.trend-sample').count(), 7);
  assert.equal(await unitCycle.innerText(), 'Raw');
  assert.equal(await page.getByTestId('trend-total').innerText(), rangeTotal.toLocaleString('en-US'));
  await unitCycle.click();
  assert.equal(await page.getByTestId('trend-total').innerText(),
    `${(rangeTotal / 1e3).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}K`);
  await page.getByRole('button', { name: 'Line chart', exact: true }).click();
  await page.locator('.trend-sample').last().hover();
  await englishCard.waitFor();
  await assertEnglish();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(390, 844));
  await page.waitForFunction(() => innerWidth === 390);
  await page.screenshot({ path: join(evidence, 'usage-english-narrow.png') });
  await page.getByRole('button', { name: 'Custom providers', exact: true }).click();
  await page.getByText('Custom providers track tokens only, without cost estimates.', { exact: true }).waitFor();
  await assertEnglish();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
  await page.waitForFunction(() => innerWidth === 1280);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'usage-english-desktop.png') });
  assert.deepEqual(errors, []);
  console.log('Chart preview passed: structured rows, exact totals/cache rate, pointer following, viewport flipping, heatmap/model/trend/hour, keyboard/Escape, scroll dismissal, real light/wine themes, narrow/reduced motion and English preferences/date dialog/cards/units/source filters.');
} catch (error) {
  if (app) for (const page of app.windows()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await app.close();
}
