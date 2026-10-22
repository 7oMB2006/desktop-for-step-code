import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(process.env.DESKTOP_CRON_SCREENSHOTS ?? join(root, 'test-results/cron-transcript'));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/tests/fixtures/cron-transcript.html`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let cases = 0;
  for (const theme of ['light', 'dark']) {
    for (const preset of ['simple', 'standard', 'detailed']) {
      for (const language of ['zh', 'en']) {
        for (const width of [1322, 390]) {
          await page.setViewportSize({ width, height: 880 });
          await page.goto(`${url}?theme=${theme}&preset=${preset}&lang=${language}`);
          const trigger = page.locator('.cron-message-trigger');
          await trigger.waitFor();
          assert.equal(await trigger.count(), 1);
          assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
          assert.equal(await page.locator('.response-text').count(), 2, 'Both real replies render without Cron prose');
          assert.equal(await page.locator('article.assistant').count(), 2, 'Cron starts a separate response');
          assert.equal(await page.locator('article.assistant').first().locator('.cron-message').count(), 0);
          assert.equal(await page.locator('.assistant-actions').count(), 2, 'Each settled turn keeps its footer');
          assert.match(await page.locator('article.assistant').nth(0).locator('.elapsed-total').innerText(), /8s/);
          assert.match(await page.locator('article.assistant').nth(1).locator('.elapsed-total').innerText(), /4s/);
          await trigger.click();
          assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
          await page.waitForTimeout(320);
          await page.getByText('10 9 * * *', { exact: true }).waitFor();
          await page.getByRole('button', { name: '刷新示例快照' }).click();
          assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'Snapshots must preserve manual disclosure');
          assert.equal(await page.locator('.cron-message-details').getAttribute('inert'), null);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          if (preset === 'standard' && language === 'zh' && width === 1322) {
            await page.mouse.move(0, 0);
            await page.screenshot({ path: join(output, `${theme}-expanded.png`) });
          }
          await trigger.focus();
          await page.keyboard.press('Space');
          await page.waitForTimeout(320);
          assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
          assert.notEqual(await page.locator('.cron-message-details').getAttribute('inert'), null);
          if (preset === 'standard' && language === 'zh' && width === 1322) {
            await trigger.blur();
            await page.screenshot({ path: join(output, `${theme}-collapsed.png`) });
          }
          cases++;
        }
      }
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${url}?state=missed`);
  const trigger = page.locator('.cron-message-trigger');
  await trigger.waitFor();
  assert.match(await trigger.innerText(), /定时任务错过提醒/);
  await trigger.click();
  await page.getByText('[cron] Missed 1 one-shot job while the session was offline.', { exact: false }).waitFor();
  assert.equal(await page.locator('.cron-message-details').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  for (const state of ['spoof', 'hidden']) {
    await page.goto(`${url}?state=${state}`);
    await page.locator('.response-text').first().waitFor();
    assert.equal(await page.locator('.cron-message').count(), 0);
  }
  await page.goto(`${url}?active=true`);
  await page.locator('.response-active .cron-message').waitFor();
  assert.equal(await page.locator('article.assistant').first().locator('.assistant-actions').count(), 1,
    'The prior footer remains while Cron is running');
  await page.reload();
  await page.locator('.response-active .cron-message').waitFor();
  assert.deepEqual(errors, []);
  console.log(`Cron transcript: ${cases} theme/preset/language/viewport cases + missed/reduced-motion passed.`);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
