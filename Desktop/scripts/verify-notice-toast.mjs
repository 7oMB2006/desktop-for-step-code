import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = 'test-results/notice-toast-timing';
await mkdir(output, { recursive: true });
let server, browser;
const errors = [];
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    ...(process.env.DESKTOP_VERIFY_BROWSER ? { executablePath: process.env.DESKTOP_VERIFY_BROWSER } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/notice-toast-timing.html`);
  await page.waitForFunction(() => window.noticeTiming);
  await page.clock.install();
  const toast = page.getByRole('status');
  await page.evaluate(() => window.noticeTiming.show());
  await page.waitForFunction(() => window.noticeTiming.ready === 1);
  await toast.hover();
  await page.clock.runFor(3100);
  assert.equal(await toast.isVisible(), true, 'Hover still pauses the original success notice');
  await page.evaluate(() => window.noticeTiming.replace());
  await page.waitForFunction(() => window.noticeTiming.ready === 2);
  assert.deepEqual(await page.evaluate(() => ({
    leaveBeforePassive: window.noticeTiming.leaveBeforePassive,
    hoverBeforePassive: window.noticeTiming.hoverBeforePassive,
  })), { leaveBeforePassive: true, hoverBeforePassive: true });
  await toast.getByText('Restored', { exact: true }).waitFor();
  await page.clock.runFor(3100);
  assert.equal(await toast.count(), 0,
    'A late passive effect cannot overwrite the already delivered mouse-leave event and park the replacement');
  assert.equal(await page.evaluate(() => window.noticeTiming.dismissed), 1);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.noticeTiming.show());
  await page.waitForFunction(() => window.noticeTiming.ready === 1);
  await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).focus();
  await page.clock.runFor(3100);
  assert.equal(await toast.isVisible(), true, 'Keyboard focus still pauses the notice');
  await page.evaluate(() => document.activeElement.blur());
  await page.clock.runFor(3100);
  assert.equal(await toast.count(), 0, 'Blur resumes the success deadline');
  await page.evaluate(() => window.noticeTiming.show());
  await page.waitForFunction(() => window.noticeTiming.ready === 1);
  await toast.hover();
  await page.evaluate(() => window.noticeTiming.replace(false));
  await page.waitForFunction(() => window.noticeTiming.ready === 2);
  await page.clock.runFor(3100);
  assert.equal(await toast.isVisible(), true, 'An actually hovered replacement remains paused');
  await page.mouse.move(0, 0);
  await page.clock.runFor(3100);
  assert.equal(await toast.count(), 0, 'Leaving the replacement resumes its deadline');
  assert.equal(await page.evaluate(() => window.noticeTiming.dismissed), 3);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ verified: true, errors }, null, 2));
  console.log('Notice timing passed: replacement leave before passive effects, ordinary hover/focus pauses and resumed deadlines.');
} finally {
  await browser?.close();
  await server?.close();
}
