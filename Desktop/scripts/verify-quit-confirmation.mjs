import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(process.env.DESKTOP_QUIT_SCREENSHOTS ?? join(root, 'test-results/quit-confirmation'));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/cron-transcript.html`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let cases = 0;
  for (const theme of ['light', 'dark']) for (const scenario of ['cron', 'durable', 'running', 'mixed']) {
    for (const width of [1322, 390]) for (const language of ['zh', 'en']) {
      await page.setViewportSize({ width, height: 880 });
      await page.goto(`${url}?quit=${scenario}&theme=${theme}&lang=${language}`);
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
      assert.equal(await dialog.locator('button').count(), 3, 'Close, cancel and quit only');
      assert.equal(await dialog.locator('button:focus').innerText(), language === 'zh' ? '取消退出' : 'Cancel quit');
      assert.equal(await dialog.locator('.quit-reasons li').count(), scenario === 'mixed' ? 3 : 1);
      if (scenario === 'cron') {
        assert.match(await dialog.locator('h2').innerText(), language === 'zh' ? /定时任务/ : /Scheduled tasks/);
        assert.equal(await dialog.locator('.quit-loss').count(), 1);
        assert.equal(await dialog.locator('.quit-confirm').innerText(), language === 'zh' ? '退出应用' : 'Quit application');
      }
      if (scenario === 'durable') assert.equal(await dialog.locator('.quit-loss').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
      if (width === 1322 && language === 'zh') {
        await page.waitForTimeout(240);
        await page.screenshot({ path: join(output, `${theme}-${scenario}.png`) });
      }
      if (width === 390 && language === 'en' && scenario === 'mixed') {
        await page.screenshot({ path: join(output, `${theme}-narrow-en.png`) });
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.window-bar small').textContent(), '已取消退出 · 示例');
      await page.getByRole('button', { name: '退出应用', exact: true }).click();
      await dialog.waitFor();
      await dialog.locator('.quit-confirm').click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.window-bar small').textContent(), '已确认退出 · 示例，不关闭应用');
      assert.equal(await page.getByRole('dialog').count(), 0);
      cases++;
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${url}?quit=cron&quitError=true`);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), 'none');
  const cancel = dialog.getByRole('button', { name: '取消退出', exact: true }).last();
  await dialog.locator('.quit-confirm').focus();
  await page.keyboard.press('Tab');
  assert.equal(await dialog.locator('button:focus').getAttribute('aria-label'), '取消退出',
    'Native dialog traps focus from the last control to the first');
  await dialog.locator('.quit-confirm').click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await cancel.isEnabled(), true, 'Failed quit remains cancellable and retryable');
  await cancel.click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log(`Quit confirmation preview: ${cases} theme/scenario/viewport/language cases, keyboard, reduced-motion and failure recovery passed.`);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
