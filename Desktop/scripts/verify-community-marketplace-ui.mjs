import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.DESKTOP_PREVIEW_URL ?? 'http://127.0.0.1:5297';
const preview = mode => `${base}/tests/fixtures/plugin-center-live.html?community=${mode}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 820 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(preview('retry'));
  const sources = page.getByRole('tab', { name: '市场来源' });
  const discover = page.getByRole('tab', { name: '发现' });
  const row = page.locator('.pc-community-source');
  const add = row.getByRole('button', { name: '添加社区市场' });
  const added = row.getByText('已添加', { exact: true });
  const example = page.getByText('Community Example', { exact: true });

  await discover.click();
  assert.equal(await row.count(), 0);
  assert.equal(await example.count(), 0);
  await sources.click();
  await add.waitFor();
  await row.locator('img').evaluate(img => img.decode());
  await add.click();
  await page.getByRole('alert').waitFor();
  await add.click();
  await added.waitFor();
  assert.equal(await sources.getAttribute('aria-selected'), 'true');
  assert.equal(await add.count(), 0);
  await discover.click();
  await example.waitFor();
  assert.equal(await row.count(), 0);
  await sources.click();
  await row.getByRole('button', { name: '移除市场 DFSC 社区市场' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认' }).click();
  await add.waitFor();
  assert.equal(await sources.getAttribute('aria-selected'), 'true');

  await page.goto(preview('existing'));
  await sources.click();
  await added.waitFor();
  assert.equal(await page.locator('.pc-source-row').count(), 2, 'Existing SSH source must only have one row');
  assert.equal(await add.count(), 0);

  await page.goto(preview('lookalike'));
  await sources.click();
  await add.waitFor();
  assert.equal(await added.count(), 0, 'A matching market name must not identify the community repository');
  assert.deepEqual(errors, []);
  console.log('Community marketplace UI: preset add and retry, tab retention, discover, removal, and source recognition passed.');
} finally {
  await browser.close();
}
