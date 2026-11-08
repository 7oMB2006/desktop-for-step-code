import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Pass an absolute evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, forwardConsole: false }, logLevel: 'error' });
let browser, page;
const results = {}, pixels = {}, captures = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.backgroundPointerListeners = new Set();
    const add = window.addEventListener, remove = window.removeEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type === 'pointermove') window.backgroundPointerListeners.add(listener);
      return add.call(this, type, listener, options);
    };
    window.removeEventListener = function (type, listener, options) {
      if (type === 'pointermove') window.backgroundPointerListeners.delete(listener);
      return remove.call(this, type, listener, options);
    };
  });
  const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/custom-background-rendering.html`;
  const image = () => page.locator('.custom-background-plane > img');
  const plane = () => page.locator('.custom-background-plane');
  const scene = () => page.locator('.stellar-workspace-scene canvas');
  const ready = async () => {
    await image().waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('.custom-background-plane > img');
      return image?.complete && image.naturalWidth > 0;
    });
  };
  const count = () => page.locator('.theme-workspace-background, .stellar-workspace-scene').count();
  const geometry = () => page.locator('.background-rendering-document, textarea, .background-rendering-document button').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height];
  }));
  const offset = () => plane().evaluate(element => [element.style.getPropertyValue('--background-x'), element.style.getPropertyValue('--background-y')]);
  const centered = async () => {
    await page.waitForFunction(() => document.querySelector('.custom-background-plane')?.style.getPropertyValue('--background-x') === '0px');
    assert.deepEqual(await offset(), ['0px', '0px']);
  };
  const nonblank = async name => {
    const hide = await page.addStyleTag({ content: '.background-rendering-fixture > :not(.theme-workspace-background):not(.stellar-workspace-scene) { visibility:hidden!important; }' });
    let png;
    try { png = await page.locator('.theme-workspace-background, .stellar-workspace-scene').screenshot(); }
    finally { await hide.evaluate(element => element.remove()); }
    const stats = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0, chromatic = 0; const colors = new Set();
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index], g = data[index + 1], b = data[index + 2], high = Math.max(r, g, b);
        if (high > 40) lit++;
        if (high > 40 && high - Math.min(r, g, b) > 24) chromatic++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
      return { width: canvas.width, height: canvas.height, lit, chromatic, colors: colors.size };
    }, [...png]);
    assert.ok(stats.lit > 1000 && stats.chromatic > 200 && stats.colors > 20, `${name}: ${JSON.stringify(stats)}`);
    pixels[name] = stats;
  };
  const capture = async name => {
    await page.mouse.move(0, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const path = join(output, `${name}.png`); await page.screenshot({ path }); captures.push(path);
  };
  await page.goto(base); await ready();
  assert.equal(await count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeBackground), 'image-v1');
  assert.equal(await image().evaluate(element => element.style.filter), 'brightness(0.9) blur(0px)',
    'Personal brightness is independent of the theme brightness (40%)');
  const initialGeometry = await geometry();
  await nonblank('imageDesktop');
  await capture('personal-background-desktop-light');
  await page.evaluate(() => window.backgroundRenderingFixture.options({
    fit: 'contain', positionX: 22, positionY: 68, zoom: 140, brightness: 75, blur: 4, parallax: 8,
  }));
  await page.waitForFunction(() => document.querySelector('.custom-background-plane > img')?.style.objectFit === 'contain');
  assert.deepEqual(await geometry(), initialGeometry, 'Image adjustments never move UI geometry');
  assert.deepEqual(await image().evaluate(element => [element.style.objectFit, element.style.objectPosition, element.style.filter]),
    ['contain', '22% 68%', 'brightness(0.75) blur(4px)']);
  assert.equal(await plane().evaluate(element => element.style.transformOrigin), '22% 68%');
  assert.match(await plane().evaluate(element => element.style.transform), /scale\(1\.4\)/);
  await page.getByRole('button', { name: '继续检查', exact: true }).click();
  assert.equal(await page.getByLabel('点击次数').innerText(), '1', 'The image never intercepts pointer clicks');
  results.optionsDoNotChangeUi = true;
  await page.mouse.move(1300, 850);
  await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('.custom-background-plane')?.style.getPropertyValue('--background-x') || '0')) > 1);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await centered();
  await page.mouse.move(100, 100); await page.waitForTimeout(100); await centered();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(1300, 850);
  await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('.custom-background-plane')?.style.getPropertyValue('--background-x') || '0')) > 1);
  await page.evaluate(() => window.backgroundRenderingFixture.paused(true)); await centered();
  await page.evaluate(() => { window.backgroundRenderingFixture.paused(false); window.backgroundRenderingFixture.motion(false); });
  await centered(); await page.mouse.move(100, 100); await page.waitForTimeout(100); await centered();
  await page.evaluate(() => window.backgroundRenderingFixture.motion(true));
  results.parallaxPauseAndReducedMotion = true;

  await page.evaluate(() => window.backgroundRenderingFixture.mode('closed'));
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  assert.equal(await plane().count(), 0); assert.equal(await count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), 'stellar');
  await page.evaluate(() => window.backgroundRenderingFixture.mode('open')); await ready();
  assert.equal(await scene().count(), 0); assert.equal(await count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), 'stellar');
  await page.evaluate(() => window.backgroundRenderingFixture.options({ enabled: false }));
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  assert.equal(await plane().count(), 0);
  await page.evaluate(() => { window.backgroundRenderingFixture.mode('builtin'); window.backgroundRenderingFixture.options({ enabled: true }); });
  await ready();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  results.closedThemeAndRestoration = true;

  await page.evaluate(() => { window.backgroundRenderingFixture.defer(true); window.backgroundRenderingFixture.resource('slow', 0); });
  await page.waitForFunction(() => window.backgroundRenderingFixture.pending().includes('slow'));
  await page.evaluate(() => window.backgroundRenderingFixture.resource('fast', 1));
  await page.waitForFunction(() => window.backgroundRenderingFixture.pending().includes('fast'));
  await page.evaluate(() => window.backgroundRenderingFixture.resolve('fast')); await ready();
  const newestSource = await image().getAttribute('src');
  await page.evaluate(() => window.backgroundRenderingFixture.resolve('slow')); await page.waitForTimeout(100);
  assert.equal(await image().getAttribute('src'), newestSource);
  await page.evaluate(() => window.backgroundRenderingFixture.resource('disposed', 0));
  await page.waitForFunction(() => window.backgroundRenderingFixture.pending().includes('disposed'));
  await page.evaluate(() => window.backgroundRenderingFixture.mount(false));
  await page.evaluate(() => window.backgroundRenderingFixture.resolve('disposed'));
  assert.equal(await count(), 0);
  assert.equal(await page.evaluate(() => window.backgroundPointerListeners.size), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeBackground), undefined);
  await page.evaluate(() => { window.backgroundRenderingFixture.defer(false); window.backgroundRenderingFixture.mount(true); }); await ready();
  results.staleAndDisposedResourcesIgnored = true;

  await page.evaluate(() => window.backgroundRenderingFixture.mode('open')); await ready();
  await page.evaluate(() => window.backgroundRenderingFixture.broken());
  await plane().waitFor({ state: 'detached' });
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  assert.equal(await count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeBackground), 'stellar-v1');
  await page.waitForFunction(() => window.backgroundPointerListeners.size === 0);
  const brokenLoads = await page.evaluate(() => window.backgroundRenderingFixture.loads());
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.backgroundRenderingFixture.loads()), brokenLoads);
  await page.evaluate(() => window.backgroundRenderingFixture.missing());
  await page.waitForTimeout(150); assert.equal(await plane().count(), 0); assert.equal(await scene().count(), 1);
  await page.evaluate(() => window.backgroundRenderingFixture.resource('recovered', 0)); await ready();
  for (const issue of ['missing', 'invalid', 'storage']) {
    await page.evaluate(issue => window.backgroundRenderingFixture.issue(issue), issue);
    await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
    assert.equal(await plane().count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.themeBackground), 'stellar-v1');
  }
  await page.evaluate(() => { window.backgroundRenderingFixture.issue(undefined); window.backgroundRenderingFixture.mode('builtin'); }); await ready();
  results.imageErrorsCleanUpAndRecover = true;

  await page.evaluate(() => window.backgroundRenderingFixture.options({ ...{
    fit: 'cover', positionX: 50, positionY: 50, zoom: 100, brightness: 90, blur: 0, parallax: 0,
  } }));
  for (const [width, theme] of [[1440, 'dark'], [390, 'light'], [390, 'dark']]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.evaluate(async theme => { const { applyTheme } = await import('/src/theme.ts'); applyTheme(theme, false); }, theme);
    await nonblank(`image-${width}-${theme}`);
    await capture(`personal-background-${width}-${theme}`);
  }
  await page.evaluate(() => window.backgroundRenderingFixture.options({ enabled: false }));
  assert.equal(await count(), 0);
  assert.equal(await page.evaluate(() => window.backgroundPointerListeners.size), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeBackground), undefined);
  results.builtinDisableCleansUp = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  const report = { passed: true, results, pixels, captures, errors, consoleErrors };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await server.close();
}
