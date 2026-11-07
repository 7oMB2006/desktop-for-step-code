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
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.brandDraws = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.matches?.('.stellar-sidebar-brand')) window.brandDraws++;
      return clear.apply(this, args);
    };
  });
  const brand = page.locator('.sidebar-identity');
  const canvas = brand.locator('.stellar-sidebar-brand');
  const ready = () => page.locator('.sidebar-identity[data-stellar-brand=ready]').waitFor();
  const data = () => canvas.evaluate(c => c.toDataURL());
  const dimensions = () => brand.evaluate(e => Object.fromEntries(
    [e, e.querySelector(':scope > img'), e.querySelector('.sidebar-wordmark')].map((node, i) => {
      const r = node.getBoundingClientRect();
      return [['button', 'mark', 'wordmark'][i], [r.width, r.height]];
    })));
  const shot = async name => {
    await page.screenshot({ path: join(output, `${name}.png`) });
    await brand.screenshot({ path: join(output, `${name}-brand.png`) });
  };
  const paused = async () => {
    await page.waitForTimeout(150);
    const count = await page.evaluate(() => window.brandDraws);
    const before = await data();
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.brandDraws), count, 'Hidden/covered brand must stop drawing');
    assert.equal(await data(), before);
  };
  const settings = async () => {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
  };
  const closeSettings = async () => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  };
  await page.goto(base); await ready();
  await page.mouse.move(600, 20);
  const original = await dimensions();
  assert.deepEqual(original.mark, [26, 26]);
  assert.equal(original.wordmark[0], 150);
  const pixels = await canvas.evaluate(c => {
    const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let visible = 0, colored = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] > 50) {
        visible++;
        if (Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) > 30) colored++;
      }
    }
    return { visible, colored };
  });
  assert.ok(pixels.visible > 1000 && pixels.colored > 300, JSON.stringify(pixels));
  const resting = await data();
  await page.waitForTimeout(650);
  assert.notEqual(await data(), resting, 'Idle stars must have gentle motion');
  await shot('chat');
  await brand.hover(); await page.waitForTimeout(450); await shot('hover');
  assert.deepEqual(await dimensions(), original, 'Emphasis must not resize the brand');
  await page.mouse.move(600, 20);
  await brand.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const focus = await brand.evaluate(e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect();
    const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    return { visible: e.matches(':focus-visible'), width: parseFloat(s.outlineWidth),
      fits: r.left - extent >= p.left && r.right + extent <= p.right && r.top - extent >= p.top };
  });
  assert.ok(focus.visible && focus.width >= 2 && focus.fits, JSON.stringify(focus));
  await shot('focus');
  await page.keyboard.press('Enter');
  assert.equal(await brand.getAttribute('aria-pressed'), 'true', 'Usage entry retains its action');
  await paused();
  await brand.click();
  assert.equal(await brand.getAttribute('aria-pressed'), 'false');
  await page.mouse.move(600, 20); await page.locator('.composer-input').focus();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await paused();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await paused();
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.locator('.window-sidebar-toggle').click(); await paused();
  await page.locator('.window-sidebar-toggle').click(); await ready();
  await settings(); await paused();
  await page.getByLabel('星海动态背景').uncheck(); await closeSettings(); await paused();
  // A synthetic loss verifies the recovery branch, not a driver-level GPU fault.
  await canvas.evaluate(c => c.dispatchEvent(new Event('contextlost', { cancelable: true })));
  assert.equal(await brand.locator(':scope > img').isVisible(), true);
  assert.equal(await brand.locator('.wordmark-dark').isVisible(), true);
  assert.deepEqual(await dimensions(), original);
  await shot('fallback');
  await canvas.evaluate(c => c.dispatchEvent(new Event('contextrestored')));
  await ready(); await paused();
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (await page.locator('.app').evaluate(e => e.classList.contains('sidebar-hidden')))
      await page.locator('.window-sidebar-toggle').click();
    await page.waitForTimeout(400); await ready();
    const b = await brand.boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= width, JSON.stringify(b));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(await dimensions(), original);
    await shot(`sidebar-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const theme of ['原版浅色', '原版深色']) {
    await settings(); await page.getByRole('button', { name: theme, exact: true }).click(); await closeSettings();
    assert.equal(await canvas.count(), 0);
    assert.equal(await brand.locator(':scope > img').isVisible(), true);
    assert.deepEqual(await dimensions(), original);
  }
  await settings(); await page.locator('.theme-pack-select').click(); await closeSettings(); await ready();
  // Rendering initialization failure must leave the original assets visible.
  const failure = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  failure.on('pageerror', error => errors.push(error.message));
  await failure.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (this.matches('.stellar-sidebar-brand')) return null;
      return getContext.apply(this, args);
    };
  });
  await failure.goto(base); await failure.locator('.messages').waitFor();
  await failure.waitForTimeout(500);
  assert.equal(await failure.locator('.sidebar-identity > img').isVisible(), true);
  assert.equal(await failure.locator('.sidebar-identity .wordmark-dark').isVisible(), true);
  assert.equal(await failure.locator('.stellar-sidebar-brand').isVisible(), false);
  await failure.close();
  assert.deepEqual(errors, []);
  const result = { passed: true, dimensions: original, pixels, focus, errors };
  await writeFile(join(output, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
