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
  await form.getByRole('group', { name: '模型来源', exact: true }).waitFor();
  assert.equal(await form.locator('.pc-mode [aria-pressed=true]').count(), 0, 'Installation is not a saved choice');
  const save = page.getByRole('button', { name: '保存配置', exact: true });
  assert.equal(await save.isDisabled(), true);
  await form.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some(button => button.textContent === '保存配置' && !button.disabled));
  assert.equal(await save.isEnabled(), true);
  await page.screenshot({ path: `${output}/follow-unsaved.png` });
  await save.click();
  await page.waitForFunction(() => window.pluginHostTest.snapshot().value.mode === 'follow');
  await form.getByRole('status').filter({ hasText: '待重启会话' }).waitFor();
  assert.equal((await page.evaluate(() => window.pluginHostTest.snapshot())).restarts, 0, 'Saving does not restart or approve');
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '当前会话已连接' }).waitFor();
  assert.equal(await form.getByText('首次调用需确认', { exact: true }).count(), 3);
  assert.equal(await form.getByText('不可用', { exact: true }).count(), 1);
  await page.evaluate(() => window.pluginHostTest.approve());
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pc-host-approved').length === 3);
  await page.screenshot({ path: `${output}/follow-approved.png` });

  const asr = form.getByLabel('语音识别专用模型', { exact: true });
  await asr.fill('unsaved-asr');
  const toggle = page.getByRole('switch', { name: '启用 宿主模型示例 服务', exact: true });
  await toggle.click();
  await form.getByRole('status').filter({ hasText: '服务已停用' }).waitFor();
  assert.equal(await form.locator('.pc-host-approved').count(), 0, 'Disabling invalidates approval observations');
  assert.equal(await asr.inputValue(), 'unsaved-asr', 'Management status refresh retains drafts');
  await toggle.click();
  await form.getByRole('status').filter({ hasText: '待重启会话' }).waitFor();
  assert.equal(await form.locator('.pc-host-approved').count(), 0, 'Re-enabling does not restore old approval');
  await asr.fill('');
  await page.getByRole('button', { name: '重启当前会话', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '当前会话已连接' }).waitFor();
  await page.evaluate(() => window.pluginHostTest.approve());
  await form.getByRole('button', { name: '刷新宿主状态', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pc-host-approved').length === 3);
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
  await page.waitForFunction(() => document.querySelectorAll('.pc-host-approved').length === 3);
  await form.getByRole('button', { name: '独立配置', exact: true }).click();
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
      assert.deepEqual(await form.locator('.pc-mode,.pc-host-capabilities li,.pc-field').evaluateAll(elements =>
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
  await form.getByRole('button', { name: '跟随 DFSC 会话', exact: true }).click();
  assert.equal(await form.locator('.pc-entrance').evaluate(element => element.getAnimations().length), 0);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await form.getByRole('button', { name: 'Follow DFSC session', exact: true }).waitFor();
  assert.equal(await form.getByText('Per-capability request confirmation', { exact: true }).count(), 1);
  await page.screenshot({ path: `${output}/follow-english-narrow.png` });
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await page.waitForFunction(() => window.pluginHostTest.snapshot().value.mode === 'follow');
  await form.getByRole('status').filter({ hasText: 'Session restart required' }).waitFor();
  await form.getByLabel('Dedicated speech recognition model', { exact: true }).fill('custom-asr');
  await page.evaluate(() => window.pluginHostTest.stale());
  await form.getByRole('button', { name: 'Refresh host status', exact: true }).click();
  await form.getByRole('alert').waitFor();
  assert.equal(await form.getByLabel('Dedicated speech recognition model', { exact: true }).inputValue(), 'custom-asr', 'Status refresh retains the draft');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  assert.match(await form.getByRole('alert').innerText(), /changed elsewhere/);
  await form.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await form.getByRole('button', { name: 'Discard and reload', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pc-host-speech input')?.value === '');
  const speech = form.getByLabel('Dedicated speech recognition model', { exact: true });
  await speech.focus(); await speech.scrollIntoViewIfNeeded();
  assert.deepEqual(await speech.evaluate(focusClips), [], 'ASR focus retains the shared gutter');
  await form.getByRole('button', { name: 'Independent', exact: true }).click();
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
  await page.waitForFunction(() => document.querySelector('.pc-mode button:last-child')?.disabled);
  assert.equal(await form.getByRole('button', { name: 'Independent', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.pluginHostTest.status('unsupported'));
  await form.getByRole('button', { name: 'Reload configuration', exact: true }).click();
  await form.getByRole('status').filter({ hasText: 'Unsupported host version' }).waitFor();
  assert.equal(await form.getByRole('button', { name: 'Follow DFSC session', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Save configuration', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Host settings UI passed: mode choice, independent secrets, revision conflicts, failed save/read, service toggles, late session response, draft retention, approval snapshots, host-only/unsupported states, restart, responsive focus and reduced motion. Fixture calls are simulated.');
} finally {
  await browser.close();
  await server.close();
  assert.equal(dirname(resolve(cacheDir)), resolve(tmpdir()));
  assert.ok(basename(cacheDir).startsWith('dfsc-host-settings-vite-'));
  await removeTestProfile(cacheDir);
}
