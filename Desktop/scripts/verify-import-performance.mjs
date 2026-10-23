import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_TEST_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_TEST_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/disclosure-summary.html');
  await page.waitForFunction(() => window.disclosureFixture);
  const started = performance.now();
  await page.evaluate(() => {
    const fixture = window.disclosureFixture;
    fixture.load([
      { role: 'user', content: 'Imported history', desktopImported: true },
      { role: 'assistant', desktopImported: true, content: [
        { type: 'text', text: '[Historical image_generation_call]\n' + JSON.stringify({ result: 'a'.repeat(3_040_000) }) },
        { type: 'thinking', thinking: 'Saved reasoning.\n'.repeat(30_000) },
      ] },
      { role: 'user', content: 'Continue', entryId: 'continue' },
    ], false);
  });
  await page.getByText('Continue', { exact: true }).waitFor({ timeout: 8000 });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 8000, `large imported history blocked rendering for ${elapsed.toFixed(0)}ms`);
  assert.equal(await page.locator('.thinking-body').textContent(), '', 'closed reasoning must not parse Markdown');
  const raw = page.locator('.large-message-text');
  assert.equal(await raw.count(), 1, 'oversized text has a bounded plain-text viewer');
  assert.ok((await raw.textContent()).length < 40_000, 'do not put megabytes into the DOM');
  await page.getByRole('button', { name: '下一段' }).click();
  assert.equal(await raw.getAttribute('data-page'), '2');
  await page.locator('.thinking > summary').click();
  await page.locator('.thinking-body .large-message-text').waitFor();
  assert.ok((await page.locator('.thinking-body').textContent()).length < 40_000);
  await page.screenshot({ path: 'test-results/import-performance.png' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('.large-message-text').first().evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: `test-results/import-performance-${theme}-narrow.png` });
  }
  console.log(`Large-history render and interaction passed (${elapsed.toFixed(0)}ms).`);
} finally {
  await browser?.close();
  await server.close();
}
