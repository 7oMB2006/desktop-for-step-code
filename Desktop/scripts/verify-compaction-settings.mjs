import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = resolve(process.env.DESKTOP_COMPACTION_EVIDENCE ?? 'test-results/compaction-settings');
await mkdir(output, { recursive: true });
let server, browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `${server.resolvedUrls.local[0]}tests/fixtures/compaction-settings.html`;
  const ratio = () => page.getByRole('spinbutton', { name: '触发比例百分比', exact: true });
  const saved = () => page.locator('.compaction-save-status').filter({ hasText: /已保存|Saved\./u }).waitFor();
  await page.goto(base);
  await ratio().waitFor();
  assert.equal(await ratio().inputValue(), '90');
  assert.equal(await page.locator('.compaction-advanced').getAttribute('open'), null);
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  await saved();
  assert.equal(await ratio().inputValue(), '91');
  assert.equal(await page.getByRole('slider').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('ArrowLeft'); await saved();
  assert.equal(await ratio().inputValue(), '90');
  await ratio().fill('99'); await ratio().press('Enter'); await saved();
  assert.equal(await ratio().inputValue(), '95');
  await page.locator('.compaction-advanced summary').click();
  await page.waitForTimeout(280);
  assert.equal(await page.locator('.compaction-advanced > div').getAttribute('inert'), null);
  await page.getByRole('checkbox', { name: '同时限制 Token 数量', exact: true }).check(); await saved();
  const cap = page.getByRole('spinbutton', { name: '全局 Token 上限', exact: true });
  await cap.fill('64000'); await cap.press('Enter'); await saved();
  await page.getByRole('combobox', { name: 'step/step-5-preview 设置来源', exact: true }).selectOption('custom'); await saved();
  const override = page.getByRole('spinbutton', { name: 'step/step-5-preview 触发比例', exact: true });
  await override.fill('75'); await override.press('Enter'); await saved();
  await ratio().fill('85'); await ratio().press('Enter'); await saved();
  assert.equal(await override.inputValue(), '75');
  await page.getByRole('combobox', { name: '添加模型设置', exact: true }).selectOption('step/step-4');
  assert.equal(await page.locator('[data-model="step/step-4"] .compaction-model-inherited').innerText(), '85%');
  await page.getByRole('combobox', { name: '会话排序', exact: true }).selectOption('updated');
  await page.getByRole('button', { name: '恢复上下文整理默认值', exact: true }).click(); await saved();
  assert.equal(await ratio().inputValue(), '90');
  assert.equal(await page.getByRole('combobox', { name: '会话排序', exact: true }).inputValue(), 'updated');
  assert.equal(await page.getByRole('checkbox', { name: '同时限制 Token 数量', exact: true }).isChecked(), false);
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await ratio().waitFor();
  assert.equal(await ratio().inputValue(), '90');

  await page.goto(`${base}?saveError=1`);
  await ratio().fill('80'); await ratio().press('Enter');
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  await ratio().fill('90'); await ratio().press('Enter');
  assert.equal(await page.getByRole('slider').inputValue(), '90');
  assert.equal(await page.locator('.compaction-save-status').innerText(), '');

  for (const mode of ['readError', 'saveError', 'conflict', 'legacy', 'disabled']) {
    await page.goto(`${base}?${mode}=1`);
    if (mode === 'readError') {
      await page.getByText('无法读取上下文整理配置。', { exact: true }).waitFor();
      await page.getByRole('button', { name: '重新读取', exact: true }).click();
      await ratio().waitFor();
    } else if (mode === 'legacy') {
      await page.getByRole('button', { name: '使用比例触发策略', exact: true }).click(); await saved();
      assert.equal(await ratio().isDisabled(), false);
    } else if (mode === 'disabled') {
      await page.getByText('自动整理当前已关闭。调整阈值不会将它启用。', { exact: true }).waitFor();
    } else {
      await ratio().fill('80'); await ratio().press('Enter');
      if (mode === 'saveError') {
        await page.getByRole('button', { name: '重试保存', exact: true }).click(); await saved();
        assert.equal(await ratio().inputValue(), '80');
      } else {
        await page.locator('.compaction-save-status').filter({ hasText: '配置已被其他操作更改。请重新读取后再修改。' }).waitFor();
        await page.getByRole('button', { name: '重新读取', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[aria-label="触发比例百分比"]')?.value === '75');
      }
    }
  }
  for (const [width, theme, language] of [[1280, 'light', 'zh'], [900, 'dark', 'en'], [390, 'dark', 'zh'], [390, 'light', 'en'], [320, 'dark', 'en']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}?theme=${theme}&lang=${language}`);
    await page.getByRole('slider').waitFor();
    await page.locator('.compaction-advanced summary').click(); await page.waitForTimeout(280);
    await page.locator('.compaction-limit input[type="checkbox"]').check(); await saved();
    await page.locator('.compaction-model-row select').first().selectOption('custom'); await saved();
    assert.equal(await page.locator('.settings-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    const fields = page.locator('.compaction-settings input, .compaction-settings select, .compaction-settings button, .compaction-settings summary');
    for (const field of await fields.all()) {
      if (!await field.isVisible() || await field.isDisabled()) continue;
      await field.focus();
      const clipped = await field.evaluate(el => {
        const box = el.getBoundingClientRect(), style = getComputedStyle(el);
        const margin = Math.max(4, (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0));
        const extent = { left: box.left - margin, right: box.right + margin, top: box.top - margin, bottom: box.bottom + margin };
        const failures = [];
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const bounds = parent.getBoundingClientRect(), css = getComputedStyle(parent);
          if (/auto|scroll|hidden|clip/.test(css.overflowX) && (extent.left < bounds.left - 1 || extent.right > bounds.right + 1)
            || /auto|scroll|hidden|clip/.test(css.overflowY) && (extent.top < bounds.top - 1 || extent.bottom > bounds.bottom + 1)) failures.push(parent.className);
        }
        if (extent.left < 0 || extent.top < 0 || extent.right > innerWidth || extent.bottom > innerHeight) failures.push('viewport');
        return failures;
      });
      assert.deepEqual(clipped, [], `${width}/${language}: focus outline must remain visible`);
    }
    await page.locator('.settings-content').evaluate(el => { el.scrollTop = 0; });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: resolve(output, `${width}-${theme}-${language}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.compaction-advanced summary').click();
  assert.equal(await page.locator('.compaction-advanced').getAttribute('open'), null);
  assert.equal(await page.locator('.compaction-advanced > div').evaluate(el => el.getAnimations().length), 0);
  assert.deepEqual(errors, []);
  console.log('Compaction settings: persistence boundary, thresholds, model inheritance, reset, errors/conflicts, legacy policy, themes, focus and reduced motion passed.');
} finally {
  await browser?.close();
  await server?.close();
}
