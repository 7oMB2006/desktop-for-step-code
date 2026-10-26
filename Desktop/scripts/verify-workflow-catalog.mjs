import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = 'test-results/workflow-catalog';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `${server.resolvedUrls.local[0]}tests/fixtures/workflow-catalog.html`;
  const panel = page.locator('#workflow-catalog-panel');
  const open = async () => {
    await page.getByRole('button', { name: '/workflows', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#workflow-catalog-panel')?.getAttribute('aria-hidden') === 'false');
    await panel.locator('[aria-busy="false"]').waitFor();
    await page.mouse.move(0, 0);
  };
  await page.goto(url);
  await open();
  await panel.hover();
  await page.waitForTimeout(5300);
  assert.equal(await panel.getAttribute('aria-hidden'), 'false', 'Hover pauses auto-close');
  await panel.locator('summary').click();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(5300);
  assert.equal(await panel.getAttribute('aria-hidden'), 'false', 'Expanded record scope pauses auto-close');
  await page.keyboard.press('Escape');
  assert.equal(await panel.getAttribute('aria-hidden'), 'true');
  await open();
  await panel.getByRole('button', { name: '刷新工作流', exact: true }).focus();
  await page.waitForTimeout(5300);
  assert.equal(await panel.getAttribute('aria-hidden'), 'false', 'Keyboard focus pauses auto-close');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '/workflows', exact: true }).evaluate(el => el === document.activeElement), true);
  await open();
  await page.waitForFunction(() => document.querySelector('#workflow-catalog-panel')?.getAttribute('aria-hidden') === 'true', null, { timeout: 8000 })
    .catch(async error => { throw new Error(`${error.message}: ${JSON.stringify(await page.evaluate(() => ({
      hidden: document.hidden, focus: document.activeElement?.outerHTML, footer: document.querySelector('#workflow-catalog-panel footer')?.textContent,
    })))}`); });
  await open();
  const grip = panel.locator('.workflow-catalog-grab');
  const drag = async distance => {
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - distance, { steps: 8 });
    await page.mouse.up();
  };
  await drag(20);
  assert.equal(await panel.getAttribute('aria-hidden'), 'false', 'Short drag springs back');
  await page.waitForTimeout(450);
  await drag(70);
  assert.equal(await panel.getAttribute('aria-hidden'), 'true', 'Upward drag dismisses');
  await page.getByLabel('Scenario').selectOption('error');
  await open();
  await panel.getByRole('alert').waitFor();
  await page.waitForTimeout(5300);
  assert.equal(await panel.getAttribute('aria-hidden'), 'false', 'Failure remains open');
  await page.getByLabel('Scenario').selectOption('empty');
  await panel.getByText('没有保存的工作流。', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByLabel('Scenario').selectOption('delayed');
  await page.getByRole('button', { name: '/workflows', exact: true }).click();
  await page.getByRole('button', { name: 'Switch session', exact: true }).click();
  await panel.getByText('session-b', { exact: true }).waitFor();
  await page.waitForTimeout(2200);
  assert.equal(await panel.getByText('session-a', { exact: true }).count(), 0, 'Old owner response ignored');
  for (const theme of ['light', 'dark']) {
    for (const width of [1100, 390, 320]) {
      await page.setViewportSize({ width, height: 650 });
      await page.goto(`${url}?theme=${theme}&lang=en&state=long`);
      await open();
      await panel.hover();
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth), false);
      await page.getByLabel('Scenario').selectOption('normal');
      await panel.getByText('wf_release', { exact: false }).waitFor();
      await panel.getByRole('button', { name: 'Refresh workflows', exact: true }).focus();
      await page.keyboard.press('Tab');
      await page.screenshot({ path: `${output}/normal-${theme}-${width}.png` });
      assert.equal(await panel.locator('table').evaluate(el => el.scrollWidth > el.clientWidth), false);
      assert.equal(await panel.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        const container = el.parentElement.parentElement.getBoundingClientRect();
        const focus = document.activeElement.getBoundingClientRect();
        return bounds.top >= container.top && bounds.bottom <= container.bottom + 1
          && focus.top - 4 >= bounds.top && focus.bottom + 4 <= bounds.bottom;
      }), true, 'Panel and keyboard focus remain inside the available space');
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await open();
  assert.equal(await panel.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  assert.deepEqual(errors, []);
  console.log('Workflow catalog: auto-close, pauses, focus, drag, errors, owner isolation, themes and responsive layout passed.');
} finally { await browser.close(); await server.close(); }
