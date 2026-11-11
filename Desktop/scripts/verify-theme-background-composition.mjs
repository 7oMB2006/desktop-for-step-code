import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This offline browser fixture does not import images into a real Desktop profile.
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Pass an absolute evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error',
});
let browser, page;
const captures = [];
const results = {};
const pixels = {};
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-composition.html`;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.stellarDraws = new WeakMap();
    for (const Type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const name of ['drawArrays', 'drawElements']) {
        const original = Type.prototype[name];
        Type.prototype[name] = function (...args) {
          window.stellarDraws.set(this.canvas, (window.stellarDraws.get(this.canvas) || 0) + 1);
          return original.apply(this, args);
        };
      }
    }
  });
  const scene = () => page.locator('.stellar-workspace-scene canvas');
  const image = () => page.locator('.theme-workspace-background > .theme-workspace-image');
  const workspaceCount = () => page.locator('.stellar-workspace-scene, .theme-workspace-background').count();
  const select = async name => {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.mouse.move(0, 0);
  };
  const imageReady = async () => {
    await image().waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('.theme-workspace-background > img');
      return image?.complete && image.naturalWidth > 0;
    });
  };
  const material = () => page.evaluate(() => document.documentElement.dataset.themeMaterial);
  const draws = canvas => canvas.evaluate(element => window.stellarDraws.get(element) || 0);
  const idle = async canvas => {
    await page.waitForTimeout(200);
    const before = await draws(canvas);
    await page.waitForTimeout(400);
    assert.equal(await draws(canvas), before, 'Static/paused scene must stop drawing');
  };
  const moving = async () => {
    const before = await draws(scene());
    await page.waitForFunction(before => (window.stellarDraws.get(document.querySelector('.stellar-workspace-scene canvas')) || 0) > before, before);
  };
  const nonblank = async (name, surface) => {
    const hide = await page.addStyleTag({ content: '.composition-fixture > :not(.stellar-workspace-scene):not(.theme-workspace-background) { visibility: hidden !important; }' });
    let png;
    try { png = await surface.screenshot(); }
    finally { await hide.evaluate(element => element.remove()); }
    const stats = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const values = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0, chromatic = 0;
      const colors = new Set();
      for (let index = 0; index < values.length; index += 4) {
        const r = values[index], g = values[index + 1], b = values[index + 2];
        const high = Math.max(r, g, b), low = Math.min(r, g, b);
        if (high > 40) lit++;
        if (high > 40 && high - low > 24) chromatic++;
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
      return { width: canvas.width, height: canvas.height, lit, chromatic, colors: colors.size };
    }, [...png]);
    assert.ok(stats.lit > 1000 && stats.chromatic > 200 && stats.colors > 20, `${name}: blank or flat background ${JSON.stringify(stats)}`);
    pixels[name] = stats;
  };
  const capture = async name => {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: horizontal overflow`);
    const path = join(output, `${name}.png`);
    await page.screenshot({ path });
    captures.push(path);
  };
  await page.goto(base);
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  await moving();
  await nonblank('sceneDesktop', scene());
  const legacyCanvas = await scene().elementHandle();
  await page.getByRole('checkbox', { name: '替换背景', exact: true }).check();
  assert.equal(await workspaceCount(), 1);
  assert.equal(await image().count(), 0);
  assert.equal(await material(), 'stellar');
  assert.equal(await scene().evaluate((element, original) => element === original, legacyCanvas), true);
  assert.equal(await page.getByLabel('背景状态').getAttribute('data-blocked'), 'true');
  results.legacyOverrideBlocked = true;
  await page.getByRole('checkbox', { name: '替换背景', exact: true }).uncheck();

  await select('可组合星辰');
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  const geometry = async () => page.locator('#fixture-input, .fixture-anchor-button').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 10) / 10);
  }));
  const beforeGeometry = await geometry();
  const oldCanvas = await scene().elementHandle();
  await page.getByRole('checkbox', { name: '替换背景', exact: true }).check();
  await imageReady();
  assert.equal(await scene().count(), 0);
  assert.equal(await workspaceCount(), 1);
  assert.equal(await material(), 'stellar');
  assert.deepEqual(await geometry(), beforeGeometry);
  await idle(oldCanvas);
  await nonblank('imageDesktop', image());
  await capture('composable-image-desktop');
  results.imageOverridePreservesSkinAndGeometry = true;
  await page.getByRole('checkbox', { name: '替换背景', exact: true }).uncheck();
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  await moving();
  assert.equal(await image().count(), 0);
  results.sceneRestored = true;

  await page.getByRole('checkbox', { name: '暂停', exact: true }).check();
  await idle(scene());
  await page.getByRole('checkbox', { name: '暂停', exact: true }).uncheck();
  await moving();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await idle(scene());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await moving();
  results.pauseAndReducedMotion = true;

  await select('标准图片');
  await imageReady();
  assert.equal(await material(), undefined);
  assert.equal(await scene().count(), 0);
  assert.equal(await workspaceCount(), 1);
  assert.equal(await page.getByRole('checkbox', { name: '主题动态效果', exact: true }).count(), 0);
  const sourceBefore = await image().getAttribute('src');
  await page.getByRole('button', { name: '更新图片', exact: true }).click();
  await imageReady();
  await page.waitForFunction(source => document.querySelector('.theme-workspace-background > img')?.getAttribute('src') !== source, sourceBefore);
  results.sameIdRevisionReloadsImage = true;

  await page.evaluate(() => window.compositionFixture.deferImageLoads(true));
  await page.getByRole('button', { name: '更新图片', exact: true }).click();
  await page.waitForFunction(() => window.compositionFixture.pendingLoads().length === 1);
  await page.getByRole('button', { name: '更新图片', exact: true }).click();
  await page.waitForFunction(() => window.compositionFixture.pendingLoads().length === 2);
  const pending = await page.evaluate(() => window.compositionFixture.pendingLoads());
  await page.evaluate(id => window.compositionFixture.resolveLoad(id), pending[1].id);
  await imageReady();
  assert.equal(await image().getAttribute('src'), pending[1].image.dataUrl);
  await page.evaluate(id => window.compositionFixture.resolveLoad(id), pending[0].id);
  await page.waitForTimeout(200);
  assert.equal(await image().getAttribute('src'), pending[1].image.dataUrl, 'Stale revision must not replace the current image');
  results.staleImageRevisionIgnored = true;
  await page.getByRole('button', { name: '更新图片', exact: true }).click();
  await page.waitForFunction(() => window.compositionFixture.pendingLoads().length === 1);
  const disposed = await page.evaluate(() => window.compositionFixture.pendingLoads()[0].id);
  await select('星辰纯色');
  await page.evaluate(id => window.compositionFixture.resolveLoad(id), disposed);
  await page.waitForTimeout(150);
  assert.equal(await workspaceCount(), 0);
  assert.equal(await material(), 'stellar');
  await page.getByRole('checkbox', { name: '主题动态效果', exact: true }).waitFor();
  assert.equal(await page.getByLabel('背景亮度', { exact: true }).count(), 0);
  results.disposedImageLoadIgnored = true;

  await page.evaluate(() => window.compositionFixture.deferImageLoads(false));
  await select('星辰图片');
  await imageReady();
  assert.equal(await material(), 'stellar');
  await page.getByRole('checkbox', { name: '主题动态效果', exact: true }).waitFor();
  await page.getByRole('button', { name: '星辰图片', exact: true }).hover();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.theme-pack-play, .theme-pack-motion').count(), 0);
  results.staticStellarCardRetainsThemeMotion = true;
  await page.evaluate(() => window.compositionFixture.breakImage());
  await image().waitFor({ state: 'detached' });
  const brokenLoads = await page.evaluate(() => window.compositionFixture.counters.imageLoads);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.compositionFixture.counters.imageLoads), brokenLoads);
  await page.getByRole('button', { name: '更新图片', exact: true }).click();
  await imageReady();
  results.imageFailureDoesNotRetry = true;

  await page.setViewportSize({ width: 760, height: 880 });
  await select('标准图片');
  await imageReady();
  await capture('standard-image-760');
  await page.setViewportSize({ width: 390, height: 844 });
  await select('可组合星辰');
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  await moving();
  await nonblank('sceneMobile', scene());
  await capture('composable-scene-390');
  await select('星辰图片');
  await imageReady();
  await nonblank('imageMobile', image());
  await capture('stellar-image-390');
  await page.getByRole('button', { name: '移除工作区', exact: true }).click();
  assert.equal(await workspaceCount(), 0);
  assert.equal(await material(), undefined);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeBackground), undefined);
  await page.getByRole('button', { name: '恢复工作区', exact: true }).click();
  await imageReady();
  assert.equal(await workspaceCount(), 1);
  results.unmountClearsMaterialAndBackground = true;
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ passed: true, results, pixels, captures, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, results, pixels, captures, errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
