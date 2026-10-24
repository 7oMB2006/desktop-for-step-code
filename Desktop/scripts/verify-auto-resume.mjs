import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results/auto-resume');
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/auto-resume.html`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let cases = 0;
  for (const theme of ['light', 'dark']) {
    for (const lang of ['zh', 'en']) {
      for (const preset of ['simple', 'standard', 'detailed']) {
        for (const width of [1100, 390]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(`${url}?theme=${theme}&lang=${lang}&preset=${preset}`);
          const notice = page.locator('.auto-resume-message');
          await notice.waitFor();
          assert.equal(await notice.count(), 1);
          assert.equal(await page.locator('.message.user').count(), 1);
          assert.equal(await notice.locator('button').count(), 0);
          const emphasis = await notice.locator('strong').evaluate(element => {
            const style = getComputedStyle(element);
            return { fontStyle: style.fontStyle, fontWeight: style.fontWeight, color: style.color,
              primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() };
          });
          assert.equal(emphasis.fontStyle, 'normal');
          assert.equal(emphasis.fontWeight, '650');
          assert.ok((await page.locator('.message-body').allTextContents())
            .every(text => !text.includes('The previous turn was interrupted')));
          assert.equal(await page.getByText('The previous turn was interrupted', { exact: false }).count(), 0);
          assert.match(await notice.innerText(), lang === 'zh' ? /已发起自动续跑/ : /continuation requested/);
          assert.equal(await page.locator('article.assistant').count(), 1);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          const bounds = await notice.boundingBox();
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
          if (lang === 'zh' && preset === 'standard') await page.screenshot({ path: resolve(output, `${theme}-${width}.png`) });
          cases++;
        }
      }
    }
  }
  for (const state of ['failed', 'stopped']) {
    await page.goto(`${url}?state=${state}`);
    await page.locator('.auto-resume-message').waitFor();
    assert.match(await page.locator('.auto-resume-message').innerText(), /已发起自动续跑/);
    assert.equal(await page.locator('.auto-resume-message').getAttribute('aria-live'), null);
    await page.reload();
    await page.locator('.auto-resume-message').waitFor();
  }
  await page.goto(`${url}?state=user`);
  await page.locator('.message.user').nth(1).waitFor();
  assert.equal(await page.locator('.auto-resume-message').count(), 0);
  await page.getByText('The previous turn was interrupted', { exact: false }).waitFor();
  await page.goto(`${url}?state=hidden`);
  await page.locator('.response-text').first().waitFor();
  assert.equal(await page.locator('.auto-resume-message').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await page.locator('.auto-resume-message').waitFor();
  assert.equal(await page.locator('.auto-resume-message').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log(`Automatic continuation: ${cases} theme/language/preset/viewport cases + stop/failure/reload/user identity passed.`);
} finally {
  await browser?.close();
  await server.close();
}
