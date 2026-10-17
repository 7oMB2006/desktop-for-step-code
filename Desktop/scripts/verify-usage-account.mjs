import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

await mkdir('test-results', { recursive: true });
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const url = `${server.resolvedUrls.local[0]}tests/fixtures/usage-account.html`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_VERIFY_BROWSER ? { executablePath: process.env.DESKTOP_VERIFY_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const allowance = page.getByRole('region', { name: '套餐与额度' });
  await allowance.getByText('Step Plan Pro', { exact: true }).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 2);
  assert.equal(await allowance.getByRole('meter').first().getAttribute('aria-valuenow'), '72');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/usage-account-coding-light.png', animations: 'disabled' });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  assert.equal(await allowance.getAttribute('aria-busy'), 'true');
  await allowance.getByText('刚刚更新', { exact: true }).waitFor();
  const select = page.getByRole('combobox', { name: '预览状态' });
  await select.selectOption('token');
  assert.equal(await allowance.getByRole('meter').last().getAttribute('aria-valuenow'), '12');
  await page.screenshot({ path: 'test-results/usage-account-token-light.png', animations: 'disabled' });
  await select.selectOption('none');
  assert.equal(await allowance.getByRole('meter').count(), 0);
  await allowance.getByText('未订阅套餐', { exact: true }).waitFor();
  await select.selectOption('error');
  await allowance.getByText('套餐信息暂不可用', { exact: true }).waitFor();
  assert.equal(await allowance.getByText('未订阅套餐', { exact: true }).count(), 0);
  await select.selectOption('stale');
  await allowance.getByText('Step Plan Pro', { exact: true }).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 2);
  await select.selectOption('unsupported');
  assert.equal(await allowance.getByRole('button', { name: '刷新额度' }).isDisabled(), true);
  await select.selectOption('loading');
  assert.equal(await allowance.getAttribute('aria-busy'), 'true');
  await select.selectOption('api');
  const balance = page.getByRole('region', { name: 'API 账户余额' });
  await balance.getByText('1,899.80', { exact: true }).waitFor();
  assert.equal(await balance.getByRole('meter').count(), 0);
  await page.screenshot({ path: 'test-results/usage-account-api-light.png', animations: 'disabled' });
  await balance.getByRole('button', { name: '刷新余额' }).click();
  assert.equal(await balance.getAttribute('aria-busy'), 'true');
  await page.waitForFunction(() => document.querySelector('.api-balance')?.getAttribute('aria-busy') === 'false');
  await select.selectOption('api-zero');
  await balance.getByText('0.00', { exact: true }).waitFor();
  await select.selectOption('api-error');
  await balance.getByText('--', { exact: true }).waitFor();
  await select.selectOption('api-stale');
  await balance.getByText(/显示的是上次获取的数据/).waitFor();
  await page.goto(`${url}?theme=dark`);
  await allowance.getByText('Step Plan Pro', { exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/usage-account-coding-dark.png', animations: 'disabled' });
  await page.getByRole('combobox', { name: '预览状态' }).selectOption('api');
  await balance.getByText('1,899.80', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/usage-account-api-dark.png', animations: 'disabled' });
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const state of ['token', 'api']) {
      await page.goto(`${url}?lang=en&state=${state}`);
      await page.getByRole('region', { name: state === 'api' ? 'API account balance' : 'Plan and allowance' }).waitFor();
      assert.ok(await page.locator('.settings-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.ok(await page.locator('.settings-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.ok(await page.locator('.account-identity-text').evaluate(el => el.getBoundingClientRect().width >= 140),
        'account identity must retain readable width rather than wrap each letter');
    }
  }
  await page.screenshot({ path: 'test-results/usage-account-mobile.png', animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${url}?state=loading`);
  assert.equal(await page.locator('.plan-skeleton i').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log('Usage account preview passed: Coding/Token, refresh, none/error distinction, stale, unsupported, loading, light/dark, narrow English, reduced motion.');
} finally {
  await browser?.close();
  await server?.close();
}
