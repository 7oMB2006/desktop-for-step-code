import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { verifyPluginMarketInfo } from './plugin-market-info-checks.mjs';

const cacheDir = await mkdtemp(join(tmpdir(), 'dfsc-plugin-center-vite-'));
const server = process.env.DESKTOP_PREVIEW_URL ? undefined : await createServer({
  cacheDir,
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn',
});
await server?.listen();
const base = process.env.DESKTOP_PREVIEW_URL ?? `http://127.0.0.1:${server.httpServer.address().port}`;
console.log(`PluginCenter browser fixture: ${base}`);
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
  await verifyPluginMarketInfo({ browser, base, output: `${output}/market-info` });
  const updates = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const updateErrors = [];
  updates.on('pageerror', error => updateErrors.push(error.message));
  try {
    await updates.goto(`${base}/tests/fixtures/plugin-center-live.html?updates=1`);
    const card = updates.locator('.pc-plugin-row').filter({ has: updates.locator('.pc-card-heading strong', { hasText: /^Bilibili Video Research$/ }) });
    const action = card.locator('.pc-update-action');
    await action.waitFor();
    await updates.locator('.pc-catalog-page').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    assert.match(await card.locator('.pc-card-meta').innerText(), /市场 · dfsc-community/);
    assert.equal(await updates.locator('.pc-plugin-row .pc-update-row').count(), 0, 'Cards do not reserve a separate update row');
    assert.equal(await updates.locator('.pc-update-action').count(), 1);
    assert.equal(await action.locator('..').getAttribute('class'), 'pc-card-actions', 'Update uses the existing footer actions');
    assert.equal(await action.getByRole('button').innerText(), '更新', 'The update action has a visible text label');
    const oldIcon = await card.locator('img').getAttribute('src');
    const initialHeight = (await card.boundingBox()).height;
    const initialFooterHeight = (await card.locator('.pc-card-footer').boundingBox()).height;
    const originalConfiguration = await updates.evaluate(() => window.pluginCenterTest.configuration());
    await updates.screenshot({ path: `${output}/updates-light-desktop.png` });
    await updates.getByRole('button', { name: '检查插件更新', exact: true }).click();
    assert.match(await updates.getByRole('button', { name: '检查插件更新', exact: true }).innerText(), /正在检查/);
    await updates.waitForFunction(() => !window.pluginUpdateTest.snapshot().checking);
    await updates.getByRole('switch', { name: '启用 Bilibili Video Research 服务', exact: true }).click();
    await updates.waitForFunction(() => document.querySelector('[aria-label="启用 Bilibili Video Research 服务"]')?.getAttribute('aria-checked') === 'false');
    await updates.getByRole('button', { name: '更新 Bilibili Video Research 至 v0.1.1', exact: true }).dblclick();
    await action.getByRole('progressbar').waitFor();
    assert.equal(await action.getByRole('button').innerText(), '更新中');
    assert.equal((await card.boundingBox()).height, initialHeight, 'Downloading does not increase card height');
    assert.equal(await action.getByRole('progressbar').evaluate(element => {
      const progress = element.getBoundingClientRect(), footer = element.closest('.pc-card-footer').getBoundingClientRect();
      return progress.height === 2 && Math.abs(progress.bottom - footer.bottom) < 1;
    }), true, 'Progress is a thin line at the existing footer edge');
    assert.equal(await updates.evaluate(() => window.pluginUpdateTest.snapshot().attempts), 1, 'Repeated clicks start one simulated update');
    assert.equal(await card.locator('img').getAttribute('src'), oldIcon, 'Downloading does not prematurely replace the installed icon');
    await updates.screenshot({ path: `${output}/updates-downloading.png` });
    await updates.waitForFunction(() => window.pluginUpdateTest.snapshot().items['bilibili-video-research'].phase === 'updated');
    await updates.waitForFunction(() => document.querySelector('.pc-card-version')?.textContent.includes('v0.1.1'));
    assert.notEqual(await card.locator('img').getAttribute('src'), oldIcon);
    assert.equal(await card.getByRole('switch').getAttribute('aria-checked'), 'false', 'Updating keeps the saved service switch');
    assert.deepEqual(await updates.evaluate(() => window.pluginCenterTest.configuration()), originalConfiguration);
    assert.equal((await card.boundingBox()).height, initialHeight, 'Update phases keep card height stable');
    assert.equal((await card.locator('.pc-card-footer').boundingBox()).height, initialFooterHeight, 'Update actions do not enlarge the footer');
    assert.equal(await action.getByRole('button').innerText(), '重启');
    await updates.screenshot({ path: `${output}/updates-complete.png` });
    await action.getByRole('button', { name: '重启会话以应用 Bilibili Video Research 更新', exact: true }).click();
    await updates.waitForFunction(() => window.pluginUpdateTest.snapshot().items['bilibili-video-research'].restartRequired === false);
    assert.equal(await updates.evaluate(() => window.pluginCenterTest.counts().restarts), 1);
    assert.equal(await action.count(), 0, 'Applied updates do not leave a redundant action');

    await updates.getByRole('button', { name: '更新结果', exact: true }).click();
    await updates.getByRole('menuitemradio', { name: '首次失败', exact: true }).click();
    await updates.getByRole('button', { name: '更新 Bilibili Video Research 至 v0.1.1', exact: true }).click();
    await updates.waitForFunction(() => window.pluginUpdateTest.snapshot().items['bilibili-video-research'].phase === 'failed');
    assert.equal(await card.locator('img').getAttribute('src'), oldIcon);
    assert.match(await card.locator('.pc-card-version').innerText(), /^v0.1.0/);
    assert.match(await card.locator('.pc-update-badge').innerText(), /更新失败/);
    assert.match(await action.getByRole('button').getAttribute('title'), /重试更新/);
    assert.equal(await action.getByRole('button').innerText(), '重试');
    assert.equal((await card.boundingBox()).height, initialHeight, 'Failure does not add another card row');
    assert.deepEqual(await updates.evaluate(() => window.pluginCenterTest.configuration()), originalConfiguration);
    await updates.screenshot({ path: `${output}/updates-failed.png` });
    await action.getByRole('button', { name: '重试更新 Bilibili Video Research', exact: true }).click();
    await updates.waitForFunction(() => window.pluginUpdateTest.snapshot().items['bilibili-video-research'].phase === 'updated');
    assert.equal(await updates.evaluate(() => window.pluginUpdateTest.snapshot().attempts), 2);

    await updates.getByRole('button', { name: '更新结果', exact: true }).click();
    await updates.getByRole('menuitemradio', { name: '更新成功', exact: true }).click();
    await updates.getByRole('button', { name: '查看 Bilibili Video Research 使用说明', exact: true }).click();
    await updates.locator('.pc-detail .pc-update-row').waitFor();
    await updates.locator('.pc-detail').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    assert.match(await updates.locator('.pc-detail .pc-update-versions').innerText(), /v0.1.0[\s\S]*v0.1.1/);
    await updates.screenshot({ path: `${output}/updates-detail.png` });
    await updates.getByRole('button', { name: '全部插件', exact: true }).click();
    await updates.emulateMedia({ reducedMotion: 'reduce' });
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await updates.getByRole('button', { name: '切换明暗主题', exact: true }).click();
      for (const [width, height] of [[1440, 980], [740, 820], [390, 844]]) {
        await updates.setViewportSize({ width, height });
        assert.equal(await updates.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(await updates.locator('.pc-update-action,.pc-card-version,.pc-card-footer,.pc-window').evaluateAll(elements =>
          elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), []);
        assert.equal(await action.getByRole('button').evaluate(element => {
          const style = getComputedStyle(element);
          return style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
            && style.borderTopWidth === '1px' && style.borderTopStyle === 'solid'
            && style.borderRadius === '4px' && style.color !== style.backgroundColor;
        }), true, `${theme}/${width}: update has a filled button surface, not plain text`);
        await action.getByRole('button').focus();
        assert.deepEqual(await action.getByRole('button').evaluate(focusClips), [], `${theme}/${width}: update button focus`);
        await updates.screenshot({ path: `${output}/updates-${theme}-${width}.png` });
      }
    }
    await updates.getByRole('button', { name: '切换为英文', exact: true }).click();
    await updates.getByRole('button', { name: 'Update Bilibili Video Research to v0.1.1', exact: true }).waitFor();
    assert.equal(await action.getByRole('button').innerText(), 'Update');
    for (const width of [1190, 1008, 390]) {
      await updates.setViewportSize({ width, height: 844 });
      assert.deepEqual(await updates.locator('.pc-card-version,.pc-card-footer,.pc-update-trigger').evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), [],
      `English/${width}: text update actions fit the existing footer`);
      await action.getByRole('button').focus();
      assert.deepEqual(await action.getByRole('button').evaluate(focusClips), [], `English/${width}: text update focus`);
    }
    await updates.screenshot({ path: `${output}/updates-dark-english-mobile.png` });
    assert.equal(await action.getByRole('button').evaluate(element => element.getAnimations().length), 0);
    assert.deepEqual(updateErrors, []);
    console.log('Plugin update presentation preview passed; installation operations are simulated.');
  } finally { await updates.close(); }
  const native = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const nativeErrors = [];
  native.on('pageerror', error => nativeErrors.push(error.message));
  try {
    const loadNative = async (readiness = 'ready') => {
      await native.goto(`${base}/tests/fixtures/plugin-center-live.html?updates=native`);
      await native.getByRole('tab', { name: /^已安装/ }).waitFor();
      await native.evaluate(value => window.pluginCenterTest.updateReadiness(value), readiness);
    };
    const card = native.locator('.pc-plugin-row').filter({ has: native.locator('.pc-card-heading strong', { hasText: /^Bilibili Video Research$/ }) });
    const action = card.locator('.pc-update-action');
    const dialog = native.getByRole('dialog', { name: '插件更新', exact: true });
    const startUpdate = (version = '0.1.1') => native.getByRole('button', {
      name: `更新 Bilibili Video Research 至 v${version}`, exact: true,
    }).click();
    const closeUpdate = () => dialog.getByRole('button', { name: '关闭更新详情', exact: true }).click();
    const confirmUpdate = () => dialog.getByRole('button', { name: '重启相关会话并更新', exact: true }).click();
    const remountNative = async () => {
      const before = await native.evaluate(() => ({
        catalog: window.pluginCenterTest.counts().catalogReads,
        operation: window.pluginCenterTest.updateCounts().operationReads,
      }));
      await native.evaluate(() => window.pluginCenterTest.remount());
      await native.waitForFunction(before => window.pluginCenterTest.counts().catalogReads > before.catalog
        && window.pluginCenterTest.updateCounts().operationReads > before.operation, before);
      await native.getByRole('tab', { name: /^已安装/ }).waitFor();
    };
    await loadNative();
    await native.getByRole('tab', { name: '发现', exact: true }).click();
    assert.match(await card.locator('.pc-card-version').innerText(), /^v0.1.1[\s\S]*已安装 v0.1.0/,
      'Discover labels candidate metadata with its own version and separately identifies the installed version');
    await native.getByRole('tab', { name: /^已安装/ }).click();
    await native.getByRole('button', { name: '检查插件更新', exact: true }).click();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().checks === 1);
    await startUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    assert.equal(await dialog.isVisible(), false, 'A ready, compatible update applies without another confirmation');
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 1);
    assert.equal(await card.getByRole('switch').isDisabled(), true);
    await native.screenshot({ path: `${output}/updates-native-pending.png` });
    await native.evaluate(() => window.pluginCenterTest.holdUpdateCatalog());
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().applied === 1);
    assert.match(await card.locator('.pc-card-version').innerText(), /v0.1.0/,
      'The installed version stays tied to the catalog until the post-commit catalog arrives');
    await native.evaluate(() => window.pluginCenterTest.releaseUpdateCatalog());
    await native.waitForFunction(() => document.querySelector('.pc-card-version')?.textContent.includes('v0.1.1'));
    await action.waitFor({ state: 'hidden' });
    assert.deepEqual(await native.evaluate(() => window.pluginCenterTest.updateCounts().consents), [false]);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.counts().restarts), 0);
    await native.screenshot({ path: `${output}/updates-native-success.png` });

    await native.evaluate(() => window.pluginCenterTest.publishUpdate('0.1.2'));
    await native.getByRole('button', { name: '检查插件更新', exact: true }).click();
    await startUpdate('0.1.2');
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 2);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateOperation().version), '0.1.2',
      'A later candidate does not reopen the previous version operation');
    assert.equal(await dialog.isVisible(), false);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await native.waitForFunction(() => document.querySelector('.pc-card-version')?.textContent.includes('v0.1.2'));
    await action.waitFor({ state: 'hidden' });
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().preflights), 2);
    await remountNative();
    assert.equal(await dialog.isVisible(), false, 'A normally completed persisted operation is not reopened on remount');
    await action.waitFor({ state: 'hidden' });
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 2);

    await loadNative('needs-release');
    await startUpdate();
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /需要释放会话占用/);
    assert.equal(await dialog.locator('.pc-update-sessions li').count(), 2);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 0,
      'Canceling assistance does not start an update');
    await action.getByRole('button', { name: '查看 Bilibili Video Research 更新详情', exact: true }).click();
    await dialog.getByRole('button', { name: '重启相关会话并更新', exact: true }).dblclick();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    assert.match(await dialog.innerText(), /关闭此窗口不会取消操作/);
    await closeUpdate();
    const readsBeforeReopen = await native.evaluate(() => window.pluginCenterTest.updateCounts().operationReads);
    await action.getByRole('button', { name: '查看 Bilibili Video Research 更新详情', exact: true }).click();
    await dialog.waitFor();
    await native.waitForFunction(before => window.pluginCenterTest.updateCounts().operationReads > before, readsBeforeReopen);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 1,
      'Double confirmation and reopening a running operation never start it again');
    await native.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await native.screenshot({ path: `${output}/updates-native-release-mobile.png` });
    await native.setViewportSize({ width: 1440, height: 980 });
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await native.waitForFunction(() => window.pluginCenterTest.updateOperation()?.phase === 'done');
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    await closeUpdate();
    assert.deepEqual(await native.evaluate(() => window.pluginCenterTest.updateCounts().consents), [true]);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.counts().restarts), 0,
      'The UI does not chain its current-session restart after coordinated restoration');

    await loadNative('needs-release');
    await native.evaluate(() => window.pluginCenterTest.failRestoration());
    await startUpdate();
    await confirmUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    assert.match(await dialog.innerText(), /部分会话未恢复/);
    assert.equal(await dialog.getByRole('button', { name: '重新检查', exact: true }).count(), 0,
      'A committed installation is not offered another package update as runtime recovery');
    await closeUpdate();
    await action.getByRole('button', { name: '查看 Bilibili Video Research 更新详情', exact: true }).click();
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 1);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().preflights), 1);
    await closeUpdate();
    await remountNative();
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    assert.match(await dialog.innerText(), /部分会话未恢复/,
      'A remount restores committed-but-failed session recovery even when the catalog is current');
    await closeUpdate();
    await action.getByRole('button', { name: '查看 Bilibili Video Research 更新详情', exact: true }).click();
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 1,
      'Hydrating recovery details never replays an installation or its consent');
    await closeUpdate();

    await native.evaluate(() => {
      window.pluginCenterTest.publishUpdate('0.1.2');
      window.pluginCenterTest.holdNextOperation();
    });
    await remountNative();
    await startUpdate('0.1.2');
    await dialog.getByRole('button', { name: '重启相关会话并更新', exact: true }).waitFor();
    await native.evaluate(() => window.pluginCenterTest.releaseOperation());
    await native.waitForTimeout(150);
    assert.match(await dialog.innerText(), /v0.1.2/);
    assert.doesNotMatch(await dialog.innerText(), /v0.1.1/,
      'A late persisted snapshot cannot overwrite a newer locally requested preflight');
    await confirmUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 2);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    await closeUpdate();

    await native.evaluate(() => {
      const operation = window.pluginCenterTest.updateOperation();
      window.pluginCenterTest.persistUpdateOperation({ ...operation, phase: 'attention', installation: 'unknown',
        error: 'capability:update-interrupted',
        sessions: operation.sessions.map(session => ({ ...session, restoration: 'unknown' })) });
    });
    await remountNative();
    await dialog.getByText('更新结果待核对', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '重新检查', exact: true }).count(), 0,
      'An unknown cross-process result is recovery information, not fresh update consent');
    await closeUpdate();
    await native.getByRole('button', { name: '检查插件更新', exact: true }).click();
    await action.getByRole('button', { name: '查看 Bilibili Video Research 更新详情', exact: true }).click();
    await dialog.getByText('更新结果待核对', { exact: true }).waitFor();
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 2);
    await closeUpdate();

    await loadNative('needs-release');
    await startUpdate();
    await confirmUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    await remountNative();
    await dialog.getByText('正在释放占用', { exact: true }).waitFor();
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 1,
      'Remounting an active current-process operation only resumes read-only polling');
    const readsBeforeStalePoll = await native.evaluate(() => window.pluginCenterTest.updateCounts().operationReads);
    await native.evaluate(() => {
      const operation = window.pluginCenterTest.updateOperation();
      window.pluginCenterTest.nextOperation({ ...operation, id: 'previous-consumed-token', version: '9.9.9',
        phase: 'attention', installation: 'committed' });
    });
    await native.waitForFunction(before => window.pluginCenterTest.updateCounts().operationReads > before, readsBeforeStalePoll);
    await native.waitForTimeout(100);
    assert.match(await dialog.innerText(), /正在释放占用/);
    assert.doesNotMatch(await dialog.innerText(), /9.9.9|新版已安装/,
      'A poll response for a different consumed token cannot replace the active operation');
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    await closeUpdate();
    await action.waitFor({ state: 'hidden' });
    assert.equal(await card.getByRole('switch').isEnabled(), true, 'Read-only polling clears the active lock at terminal state');
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 1);

    await loadNative();
    await native.evaluate(() => window.pluginCenterTest.persistUpdateOperation({
      id: 'unrelated-old-operation', pluginId: 'bilibili-video-research', version: '0.0.1',
      phase: 'attention', installation: 'unknown', sessions: [], warnings: [],
    }));
    await remountNative();
    await native.waitForTimeout(100);
    assert.equal(await dialog.isVisible(), false, 'An unrelated persisted version does not replace the current candidate');
    await action.getByRole('button', { name: '更新 Bilibili Video Research 至 v0.1.1', exact: true }).waitFor();

    await loadNative('needs-release');
    await native.evaluate(() => window.pluginCenterTest.failUpdate());
    await startUpdate();
    await confirmUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    const readsBeforeRollback = await native.evaluate(() => window.pluginCenterTest.counts().catalogReads);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await dialog.getByText('尚未更新', { exact: true }).waitFor();
    await native.waitForFunction(before => window.pluginCenterTest.counts().catalogReads > before
      && !document.querySelector('[aria-label="启用 Bilibili Video Research 服务"]')?.disabled, readsBeforeRollback);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().retiredReferences), 1);
    assert.match(await dialog.innerText(), /仍被会话占用/,
      'Refreshing retired package references preserves the unchanged operation and its error');
    await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().preflights === 2);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().staleRequests), 0,
      'A rolled-back operation rechecks with fresh package references');
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 1,
      'Rechecking a rollback does not replay its installation or restart consent');
    await confirmUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 2);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await dialog.getByText('新版已安装', { exact: true }).waitFor();
    await closeUpdate();

    await loadNative();
    await native.evaluate(() => window.pluginCenterTest.rejectUpdate());
    await startUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().retiredReferences === 1
      && window.pluginCenterTest.counts().catalogReads > 1
      && !document.querySelector('[aria-label="启用 Bilibili Video Research 服务"]')?.disabled);
    await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 2);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().preflights), 2,
      'A rejected ready operation does not strand a running panel or reuse its consumed receipt');
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().staleRequests), 0,
      'An apply exception without a matching operation also refreshes retired references');
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await action.waitFor({ state: 'hidden' });

    await loadNative();
    await native.evaluate(() => window.pluginCenterTest.retireUpdateReferences());
    await startUpdate();
    await action.getByRole('button', { name: '重试更新 Bilibili Video Research', exact: true }).waitFor();
    await native.waitForFunction(() => window.pluginCenterTest.counts().catalogReads > 1
      && !document.querySelector('[aria-label="启用 Bilibili Video Research 服务"]')?.disabled);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().staleRequests), 1);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 0,
      'A stale preflight has not started an installation');
    await action.getByRole('button', { name: '重试更新 Bilibili Video Research', exact: true }).click();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().staleRequests), 1,
      'Retry after a preflight exception uses the refreshed references');
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().preflights), 1);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await action.waitFor({ state: 'hidden' });

    await loadNative('blocked');
    await startUpdate();
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /有会话仍有任务或受保护的运行状态/);
    assert.equal(await dialog.getByRole('button', { name: '重启相关会话并更新', exact: true }).count(), 0);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 0);
    assert.doesNotMatch(await card.locator('.pc-update-badge').innerText(), /更新失败/);
    await native.evaluate(() => window.pluginCenterTest.updateReadiness('ready'));
    await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await action.waitFor({ state: 'hidden' });

    await loadNative('needs-release');
    await startUpdate();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await card.getByRole('button', { name: '查看 Bilibili Video Research 使用说明', exact: true }).click();
    await native.getByRole('tab', { name: '配置', exact: true }).click();
    const runtime = native.getByLabel('BVR 运行目录', { exact: true });
    await runtime.fill('D:\\Unsaved\\BVR');
    const dirtyDialog = native.getByRole('dialog', { name: '放弃未保存的插件配置？', exact: true });
    const requestWithDirtyDraft = async () => {
      await native.getByRole('button', { name: '查看 Bilibili Video Research 更新详情', exact: true }).click();
      if (!await dirtyDialog.isVisible()) await confirmUpdate();
      await dirtyDialog.waitFor();
    };
    await requestWithDirtyDraft();
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().attempts), 0);
    await dirtyDialog.getByRole('button', { name: '取消', exact: true }).click();
    if (await dialog.isVisible()) await closeUpdate();
    assert.equal(await runtime.inputValue(), 'D:\\Unsaved\\BVR', 'Canceling discard keeps the unsaved draft');
    assert.equal(await native.evaluate(() => window.pluginCenterTest.configuration().runtimeDirectory), 'D:\\Tools\\BVR');
    await requestWithDirtyDraft();
    await dirtyDialog.getByRole('button', { name: '确认', exact: true }).click();
    await dirtyDialog.waitFor({ state: 'hidden' });
    if (await dialog.getByRole('button', { name: '重启相关会话并更新', exact: true }).isVisible()) await confirmUpdate();
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().attempts === 1);
    await native.evaluate(() => window.pluginCenterTest.releaseUpdate());
    await native.waitForFunction(() => window.pluginCenterTest.updateCounts().applied === 1);
    assert.equal(await native.evaluate(() => window.pluginCenterTest.counts().saves), 0,
      'Accepting discard does not silently save the unrelated draft');
    assert.equal(await native.evaluate(() => window.pluginCenterTest.updateCounts().legacy), 0,
      'Native presentation uses only the coordinated update bridge');
    assert.deepEqual(nativeErrors, []);
    console.log('Plugin update coordinated browser flows passed against the typed bridge fixture.');
  } finally { await native.close(); }
  const metadata = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  try {
    await metadata.goto(`${base}/tests/fixtures/plugin-center-live.html?repositories=held`);
    await metadata.getByRole('tab', { name: /^已安装/ }).waitFor();
    await metadata.waitForFunction(() => window.pluginCenterTest.counts().repositoryReads === 2);
    const cards = metadata.locator('.pc-plugin-row');
    assert.match(await cards.nth(0).locator('.pc-card-meta').innerText(), /匹配市场 · bvr-local-preview/);
    assert.match(await cards.nth(1).locator('.pc-card-meta').innerText(), /市场 · builtin/);
    assert.match(await cards.nth(2).locator('.pc-card-meta').innerText(), /来源未确认/);
    assert.match(await cards.nth(3).locator('.pc-card-meta').innerText(), /市场 · fixture-community/);
    assert.match(await cards.nth(1).locator('.pc-card-description').innerText(), /浏览器自动化/);
    assert.deepEqual(await cards.nth(0).locator('.pc-category-tag').allTextContents(), ['搜索研究', '音视频']);
    assert.deepEqual(await cards.nth(1).locator('.pc-category-tag').allTextContents(), ['开发辅助', '效率自动化']);
    assert.equal(await cards.nth(2).locator('.pc-category-tags').count(), 0, 'Unknown categories are not advertised as known card tags');
    assert.deepEqual(await cards.nth(3).locator('.pc-category-tag').allTextContents(), ['文本与文档']);
    assert.equal(await cards.nth(0).evaluate(element => {
      const description = element.querySelector('.pc-card-description').getBoundingClientRect();
      const tags = element.querySelector('.pc-category-tags').getBoundingClientRect();
      const source = element.querySelector('.pc-card-meta').getBoundingClientRect();
      return tags.top >= description.bottom && tags.bottom <= source.top;
    }), true, 'Category tags sit between the description and the source, not inside the service footer');
    assert.equal(await cards.nth(0).locator('.pc-stars').getAttribute('aria-busy'), 'true');
    assert.equal(await cards.nth(0).locator('.pc-stars > span').innerText(), '...');
    await metadata.getByRole('button', { name: '查看 Bilibili Video Research 使用说明', exact: true }).click();
    await metadata.locator('.pc-document-markdown table').waitFor();
    assert.equal(await metadata.locator('.pc-repository .pc-stars').getAttribute('aria-busy'), 'true',
      'A slow public repository lookup must not block opening and reading a plugin');
    await metadata.evaluate(() => window.pluginCenterTest.releaseRepositories());
    await metadata.waitForFunction(() => document.querySelector('.pc-repository .pc-stars > span')?.textContent === '18');
    await metadata.evaluate(() => window.pluginCenterTest.language('en'));
    await metadata.getByRole('tab', { name: 'Guide', exact: true }).waitFor();
    await metadata.getByRole('heading', { name: 'Video research', exact: true }).waitFor();
    assert.equal(await metadata.locator('.pc-plugin-summary > p').innerText(), 'Research public videos using transcripts, audio and frames.');
    assert.match(await metadata.locator('.pc-plugin-title').innerText(), /Matching marketplace · bvr-local-preview/);
    assert.deepEqual(await metadata.locator('.pc-plugin-summary .pc-category-tag').allTextContents(), ['Search & research', 'Audio & video']);
    assert.equal(await metadata.locator('.pc-plugin-keywords dd').innerText(), '视频研究 · 字幕 · 语音转写',
      'Author keywords are not silently translated with the UI');
    assert.equal(await metadata.locator('.pc-documentation .pc-document-heading > span').last().innerText(), 'v0.1.0 · README.en.md');
    await metadata.evaluate(() => window.pluginCenterTest.language('zh'));
    await metadata.locator('.pc-document-markdown table').waitFor();
    await metadata.getByRole('button', { name: '全部插件', exact: true }).click();
    assert.equal(await cards.nth(0).locator('.pc-stars > span').innerText(), '18');
    assert.equal(await cards.nth(1).locator('.pc-stars > span').innerText(), '-',
      'An unavailable star count stays unknown, not an invented zero or a missing affordance');
    assert.equal(await metadata.evaluate(() => window.pluginCenterTest.counts().repositoryReads), 2,
      'Repeated detail navigation and language changes reuse the repository lookup');
    await metadata.getByRole('switch', { name: '启用 Bilibili Video Research 服务', exact: true }).click();
    await metadata.waitForFunction(() => document.querySelector('[aria-label="启用 Bilibili Video Research 服务"]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await cards.nth(0).locator('.pc-stars > span').innerText(), '18',
      'A capability refresh must not reset an already fetched star snapshot');
    const search = metadata.getByLabel('搜索插件', { exact: true });
    for (const [query, name] of [['语音转写', 'Bilibili Video Research'], ['Audio & video', 'Bilibili Video Research'],
      ['text-documents', 'DFSC Configuration Example'], ['文本与文档', 'DFSC Configuration Example']]) {
      await search.fill(query);
      await metadata.getByRole('button', { name: `查看 ${name} 使用说明`, exact: true }).waitFor();
      assert.equal(await cards.count(), 1, `Classification search: ${query}`);
    }
    await search.fill('future-category');
    await metadata.getByRole('button', { name: '查看 LongNamePluginWithoutALogoForLayoutVerification 使用说明', exact: true }).click();
    assert.deepEqual(await metadata.locator('.pc-plugin-summary .pc-category-tag').allTextContents(), ['future-category']);
    assert.equal(await metadata.locator('.pc-plugin-keywords dd').innerText(), 'long-keyword-without-spaces-for-layout-checking');
    await metadata.getByRole('button', { name: '全部插件', exact: true }).click();
    await search.fill('');
    await metadata.getByRole('tab', { name: '发现', exact: true }).click();
    assert.deepEqual(await cards.first().locator('.pc-category-tag').allTextContents(), ['开发辅助', '效率自动化', '+1']);
    assert.equal(await cards.first().locator('.pc-category-more').getAttribute('aria-label'), '另有 1 个分类');
    await metadata.getByRole('button', { name: '查看 Fixture plugin 使用说明', exact: true }).click();
    assert.deepEqual(await metadata.locator('.pc-plugin-summary .pc-category-tag').allTextContents(), ['开发辅助', '效率自动化', '知识管理'],
      'Opening a card shows every declared category');
    await metadata.getByRole('button', { name: '全部插件', exact: true }).click();
    await metadata.getByRole('tab', { name: /^已安装/ }).click();
    await metadata.evaluate(() => window.pluginCenterTest.language('en'));
    await metadata.getByRole('tab', { name: /^Installed/ }).waitFor();
    assert.deepEqual(await cards.nth(0).locator('.pc-category-tag').allTextContents(), ['Search & research', 'Audio & video']);
    for (const theme of ['light', 'dark']) {
      await metadata.evaluate(theme => window.pluginCenterTest.theme(theme), theme);
      for (const [width, height] of [[1440, 980], [1008, 887], [640, 720], [390, 760]]) {
        await metadata.setViewportSize({ width, height });
        await metadata.waitForTimeout(280);
        assert.deepEqual(await metadata.locator('.pc-category-tags,.pc-category-tag,.pc-plugin-row,.pc-card-open').evaluateAll(elements =>
          elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), [],
        `${theme}/${width}: English category tags wrap within the card`);
        assert.ok(await cards.first().evaluate(element => {
          const tags = element.querySelector('.pc-category-tags').getBoundingClientRect();
          const source = element.querySelector('.pc-card-meta').getBoundingClientRect();
          return Math.abs(source.top - tags.bottom - 12) < 1;
        }), 'Tags stay anchored above source metadata even when a neighboring description wraps');
        await metadata.screenshot({ path: `${output}/${theme}-${width}-tags-en.png` });
        await metadata.getByRole('button', { name: 'Read LongNamePluginWithoutALogoForLayoutVerification guide', exact: true }).click();
        assert.deepEqual(await metadata.locator('.pc-plugin-summary,.pc-category-tag,.pc-plugin-keywords,.pc-plugin-keywords dd').evaluateAll(elements =>
          elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), [],
        `${theme}/${width}: future category and long author keywords remain readable`);
        await metadata.getByRole('button', { name: 'All plugins', exact: true }).click();
      }
    }
    console.log('Cold-cache repository lookups, installation sources, localized classification tags and keyword search passed.');
  } finally { await metadata.close(); }
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
    assert.equal(await race.getByRole('button', { name: '查看 StepPage 使用说明', exact: true }).locator('.pc-category-tags').count(), 0,
      'Legacy plugins without classification metadata remain usable and do not receive inferred tags');
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
      // Wrapper boxes are layout-rounded on some runners (72.000015 at 100%
      // zoom); the media checks below already carry the same tolerance.
      assert.ok(Math.abs(icon.width - size) < .1, 'Logo width must not shrink in flex layouts');
      assert.ok(Math.abs(icon.height - size) < .1);
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
      assert.deepEqual(await page.locator('.pc-plugin-row').first().locator('.pc-category-tag').allTextContents(), ['搜索研究', '音视频']);
      const overflow = await page.locator('.pc-plugin-row,.pc-card-heading,.pc-category-tags,.pc-category-tag').evaluateAll(elements =>
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
      const linkCards = center.locator('.pc-document-link');
      assert.equal(await linkCards.count(), 2);
      assert.deepEqual(await linkCards.locator('.pc-document-link-copy > span').allTextContents(), ['github.com', 'github.com']);
      const documentationUrl = 'https://github.com/7oMB2006/Bilibili-Video-Research/blob/main/README.zh-CN.md';
      assert.equal(await linkCards.first().getAttribute('href'), documentationUrl);
      for (const card of await linkCards.all()) {
        assert.equal(await card.getAttribute('target'), '_blank');
        assert.equal(await card.getAttribute('rel'), 'noopener noreferrer');
      }
      const inlineLink = center.locator('.pc-document-markdown a').filter({ hasText: '完整项目文档' });
      assert.equal(await inlineLink.count(), 1, 'A body link is not promoted to a website card');
      assert.equal(await inlineLink.getAttribute('href'), documentationUrl);
      assert.equal(await inlineLink.locator('.pc-document-link-icon').count(), 0);
      assert.equal(await center.locator('.pc-documentation').evaluate(element => {
        const links = element.querySelector('.pc-document-links'), heading = element.querySelector('.pc-document-heading');
        return Boolean(links.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING);
      }), true, 'Explicit website cards appear before the guide body');
      assert.equal(await center.locator('.pc-document-markdown table:visible').count(), 1);
      assert.equal(await center.locator('.pc-document-credits').getByText('DFSC 社区', { exact: true }).count(), 1);
      assert.equal(await center.locator('.pc-repository .pc-stars').getAttribute('title'), 'GitHub Stars：18，查询于 2026-11-04');
      assert.equal(await center.locator('.pc-detail-footer:visible').count(), 0);
      await page.locator('.pc-detail-scroll').evaluate(element => { element.scrollTop = 0; });
      await page.waitForTimeout(280);
      const documentationOverflow = await page.locator('.pc-detail,.pc-plugin-header,.pc-tutorial,.pc-document-links,.pc-document-link,.pc-documentation,.pc-document-credits').evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className));
      assert.deepEqual(documentationOverflow, [], `${theme}/${width}: documentation layout`);
      await page.screenshot({ path: `${output}/${theme}-${width}-guide.png` });
      await page.mouse.move(0, 0);
      const stickyBand = async position => {
        await page.locator('.pc-detail-scroll').evaluate((element, top) => { element.scrollTop = top; }, position);
        await page.waitForTimeout(50);
        const clip = await page.locator('.pc-detail-tabs').evaluate(element => {
          const tabs = element.getBoundingClientRect(), scroll = element.closest('.pc-detail-scroll');
          const viewport = scroll.getBoundingClientRect();
          if (Math.abs(tabs.top - viewport.top) > 1) throw new Error('Tabs must cover the very top of the scroll viewport');
          return { x: Math.ceil(viewport.left), y: Math.ceil(viewport.top),
            width: Math.floor(scroll.clientWidth - 1), height: Math.floor(tabs.bottom - viewport.top - 1) };
        });
        return page.screenshot({ clip, animations: 'disabled' });
      };
      const stickyStart = await page.locator('.pc-detail-tabs').evaluate(element => {
        const scroll = element.closest('.pc-detail-scroll');
        return scroll.scrollTop + element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      });
      const firstBand = await stickyBand(stickyStart + 32), nextBand = await stickyBand(stickyStart + 82);
      assert.deepEqual(nextBand, firstBand, `${theme}/${width}: scrolling body must not bleed above, through or beside sticky tabs`);
      await page.screenshot({ path: `${output}/${theme}-${width}-scrolled-guide.png` });
      await page.locator('.pc-detail-scroll').evaluate(element => { element.scrollTop = 0; });
      await tutorial.focus();
      assert.equal(await tutorial.evaluate(element => {
        const rect = element.getBoundingClientRect(), parent = element.closest('.pc-detail-scroll').getBoundingClientRect();
        const style = getComputedStyle(element), extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        return rect.left - extent >= parent.left && rect.right + extent <= parent.right
          && rect.top - extent >= parent.top && rect.bottom + extent <= parent.bottom;
      }), true, `${theme}/${width}: tutorial focus outline`);
      for (const card of await linkCards.all()) {
        await page.keyboard.press('Tab');
        assert.equal(await card.evaluate(element => element === document.activeElement), true,
          'Website cards follow the video in keyboard navigation');
        assert.equal(await card.evaluate(element => element.matches(':focus-visible')), true);
        assert.deepEqual(await card.evaluate(focusClips), [], `${theme}/${width}: website card focus outline`);
      }
      await page.getByRole('tab', { name: '更新记录', exact: true }).click();
      assert.equal(await center.locator('.pc-document-markdown:visible').count(), 1);
      await page.screenshot({ path: `${output}/${theme}-${width}-changelog.png` });
      await page.getByRole('button', { name: '全部插件', exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByRole('button', { name: '查看 Bilibili Video Research 使用说明', exact: true }).click();
  const firstCard = center.locator('.pc-document-link').first();
  await firstCard.locator('strong').evaluate(element => { element.textContent = 'ShowcaseWithoutWhitespace'.repeat(8); });
  await firstCard.locator('.pc-document-link-copy > span').evaluate(element => {
    element.textContent = `${'showcase'.repeat(7)}.${'example'.repeat(7)}.example`;
  });
  assert.deepEqual(await firstCard.evaluate(element => [...element.querySelectorAll('*'), element]
    .filter(item => item.scrollWidth > item.clientWidth + 1).map(item => item.className)), [],
  'Long website titles and domains wrap without hiding the external-link affordance');
  await firstCard.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.deepEqual(await firstCard.evaluate(focusClips), [], 'Long website card focus remains inside the scroll viewport');
  await page.screenshot({ path: `${output}/dark-390-long-website-link.png` });
  await page.getByRole('button', { name: '全部插件', exact: true }).click();
  const cards = page.locator('.pc-plugin-row');
  assert.equal(await cards.nth(0).locator('.pc-stars').count(), 1);
  assert.equal(await cards.nth(1).locator('.pc-stars > span').innerText(), '-', 'Unavailable stars are marked unknown, not shown as zero');
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
