import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.DESKTOP_FIXTURE_ORIGIN ?? 'http://127.0.0.1:5191';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('test-results', { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) {
    for (const width of [1100, 375]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(`${origin}/tests/fixtures/session-status.html?theme=${theme}`);
      assert.equal(await page.getByRole('tab').first().innerText(), '上下文');
      assert.equal(await page.getByRole('tab', { name: '上下文', exact: true }).getAttribute('aria-selected'), 'true');
      await page.getByRole('tab', { name: '状态', exact: true }).click();
      await page.getByText('Step 3.5 Flash', { exact: true }).waitFor();
      await page.getByText('已信任', { exact: true }).waitFor();
      const toggle = page.getByRole('button', { name: '详细信息', exact: true });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      await page.locator('.context-panel').evaluate(async element => {
        await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
      });
      await page.locator('#session-status-details').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/session-status-details-${theme}-${width}.png` });
      await page.locator('.context-panel-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: `test-results/session-status-view-${theme}-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const overflow = await page.locator('.session-status-row dd').evaluateAll(rows => rows
        .filter(row => row.scrollWidth > row.clientWidth + 1).map(row => row.textContent));
      assert.deepEqual(overflow, []);
      await page.getByRole('tab', { name: '上下文', exact: true }).click();
      await page.locator('.context-content').waitFor();
      await page.keyboard.press('End');
      await page.locator('.session-status-content').waitFor();
    }
  }
  for (const [state, text] of [['draft', '尚未创建'], ['offline', '已断开'], ['custom', 'Local provider'], ['api', '官方 API'], ['error', '读取失败']]) {
    await page.goto(`${origin}/tests/fixtures/session-status.html?state=${state}`);
    await page.getByRole('tab', { name: '状态', exact: true }).click();
    await page.getByText(text, { exact: state !== 'offline' }).first().waitFor();
    if (state === 'custom') assert.ok(!(await page.locator('.session-status-content').innerText()).includes('100008326'));
  }
  await page.goto(`${origin}/tests/fixtures/session-status.html?lang=en&theme=dark`);
  await page.getByRole('tab', { name: 'Status', exact: true }).click();
  await page.getByText('Applies next turn', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.screenshot({ path: 'test-results/session-status-view-en.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.context-view-content').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log('Status presentation passed: themes, desktop/narrow, draft/offline/custom/API, tabs, English and reduced motion.');
} finally {
  await browser.close();
}
