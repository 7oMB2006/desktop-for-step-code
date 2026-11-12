import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { settleLayout } from './settle-layout.mjs';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('test-results', { recursive: true });
try {
  const url = server.resolvedUrls.local[0];
  for (const theme of ['light', 'dark']) {
    for (const language of ['zh', 'en']) {
      for (const width of [1280, 520, 360]) {
        await page.setViewportSize({ width, height: 860 });
        await page.emulateMedia({ reducedMotion: width === 360 ? 'reduce' : 'no-preference' });
        await page.goto(`${url}tests/fixtures/workflow-roles.html?theme=${theme}&lang=${language}`);
        const rows = page.locator('.workflow-agent');
        await rows.first().waitFor();
        await settleLayout(page.locator('#subagent-panel'));
        assert.equal(await rows.count(), 7);
        for (const [index, icon] of ['scan-search', 'shield-check', 'code-xml', 'flask-conical', 'bot', 'bot', 'bot'].entries()) {
          const row = rows.nth(index);
          assert.equal(await row.locator(`.agent-role-icon svg.lucide-${icon}`).count(), 1);
          assert.equal(await row.locator('.subagent-status-icon').count(), 1, 'role icons do not replace status icons');
          const fits = await row.evaluate(element => {
            const identity = element.querySelector('.workflow-agent-identity');
            const role = identity.querySelector('.agent-role-icon').getBoundingClientRect();
            const label = identity.lastElementChild.getBoundingClientRect();
            const next = element.querySelector('.workflow-agent-copy > span').getBoundingClientRect();
            return element.scrollWidth <= element.clientWidth + 1 && role.right <= label.left && label.bottom <= next.top;
          });
          assert.ok(fits, `Row layout ${theme}/${language}/${width}/${index}`);
        }
        assert.equal(await rows.nth(5).locator('.agent-role-icon').getAttribute('data-agent-role'), 'docs-helper');
        assert.equal(await rows.nth(6).locator('.agent-role-icon').getAttribute('data-agent-role'), 'unknown');
        await page.screenshot({ path: `test-results/workflow-roles-${theme}-${language}-${width}.png` });
        await rows.nth(0).click();
        const detail = page.locator('.subagent-body');
        await detail.waitFor();
        await settleLayout(detail);
        assert.equal(await detail.locator('.agent-role-icon svg.lucide-scan-search').count(), 1);
        assert.match(await detail.locator('.workflow-agent-identity').innerText(), /ref-config-starter/);
        await page.screenshot({ path: `test-results/workflow-role-detail-${theme}-${language}-${width}.png` });
        await page.goto(`${url}tests/fixtures/workflow-roles.html?theme=${theme}&lang=${language}&view=transcript`);
        const summary = page.locator('.workflow-inline-roles');
        await summary.waitFor();
        assert.equal(await summary.locator('button').count(), 7, 'Six role groups plus overflow');
        assert.equal(await summary.locator('.agent-role-icon[data-agent-role="explore"]').count(), 1);
        assert.equal(await summary.locator('button').first().locator('.workflow-role-count').innerText(), '2');
        const lanes = page.locator('.lane-row');
        assert.equal(await lanes.count(), 6);
        for (const [index, icon] of ['scan-search', 'shield-check', 'code-xml', 'flask-conical', 'bot', 'bot'].entries()) {
          assert.equal(await lanes.nth(index).locator(`.agent-role-icon svg.lucide-${icon}`).count(), 1);
          assert.equal(await lanes.nth(index).locator('.subagent-status-icon').count(), 1);
        }
        assert.ok(await summary.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Role summary fits the transcript');
        await page.screenshot({ path: `test-results/workflow-roles-transcript-${theme}-${language}-${width}.png` });
        await summary.locator('button').first().click();
        await page.locator('#subagent-panel[aria-hidden="false"] .workflow-overview').waitFor();
        await page.locator('#subagent-panel .right-panel-header .icon-button').last().click();
        await page.locator('#subagent-panel[aria-hidden="false"]').waitFor({ state: 'hidden' });
        await lanes.first().click();
        await page.locator('#subagent-panel[aria-hidden="false"] .subagent-body .lane-type').getByText('explore', { exact: true }).waitFor();
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('Workflow role icons: 12 theme/language/viewport combinations passed; transcript, list, detail and navigation verified.');
} finally {
  await browser.close();
  await server.close();
}
