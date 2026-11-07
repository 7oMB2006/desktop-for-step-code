import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { settleLayout } from './settle-layout.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results/execution-outcomes');
await mkdir(output, { recursive: true });
const server = await createServer({ root, cacheDir: resolve(output, '.vite'), configFile: false, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/execution-outcomes.html`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let cases = 0;
  for (const theme of ['light', 'dark']) for (const lang of ['zh', 'en']) {
    for (const preset of ['simple', 'standard', 'detailed']) for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${url}?theme=${theme}&lang=${lang}&preset=${preset}`);
      await page.locator('.process-tool').first().waitFor();
      assert.equal(await page.locator('.process-tool.failed').count(), 4);
      assert.equal(await page.locator('.process-tool.stopped').count(), 2);
      assert.equal(await page.locator('.process-tool.unknown').count(), 1);
      assert.equal(await page.locator('.tool-group').count(), 0);
      assert.match(await page.locator('.process-tool').first().innerText(), /7/);
      const edit = page.locator('.process-tool.stopped').last();
      assert.match(await edit.innerText(), lang === 'zh' ? /修改了文件.*验证已取消/ : /Edited file.*cancelled/);
      await edit.locator('summary').click();
      await edit.locator('.process-tool-status').waitFor();
      await settleLayout(edit);
      assert.match(await edit.innerText(), /File changed/);
      assert.ok(await page.locator('.turn-changes').count(), 'Applied diff survives a cancelled check');
      await page.locator('.turn-change-row').click();
      await page.getByText('export const ready = true;', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (lang === 'zh' && preset === 'standard') await page.screenshot({ path: resolve(output, `${theme}-${width}.png`) });
      cases++;
    }
  }
  for (const state of ['recovering', 'exhausted', 'recovered']) {
    await page.goto(`${url}?state=${state}`);
    await page.locator('article.assistant').waitFor();
    assert.equal(await page.locator('.incomplete-response').count(), state === 'recovered' ? 0 : 1);
    if (state !== 'recovered') assert.match(await page.locator('.incomplete-response').innerText(), state === 'recovering' ? /等待运行时/ : /本轮未完成/);
    assert.equal(await page.getByText('INTERNAL RECOVERY INPUT', { exact: false }).count(), 0);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${url}?theme=dark`);
  await page.locator('.process-tool').first().waitFor();
  await page.locator('.process-tool').first().locator('summary').click();
  assert.deepEqual(errors, []);
  console.log(`Execution outcomes: ${cases} theme/language/preset/viewport cases, retained diffs, recovery and reduced motion passed.`);
} finally {
  await browser?.close();
  await server.close();
}
