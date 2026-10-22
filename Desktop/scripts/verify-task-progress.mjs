import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
await server.listen();
let browser;
await mkdir('test-results', { recursive: true });
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_TEST_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_TEST_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.audioCalls = [];
    HTMLMediaElement.prototype.play = function () {
      window.audioCalls.push({ at: performance.now(), phase: document.querySelector('.sb-task-progress')?.dataset.phase });
      return Promise.resolve();
    };
  });
  await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/task-progress-motion.html');
  const progress = page.getByRole('progressbar');
  await progress.waitFor();
  assert.equal(await progress.getAttribute('aria-valuenow'), '4');
  assert.equal(await progress.getAttribute('data-phase'), 'running');
  await page.evaluate(() => window.taskProgressFixture.update(5));
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '5');
  await page.waitForTimeout(400);
  assert.equal(await progress.getAttribute('data-phase'), 'running', 'Full tasks are not whole-round completion');
  assert.equal(await page.evaluate(() => window.audioCalls.length), 0);
  await page.screenshot({ path: 'test-results/task-progress-full-flowing-light.png' });
  const frames = await page.evaluate(() => {
    window.taskProgressFixture.complete();
    return new Promise(resolve => {
      const root = document.querySelector('.sb-task-progress');
      const samples = [];
      const start = performance.now();
      const sample = () => {
        const transform = new DOMMatrix(getComputedStyle(root).transform);
        samples.push({ at: performance.now() - start, phase: root.dataset.phase,
          x: transform.m41, y: transform.m42, scale: transform.m22,
          mask: root.querySelector('.task-progress-green').style.maskImage,
          dust: root.querySelector('.task-progress-dust').children.length });
        if (performance.now() - start < 1450) requestAnimationFrame(sample);
        else resolve({ samples, audio: window.audioCalls });
      };
      requestAnimationFrame(sample);
    });
  });
  assert.equal(frames.audio.length, 1);
  assert.equal(frames.audio[0].phase, 'settling', 'Sound must start in the same delivery as visual completion');
  assert.ok(frames.samples.some(frame => Math.abs(frame.y) > 1.5), 'Impact should be perceptible');
  assert.ok(frames.samples.some(frame => frame.dust > 0), 'Pixels follow the sweep');
  assert.ok(frames.samples.some(frame => frame.mask !== 'none'));
  assert.equal(await progress.getAttribute('data-phase'), 'complete');
  await page.waitForTimeout(650);
  assert.equal(await page.locator('.task-progress-dust i').count(), 0);
  await page.screenshot({ path: 'test-results/task-progress-complete-light.png' });
  await page.evaluate(() => window.taskProgressFixture.visible(false));
  await progress.waitFor({ state: 'detached' });
  await page.evaluate(() => { window.taskProgressFixture.idle(); window.taskProgressFixture.visible(true); });
  await progress.waitFor();
  assert.equal(await progress.getAttribute('data-phase'), 'complete');
  assert.equal(await page.evaluate(() => window.audioCalls.length), 1, 'Reopen cannot replay sound');
  assert.equal(await progress.evaluate(element => element.getAnimations().length), 0, 'Reopen cannot replay impact');
  await page.evaluate(() => window.taskProgressFixture.update(3));
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '3');
  await page.evaluate(() => window.taskProgressFixture.complete());
  assert.equal(await progress.getAttribute('data-phase'), 'running');
  assert.equal(await progress.getAttribute('aria-valuenow'), '3', 'Round completion cannot fabricate finished tasks');
  await page.evaluate(() => window.taskProgressFixture.update(5));
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '5');
  await page.evaluate(() => window.taskProgressFixture.complete('other-runtime', 'other-session'));
  assert.equal(await progress.getAttribute('data-phase'), 'running');
  await page.evaluate(() => window.taskProgressFixture.complete());
  await page.waitForTimeout(80);
  await page.evaluate(() => window.taskProgressFixture.session('other-session'));
  await page.waitForFunction(() => document.querySelector('.sb-task-progress')?.dataset.phase === 'complete');
  assert.equal(await page.locator('.task-progress-dust i').count(), 0, 'Session change cancels old particles');
  const soundCount = await page.evaluate(() => window.audioCalls.length);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.taskProgressFixture.update(4));
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '4');
  await page.evaluate(() => window.taskProgressFixture.update(5));
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '5');
  await page.evaluate(() => window.taskProgressFixture.complete('preview-runtime', 'other-session'));
  assert.equal(await progress.getAttribute('data-phase'), 'complete');
  assert.equal(await progress.evaluate(element => element.getAnimations().length), 0);
  assert.equal(await page.evaluate(() => window.audioCalls.length), soundCount + 1, 'Reduced motion retains the single sound');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByRole('button', { name: '切换暗色' }).click();
  await page.screenshot({ path: 'test-results/task-progress-complete-dark-narrow.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('Task progress verified: flowing/full, impact/sweep/audio, reopen, incomplete, scope, reduced motion and narrow dark.');
} finally {
  await browser?.close();
  await server.close();
}
