import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5207/tests/fixtures/remote-startup-toast.html';
const output = resolve(process.argv[2] ?? 'test-results/remote-startup-toast-preview');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
try {
  for (const variant of [
    { name: 'light', width: 1280, height: 800, theme: 'light' },
    { name: 'dark', width: 1280, height: 800, theme: 'dark' },
    { name: 'narrow', width: 390, height: 844, theme: 'light', reducedMotion: 'reduce' },
    { name: 'external-agent', width: 1280, height: 800, theme: 'light', source: 'external-agent' },
    { name: 'feishu-session', width: 1280, height: 800, theme: 'dark', source: 'feishu-session' },
  ]) {
    const page = await browser.newPage({ viewport: variant, reducedMotion: variant.reducedMotion });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}?auto=0&theme=${variant.theme}&source=${variant.source ?? 'feishu-recovery'}`);
    const row = id => page.locator(`[data-reorder-id="${id}"] > button`).first();
    await row('login').waitFor({ state: 'attached' });
    // At phone width, open the app's real collapsed navigation.
    if (!await row('login').isVisible()) {
      await page.locator('.window-bar button').first().click();
    }
    await row('login').click();
    assert.equal(await page.locator('.remote-navigation-hint').count(), 0, 'No instant hint');
    const hint = page.locator('.remote-navigation-hint');
    const anchor = page.locator('.remote-entry');
    await hint.waitFor({ state: 'visible' });
    assert.match(await hint.innerText(), variant.source === 'external-agent' ? /正在准备外部 Agent 任务/
      : variant.source === 'feishu-session' ? /正在准备飞书会话/ : /正在恢复飞书会话/);
    assert.equal(await page.locator('.notice-toast').count(), 0, 'No global toast');
    if (variant.name !== 'narrow') {
      await row('usage').click();
      await row('theme').click();
      await page.evaluate(() => window.remoteNavigationPreview.emit({ type: 'desktop_navigation_wait', requestId: 1 }));
    }
    assert.equal(await hint.count(), 1, 'Only one hint after repeated selections');
    assert.match(await hint.innerText(), variant.name === 'narrow' ? /修复登录刷新/ : /调整主题色/);
    const bounds = await hint.boundingBox();
    const trigger = await anchor.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= variant.width, 'Hint fits viewport');
    assert.ok(trigger && Math.abs(bounds.x + 16 - trigger.x - trigger.width / 2) <= 8, 'Tail points to Remote');
    assert.ok(bounds.y + bounds.height <= trigger.y && trigger.y - bounds.y - bounds.height <= 22, 'Hint stays near Remote');
    assert.equal(await page.locator('img').evaluateAll(images =>
      images.filter(image => !image.complete || image.naturalWidth === 0).length), 0, 'All images render');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow');
    if (variant.reducedMotion) {
      assert.equal(await hint.locator('svg').first().evaluate(element =>
        getComputedStyle(element).animationName), 'none', 'Reduced motion disables spinner rotation');
    }
    await page.locator('.session-navigation-spinner').waitFor({ state: 'visible' });
    await page.screenshot({ path: resolve(output, `${variant.name}-anchored.png`) });
    if (variant.name === 'dark') {
      await page.locator('.sidebar-settings').click();
      await page.locator('.settings-dialog').waitFor({ state: 'visible' });
      assert.equal(await hint.isVisible(), false, 'Settings hides the local hint');
      await page.screenshot({ path: resolve(output, 'dark-settings.png') });
      await page.locator('.settings-dialog > header button').click();
      await page.locator('.settings-dialog').waitFor({ state: 'detached' });
      await hint.waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '关闭提示', exact: true }).click();
      await hint.waitFor({ state: 'detached' });
      await row('usage').click();
      await row('theme').click();
      assert.equal(await hint.count(), 0, 'Changing target does not undo dismissal for the same preparation');
      await page.locator('.window-sidebar-toggle').focus();
      await anchor.focus();
      await hint.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await hint.waitFor({ state: 'detached' });
      await page.locator('.window-sidebar-toggle').focus();
      await page.mouse.move(600, 300);
      await anchor.hover();
      await hint.waitFor({ state: 'visible' });
      await hint.hover();
      assert.equal(await hint.isVisible(), true, 'Pointer can move into the bubble');
      await page.mouse.move(600, 300);
      await hint.waitFor({ state: 'detached' });
    }
    if (variant.name === 'narrow') {
      await page.locator('.window-sidebar-toggle').click();
      assert.equal(await hint.isVisible(), false, 'Collapsed sidebar hides the hint');
      await page.locator('.window-sidebar-toggle').click();
      await hint.waitFor({ state: 'visible' });
    }
    await page.evaluate(() => window.remoteNavigationPreview.release());
    await hint.waitFor({ state: 'detached', timeout: 12000 });
    await page.getByText('好的，我先检查相关实现和已有测试。', { exact: true }).waitFor();
    assert.match(await page.locator('.window-bar').innerText(), variant.name === 'narrow' ? /修复登录刷新/ : /调整主题色/);
    assert.equal(await page.locator('.app-error-banner').count(), 0, 'No error banner');
    await page.screenshot({ path: resolve(output, `${variant.name}-opened.png`) });
    if (variant.name === 'light') {
      await page.getByRole('button', { name: '重新演示', exact: true }).click();
      await page.locator('.remote-navigation-hint').waitFor({ state: 'visible' });
    }
    results.push({ variant: variant.name, passed: true });
    await page.close();
  }
  for (const control of [{ name: 'quick', query: 'delay=150' }, { name: 'ordinary-slow', query: 'block=0' }]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}?auto=0&${control.query}`);
    await page.locator('[data-reorder-id="login"] > button').first().click();
    await page.waitForTimeout(1300);
    assert.equal(await page.locator('.remote-navigation-hint').count(), 0, 'No hint without a long confirmed Remote blocker');
    await page.evaluate(() => window.remoteNavigationPreview.release());
    await page.getByText('好的，我先检查相关实现和已有测试。', { exact: true }).waitFor();
    results.push({ variant: control.name, passed: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors, output }, null, 2));
} finally {
  await browser.close();
}
