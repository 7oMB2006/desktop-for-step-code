import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const cacheDir = await mkdtemp(join(tmpdir(), 'dfsc-plugin-center-vite-'));
const server = process.env.DESKTOP_PREVIEW_URL ? undefined : await createServer({
  cacheDir,
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn',
});
await server?.listen();
const base = process.env.DESKTOP_PREVIEW_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`;
const output = process.env.DESKTOP_PREVIEW_OUTPUT ?? 'test-results/plugin-center-live';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
function focusClips(element) {
  const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
  const extent = Math.max(0, parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset));
  const clips = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (rect.left - extent < box.left + parent.clientLeft - 1
      || rect.right + extent > box.left + parent.clientLeft + parent.clientWidth + 1)) clips.push(`${parent.className}:x`);
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (rect.top - extent < box.top + parent.clientTop - 1
      || rect.bottom + extent > box.top + parent.clientTop + parent.clientHeight + 1)) clips.push(`${parent.className}:y`);
  }
  return clips;
}
try {
  const race = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  try {
    await race.goto(`${base}/tests/fixtures/plugin-center-live.html`);
    await race.getByRole('tab', { name: /^已安装/ }).waitFor();
    await race.locator('.cap-preparation > summary').click();
    await race.evaluate(() => window.pluginCenterTest.holdPreparationRefresh());
    await race.getByRole('button', { name: '安装并准备', exact: true }).click();
    await race.waitForFunction(() => window.pluginCenterTest.counts().preparationRefreshes === 1);
    await race.getByRole('button', { name: '配置 Bilibili Video Research', exact: true }).click();
    const runtime = race.getByLabel('BVR 运行目录', { exact: true });
    await runtime.fill('D:\\Unsaved\\BVR');
    await race.getByRole('tab', { name: '使用说明', exact: true }).click();
    const before = await race.evaluate(() => window.pluginCenterTest.counts().catalogReads);
    await race.evaluate(() => window.pluginCenterTest.releasePreparationRefresh());
    await race.waitForFunction(before => window.pluginCenterTest.counts().catalogReads > before, before);
    await race.waitForTimeout(100);
    assert.equal(await race.getByRole('heading', { name: 'Bilibili Video Research', exact: true, level: 2 }).count(), 1,
      'Late StepPage completion must not navigate away from the current plugin');
    assert.equal(await race.getByRole('tab', { name: '使用说明', exact: true }).getAttribute('aria-selected'), 'true',
      'Late StepPage completion must not change the current detail tab');
    await race.getByRole('tab', { name: '配置', exact: true }).click();
    assert.equal(await runtime.inputValue(), 'D:\\Unsaved\\BVR', 'Late StepPage completion preserves the current form instance and draft');
    assert.equal(await race.locator('dialog[open]').count(), 0);
    await race.getByRole('button', { name: '全部插件', exact: true }).click();
    await race.getByRole('dialog').waitFor();
    await race.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await runtime.inputValue(), 'D:\\Unsaved\\BVR', 'Discard protection remains active');
    await race.getByRole('button', { name: '全部插件', exact: true }).click();
    await race.getByRole('button', { name: '确认', exact: true }).click();
    await race.getByRole('button', { name: '配置 StepPage', exact: true }).click();
    assert.match(await race.locator('.pc-save-state').innerText(), /已保存.*重启/);
    assert.deepEqual(await race.evaluate(() => {
      const { saves, restarts } = window.pluginCenterTest.counts(); return { saves, restarts };
    }), { saves: 0, restarts: 0 }, 'Preparation refresh must not save the unrelated draft or restart automatically');
    console.log('Late StepPage preparation preserves navigation and the BVR draft while refreshing the catalog.');
  } finally { await race.close(); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/tests/fixtures/plugin-center-live.html`);
  const center = page.locator('.plugin-center');
  const open = () => page.getByRole('button', { name: '配置 Bilibili Video Research', exact: true }).click();
  await page.getByRole('tab', { name: /^已安装/ }).waitFor();
  async function verifyIconSizes(selector, size) {
    const icons = await page.locator(selector).evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      const media = element.querySelector('img,svg'), image = media instanceof HTMLImageElement;
      const bounds = media.getBoundingClientRect();
      return { kind: element.dataset.iconKind, width: box.width, height: box.height,
        basis: getComputedStyle(element).flexBasis, mediaWidth: bounds.width, mediaHeight: bounds.height,
        loaded: !image || media.complete && media.naturalWidth > 0, fit: getComputedStyle(media).objectFit };
    }));
    assert.ok(icons.length > 0);
    for (const icon of icons) {
      assert.equal(icon.width, size, 'Logo width must not shrink in flex layouts');
      assert.equal(icon.height, size);
      assert.equal(icon.basis, `${size}px`);
      assert.ok(icon.loaded, 'PNG logos must load');
      const mediaSize = icon.kind === 'png' ? size : size * 2 / 3;
      assert.ok(Math.abs(icon.mediaWidth - mediaSize) < .1, 'Actual logo media must scale with its wrapper');
      assert.ok(Math.abs(icon.mediaHeight - mediaSize) < .1);
      if (icon.kind === 'png') assert.equal(icon.fit, 'contain', 'Wide logos must not be cropped');
    }
    return icons;
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.pluginCenterTest.theme(theme), theme);
    for (const [width, height] of [[1440, 980], [900, 740], [640, 720], [390, 760]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(280);
      const icons = await verifyIconSizes('.pc-card-heading .cap-plugin-icon', width <= 740 ? 64 : 72);
      assert.deepEqual(icons.map(icon => icon.kind), ['png', 'step', 'fallback', 'fallback']);
      const overflow = await page.locator('.pc-plugin-row,.pc-card-heading').evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className));
      assert.deepEqual(overflow, [], `${theme}/${width}: logo and long-name layout`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('.pc-card-settings svg').first().evaluate(element => element.getBoundingClientRect().width), 16);
      await page.screenshot({ path: `${output}/${theme}-${width}-catalog.png` });
      await open();
      await page.waitForTimeout(280);
      await verifyIconSizes('.pc-plugin-identity .cap-plugin-icon', width <= 740 ? 64 : 80);
      await page.screenshot({ path: `${output}/${theme}-${width}-identity.png` });
      await page.getByRole('tab', { name: '使用说明', exact: true }).click();
      await center.locator('.pc-document-markdown table:visible').waitFor();
      const tutorial = page.getByRole('link').filter({ hasText: '让 Agent 帮你研究视频' });
      assert.equal(await tutorial.getAttribute('href'), 'https://www.bilibili.com/video/BV1dPeP6REwM/');
      assert.equal(await tutorial.getAttribute('target'), '_blank');
      assert.equal(await tutorial.getAttribute('rel'), 'noopener noreferrer');
      assert.equal(await center.locator('.pc-document-markdown table:visible').count(), 1);
      assert.equal(await center.locator('.pc-document-credits').getByText('DFSC 社区', { exact: true }).count(), 1);
      assert.equal(await center.locator('.pc-repository .pc-stars').getAttribute('title'), 'GitHub Stars：18，查询于 2026-11-04');
      assert.equal(await center.locator('.pc-detail-footer:visible').count(), 0);
      await page.locator('.pc-detail-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.waitForTimeout(280);
      const documentationOverflow = await page.locator('.pc-detail,.pc-plugin-header,.pc-tutorial,.pc-documentation,.pc-document-credits').evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className));
      assert.deepEqual(documentationOverflow, [], `${theme}/${width}: documentation layout`);
      await page.screenshot({ path: `${output}/${theme}-${width}-guide.png` });
      await tutorial.focus();
      assert.equal(await tutorial.evaluate(element => {
        const rect = element.getBoundingClientRect(), parent = element.closest('.pc-detail-scroll').getBoundingClientRect();
        const style = getComputedStyle(element), extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        return rect.left - extent >= parent.left && rect.right + extent <= parent.right
          && rect.top - extent >= parent.top && rect.bottom + extent <= parent.bottom;
      }), true, `${theme}/${width}: tutorial focus outline`);
      await page.getByRole('tab', { name: '更新记录', exact: true }).click();
      assert.equal(await center.locator('.pc-document-markdown:visible').count(), 1);
      await page.screenshot({ path: `${output}/${theme}-${width}-changelog.png` });
      await page.getByRole('button', { name: '全部插件', exact: true }).click();
    }
  }
  const cards = page.locator('.pc-plugin-row');
  assert.equal(await cards.nth(0).locator('.pc-stars').count(), 1);
  assert.equal(await cards.nth(1).locator('.pc-stars').count(), 0, 'Unknown stars are hidden, not shown as zero');
  await page.getByRole('button', { name: '查看 Playwright 使用说明', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: '使用说明', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('tab', { name: '更新记录', exact: true }).count(), 0, 'Do not invent a changelog');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('button', { name: '查看 Bilibili Video Research 使用说明', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: '使用说明', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.evaluate(() => window.pluginCenterTest.theme('light'));
  const service = page.getByRole('switch', { name: '启用 Bilibili Video Research 服务', exact: true });
  assert.equal(await service.getAttribute('aria-checked'), 'true');
  assert.equal(await service.getAttribute('data-tooltip'), null);
  await service.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="启用 Bilibili Video Research 服务"]')?.getAttribute('aria-checked') === 'false');
  await service.click();
  const github = page.getByRole('link', { name: '打开 Bilibili Video Research GitHub 项目', exact: true });
  assert.equal(await github.getAttribute('href'), 'https://github.com/7oMB2006/Bilibili-Video-Research');
  assert.equal(await github.getAttribute('target'), '_blank');
  await open();
  await page.getByRole('button', { name: '独立配置', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('fixture-main-key');
  await page.getByLabel('ASR API Key', { exact: true }).fill('fixture-asr-key');
  await page.getByLabel('接口地址', { exact: true }).fill('https://api.stepfun.com/v1');
  await page.getByLabel('ASR 接口地址', { exact: true }).fill('https://api.stepfun.ai/step_plan/v1');
  await page.getByLabel('语音识别模型', { exact: true }).fill('separate-asr-model');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByLabel('ASR API Key', { exact: true }).inputValue(), 'fixture-asr-key');
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  assert.equal(await page.getByLabel('会话草稿').inputValue(), '保留会话草稿');
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  assert.equal(await page.getByLabel('ASR API Key', { exact: true }).inputValue(), 'fixture-asr-key', 'Main navigation preserves configuration drafts');
  await page.getByRole('tab', { name: '能力', exact: true }).click();
  await page.getByRole('tab', { name: '使用说明', exact: true }).click();
  assert.equal(await center.locator('.pc-detail-footer:visible').count(), 1, 'Document browsing retains unsaved draft status');
  await page.getByRole('tab', { name: '配置', exact: true }).click();
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), 'fixture-main-key', 'Detail tabs preserve drafts');
  await page.getByRole('button', { name: '选择BVR 运行目录', exact: true }).click();
  assert.equal(await page.getByLabel('BVR 运行目录', { exact: true }).inputValue(), 'D:\\Chosen\\BVR');
  await page.getByRole('button', { name: '检查环境', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Node.js/ }).waitFor();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.waitForFunction(() => window.pluginCenterTest.counts().saves === 1);
  await page.waitForFunction(() => document.querySelector('.pc-secret input')?.value === '');
  const saved = await page.evaluate(() => window.pluginCenterTest.configuration());
  assert.equal(saved.asrApiBase, 'https://api.stepfun.ai/step_plan/v1');
  assert.equal(saved.asrModel, 'separate-asr-model');
  assert.doesNotMatch(JSON.stringify(saved), /fixture-main-key|fixture-asr-key/);
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  assert.equal(await page.evaluate(() => window.pluginCenterTest.counts().restarts), 1);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.pluginCenterTest.theme(theme), theme);
    for (const [width, height] of [[1440, 980], [640, 720], [390, 760]]) {
      await page.setViewportSize({ width, height });
      await page.locator('.pc-detail-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.waitForTimeout(280);
      await page.screenshot({ path: `${output}/${theme}-${width}-connections.png` });
      await page.locator('.pc-disclosure > summary').click();
      await page.waitForTimeout(280);
      const fields = center.locator('input:visible');
      for (const field of await fields.all()) {
        await field.evaluate(element => element.scrollIntoView({ block: 'center' }));
        await field.focus();
        const clips = await field.evaluate(focusClips);
        assert.deepEqual(clips, [], `${theme}/${width}: focus outline`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const overflow = await center.locator('.pc-detail,.pc-plugin-header,.pc-mode,.pc-api-services,.pc-detail-footer').evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className));
      assert.deepEqual(overflow, []);
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
      await page.locator('.pc-disclosure > summary').click();
      await page.waitForTimeout(280);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.pc-disclosure > summary').click();
  assert.equal(await page.locator('.pc-disclosure .cap-disclosure-body').evaluate(element => element.getAnimations().length), 0);
  await page.getByLabel('语音识别模型', { exact: true }).fill('stale-change');
  await page.evaluate(() => window.pluginCenterTest.stale());
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /配置已被其他操作更改/ }).waitFor();
  assert.equal(await page.getByLabel('语音识别模型', { exact: true }).inputValue(), 'stale-change');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('tab', { name: '发现', exact: true }).click();
  await page.getByRole('button', { name: '配置 DFSC Configuration Example', exact: true }).click();
  await page.getByLabel('Prefix', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Prefix', { exact: true }).inputValue(), 'Note: ',
    'Installed plugin settings use the installation reference even when opened from Discover');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByRole('tab', { name: /^已安装/ }).click();
  await page.evaluate(() => window.pluginCenterTest.exampleFields());
  await page.getByRole('button', { name: '配置 DFSC Configuration Example', exact: true }).click();
  await page.getByLabel('Prefix', { exact: true }).fill('Review ');
  await page.getByRole('tab', { name: '使用说明', exact: true }).click();
  await page.getByRole('button', { name: 'the consumer contract', exact: true }).click();
  await page.getByRole('heading', { name: 'json-file-v1', exact: true }).waitFor();
  await page.getByRole('button', { name: '返回上一页', exact: true }).click();
  await page.getByRole('heading', { name: 'DFSC Configuration Example', exact: true, level: 2 }).waitFor();
  await page.getByRole('tab', { name: '配置', exact: true }).click();
  assert.equal(await page.getByLabel('Prefix', { exact: true }).inputValue(), 'Review ');
  await page.locator('.pc-generic-form .cap-disclosure > summary').click();
  await page.getByRole('button', { name: '选择Source file', exact: true }).click();
  assert.equal(await page.getByLabel('Source file', { exact: true }).inputValue(), 'D:\\Chosen\\Example');
  await page.getByLabel('Example secret', { exact: true }).fill('fixture-generic-secret');
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Short', exact: true }).click();
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => window.pluginCenterTest.exampleFailure());
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Example secret', { exact: true }).inputValue(), 'fixture-generic-secret');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.waitForFunction(() => window.pluginCenterTest.exampleConfiguration().configured);
  assert.equal(await page.getByLabel('Example secret', { exact: true }).inputValue(), '');
  const generic = await page.evaluate(() => window.pluginCenterTest.exampleConfiguration());
  assert.equal(generic.values.prefix, 'Review '); assert.equal(generic.values.style, 'short');
  assert.equal(generic.hasSecret.key, true); assert.doesNotMatch(JSON.stringify(generic), /fixture-generic-secret/);
  await page.getByLabel('Prefix', { exact: true }).fill('Unsaved conflict');
  await page.evaluate(() => window.pluginCenterTest.exampleStale());
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Prefix', { exact: true }).inputValue(), 'Unsaved conflict');
  await page.getByRole('button', { name: '重新载入配置', exact: true }).click();
  await page.getByRole('button', { name: '丢弃并载入', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pc-generic-form input')?.value === 'Review ');
  await page.screenshot({ path: `${output}/generic-settings.png` });
  const disclosure = page.locator('.pc-generic-form .cap-disclosure');
  if (!await disclosure.evaluate(element => element.open)) await disclosure.locator(':scope > summary').click();
  assert.equal(await disclosure.locator('.cap-disclosure-body').evaluate(element => element.getAnimations().length), 0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.pluginCenterTest.theme(theme), theme);
    for (const [width, height] of [[1440, 980], [640, 720], [390, 760]]) {
      await page.setViewportSize({ width, height });
      for (const control of await page.locator('.pc-generic-form input:visible,.pc-generic-form button:visible').all()) {
        await control.evaluate(element => element.scrollIntoView({ block: 'center' }));
        await control.focus();
        assert.deepEqual(await control.evaluate(focusClips), [], `${theme}/${width}: generic focus outline`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(await page.locator('.pc-generic-form,.pc-generic-fields,.pc-detail-footer').evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), []);
      await page.locator('.pc-detail-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: `${output}/${theme}-${width}-generic.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('Production PluginCenter browser acceptance passed.');
} finally { await browser.close(); await server?.close(); await rm(cacheDir, { recursive: true, force: true }); }
