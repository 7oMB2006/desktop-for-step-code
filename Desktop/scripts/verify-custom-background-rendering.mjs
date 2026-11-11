import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { settleLayout } from './settle-layout.mjs';
import { verifyWorkspaceSurfaces } from './workspace-surface-checks.mjs';

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
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
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
  const geometry = () => page.locator('.sidebar, .conversation-shell, .background-rendering-document, .composer, [role=textbox], .composer button, .summary-board').evaluateAll(elements => elements.map(element => {
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
  const surfaceState = () => page.evaluate(() => {
    const root = document.documentElement;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const alpha = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    };
    const surfaces = ['main', '.sidebar', '.summary-board', '.composer'];
    return {
      active: root.dataset.customBackgroundSurfaces,
      variables: [...root.style].filter(key => key.startsWith('--background-')),
      surfaces: surfaces.map(selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element), backing = getComputedStyle(element, '::before');
        return { alpha: alpha(backing.backgroundColor), opacity: style.opacity, filter: style.filter, blur: backing.backdropFilter };
      }),
      messagesAlpha: alpha(getComputedStyle(document.querySelector('.messages')).backgroundColor),
      codeAlpha: alpha(getComputedStyle(document.querySelector('.message-body pre')).backgroundColor),
      dialogAlpha: alpha(getComputedStyle(document.querySelector('dialog')).backgroundColor),
      veil: getComputedStyle(document.querySelector('.composer-wrap'), '::before').backgroundImage,
      text: getComputedStyle(document.querySelector('.message-body')).color,
    };
  });
  const noSurfaces = async () => {
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-custom-background-surfaces'));
    assert.deepEqual((await surfaceState()).variables, [], 'Surface variables must not leak after deactivation');
  };
  await page.goto(base); await ready();
  await settleLayout(page.locator('.background-rendering-body'));
  assert.equal(await count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeBackground), 'image-v1');
  assert.equal(await image().evaluate(element => element.style.filter), 'brightness(0.9) blur(0px)',
    'Personal brightness is independent of the theme brightness (40%)');
  const initialGeometry = await geometry();
  await nonblank('imageDesktop');
  await capture('personal-background-desktop-light');
  const defaultSurfaces = await surfaceState();
  assert.equal(defaultSurfaces.active, 'true');
  assert.deepEqual(defaultSurfaces.surfaces.map(surface => surface.blur), ['blur(8px)', 'blur(8px)', 'blur(8px)', 'none']);
  for (const surface of defaultSurfaces.surfaces) {
    assert.equal(surface.opacity, '1'); assert.equal(surface.filter, 'none');
  }
  assert.equal(defaultSurfaces.messagesAlpha, 0, 'The narrow transcript column has no opaque backing');
  assert.equal(defaultSurfaces.codeAlpha, 255, 'Code keeps its reading surface');
  assert.equal(defaultSurfaces.veil, 'none', 'The composer veil does not conceal the wallpaper');
  await page.evaluate(() => window.backgroundRenderingFixture.options({
    contentTransparency: 100, sidebarTransparency: 65, panelTransparency: 40, composerTransparency: 0, surfaceBlur: 0,
  }));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--background-content-opacity') === '0%');
  const adjustedSurfaces = await surfaceState();
  for (const [index, alpha] of [0, 89, 153, 255].entries())
    assert.ok(Math.abs(adjustedSurfaces.surfaces[index].alpha - alpha) <= 1, `Independent region ${index}`);
  assert.deepEqual(await geometry(), initialGeometry, 'Material adjustments never change layout');
  assert.equal(adjustedSurfaces.text, defaultSurfaces.text, 'Foreground color stays unchanged');
  await page.evaluate(() => {
    const composer = document.querySelector('.composer');
    const probe = document.createElement('i'); probe.id = 'fixed-probe';
    probe.style.cssText = 'position:fixed;left:20px;top:10px;width:2px;height:2px';
    composer.append(probe);
    document.querySelector('dialog').showModal();
  });
  assert.deepEqual(await page.locator('#fixed-probe').evaluate(element => {
    const rect = element.getBoundingClientRect(); return [rect.x, rect.y];
  }), [20, 10], 'Glass backing never changes fixed-position menu coordinates');
  assert.equal((await surfaceState()).dialogAlpha, 255, 'Confirmation dialogs stay opaque');
  await page.evaluate(() => { document.querySelector('dialog').close(); document.querySelector('#fixed-probe').remove(); });
  await capture('independent-surfaces-desktop-light');
  await page.evaluate(() => window.backgroundRenderingFixture.options({
    contentTransparency: 0, sidebarTransparency: 100, panelTransparency: 100, composerTransparency: 100,
  }));
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--background-content-opacity') === '100%');
  assert.deepEqual((await surfaceState()).surfaces.map(surface => surface.alpha), [255, 0, 0, 0],
    'Every region supports opaque and transparent endpoints independently');
  await page.evaluate(() => window.backgroundRenderingFixture.options({
    contentTransparency: 30, sidebarTransparency: 20, panelTransparency: 20, composerTransparency: 10, surfaceBlur: 8,
  }));
  results.independentSurfacesPreserveForegroundAndGeometry = true;
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
  await noSurfaces();
  await page.evaluate(() => window.backgroundRenderingFixture.mode('open')); await ready();
  assert.equal(await scene().count(), 0); assert.equal(await count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), 'stellar');
  await noSurfaces();
  await page.evaluate(() => window.backgroundRenderingFixture.options({ enabled: false }));
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  assert.equal(await plane().count(), 0);
  await page.evaluate(() => { window.backgroundRenderingFixture.mode('builtin'); window.backgroundRenderingFixture.options({ enabled: true }); });
  await ready();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  await page.evaluate(() => window.backgroundRenderingFixture.mode('standard')); await ready();
  await page.waitForFunction(() => document.documentElement.dataset.customBackgroundSurfaces === 'true');
  await page.evaluate(() => window.backgroundRenderingFixture.mode('builtin')); await ready();
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
  await noSurfaces();
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
  await page.evaluate(() => window.backgroundRenderingFixture.broken()); await plane().waitFor({ state: 'detached' }); await noSurfaces();
  await page.evaluate(() => window.backgroundRenderingFixture.resource('surface-recovered', 0)); await ready();
  await page.waitForFunction(() => document.documentElement.dataset.customBackgroundSurfaces === 'true');
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
  await noSurfaces();
  results.builtinDisableCleansUp = true;
  results.actualWorkspaceCoverage = await verifyWorkspaceSurfaces(browser, server.resolvedUrls.local[0], output);
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
