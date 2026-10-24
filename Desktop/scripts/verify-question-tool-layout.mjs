import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results', { recursive: true });
  for (const theme of ['light', 'dark']) {
    for (const lang of ['zh', 'en']) {
      for (const width of [1123, 600, 360]) {
        await page.setViewportSize({ width, height: 500 });
        await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/question-tool.html?theme=${theme}&lang=${lang}`);
        await page.locator('.question-tool-summary').last().waitFor();
        const rows = await page.locator('.question-tool-summary').evaluateAll(elements => elements.map(row => {
          const label = row.querySelector('.process-tool-label, button');
          const beta = row.querySelector('.question-beta');
          const subject = row.querySelector('.question-tool-subject');
          const rect = element => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, height: box.height };
          };
          const lineCount = element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return new Set([...range.getClientRects()].map(box => Math.round(box.top))).size;
          };
          return { labelLines: lineCount(label), betaLines: lineCount(beta), row: rect(row),
            label: rect(label), beta: rect(beta), subject: rect(subject), truncated: subject.scrollWidth > subject.clientWidth };
        }));
        for (const row of rows) {
          assert.equal(row.labelLines, 1, `${theme}/${lang}/${width}: status label must stay on one line`);
          assert.equal(row.betaLines, 1, `${theme}/${lang}/${width}: Beta must stay on one line`);
          assert.ok(row.label.right <= row.beta.left + 1, 'Label and badge must not overlap');
          assert.ok(row.beta.right <= row.subject.left + 1, 'Only the question preview may shrink');
          assert.ok(row.subject.right <= row.row.right + 1, 'Preview must fit inside the row');
          assert.ok(row.row.right <= width, 'Row must not overflow the viewport');
          if (width <= 600) assert.ok(row.truncated, 'Long question should be ellipsized in narrow layouts');
        }
        await page.locator('summary.question-tool-summary').click();
        assert.equal(await page.locator('details.process-tool').getAttribute('open'), '');
        await page.getByRole('button', { name: lang === 'zh' ? '打开待回答问题' : 'Open pending questions' }).click();
        assert.equal(await page.locator('html').getAttribute('data-question-opened'), 'true');
        if (width === 600 && lang === 'zh') await page.screenshot({ path: `test-results/question-tool-${theme}.png` });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('Question tool: 12 theme/language/width cases retain single-line labels and badges, truncated previews and working actions.');
} finally {
  await browser.close();
  await server.close();
}
