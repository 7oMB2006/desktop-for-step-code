import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { settleLayout } from './settle-layout.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5195/tool-status-preview.html';
const output = resolve(process.argv[3] ?? 'test-results/plugin-reload-web');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], checks = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
page.on('pageerror', error => errors.push(error.message));
const trigger = page.getByRole('button', { name: '重载 Bilibili Video Research', exact: true });
const dialog = page.locator('.pc-reload-dialog');
const occupancy = page.getByRole('combobox', { name: '会话占用', exact: true });
const status = page.getByRole('button', { name: '查看 Bilibili Video Research 的重载详情', exact: true });
const shot = async name => {
  await settleLayout(dialog);
  await page.screenshot({ path: join(output, name), animations: 'disabled' });
};
try {
  await page.goto(url);
  await trigger.waitFor();
  await occupancy.selectOption('busy');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await status.waitFor();
  assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
  assert.equal(await dialog.count(), 0);
  await trigger.click();
  await dialog.locator('[data-phase=occupied].lc-ring-base').waitFor();
  assert.equal(await dialog.locator('details').getAttribute('open'), null);
  await dialog.locator('[data-phase=done].lc-ring-base').waitFor();
  await shot('collapsed-dark.png');
  await dialog.locator('summary').click();
  await dialog.getByText('插件正在被调用', { exact: true }).waitFor();
  checks.push('one click starts without a dialog; second click shows the same operation and collapsed segmented ring');

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
  const before = await trigger.boundingBox();
  await status.click();
  await dialog.getByRole('button', { name: '取消等待', exact: true }).click();
  await dialog.locator('[data-phase=cancelled].lc-ring-base').waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(await trigger.boundingBox(), before);
  assert.equal(await status.evaluate(node => document.activeElement === node), true);
  checks.push('waiting survives closing; only pending work is cancelled; focus and layout are preserved');

  await page.getByRole('button', { name: '切换浅色', exact: true }).click();
  await occupancy.selectOption('idle');
  await trigger.click();
  await status.locator('[data-complete=true]').waitFor();
  await page.getByText('Bilibili Video Research 已重载', { exact: true }).waitFor();
  await page.getByText('Bilibili Video Research 已重载', { exact: true }).waitFor({ state: 'hidden' });
  checks.push('full success forms the green ring and dismisses its toast automatically');
  await status.click();
  await shot('desktop-light.png');
  await page.keyboard.press('Escape');

  for (const width of [680, 390]) {
    await page.setViewportSize({ width, height: 840 });
    const sidebar = page.getByRole('button', { name: '切换侧栏', exact: true });
    if (await sidebar.getAttribute('aria-expanded') === 'true') await sidebar.click();
    await status.scrollIntoViewIfNeeded();
    await status.click();
    const fits = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
        && element.scrollWidth <= element.clientWidth + 1;
    });
    assert.equal(fits, true);
    await shot(`narrow-${width}.png`);
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await status.click();
  assert.equal(await dialog.locator('.lc-ring-base').first().evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  checks.push('light and narrow layouts fit; reduced-motion mode disables ring transitions');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.getByRole('button', { name: '更新 Bilibili Video Research 至 v2.0.0', exact: true }).click();
  await page.getByRole('button', { name: '重启相关会话并更新', exact: true }).click();
  await page.getByText('2/2 已恢复', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await status.waitFor({ state: 'hidden' });
  checks.push('installing a new package invalidates the old green result');

  const failureURL = new URL(url);
  failureURL.searchParams.set('reloadOutcome', 'failure');
  await page.goto(failureURL.href);
  await trigger.click();
  await page.getByText('Bilibili Video Research 有 2 个实例重载失败', { exact: true }).waitFor();
  assert.equal(await status.getAttribute('aria-description'), '0/2 已加载，2 个失败');
  await status.click();
  await dialog.getByText('0/2 已加载，2 个失败', { exact: true }).waitFor();
  checks.push('failed instances are explicit on the collapsed control and in the one-time notice');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ scope: 'Production UI with mocked IPC', checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally { await browser.close(); }
