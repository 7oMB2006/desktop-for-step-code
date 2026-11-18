import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5187/tool-status-preview.html';
const output = resolve(process.argv[3] ?? 'test-results/tool-status-web');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const state = page.getByRole('combobox', { name: '工具状态', exact: true });
  const panel = page.locator('.runtime-startup-status');
  await page.locator('.pc-plugin-row').first().waitFor();
  assert.equal(await page.locator('.pc-plugin-row').count(), 3);
  assert.equal(await panel.locator('summary').getAttribute('aria-expanded'), 'false');
  await page.screenshot({ path: join(output, 'desktop-collapsed.png') });
  await panel.locator('summary').click();
  await panel.locator('ul').waitFor({ state: 'visible' });
  assert.ok(await page.evaluate(() => {
    const dot = document.querySelector('.sidebar-plugins-dot');
    if (!dot) return false;
    const expected = getComputedStyle(dot).backgroundColor;
    const labels = document.querySelectorAll(
      '.runtime-startup-status [role="status"], .runtime-startup-status li[data-attention="true"] > span:nth-child(2), .pc-status-unavailable',
    );
    return labels.length === 3 && [...labels].every(label => getComputedStyle(label).color === expected);
  }), 'Unavailable labels match the Plugins attention dot');
  await page.waitForFunction(() => !document.querySelector('.runtime-startup-status .cap-disclosure-body')?.getAnimations().length);
  await page.screenshot({ path: join(output, 'desktop-expanded.png') });
  await page.getByRole('button', { name: 'MCP 设置', exact: true }).click();
  await page.getByRole('dialog', { name: 'MCP 设置' }).waitFor();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '重新连接运行时' }).click();
  await panel.waitFor({ state: 'detached' });
  assert.equal(await state.inputValue(), 'ready');
  for (const mode of ['connecting', 'cleanup', 'discovery', 'failed']) {
    await state.selectOption(mode);
    await panel.waitFor();
    assert.equal(await panel.locator('summary').getAttribute('aria-expanded'), 'false');
  }
  await page.getByRole('button', { name: '切换浅色' }).click();
  await page.screenshot({ path: join(output, 'desktop-light.png') });
  await page.getByRole('button', { name: '插件联调记录', exact: true }).click();
  const transcript = page.locator('.web-preview-messages');
  await transcript.waitFor();
  const before = await transcript.boundingBox();
  await state.selectOption('connecting');
  assert.deepEqual(await transcript.boundingBox(), before);
  await state.selectOption('failed');
  assert.deepEqual(await transcript.boundingBox(), before);
  assert.equal(await panel.count(), 0);
  await page.screenshot({ path: join(output, 'conversation.png') });
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  await page.getByRole('button', { name: '查看 Bilibili Video Research 使用说明' }).click();
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  const occupancy = page.getByRole('combobox', { name: '会话占用', exact: true });
  const uninstall = () => page.getByRole('button', { name: '卸载 Bilibili Video Research', exact: true });
  const removal = page.getByRole('dialog', { name: '卸载插件', exact: true });
  const settle = async dialog => dialog.evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  await uninstall().click();
  await removal.waitFor();
  assert.equal(await removal.locator('.pc-update-sessions li').count(), 2);
  await settle(removal);
  await page.screenshot({ path: join(output, 'uninstall-idle.png') });
  await removal.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '切换深色', exact: true }).click();
  await uninstall().click();
  await settle(removal);
  await page.screenshot({ path: join(output, 'uninstall-dark.png') });
  await removal.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '切换浅色', exact: true }).click();
  assert.equal(await page.locator('.pc-plugin-row').count(), 3);
  for (const mode of ['busy', 'unknown']) {
    await occupancy.selectOption(mode);
    await uninstall().click();
    await removal.waitFor();
    assert.equal(await removal.getByRole('button', { name: '释放占用并卸载', exact: true }).count(), 0);
    await settle(removal);
    await page.screenshot({ path: join(output, `uninstall-${mode}.png`) });
    if (mode === 'busy') {
      await removal.getByRole('button', { name: '查看会话 每周资料整理', exact: true }).click();
      await page.getByText('每周资料整理', { exact: true }).waitFor();
      await page.getByRole('button', { name: '插件市场', exact: true }).click();
    } else await removal.getByRole('button', { name: '取消', exact: true }).click();
  }
  await occupancy.selectOption('idle');
  await page.getByRole('button', { name: '更新 Bilibili Video Research 至 v2.0.0', exact: true }).click();
  const update = page.getByRole('dialog', { name: '插件更新', exact: true });
  await update.waitFor();
  await update.getByRole('button', { name: '重启相关会话并更新', exact: true }).click();
  await update.getByText('新版已安装', { exact: true }).waitFor();
  await update.getByRole('button', { name: '关闭', exact: true }).click();
  await uninstall().click();
  await removal.getByRole('button', { name: '释放占用并卸载', exact: true }).click();
  await removal.getByText('插件已卸载', { exact: true }).waitFor();
  assert.equal(await page.locator('.pc-plugin-row').count(), 2);
  assert.equal(await removal.getByText('已恢复', { exact: true }).count(), 2);
  await removal.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '重置预览', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pc-plugin-row').length === 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await page.screenshot({ path: join(output, 'narrow-collapsed.png') });
  await panel.locator('summary').click();
  await panel.locator('ul').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.runtime-startup-status .cap-disclosure-body')?.getAnimations().length);
  await page.screenshot({ path: join(output, 'narrow-expanded.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow');
  assert.ok(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), 'Assets loaded');
  await uninstall().click();
  await removal.waitFor();
  await settle(removal);
  await page.screenshot({ path: join(output, 'narrow-uninstall.png') });
  assert.ok(await removal.evaluate(dialog => dialog.getBoundingClientRect().right <= innerWidth), 'Removal dialog fits viewport');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ complete: true, url, rendererErrors: errors, output }));
} finally {
  await browser.close();
}
