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
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.letteringDraws = 0;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      if (this.canvas.closest('.stellar-lettering')) window.letteringDraws++;
      return draw.apply(this, args);
    };
  });
  const text = page.locator('.stellar-lettering');
  const canvas = text.locator('canvas');
  const ready = () => page.locator('.stellar-lettering[data-ready=true]').waitFor();
  const settled = () => page.waitForFunction(() => {
    const text = document.querySelector('.stellar-lettering');
    return text?.textContent && text.textContent === document.querySelector('.new-session h1')?.getAttribute('aria-label');
  });
  const geometry = () => page.locator('.new-session').evaluate(e => Object.fromEntries(
    ['.empty-symbol', 'h1', '.new-session-project', '.new-session-settings'].map(selector => {
      const r = e.querySelector(selector).getBoundingClientRect();
      return [selector, [r.x, r.y, r.width, r.height]];
    })));
  const shot = async name => {
    await page.screenshot({ path: join(output, `${name}.png`) });
    await text.screenshot({ path: join(output, `${name}-title.png`) });
  };
  const freeze = async () => {
    await page.waitForTimeout(200);
    const first = await canvas.screenshot();
    await page.waitForTimeout(550);
    assert.ok(first.equals(await canvas.screenshot()), 'Static lettering must stop animating');
  };
  const settings = async () => {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
  };
  const closeSettings = () => page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto(base);
  await ready();
  // Drafting holds the real greeting without changing its original timing logic.
  await page.locator('.composer-input').fill(' ');
  await settled(); await ready();
  await page.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
  await shot('welcome-desktop');
  assert.deepEqual(await page.locator('.stellar-emblem').evaluate(e => [e.clientWidth, e.clientHeight]), [48, 48]);
  assert.equal(await page.locator('.new-session h1').evaluate(e => getComputedStyle(e).fontSize), '25px');
  const original = await geometry();
  await text.evaluate(e => { delete e.dataset.ready; });
  assert.deepEqual(await geometry(), original, 'Fallback and particles must have identical geometry');
  const isolation = await page.addStyleTag({ content: '.stellar-workspace-scene, .terminal-cursor { visibility: hidden !important; }' });
  await ready();
  const first = await canvas.screenshot();
  await page.waitForTimeout(650);
  const next = await canvas.screenshot();
  assert.ok(!first.equals(next), 'Settled lettering must have living light');
  const pixels = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0, bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 60 && data[i + 1] > 60 && data[i + 2] > 60) lit++;
      if (data[i] > 210 && data[i + 1] > 210 && data[i + 2] > 210) bright++;
    }
    return { lit, bright, area: c.width * c.height };
  }, [...next]);
  assert.ok(pixels.lit / pixels.area > .035, JSON.stringify(pixels));
  assert.ok(pixels.lit > pixels.bright * 1.3, 'Retain soft light, not just saturated white pixels');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await page.evaluate(() => window.letteringDraws);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.letteringDraws), hidden);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(count => window.letteringDraws > count, hidden);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await freeze();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await settings();
  // The covered surface remains mounted, but its frame loop is paused.
  const covered = await page.evaluate(() => window.letteringDraws);
  await page.waitForTimeout(550);
  assert.equal(await page.evaluate(() => window.letteringDraws), covered);
  await page.getByLabel('星海动态背景').uncheck();
  await closeSettings(); await freeze();
  await canvas.evaluate(c => {
    window.letteringLoss = c.getContext('webgl2').getExtension('WEBGL_lose_context');
    window.letteringLoss.loseContext();
  });
  await page.waitForFunction(() => !document.querySelector('.stellar-lettering')?.hasAttribute('data-ready'));
  assert.equal(await text.locator('.stellar-lettering-fallback').isVisible(), true);
  assert.deepEqual(await geometry(), original, 'Context loss must not shift the greeting');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.letteringLoss.restoreContext());
  await ready(); await freeze();
  await isolation.evaluate(e => e.remove());
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(350); await ready();
    const bounds = await text.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify(bounds));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const size = await page.locator('.new-session h1').evaluate(e => getComputedStyle(e).fontSize);
    assert.equal(size, width <= 740 ? '22px' : '25px');
    await shot(`welcome-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await settings();
  await page.getByRole('button', { name: '原版浅色', exact: true }).click();
  await closeSettings();
  assert.equal(await text.count(), 0, 'Built-in theme must not mount particle lettering');
  assert.equal(await page.locator('.new-session h1').evaluate(e => getComputedStyle(e).fontSize), '25px');
  await settings(); await page.locator('.theme-pack-select').click(); await closeSettings(); await ready();
  await page.getByRole('button', { name: '主题包 · 会话预览', exact: true }).click();
  await page.locator('.messages').waitFor();
  assert.equal(await text.count(), 0, 'Conversation must release lettering');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await ready();
  // English shares the same sampled glyph path, not a Chinese-only image.
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByLabel(/^语言/).selectOption('en');
  await closeSettings();
  await page.locator('.composer-input').fill(' ');
  await settled(); await ready();
  assert.equal(await text.textContent(), 'Let ideas reach the stars');
  await shot('welcome-english');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350); await ready();
  const english = await text.boundingBox();
  assert.ok(english.x >= 0 && english.x + english.width <= 390, JSON.stringify(english));
  await shot('welcome-english-390');
  assert.deepEqual(errors, []);
  const result = { passed: true, pixels, geometry: original, errors };
  await writeFile(join(output, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
