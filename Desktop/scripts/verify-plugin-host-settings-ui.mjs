import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { mkdtemp, removeTestProfile } from './test-profile.mjs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const cacheDir = await mkdtemp(join(tmpdir(), 'dfsc-host-settings-vite-'));
const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const output = 'test-results/plugin-host-settings-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', error => errors.push(error.message));
function focusClips(element) {
  const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
  const extent = Math.max(4, parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset));
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
  await page.goto(`${base}/tests/fixtures/plugin-center-live.html?host=1`);
  await page.getByRole('button', { name: '配置 宿主模型示例', exact: true }).click();
  const form = page.locator('.pc-host-form');
  await form.getByRole('group', { name: '连接来源', exact: true }).waitFor();
  assert.equal(await form.locator('.pc-mode [aria-checked=true]').count(), 0, 'Installation is not a saved choice');
  const save = page.getByRole('button', { name: '保存配置', exact: true });
  const source = label => form.getByRole('button', { name: `${label} · 调用来源`, exact: true });
  const model = label => form.getByRole('button', { name: `${label} · 模型`, exact: true });
  const plan = form.getByRole('switch', { name: '使用我的 Step Plan 额度', exact: true });
  const api = form.getByRole('switch', { name: '开放平台 API（按量计费）', exact: true });
  const independent = form.getByRole('switch', { name: '独立配置', exact: true });
  const pick = async (picker, name) => {
    await picker.click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
  };
  const bind = async (label, channel, id) => {
    await pick(source(label), channel);
    await pick(model(label), id);
  };
  assert.equal(await save.isDisabled(), true);
  assert.equal(await api.isDisabled(), true, 'A Plan account is not a metered account');
  await plan.focus();
  await plan.press('Space');
  assert.deepEqual(await plan.evaluate(focusClips), [], 'The source switch has a complete focus gutter');
  assert.equal(await independent.isDisabled(), true, 'The existing v1 consumer has only one launch mode');
  const tts = model('语音合成');
  assert.equal(await tts.isDisabled(), true);
  await pick(source('语音合成'), 'Step Plan');
  await form.getByRole('status').filter({ hasText: '请为已选来源的能力补选模型' }).waitFor();
  await save.and(page.locator(':disabled')).waitFor();
  await tts.click();
  assert.equal(await page.getByRole('menuitemradio', { name: /stepaudio-3-tts.*当前渠道未确认支持/ }).isDisabled(), true);
  await page.getByRole('menuitemradio', { name: 'stepaudio-2.5-tts', exact: true }).click();
  await bind('文本', 'Step Plan', 'step-5-preview');
  await bind('视频理解', 'Step Plan', 'step-5-preview');
  await bind('图片理解', 'Step Plan', 'step-5-preview');
  await bind('语音识别', 'Step Plan', 'stepaudio-2.5-asr');
  assert.match(await tts.innerText(), /stepaudio-2\.5-tts/);
  await page.screenshot({ path: `${output}/follow-unsaved.png` });
  await save.click();
  await page.waitForFunction(() => window.pluginHostTest.snapshot().value.mode === 'account');
  assert.equal((await page.evaluate(() => window.pluginHostTest.snapshot())).value.models['model.tts'], 'stepaudio-2.5-tts');
  await form.getByRole('status').filter({ hasText: '待重启会话' }).waitFor();
  assert.equal((await page.evaluate(() => window.pluginHostTest.snapshot())).restarts, 0, 'Saving does not restart or approve');
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '当前会话已连接' }).waitFor();
  await form.getByText('Step Plan · 中国大陆 · stepaudio-2.5-tts', { exact: true }).waitFor();
  assert.equal(await form.locator('.pc-host-routes').getByText('图片理解', { exact: true }).count(), 1);
  assert.equal(await form.getByText('首次调用需确认', { exact: true }).count(), 5);
  assert.equal(await form.getByText('不可用', { exact: true }).count(), 0);
  await page.evaluate(() => window.pluginHostTest.approve());
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pc-host-approved').length === 5);
  await page.screenshot({ path: `${output}/follow-approved.png` });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.pluginCenterTest.theme(theme), theme);
    for (const width of [1360, 740, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await tts.focus(); await tts.scrollIntoViewIfNeeded();
      assert.deepEqual(await tts.evaluate(focusClips), [], `${theme}/${width}: complete TTS selector focus ring`);
      await tts.click();
      const menu = page.getByRole('menu', { name: '语音合成 · 模型', exact: true });
      await menu.waitFor();
      await menu.evaluate(async element => {
        await new Promise(requestAnimationFrame);
        await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
      });
      assert.equal(await menu.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
      }), true, `${theme}/${width}: TTS menu stays in the viewport`);
      await page.screenshot({ path: `${output}/tts-menu-${theme}-${width}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await tts.evaluate(element => element === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.evaluate(() => window.pluginCenterTest.theme('light'));
  await page.evaluate(() => window.pluginHostTest.channel('api'));
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '额度账户已变化' }).waitFor();
  assert.match(await source('语音合成').innerText(), /Step Plan/);
  assert.equal(await save.isDisabled(), true);
  await plan.click();
  await save.click();
  await form.getByRole('status').filter({ hasText: '模型连接已暂停' }).waitFor();
  assert.match(await tts.innerText(), /stepaudio-2\.5-tts/);
  assert.equal(await tts.isDisabled(), true);
  assert.equal(await form.locator('.pc-host-approved').count(), 0);
  await api.click();
  assert.match(await source('语音合成').innerText(), /不使用/, 'Changing billing channel cannot reuse a route silently');
  await bind('文本', '开放平台 API', 'step-5-preview');
  await bind('视频理解', '开放平台 API', 'step-5-preview');
  await bind('图片理解', '开放平台 API', 'step-5-preview');
  await bind('语音识别', '开放平台 API', 'stepaudio-2.5-asr');
  await bind('语音合成', '开放平台 API', 'stepaudio-2.5-tts');
  await save.click();
  await form.getByRole('status').filter({ hasText: '待重启会话' }).waitFor();

  const asr = model('语音识别');
  await pick(source('语音识别'), '不使用');
  await tts.click();
  await page.getByRole('menuitemradio', { name: 'step-tts-mini', exact: true }).click();
  const toggle = page.getByRole('switch', { name: '启用 宿主模型示例 服务', exact: true });
  await toggle.click();
  await form.getByRole('status').filter({ hasText: '服务已停用' }).waitFor();
  assert.equal(await form.locator('.pc-host-approved').count(), 0, 'Disabling invalidates approval observations');
  assert.match(await source('语音识别').innerText(), /不使用/, 'Management status refresh retains drafts');
  assert.match(await tts.innerText(), /step-tts-mini/, 'Management status refresh retains the TTS draft');
  await toggle.click();
  await form.getByRole('status').filter({ hasText: '待重启会话' }).waitFor();
  assert.equal(await form.locator('.pc-host-approved').count(), 0, 'Re-enabling does not restore old approval');
  await bind('语音识别', '开放平台 API', 'stepaudio-2.5-asr');
  await tts.click();
  await page.getByRole('menuitemradio', { name: 'stepaudio-2.5-tts', exact: true }).click();
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '当前会话已连接' }).waitFor();
  await page.evaluate(() => window.pluginHostTest.approve());
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pc-host-approved').length === 5);
  await page.evaluate(() => window.pluginHostTest.hold());
  const beforeHeld = (await page.evaluate(() => window.pluginHostTest.snapshot())).reads;
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await page.waitForFunction(reads => window.pluginHostTest.snapshot().reads > reads, beforeHeld);
  await page.evaluate(() => {
    window.pluginHostTest.status('no-session');
    window.pluginHostTest.session('another-runtime');
  });
  await page.waitForFunction(() => document.querySelector('.pc-host-runtime')?.textContent.includes('状态待刷新'));
  await page.evaluate(() => window.pluginHostTest.release());
  await form.getByRole('status').filter({ hasText: '尚无已连接会话' }).waitFor();
  assert.equal(await form.locator('.pc-host-approved').count(), 0, 'Late old-session response cannot restore approval');
  await page.evaluate(() => window.pluginHostTest.failRead());
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await form.getByRole('alert').waitFor();
  const failedReads = (await page.evaluate(() => window.pluginHostTest.snapshot())).reads;
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.pluginHostTest.snapshot())).reads, failedReads, 'Failed observations do not retry-loop');
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '当前会话已连接' }).waitFor();
  await page.evaluate(() => window.pluginHostTest.approve());
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pc-host-approved').length === 5);
  await api.click();
  await independent.click();
  await form.getByLabel('API Key', { exact: true }).fill('preview-private-key');
  await form.getByLabel('模型', { exact: true }).fill('step-independent-model');
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await form.getByLabel('模型', { exact: true }).inputValue(), 'step-independent-model');
  await page.evaluate(() => window.pluginHostTest.fail());
  await save.click();
  await form.getByRole('alert').waitFor();
  await form.getByRole('status').filter({ hasText: '待重启会话' }).waitFor();
  assert.equal(await form.locator('.pc-host-approved').count(), 0, 'Failed commit cannot retain old paid authorization');
  assert.equal(await form.getByLabel('模型', { exact: true }).inputValue(), 'step-independent-model');
  assert.equal(await form.getByLabel('API Key', { exact: true }).inputValue(), 'preview-private-key', 'Failed save preserves the secret draft');
  await save.click();
  await page.waitForFunction(() => window.pluginHostTest.snapshot().value.mode === 'independent');
  await page.waitForFunction(() => document.querySelector('.pc-host-form input[type=password]')?.value === '');
  assert.equal(await form.getByLabel('API Key', { exact: true }).inputValue(), '', 'Saved keys are not loaded into renderer inputs');
  assert.equal(await form.getByLabel('API Key', { exact: true }).getAttribute('placeholder'), '已保存，留空保留');

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.pluginCenterTest.theme(theme), theme);
    for (const width of [1360, 740, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const model = form.getByLabel('模型', { exact: true });
      await model.focus();
      await model.scrollIntoViewIfNeeded();
      assert.deepEqual(await model.evaluate(focusClips), [], `${theme}/${width}: complete model focus ring`);
      const key = form.getByLabel('API Key', { exact: true });
      await key.focus(); await key.scrollIntoViewIfNeeded();
      assert.deepEqual(await key.evaluate(focusClips), [], `${theme}/${width}: complete composite secret focus ring`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(await form.locator('.pc-mode,.pc-host-routes li,.pc-field').evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), []);
      await page.screenshot({ path: `${output}/independent-${theme}-${width}.png` });
    }
  }
  await form.getByText('高级设置', { exact: true }).click();
  await form.locator('.cap-disclosure-body').evaluate(async element => {
    await new Promise(requestAnimationFrame);
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const path = form.getByLabel('工作目录', { exact: true });
  await path.focus(); await path.scrollIntoViewIfNeeded();
  assert.deepEqual(await path.evaluate(focusClips), [], 'Expanded final field focus is not clipped');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await form.getByText('高级设置', { exact: true }).click();
  assert.equal(await form.locator('.cap-disclosure-body').evaluate(element => element.inert), true);
  await independent.click();
  await api.click();
  assert.equal(await form.locator('.pc-entrance').count(), 0);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await form.getByRole('switch', { name: 'Open Platform API (metered)', exact: true }).waitFor();
  assert.equal(await form.getByText('Per-capability request confirmation', { exact: true }).count(), 1);
  const englishTts = form.getByRole('button', { name: 'Speech synthesis · Model', exact: true });
  await englishTts.focus(); await englishTts.scrollIntoViewIfNeeded();
  assert.deepEqual(await englishTts.evaluate(focusClips), [], 'English narrow TTS selector focus');
  await page.screenshot({ path: `${output}/follow-english-narrow.png` });
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await page.waitForFunction(() => window.pluginHostTest.snapshot().value.mode === 'account');
  await form.getByRole('status').filter({ hasText: 'Session restart required' }).waitFor();
  const speech = form.getByRole('button', { name: 'Speech recognition · Model', exact: true });
  const speechSource = form.getByRole('button', { name: 'Speech recognition · Source', exact: true });
  await pick(speechSource, 'Do not use');
  await page.evaluate(() => window.pluginHostTest.stale());
  await form.getByRole('button', { name: 'Refresh host status', exact: true }).click();
  await form.getByRole('alert').waitFor();
  assert.match(await speechSource.innerText(), /Do not use/, 'Status refresh retains the draft');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  assert.match(await form.getByRole('alert').innerText(), /changed elsewhere/);
  await form.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await form.getByRole('button', { name: 'Discard and reload', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pc-host-form button[aria-label="Speech recognition · Model"]')?.textContent.includes('stepaudio-2.5-asr'));
  await speech.focus(); await speech.scrollIntoViewIfNeeded();
  assert.deepEqual(await speech.evaluate(focusClips), [], 'ASR focus retains the shared gutter');
  await form.getByRole('switch', { name: 'Open Platform API (metered)', exact: true }).click();
  await form.getByRole('switch', { name: 'Independent', exact: true }).click();
  await form.getByLabel('模型', { exact: true }).fill('draft-after-commit');
  await page.evaluate(() => window.pluginHostTest.failAfterCommit());
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await form.getByRole('status').filter({ hasText: 'Session restart required' }).waitFor();
  assert.match(await form.getByRole('alert').innerText(), /mode commit could not be confirmed/, 'Automatic status read must not replace the save diagnostic with a revision conflict');
  assert.equal(await form.getByLabel('模型', { exact: true }).inputValue(), 'draft-after-commit');
  await form.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await form.getByRole('button', { name: 'Discard and reload', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.pc-host-form [role=alert]'));
  await page.evaluate(() => window.pluginHostTest.noIndependent());
  await form.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await form.getByLabel('模型', { exact: true }).waitFor({ state: 'detached' });
  const englishIndependent = form.getByRole('switch', { name: 'Independent', exact: true });
  assert.equal(await englishIndependent.getAttribute('aria-checked'), 'true');
  await englishIndependent.click();
  assert.equal(await englishIndependent.isDisabled(), true, 'Missing schema permits stopping, but not re-enabling');
  await page.evaluate(() => window.pluginHostTest.status('unsupported'));
  await form.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await form.getByRole('button', { name: 'Discard and reload', exact: true }).click();
  await form.getByRole('status').filter({ hasText: 'Unsupported host version' }).waitFor();
  assert.equal(await form.getByRole('switch', { name: 'Use my Step Plan quota', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Save configuration', exact: true }).isDisabled(), true);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(`${base}/tests/fixtures/plugin-center-live.html?host=1&routed=1`);
  await page.getByRole('button', { name: '配置 宿主模型示例', exact: true }).click();
  await plan.click();
  await independent.click();
  assert.equal(await plan.getAttribute('aria-checked'), 'true');
  assert.equal(await independent.getAttribute('aria-checked'), 'true');
  assert.equal(await api.isDisabled(), true, 'The other official channel still requires a connected account');
  await bind('文本', 'Step Plan', 'step-5-preview');
  await source('视频理解').click();
  assert.equal(await page.getByRole('menuitemradio', { name: '独立配置', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await pick(source('语音识别'), '独立配置');
  assert.equal(await model('语音识别').isDisabled(), true);
  assert.match(await model('语音识别').innerText(), /由插件配置/);
  await form.getByLabel('API Key', { exact: true }).fill('fixture-only-key');
  await save.click();
  await form.getByRole('status').filter({ hasText: '待重启会话' }).waitFor();
  const routed = (await page.evaluate(() => window.pluginHostTest.snapshot())).value;
  assert.deepEqual(routed.independentCapabilities, ['model.asr']);
  assert.deepEqual(routed.models, { 'model.text': 'step-5-preview' });
  assert.equal(routed.mode, 'routed');
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await form.getByText('插件独立直连', { exact: true }).waitFor();
  assert.equal(await form.getByText('首次调用需确认', { exact: true }).count(), 1);
  assert.equal(await form.locator('.pc-host-route-state').getByText('未启用', { exact: true }).count(), 3);
  await form.locator('.pc-host-source-switches').evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${output}/mixed-desktop.png` });
  await page.evaluate(() => window.pluginCenterTest.theme('dark'));
  await page.setViewportSize({ width: 390, height: 900 });
  const directSource = source('语音识别');
  await directSource.focus();
  await directSource.scrollIntoViewIfNeeded();
  assert.deepEqual(await directSource.evaluate(focusClips), [], 'Mixed source picker retains the narrow dark focus gutter');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mixed-narrow.png` });
  await plan.click();
  assert.match(await source('语音识别').innerText(), /独立配置/);
  assert.match(await source('文本').innerText(), /不使用/, 'Turning off Plan does not move text to direct calls');
  await save.click();
  await page.waitForFunction(() => !window.pluginHostTest.snapshot().value.source);

  for (const independentModel of [false, true]) {
    await page.goto(`${base}/tests/fixtures/plugin-center-live.html${independentModel ? '?independent-model=1' : ''}`);
    await page.getByRole('button', { name: `配置 ${independentModel ? '漫画绘制示例' : 'DFSC Configuration Example'}`, exact: true }).click();
    const group = page.getByRole('group', { name: '连接来源', exact: true });
    const generic = page.locator('.pc-generic-form');
    await generic.locator('input').first().waitFor();
    if (!independentModel) {
      assert.equal(await group.count(), 0, 'Ordinary configuration does not claim a model source');
      continue;
    }
    const choices = group.getByRole('switch');
    assert.equal(await choices.count(), 3);
    assert.deepEqual(await choices.allTextContents(), ['使用我的 Step Plan 额度', '开放平台 API（按量计费）', '独立配置']);
    for (const [index, checked] of [[0, 'false'], [1, 'false'], [2, 'true']]) {
      const choice = choices.nth(index);
      assert.equal(await choice.isDisabled(), true);
      assert.equal(await choice.getAttribute('aria-checked'), checked);
      assert.equal(await choice.getAttribute('aria-describedby'), null);
      assert.equal(await choice.evaluate(el => Number(getComputedStyle(el).opacity) < 1), checked === 'false');
    }
    assert.equal(await page.getByText('请先在账户设置中连接官方 Step 账户。', { exact: true }).count(), 0);
    for (const [width, theme] of [[1360, 'light'], [390, 'dark']]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => window.pluginCenterTest.theme(value), theme);
      await group.scrollIntoViewIfNeeded();
      assert.equal(await group.evaluate(element => element.scrollWidth > element.clientWidth), false);
      await page.screenshot({ path: `${output}/independent-only-${theme}.png` });
    }
    await generic.getByLabel('生图接口地址', { exact: true }).fill('https://images.example.invalid/v1');
    await generic.getByLabel('生图模型', { exact: true }).fill('fixture-image-model');
    await generic.getByLabel('API Key', { exact: true }).fill('fixture-image-key');
    await save.click();
    await page.waitForFunction(() => window.pluginCenterTest.exampleConfiguration().values.model === 'fixture-image-model');
    assert.equal(await generic.getByLabel('API Key', { exact: true }).inputValue(), '', 'Saved independent secrets never return to the input');
  }
  assert.deepEqual(errors, []);
  console.log('Host settings UI passed: legacy modes, mixed routes, independent secrets, separate approval states, revision conflicts, restart, responsive focus and reduced motion. Fixture calls are simulated.');
} finally {
  await browser.close();
  await server.close();
  assert.equal(dirname(resolve(cacheDir)), resolve(tmpdir()));
  assert.ok(basename(cacheDir).startsWith('dfsc-host-settings-vite-'));
  await removeTestProfile(cacheDir);
}
