import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const results = {};
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const open = async view => {
    await page.goto(`${base}?view=${view}`);
    await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  };
  const shot = async name => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(output, `${name}.png`) });
  };
  const activity = value => page.waitForFunction(expected =>
    document.documentElement.dataset.stellarActivity === expected, value);
  const dimensions = () => page.evaluate(() => Object.fromEntries(
    ['.composer', '.composer-input', '.composer-action-button', '.session-row', '.right-tool-rail .icon-button']
      .map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, [rect.width, rect.height]];
      })));
  const theme = async name => {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  };
  await open('chat');
  await activity('idle');
  const original = await dimensions();
  const route = page.getByRole('group', { name: '任务路线', exact: true });
  await route.getByRole('button', { name: /核对欢迎页/ }).click();
  const completed = page.locator('.sb-step.is-completed .sb-step-trigger');
  await page.waitForFunction(() => document.activeElement?.matches('.sb-step.is-completed .sb-step-trigger'));
  assert.equal(await completed.getAttribute('aria-expanded'), 'true');
  await route.getByRole('button', { name: /检查窄窗口/ }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('.sb-step.is-in_progress .sb-step-trigger'));
  assert.equal(await page.locator('.sb-step.is-in_progress .sb-step-trigger').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await dimensions(), original, 'Route disclosure must not resize existing controls');
  await route.getByRole('button', { name: /核对欢迎页/ }).click();
  await page.locator('.composer-input').focus();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.composer-input').evaluate(e => e === document.activeElement), true,
    'Delayed task reveal must not steal focus from continued typing');
  await page.locator('.composer-input').fill('检查任务路线与输入状态');
  await shot('chat-task-route');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await activity('running');
  results.running = await page.locator('.composer').evaluate(e => ({
    animation: getComputedStyle(e, '::before').animationName,
    action: e.querySelector('.composer-action-button').dataset.action,
  }));
  assert.equal(results.running.animation, 'stellar-transmission');
  assert.equal(results.running.action, 'stop');
  await shot('chat-running');
  await activity('idle');
  assert.equal(await page.locator('.composer').evaluate(e => getComputedStyle(e, '::before').animationName), 'none');

  await open('plan');
  await activity('waiting');
  await shot('plan');
  await page.getByRole('button', { name: '稍后批阅', exact: true }).click();
  await page.locator('.approval-drawer').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.composer').evaluate(e => getComputedStyle(e, '::before').animationName), 'none');
  await page.getByRole('button', { name: '批阅计划', exact: true }).click();
  await page.getByRole('button', { name: '批准并执行', exact: true }).click();
  await activity('idle');
  await open('question');
  await page.getByRole('radio', { name: /安静阅读/ }).check();
  await shot('question-selected');

  // Reuse the offline bridge, supplying all four authoritative task states.
  await open('chat');
  await page.evaluate(() => {
    const summary = window.desktop.summary;
    window.desktop.summary = async (...args) => ({ ...await summary(...args),
      tasks: ['completed', 'in_progress', 'pending', 'failed'].map((status, i) => ({
        id: `state-${i}`, subject: `State ${i}`, description: 'Offline state sample', status,
      })) });
  });
  await page.waitForFunction(() => document.querySelectorAll('.stellar-task-route > button').length === 4);
  results.states = await page.locator('.stellar-task-route > button').evaluateAll(nodes => nodes.map(e => ({
    status: e.dataset.status, color: getComputedStyle(e).color, label: e.getAttribute('aria-label'),
  })));
  assert.equal(new Set(results.states.map(s => s.color)).size, 4);
  await shot('task-states');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.stellar-route-point').first().evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.locator('.composer-input').fill('Reduced motion');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await activity('running');
  assert.equal(await page.locator('.composer').evaluate(e => getComputedStyle(e, '::before').animationName), 'none');
  await activity('idle');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    await open('chat');
    const summary = page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name: '摘要', exact: true });
    if (await summary.getAttribute('aria-pressed') !== 'true') await summary.click();
    await route.getByRole('button', { name: /核对欢迎页/ }).click();
    await page.waitForFunction(() => document.activeElement?.matches('.sb-step.is-completed .sb-step-trigger'));
    assert.equal(await completed.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await shot(`route-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await open('chat');
  await theme('原版浅色');
  assert.equal(await page.locator('.stellar-task-route').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.stellarActivity), undefined);
  assert.deepEqual(await dimensions(), original, 'Existing controls retain their built-in dimensions');
  await shot('built-in-light');
  await theme('原版深色');
  assert.equal(await page.locator('.stellar-task-route').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  await shot('built-in-dark');
  await page.evaluate(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
    JSON.stringify({ themeMotion: false })));
  await open('chat');
  assert.equal(await page.locator('.stellar-route-point').first().evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.locator('.composer-input').fill('Static preference');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await activity('running');
  assert.equal(await page.locator('.composer').evaluate(e => getComputedStyle(e, '::before').animationName), 'none');
  await activity('idle');
  await shot('chat-static');
  await page.setViewportSize({ width: 1908, height: 1080 });
  await open('chat');
  await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
  await route.getByRole('button', { name: /检查窄窗口/ }).click();
  await page.waitForFunction(() => document.activeElement?.matches('.sb-step.is-in_progress .sb-step-trigger'));
  await page.locator('.composer-input').fill('继续核对星辰巡航主题');
  assert.equal(await page.locator('.message-body table').evaluate(e => getComputedStyle(e).backgroundColor),
    'rgba(0, 0, 0, 0)', 'Table reading fill belongs to cells, not the empty scroll width');
  assert.equal(await page.locator('.message-body pre code').first().evaluate(e => getComputedStyle(e).backgroundColor),
    'rgba(0, 0, 0, 0)', 'Block code must not inherit the inline-code chip fill');
  await shot('workspace-wide');
  await page.locator('.stellar-workspace-scene').evaluate(e => { e.style.visibility = 'hidden'; });
  await shot('workspace-no-scenery');
  await page.locator('.stellar-workspace-scene').evaluate(e => { e.style.visibility = ''; });
  await open('welcome');
  await page.locator('.stellar-emblem[data-ready=true]').waitFor();
  assert.deepEqual(await page.locator('.stellar-emblem').evaluate(e => [e.clientWidth, e.clientHeight]), [48, 48]);
  await shot('welcome');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, results, dimensions: original, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, results, errors }));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
