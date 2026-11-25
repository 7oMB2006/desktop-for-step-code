import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4197/';
const output = resolve(process.argv[3] || 'test-results/startup-choreography');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const errors = [], samples = [];
const watch = page => page.on('pageerror', error => errors.push(error.message));
const pixels = async page => {
  const png = await page.screenshot({ omitBackground: true });
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const copy = document.createElement('canvas');
    copy.width = bitmap.width; copy.height = bitmap.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let nonblank = 0, hash = 0, edge = 0;
    for (let y = 0; y < copy.height; y++) for (let x = 0; x < copy.width; x++) {
      const alpha = data[(y * copy.width + x) * 4 + 3];
      if (alpha > 8) {
        nonblank++;
        if (x < 3 || y < 3 || x >= copy.width - 3 || y >= copy.height - 3) edge++;
      }
      hash = (hash * 31 + alpha) | 0;
    }
    return { nonblank, hash, edge };
  }, [...png]);
};
try {
  const context = await browser.newContext({ viewport: { width: 256, height: 256 },
    recordVideo: { dir: output, size: { width: 256, height: 256 } } });
  const animated = await context.newPage();
  watch(animated);
  await animated.addInitScript(() => {
    window.startupFirstImage = [];
    const observer = new MutationObserver(() => {
      const image = document.querySelector('.logo img'), logo = document.querySelector('.logo');
      if (!image) return;
      window.startupFirstImage.push({ image: getComputedStyle(image).visibility,
        ready: logo.dataset.ready, time: performance.now() });
      if (logo.dataset.ready === 'true') {
        window.startupReadyAt ??= performance.now();
      }
    });
    observer.observe(document, { subtree: true, attributes: true, childList: true });
  });
  await animated.goto(new URL('startup-logo.html?material=stellar', base).href);
  await animated.locator('.logo[data-ready=true]').waitFor();
  await animated.waitForFunction(() => document.documentElement.dataset.startupComplete === 'true');
  const playback = await animated.evaluate(() => ({
    firstImage: window.startupFirstImage,
    elapsed: performance.now() - window.startupReadyAt,
    dimensions: [document.querySelector('img').offsetWidth, document.querySelector('img').offsetHeight],
  }));
  assert.ok(playback.firstImage.every(frame => frame.image === 'hidden'));
  assert.ok(playback.elapsed >= 2800 && playback.elapsed < 4200, `playback ${playback.elapsed}ms`);
  assert.deepEqual(playback.dimensions, [88, 88]);
  await animated.waitForTimeout(600);
  const video = animated.video();
  await context.close();
  await video.saveAs(join(output, 'startup-choreography.webm'));

  // Freeze exact shader samples independently of screenshot latency.
  const sample = await browser.newPage({ viewport: { width: 256, height: 256 } });
  watch(sample);
  await sample.goto(new URL('startup-logo.html?material=stellar&motion=off', base).href);
  await sample.locator('.logo[data-ready=true]').waitFor();
  await sample.evaluate(async () => {
    const [{ StellarEmblemRenderer }, { startupFrame, STARTUP_STELLAR_MS }] = await Promise.all([
      import('/src/stellar/emblem.ts'), import('/src/startup-motion.ts'),
    ]);
    const canvas = document.createElement('canvas');
    document.querySelector('.logo canvas').replaceWith(canvas);
    const renderer = new StellarEmblemRenderer(canvas, document.querySelector('.logo img'));
    renderer.resize(88 * 256 / 104, 256);
    window.drawStartupSample = time => renderer.draw(0, false, time < STARTUP_STELLAR_MS ? startupFrame(time) : undefined);
    window.drawSettledEmblem = () => renderer.draw(0, false);
  });
  for (const time of [0, 120, 400, 800, 1100, 1450, 1750, 2100, 2500]) {
    await sample.evaluate(time => window.drawStartupSample(time), time);
    const result = await pixels(sample);
    await sample.screenshot({ path: join(output, `frame-${String(time).padStart(4, '0')}.png`), omitBackground: true });
    samples.push({ time, ...result });
    assert.equal(result.edge, 0, 'stars fit the transparent native window');
  }
  assert.equal(samples[0].nonblank, 0, 'the first rendered frame is silent, not a full particle cloud');
  assert.equal(samples[1].nonblank, 0, 'the first beat remains empty');
  assert.ok(samples.at(-1).nonblank > 150, 'the final emblem is not blank');
  assert.ok(samples[2].nonblank < samples.at(-1).nonblank / 5, 'initial sparks remain sparse');
  assert.notEqual(samples[4].hash, samples[5].hash, 'the approach changes across the acceleration');
  await sample.evaluate(() => window.drawSettledEmblem());
  assert.deepEqual(await pixels(sample), { nonblank: samples.at(-1).nonblank,
    hash: samples.at(-1).hash, edge: samples.at(-1).edge }, 'the finale matches the ordinary settled renderer');
  await sample.close();

  const previews = [];
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    watch(page);
    await page.goto(new URL('tests/fixtures/startup-preview.html', base).href);
    await page.getByRole('button', { name: '循环播放', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '循环播放', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: '静止预览', exact: true }).click();
    const frame = page.frameLocator('iframe');
    await frame.locator('.logo[data-ready=true]').waitFor();
    await frame.locator('html[data-startup-complete=true]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const paused = await frame.locator('canvas').screenshot({ omitBackground: true });
    await page.waitForTimeout(180);
    assert.deepEqual(await frame.locator('canvas').screenshot({ omitBackground: true }), paused, 'motion-off stays static');
    await page.getByRole('button', { name: '放大预览', exact: true }).click();
    const previewPng = await page.screenshot({ path: join(output, `preview-${width}.png`) });
    const corner = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const copy = document.createElement('canvas'); copy.width = bitmap.width; copy.height = bitmap.height;
      const ctx = copy.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const rect = document.querySelector('iframe').getBoundingClientRect();
      return [...ctx.getImageData(Math.round(rect.left + 4), Math.round(rect.top + 4), 1, 1).data].slice(0, 3);
    }, [...previewPng]);
    assert.deepEqual(corner, [25, 26, 28], 'the iframe remains transparent instead of painting a white rectangle');
    await page.getByRole('button', { name: '浅色背景', exact: true }).click();
    assert.equal(await page.locator('main').getAttribute('data-backdrop'), 'light');
    const previousFrame = await page.locator('iframe').elementHandle();
    await page.getByRole('button', { name: '重播', exact: true }).click();
    assert.equal(await previousFrame.evaluate(element => element.isConnected), false, 'replay creates a fresh animation');
    await frame.locator('.logo[data-ready=true]').waitFor();
    await page.getByRole('button', { name: '重播', exact: true }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.getByRole('button', { name: '重播', exact: true }).evaluate(button =>
      getComputedStyle(button).outlineStyle !== 'none'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '静止预览', exact: true }).click();
    await frame.locator('.logo[data-ready=true]').waitFor();
    const reduced = await frame.locator('canvas').screenshot({ omitBackground: true });
    await page.waitForTimeout(180);
    assert.deepEqual(await frame.locator('canvas').screenshot({ omitBackground: true }), reduced, 'OS reduced motion stays static');
    if (width === 1100) {
      const previousLoop = await page.locator('iframe').elementHandle();
      await page.getByRole('button', { name: '循环播放', exact: true }).click();
      await page.waitForFunction(element => !element.isConnected, previousLoop, { timeout: 6000 });
      await page.getByRole('button', { name: '循环播放', exact: true }).click();
    }
    previews.push(width);
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    passed: true, playback, samples, previews, errors,
    scope: 'Source browser animation only. No packaging, shortcut change or real profile access.',
  }, null, 2));
  console.log(JSON.stringify({ passed: true, output, samples, previews }));
} finally { await browser.close(); }
