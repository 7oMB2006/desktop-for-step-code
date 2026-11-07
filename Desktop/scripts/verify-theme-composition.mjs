import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only geometry and pixel checks using the real point-cloud renderer.
const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error',
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
    JSON.stringify({ themeMotion: false })));
  await page.goto(base);
  await page.locator('.stellar-emblem[data-ready=true]').waitFor();
  const asset = `/@fs/${join(root, '../theme-marketplace/plugins/stellar-cruise/scene.json').replaceAll('\\', '/')}`;
  const probes = await page.evaluate(async asset => {
    const [{ Universe }, { defaults }, art] = await Promise.all([
      import('/src/stellar/universe.ts'), import('/src/stellar/settings.ts'),
      fetch(asset).then(r => {
        if (!r.ok) throw new Error(`Scene fetch: ${r.status}`);
        return r.json();
      }),
    ]);
    const render = async (width, height, workspace, sidebar = 0) => {
      const host = document.createElement('div'), canvas = document.createElement('canvas');
      Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${height}px` });
      Object.assign(canvas.style, { width: '100%', height: '100%' });
      host.style.setProperty('--sidebar-track', `${sidebar}px`);
      host.append(canvas); document.body.append(host);
      const scene = new Universe(canvas, host, art, () => true, host, workspace);
      try {
        await scene.ready(); scene.configure(defaults); scene.draw(1, 0, false);
        const stats = scene.inspect();
        return { image: canvas.toDataURL(), lit: stats.lit, warm: stats.warm, cool: stats.cool,
          dragons: stats.artwork.dragons.map(d => d.inFrame / d.count), relics: stats.artwork.relics };
      } finally { scene.dispose(); host.remove(); }
    };
    const original = await render(1440, 960, false);
    const workspace = await render(1440, 960, true);
    const compact = [];
    for (const [width, height] of [[390, 844], [760, 880], [900, 620]]) {
      const sidebar = width > 760 ? 224 : 0;
      const { image, ...result } = await render(width, height, true, sidebar);
      compact.push({ width, height, sidebar, ...result });
    }
    return { identicalWidePixels: original.image === workspace.image, compact };
  }, asset);
  assert.equal(probes.identicalWidePixels, true, 'Wide artwork must remain pixel-identical');
  for (const result of probes.compact) {
    assert.ok(result.lit > 3000 && result.warm > 200 && result.cool > 200, JSON.stringify(result));
    assert.ok(result.dragons.every(ratio => ratio > .98), JSON.stringify(result));
    for (const relic of result.relics)
      assert.ok(relic.x - relic.radius >= result.sidebar && relic.x + relic.radius < result.width - 44);
  }
  for (const [width, height] of [[1440, 960], [760, 880], [390, 844], [900, 620]]) {
    await page.setViewportSize({ width, height });
    for (const view of ['welcome', 'chat']) {
      await page.goto(`${base}?view=${view}`);
      await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
      if (view === 'welcome') {
        await page.locator('.stellar-emblem[data-ready=true]').waitFor();
        assert.deepEqual(await page.locator('.stellar-emblem').evaluate(e => [e.clientWidth, e.clientHeight]), [48, 48]);
      }
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(output, `composition-${view}-${width}.png`) });
    }
  }
  await page.goto(`${base}?view=welcome`);
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  const originalCanvas = await page.locator('.stellar-workspace-scene canvas').elementHandle();
  const canvasPixels = async canvas => {
    const png = await canvas.screenshot();
    return Buffer.from(await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const surface = document.createElement('canvas');
      surface.width = bitmap.width; surface.height = bitmap.height;
      const context = surface.getContext('2d');
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))];
    }, [...png]));
  };
  const sceneImage = async () => {
    const hide = await page.addStyleTag({ content: '.app > :not(.stellar-workspace-scene) { visibility: hidden !important; }' });
    try { return await canvasPixels(page.locator('.stellar-workspace-scene canvas')); }
    finally { await hide.evaluate(e => e.remove()); }
  };
  const docked = await sceneImage();
  await page.getByRole('button', { name: '侧栏', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button', { name: '侧栏', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.ok(!docked.equals(await sceneImage()), 'Sidebar toggle must recompose the narrow artwork');
  assert.equal(await page.locator('.stellar-workspace-scene canvas').evaluate((c, original) => c === original, originalCanvas), true);
  await page.screenshot({ path: join(output, 'composition-welcome-900-sidebar-hidden.png') });
  // Motion and pause still belong to the existing scene, not a replacement canvas.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}?view=welcome`);
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  const canvas = page.locator('.stellar-workspace-scene canvas');
  const foreground = await page.addStyleTag({ content: '.app > :not(.stellar-workspace-scene) { visibility: hidden !important; }' });
  await page.waitForTimeout(700);
  const still = await canvasPixels(canvas);
  await page.waitForTimeout(450);
  assert.ok(still.equals(await canvasPixels(canvas)), 'Motion-off must remain stable');
  await foreground.evaluate(e => e.remove());
  await page.getByRole('button', { name: '账户设置', exact: true }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByLabel('星海动态背景').check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  const moving = await sceneImage();
  await page.waitForTimeout(500);
  assert.ok(!moving.equals(await sceneImage()), 'Narrow scene must retain live particle motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
  const reduced = await sceneImage();
  await page.waitForTimeout(450);
  assert.ok(reduced.equals(await sceneImage()), 'Reduced motion must freeze the narrow scene');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, probes, errors }));
} finally {
  await browser?.close();
  await server.close();
}
