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
let browser, page;
const errors = [];
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('dfsc-stellar-preview-preferences-v1'))
      localStorage.setItem('dfsc-stellar-preview-preferences-v1', JSON.stringify({ themeMotion: false }));
  });
  const open = async view => {
    await page.goto(`${base}?view=${view}`);
    await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  };
  const shot = async name => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(800, 30);
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(output, `${name}.png`) });
  };
  const rail = name => page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name, exact: true });
  const panel = async name => {
    const button = rail(name);
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    await page.waitForTimeout(350);
  };
  const focusFits = async locator => {
    await locator.focus();
    await locator.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const info = await locator.evaluate(e => {
      const style = getComputedStyle(e), rect = e.getBoundingClientRect();
      const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const clips = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p), r = p.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) clips.push(rect.left - extent >= r.left - .5 && rect.right + extent <= r.right + .5);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) clips.push(rect.top - extent >= r.top - .5 && rect.bottom + extent <= r.bottom + .5);
      }
      return { visible: e.matches(':focus-visible'), outline: parseFloat(style.outlineWidth), clips };
    });
    assert.ok(info.visible && info.outline >= 2 && info.clips.every(Boolean), JSON.stringify(info));
  };
  const nav = page.locator('.conversation-nav-panel');
  const current = nav.locator('nav button[aria-current=location] .nav-turn-number');
  const scrollTo = async index => {
    await page.locator('.conversation').evaluate((scroll, index) => {
      const message = scroll.querySelector(`[data-message-index="${index}"]`);
      scroll.scrollTo({ top: message.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop,
        behavior: 'instant' });
    }, index);
  };
  await open('navigation');
  await panel('会话导航');
  assert.equal(await nav.locator('nav button').count(), 8);
  await scrollTo(0);
  await page.waitForFunction(() => document.querySelector('.conversation-nav-panel [aria-current=location] .nav-turn-number')?.textContent === '1');
  await focusFits(nav.locator('nav button').first());
  await shot('navigation-start');
  await scrollTo(8);
  await page.waitForFunction(() => document.querySelector('.conversation-nav-panel [aria-current=location] .nav-turn-number')?.textContent === '5');
  assert.equal(await page.locator('.turn-marker[aria-current=location]').count(), 1);
  await shot('navigation-reading');
  await nav.locator('nav button').nth(2).click();
  await page.waitForFunction(() => document.querySelector('.conversation-nav-panel [aria-current=location] .nav-turn-number')?.textContent === '3');
  await page.locator('.turn-marker.active').hover();
  await page.locator('.turn-marker-preview time').waitFor();
  assert.match(await page.locator('.turn-marker-preview').innerText(), /11月05日/);
  await page.screenshot({ path: join(output, 'reading-tooltip.png') });
  const markerSize = await page.locator('.turn-marker.active').evaluate(e => [e.offsetWidth, e.offsetHeight]);
  assert.deepEqual(markerSize, [20, 18]);
  const navWidth = await nav.evaluate(e => e.offsetWidth);

  // Exercise one continuous journey without reloading or submitting a real prompt.
  const composer = page.locator('.composer-input');
  const draft = '保留这份草稿：检查侧栏、审批和阅读位置。\n返回后继续编辑。';
  await composer.fill(draft);
  await scrollTo(4);
  await page.waitForFunction(() => document.querySelector('.conversation-nav-panel [aria-current=location] .nav-turn-number')?.textContent === '3');
  const readingTop = await page.locator('.conversation').evaluate(e => e.scrollTop);
  await page.locator('.sidebar-bottom > button').click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.waitFor();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await settings.waitFor({ state: 'detached' });
  assert.equal(await composer.innerText(), draft);
  assert.ok(Math.abs(await page.locator('.conversation').evaluate(e => e.scrollTop) - readingTop) < 2,
    'Settings must preserve the reading position');
  await page.locator('[data-reorder-id="sample-queue"] > button').first().click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state?.sessionId === 'sample-queue');
  await composer.fill('另一会话的独立草稿。');
  await page.locator('[data-reorder-id="sample-navigation"] > button').first().click();
  await page.waitForFunction(() => document.querySelector('.composer-input')?.innerText.includes('保留这份草稿'));
  assert.equal(await composer.innerText(), draft);
  await panel('会话导航');
  await page.waitForFunction(() => document.querySelector('.conversation-nav-panel [aria-current=location] .nav-turn-number')?.textContent === '3');
  await shot('journey-restored');
  await page.locator('[data-reorder-id="sample-queue"] > button').first().click();
  await page.waitForFunction(() => document.querySelector('.composer-input')?.innerText === '另一会话的独立草稿。');
  await composer.focus();
  assert.equal(await composer.evaluate(e => e === document.activeElement), true);

  await open('agents');
  await panel('子代理');
  const agents = page.locator('.subagent-panel');
  const overview = agents.locator('.workflow-overview');
  const rows = overview.locator('.workflow-agent');
  assert.equal(await rows.count(), 5);
  assert.equal(await overview.getAttribute('data-workflow-state'), 'partial_failed');
  assert.deepEqual(await rows.evaluateAll(items => items.map(e => e.dataset.agentState)),
    ['completed', 'completed', 'cached', 'failed', 'aborted']);
  await focusFits(rows.first());
  await shot('agents-overview');
  await rows.nth(3).click();
  await agents.locator('.workflow-error').waitFor();
  assert.match(await agents.locator('.workflow-error').innerText(), /FIXTURE_FOCUS_CLIPPED/);
  await shot('agent-failure');
  await agents.getByRole('button', { name: '编排', exact: true }).click();
  assert.equal(await rows.nth(3).getAttribute('aria-pressed'), 'true');
  await rows.nth(2).click();
  assert.match(await agents.locator('.workflow-pane:not([hidden])').innerText(), /本次复用了缓存结果/);
  await shot('agent-cached');
  await agents.getByRole('button', { name: '编排', exact: true }).click();
  await agents.getByRole('button', { name: '选择编排记录', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /未返回最终回执/ }).click();
  assert.equal(await overview.getAttribute('data-workflow-state'), 'unknown');
  assert.equal(await rows.first().getAttribute('data-agent-state'), 'unknown');
  await rows.first().click();
  assert.match(await agents.locator('.workflow-pane:not([hidden])').innerText(), /未返回最终状态/);
  await shot('agent-unknown');

  await panel('摘要');
  await page.locator('.sb-agent-row').filter({ hasText: '检查导航组件' }).click();
  await agents.locator('.subagent-transcript pre').waitFor();
  await shot('agent-record');

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    await open('navigation');
    await panel('会话导航');
    await focusFits(nav.locator('nav button').last());
    await shot(`navigation-${width}`);
    await nav.locator('nav button').nth(1).click();
    await nav.waitFor({ state: 'detached' });
    await panel('会话导航');
    assert.equal(await current.innerText(), '2');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await open('agents');
    await panel('子代理');
    await focusFits(rows.last());
    await shot(`agents-${width}`);
    await rows.nth(3).click();
    await shot(`agent-failure-${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const box = await agents.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + .5);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open('agents');
  await panel('子代理');
  assert.equal(await agents.locator('.workflow-pane:not([hidden])').evaluate(e => getComputedStyle(e).animationName), 'none');
  await open('navigation');
  await panel('会话导航');
  await nav.locator('nav button').nth(4).click();
  await page.waitForFunction(() => document.querySelector('.conversation-nav-panel [aria-current=location] .nav-turn-number')?.textContent === '5');
  assert.equal(await nav.locator('nav button').first().evaluate(e => getComputedStyle(e).transitionDuration), '0s');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => {
      const { applyTheme } = await import('/src/theme.ts');
      await window.desktop.preferences({ theme });
      applyTheme(theme, true);
    }, theme);
    await page.reload();
    await panel('会话导航');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
    assert.equal(await nav.evaluate(e => e.offsetWidth), navWidth);
    await scrollTo(4);
    await page.waitForFunction(() => document.querySelector('.conversation-nav-panel [aria-current=location] .nav-turn-number')?.textContent === '3');
    await shot(`built-in-${theme}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, markerSize, navWidth, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, markerSize, navWidth, errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
