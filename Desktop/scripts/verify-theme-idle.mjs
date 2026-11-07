import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only browser acceptance: owns its server and never starts Electron.
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
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
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
  const scene = page.locator('.stellar-workspace-scene canvas');
  const emblem = page.locator('.stellar-emblem canvas');
  const preview = page.locator('.theme-pack-motion canvas');
  const count = canvas => canvas.evaluate(c => window.stellarDraws.get(c) || 0);
  const idle = async canvas => {
    const before = await count(canvas);
    await page.waitForTimeout(500);
    assert.equal(await count(canvas), before, 'Covered/static canvas must issue no drawing calls');
  };
  const moving = async canvas => {
    const before = await count(canvas);
    await page.waitForFunction(({ selector, before }) =>
      (window.stellarDraws.get(document.querySelector(selector)) || 0) > before,
    { selector: canvas === scene ? '.stellar-workspace-scene canvas'
      : canvas === emblem ? '.stellar-emblem canvas' : '.theme-pack-motion canvas', before });
  };
  const settings = async () => {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.waitForTimeout(300);
  };
  const close = async () => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-dialog').waitFor({ state: 'detached' });
    await page.waitForTimeout(200);
  };
  await page.goto(base);
  await page.locator('.stellar-emblem[data-ready=true]').waitFor();
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  await moving(scene); await moving(emblem);
  await page.evaluate(() => {
    window.initialScene = document.querySelector('.stellar-workspace-scene canvas');
    window.initialEmblem = document.querySelector('.stellar-emblem canvas');
    window.initialContext = window.initialScene.getContext('webgl2');
  });
  await settings();
  await idle(scene); await idle(emblem);
  await page.locator('.theme-pack-select').hover();
  await page.locator('.theme-pack-motion canvas[data-ready=true]').waitFor();
  await moving(preview);
  await idle(scene); await idle(emblem);
  await page.screenshot({ path: join(output, 'idle-settings-preview.png') });
  await page.getByLabel('背景亮度', { exact: true }).fill('60');
  await page.waitForTimeout(150);
  await idle(scene);
  await close();
  await moving(scene); await moving(emblem);
  assert.equal(await page.evaluate(() => window.initialScene === document.querySelector('.stellar-workspace-scene canvas')
    && window.initialEmblem === document.querySelector('.stellar-emblem canvas')
    && window.initialContext === window.initialScene.getContext('webgl2')), true, 'Resume must reuse the canvases and context');

  await settings();
  await page.setViewportSize({ width: 760, height: 880 });
  await page.waitForTimeout(250);
  await idle(scene); await idle(emblem);
  await close();
  await moving(scene); await moving(emblem);
  assert.equal(await scene.evaluate(c => c.width > 0 && c.height > 0), true);
  assert.equal(await page.locator('.stellar-emblem').evaluate(e => e.clientWidth), 48);
  await page.screenshot({ path: join(output, 'idle-resumed-760.png') });
  await page.setViewportSize({ width: 1440, height: 960 });

  await settings();
  await page.getByLabel('星海动态背景').uncheck();
  await close();
  await idle(scene); await idle(emblem);
  await settings();
  await page.getByLabel('星海动态背景').check();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await close();
  await idle(scene); await idle(emblem);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await moving(scene); await moving(emblem);

  await page.setViewportSize({ width: 1440, height: 960 });
  await settings();
  await scene.evaluate(c => {
    window.loss = c.getContext('webgl2').getExtension('WEBGL_lose_context');
    window.loss.loseContext();
  });
  await scene.locator('xpath=self::*[@hidden]').waitFor({ state: 'attached' });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.loss.restoreContext());
  await page.waitForFunction(() => !window.initialContext.isContextLost());
  await page.waitForTimeout(150);
  await idle(scene);
  await close();
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]:not([hidden])').waitFor();
  await moving(scene);
  await page.getByRole('button', { name: '主题包 · 会话预览', exact: true }).click();
  await page.locator('.messages').waitFor();
  assert.equal(await emblem.count(), 0);
  await settings(); await idle(scene); await close(); await moving(scene);
  await page.screenshot({ path: join(output, 'idle-resumed-chat.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, coveredDrawCalls: 0, sameContext: true, errors }));
} finally {
  await browser?.close();
  await server.close();
}
