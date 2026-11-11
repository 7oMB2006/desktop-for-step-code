import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Pass an absolute evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser, page;
const results = {}, captures = [];
const focusClips = element => {
  const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
  const margin = Math.max(4, (parseFloat(css.outlineWidth) || 0) + (parseFloat(css.outlineOffset) || 0));
  const extent = { left: rect.left - margin, right: rect.right + margin, top: rect.top - margin, bottom: rect.bottom + margin };
  const clips = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const bounds = parent.getBoundingClientRect(), style = getComputedStyle(parent);
    if (/hidden|clip|auto|scroll/.test(style.overflowX) && (extent.left < bounds.left + parent.clientLeft - 1
      || extent.right > bounds.left + parent.clientLeft + parent.clientWidth + 1)) clips.push(`${parent.className}:x`);
    if (/hidden|clip|auto|scroll/.test(style.overflowY) && (extent.top < bounds.top + parent.clientTop - 1
      || extent.bottom > bounds.top + parent.clientTop + parent.clientHeight + 1)) clips.push(`${parent.className}:y`);
  }
  if (extent.left < 0 || extent.top < 0 || extent.right > innerWidth || extent.bottom > innerHeight) clips.push('viewport');
  return clips;
};
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/custom-background-settings.html`;
  const panel = () => page.getByRole('region', { name: /自定义背景设置|Custom background settings/ });
  const saved = async () => {
    await page.waitForFunction(() => document.querySelector('.custom-background-feedback')?.textContent.includes('已保存')
      || document.querySelector('.custom-background-feedback')?.textContent.includes('Saved'));
  };
  const state = () => page.evaluate(() => window.backgroundFixture.state());
  const counts = () => page.evaluate(() => window.backgroundFixture.counts());
  const imageReady = async () => {
    await panel().locator('.custom-background-preview > img').waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('.custom-background-preview > img');
      return image?.complete && image.naturalWidth > 0;
    });
  };
  const capture = async name => {
    await page.mouse.move(0, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: document overflow`);
    const path = join(output, `${name}.png`); await page.screenshot({ path }); captures.push(path);
  };
  await page.goto(base);
  await panel().waitFor();
  await page.getByRole('checkbox', { name: '启用背景', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '启用背景', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('switch').count(), 0, 'Host visual plugin has no MCP service switch');
  assert.equal(await page.getByRole('button', { name: '重启当前会话', exact: true }).isVisible(), false);
  await page.evaluate(() => window.backgroundFixture.cancelImport());
  await page.getByRole('button', { name: '导入背景图片', exact: true }).click();
  await page.waitForFunction(() => window.backgroundFixture.counts().imports === 1);
  assert.equal((await state()).image, undefined);
  results.canceledImportKeepsState = true;
  await page.getByRole('button', { name: '导入背景图片', exact: true }).click();
  await imageReady(); await saved();
  assert.equal((await state()).options.enabled, true, 'Import enables the custom image');
  assert.equal(await page.getByRole('checkbox', { name: '启用背景', exact: true }).isDisabled(), false,
    'Running an agent does not lock appearance controls');
  results.importWhileAgentBusy = true;

  await page.evaluate(() => window.backgroundFixture.hold());
  const brightness = page.getByRole('slider', { name: '亮度', exact: true });
  await brightness.focus(); await brightness.press('End');
  await page.waitForFunction(() => window.backgroundFixture.counts().saves === 1);
  assert.equal(await page.getByRole('button', { name: '导入背景图片', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '全部插件', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.backgroundFixture.release()); await saved();
  assert.equal((await state()).options.brightness, 120);
  assert.equal(await brightness.evaluate(element => element === document.activeElement), true, 'Save retains slider focus');
  results.serializedSaveAndFocus = true;

  await page.evaluate(() => window.backgroundFixture.fail('save'));
  const zoom = page.getByRole('slider', { name: '缩放', exact: true });
  await zoom.focus(); await zoom.press('End');
  await panel().getByRole('alert').waitFor();
  assert.equal((await state()).options.zoom, 100);
  assert.equal(await zoom.inputValue(), '200', 'Unconfirmed edits remain in the form');
  await page.getByRole('button', { name: '重试保存', exact: true }).click(); await saved();
  assert.equal((await state()).options.zoom, 200);
  results.saveFailureRetainsAdjustment = true;

  const beforeBlocked = await state();
  await page.evaluate(() => window.backgroundFixture.blocked(true));
  await page.getByRole('status').filter({ hasText: '当前主题不接受替换' }).waitFor();
  await page.getByRole('status').filter({ hasText: '由主题管理' }).waitFor();
  for (const control of await panel().locator('.custom-background-surfaces input').all())
    assert.equal(await control.isDisabled(), true, 'Theme-owned materials cannot be overridden');
  assert.deepEqual(await state(), beforeBlocked);
  await page.evaluate(() => window.backgroundFixture.blocked(false));
  await page.getByRole('button', { name: '跟随主题', exact: true }).click(); await saved();
  const disabled = await state();
  assert.equal(disabled.options.enabled, false); assert.deepEqual(disabled.image, beforeBlocked.image);
  await page.getByRole('button', { name: '重置背景调节', exact: true }).click(); await saved();
  assert.deepEqual((await state()).options, { enabled: false, fit: 'cover', positionX: 50, positionY: 50, zoom: 100, brightness: 90, blur: 0, parallax: 0,
    contentTransparency: 30, sidebarTransparency: 20, panelTransparency: 20, composerTransparency: 10, surfaceBlur: 8 });
  for (const [label, key, maximum] of [
    ['对话区透明度', 'contentTransparency', 100], ['左栏透明度', 'sidebarTransparency', 100],
    ['右栏透明度', 'panelTransparency', 100], ['输入框透明度', 'composerTransparency', 100], ['界面毛玻璃', 'surfaceBlur', 24],
  ]) {
    const control = page.getByRole('slider', { name: label, exact: true });
    await control.focus(); await control.press('End'); await saved();
    assert.equal((await state()).options[key], maximum);
    await control.press('Home'); await saved();
    assert.equal((await state()).options[key], 0);
  }
  results.surfaceControlsPersistAtBothEndpoints = true;
  await page.getByRole('checkbox', { name: '启用背景', exact: true }).check(); await saved();
  await page.getByRole('button', { name: '适应', exact: true }).click(); await saved();
  assert.equal((await state()).options.fit, 'contain');
  await page.getByRole('slider', { name: '鼠标视差', exact: true }).press('End'); await saved();
  assert.equal((await state()).options.parallax, 12);
  results.compatibilityRestoreAndReset = true;
  await page.evaluate(() => window.backgroundFixture.external({ brightness: 75 }));
  await page.waitForFunction(() => document.querySelector('[id$="-brightness"]')?.value === '75');
  results.externalStateRefreshesForm = true;

  await page.evaluate(() => window.backgroundFixture.fail('import'));
  const beforeInvalid = await state();
  await page.getByRole('button', { name: '导入背景图片', exact: true }).click();
  await panel().getByRole('alert').waitFor();
  assert.deepEqual(await state(), beforeInvalid);
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await imageReady();
  results.invalidImportKeepsImage = true;
  await page.getByRole('button', { name: '删除背景图片', exact: true }).click();
  await page.getByRole('dialog', { name: '删除本机背景图片？', exact: true }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal((await counts()).removes, 0);
  assert.equal(await page.getByRole('button', { name: '删除背景图片', exact: true }).evaluate(element => element === document.activeElement), true);
  results.deleteCancelKeepsImage = true;

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, theme, language] of [[1440, 'light', 'zh'], [900, 'dark', 'en'], [390, 'dark', 'zh'], [390, 'light', 'en']]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(({ theme, language }) => { window.backgroundFixture.theme(theme); window.backgroundFixture.language(language); }, { theme, language });
    for (const control of await panel().locator('button,input').all()) {
      if (!await control.isVisible() || await control.isDisabled()) continue;
      await control.focus();
      assert.deepEqual(await control.evaluate(focusClips), [], `${width}/${theme}/${language}: focus outline`);
    }
    await page.locator('.pc-detail-scroll').evaluate(element => { element.scrollTop = 0; });
    await capture(`background-settings-${width}-${theme}-${language}`);
    if (width === 1440) {
      await panel().locator('.custom-background-surfaces').scrollIntoViewIfNeeded();
      await capture('background-settings-materials-light');
    }
    assert.equal(await page.locator('.pc-detail-footer').isVisible(), false);
  }
  results.lightDarkNarrowFocus = true;
  await page.evaluate(() => window.backgroundFixture.language('zh'));
  await page.getByRole('button', { name: '删除背景图片', exact: true }).click();
  await page.getByRole('button', { name: '删除图片', exact: true }).click();
  await saved();
  assert.equal((await state()).image, undefined);
  assert.equal((await state()).options.enabled, false);
  results.explicitDelete = true;
  assert.equal((await counts()).restarts, 0); assert.equal((await counts()).mutations, 0);
  const panelCounts = await counts();
  await page.goto(`${base}?status=1&theme=dark`);
  const status = page.locator('.background-status');
  await status.getByRole('button', { name: '配置', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.backgroundFixture.statusActions()), ['configure']);
  await page.evaluate(() => { window.backgroundFixture.personal(); window.backgroundFixture.blocked(true); });
  await status.getByRole('status').filter({ hasText: '当前主题保留原背景' }).waitFor();
  await status.getByRole('button', { name: '配置', exact: true }).focus();
  assert.deepEqual(await status.getByRole('button').evaluate(focusClips), []);
  await capture('background-status-390-dark-closed');
  await page.evaluate(() => window.backgroundFixture.available(false));
  await status.getByRole('button', { name: '前往插件', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.backgroundFixture.statusActions()), ['configure', 'discover']);
  await page.evaluate(() => window.backgroundFixture.language('en'));
  await status.getByRole('button', { name: 'Open plugin', exact: true }).focus();
  assert.deepEqual(await status.getByRole('button').evaluate(focusClips), []);
  await capture('background-status-390-dark-not-installed');
  results.appearanceEntryStatusAndActions = true;
  await page.goto(`${base}?lifecycle=1&defer=1`);
  await page.waitForFunction(() => window.backgroundFixture?.readCount() === 1);
  await page.evaluate(() => window.backgroundFixture.packageRef('replacement-background'));
  await page.waitForFunction(() => window.backgroundFixture.readCount() === 2);
  assert.equal(await page.evaluate(() => window.backgroundFixture.pendingStates().at(-1)), true);
  await page.evaluate(() => window.backgroundFixture.resolveRead(0));
  assert.equal(await page.getByRole('checkbox', { name: '启用背景', exact: true }).count(), 0,
    'The disposed reference cannot install its response');
  assert.equal(await page.evaluate(() => window.backgroundFixture.pendingStates().at(-1)), true);
  await page.evaluate(() => window.backgroundFixture.resolveRead(0));
  await page.getByRole('button', { name: '导入背景图片', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '导入背景图片', exact: true }).isDisabled(), false);
  await page.evaluate(() => window.backgroundFixture.bridge(true));
  await page.waitForFunction(() => window.backgroundFixture.readCount() === 1);
  await page.evaluate(() => window.backgroundFixture.bridge(false));
  await page.waitForFunction(() => window.backgroundFixture.readCount() === 2);
  assert.equal(await page.evaluate(() => window.backgroundFixture.pendingStates().at(-1)), true);
  await page.evaluate(() => window.backgroundFixture.resolveRead(0));
  assert.equal(await page.getByRole('checkbox', { name: '启用背景', exact: true }).count(), 0,
    'An older bridge response cannot unlock the replacement request');
  assert.equal(await page.evaluate(() => window.backgroundFixture.pendingStates().at(-1)), true);
  await page.evaluate(() => { window.backgroundFixture.deferReads(false); window.backgroundFixture.resolveRead(0); });
  await page.getByRole('button', { name: '导入背景图片', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '导入背景图片', exact: true }).isDisabled(), false);
  await page.waitForFunction(() => window.backgroundFixture.pendingStates().at(-1) === false);
  assert.equal((await counts()).loads, 4);
  results.deferredReferenceAndBridgeChanges = true;
  assert.deepEqual(errors, []);
  const report = { passed: true, results, captures, counts: panelCounts, errors };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await server.close();
}
