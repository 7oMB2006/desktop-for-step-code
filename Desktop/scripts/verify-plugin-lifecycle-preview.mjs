import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { settleLayout } from './settle-layout.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5195/tool-status-preview.html?lifecycle=1';
const output = resolve(process.argv[3] ?? 'output/playwright/plugin-lifecycle');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const card = id => page.locator(`.lc-card[data-plugin="${id}"]`);
const panel = () => page.locator('.lc-panel');
const ring = () => panel().locator('.lc-instance-ring');
const close = async () => {
  await page.keyboard.press('Escape');
  await panel().waitFor({ state: 'detached' });
};
const geometry = () => page.locator('.lc-scroll').evaluate(scroll => ({
  scrollTop: scroll.scrollTop,
  cards: [...scroll.querySelectorAll('.lc-card')].map(element => {
    const rect = element.getBoundingClientRect();
    return { id: element.dataset.plugin, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }),
}));
const unchanged = async (before, label) => assert.deepEqual(await geometry(), before, label);
const shot = async name => {
  await settleLayout(page.locator('.lc-center'));
  if (await panel().count()) await settleLayout(panel());
  await page.screenshot({ path: join(output, name), animations: 'disabled' });
};
try {
  await page.goto(url);
  await card('bvr').waitFor();
  assert.equal(await page.locator('.lc-card').count(), 9);
  assert.equal(await panel().count(), 0);
  assert.equal(await page.getByRole('button', { name: '查看', exact: true }).count(), 0);
  await shot('desktop-collapsed.png');
  await card('bvr').getByRole('button', { name: '更新 Bilibili Video Research', exact: true }).click();
  assert.equal(await ring().getAttribute('data-done'), '0');
  assert.equal(await ring().getAttribute('data-complete'), 'false');
  assert.equal(await ring().locator('circle[data-phase=idle]').count(), 2);
  assert.match(await panel().locator('summary').innerText(), /2\/2 可立即加载/);
  await shot('ring-ready-idle.png');
  await close();
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('unknown');
  await card('bvr').getByRole('button', { name: '更新 Bilibili Video Research', exact: true }).click();
  assert.equal(await ring().locator('circle[data-phase=unknown]').count(), 1);
  assert.equal(await ring().locator('circle[data-phase=occupied]').count(), 0);
  assert.match(await panel().locator('summary').innerText(), /1\/2 可立即加载/);
  assert.match(await panel().locator('summary').innerText(), /1 个待确认/);
  await shot('ring-ready-unknown.png');
  await close();
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('busy');
  const gridBefore = await geometry();
  await card('bvr').getByRole('button', { name: '更新 Bilibili Video Research', exact: true }).click();
  await unchanged(gridBefore, 'opening dialog must not move any grid row');
  await panel().getByText('更新插件', { exact: true }).waitFor();
  assert.equal(await panel().locator('summary').getAttribute('aria-expanded'), 'false');
  assert.equal(await ring().getAttribute('data-done'), '0');
  assert.equal(await ring().locator('circle[data-phase=idle]').count(), 1);
  assert.equal(await ring().locator('circle[data-phase=occupied]').count(), 1);
  assert.match(await ring().locator('.lc-ring-segment[data-phase=occupied] > .lc-ring-texture').getAttribute('style'), /url\(["']?#/);
  assert.match(await ring().getAttribute('aria-label'), /1 个空闲/);
  assert.match(await ring().getAttribute('aria-label'), /1 个占用/);
  assert.match(await panel().locator('summary').innerText(), /1\/2 可立即加载/);
  assert.match(await panel().innerText(), /保留配置与开关，更新后自动加载新版/);
  assert.doesNotMatch(await panel().innerText(), /重启.*会话|其他工具也会重连/);
  await shot('desktop-update.png');
  await panel().screenshot({ path: join(output, 'ring-ready-busy-dialog.png'), animations: 'disabled' });
  await panel().locator('summary').click();
  await panel().getByText('调用进行中', { exact: true }).waitFor();
  await unchanged(gridBefore, 'expanding instances must not move later plugins');
  await panel().getByRole('button', { name: '更新并加载', exact: true }).click();
  assert.equal(await ring().locator('circle[data-phase=idle]').count(), 1);
  assert.equal(await ring().locator('circle[data-phase=occupied]').count(), 1);
  await panel().locator('li small[data-phase=done]').waitFor();
  await panel().getByText('等待插件调用结束', { exact: true }).waitFor();
  assert.equal(await ring().getAttribute('data-done'), '1');
  assert.equal(await ring().locator('circle[data-phase=occupied]').count(), 1);
  assert.equal(await ring().locator('circle[data-phase=done]').count(), 1);
  const operationId = await card('bvr').getAttribute('data-operation-id');
  assert.match(await card('bvr').locator('.lc-version').innerText(), /v0.2.0/);
  await shot('desktop-update-waiting.png');
  await panel().locator('summary').click();
  await shot('ring-waiting-collapsed.png');
  await unchanged(gridBefore, 'progress changes must not resize cards or move the grid');
  await close();
  await unchanged(gridBefore, 'closing dialog must preserve grid position');
  await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).click();
  await panel().getByText('等待插件调用结束', { exact: true }).waitFor();
  assert.equal(await card('bvr').getAttribute('data-operation-id'), operationId);
  assert.equal(await panel().getByRole('button', { name: '重新加载', exact: true }).count(), 0);
  checks.push('update installs and loads in one operation; reload opens the same running task instead of duplicating it');
  checks.push('all nine card positions, sizes and list scroll position stay unchanged while opening, expanding, progressing, closing and reopening');
  await panel().locator('summary').click();
  await panel().getByRole('button', { name: '前往会话 插件联调记录', exact: true }).click();
  await page.locator('.web-preview-chat').waitFor();
  assert.equal(await panel().count(), 0);
  await page.locator('.sidebar-plugins-entry').click();
  assert.equal(await panel().count(), 0);
  await card('bvr').getByRole('button', { name: '更新进度 Bilibili Video Research', exact: true }).click();
  await panel().getByText('等待插件调用结束', { exact: true }).waitFor();
  assert.equal(await card('bvr').getAttribute('data-operation-id'), operationId);
  checks.push('navigation and closing details preserve the running operation');
  await panel().getByRole('button', { name: '取消等待', exact: true }).click();
  await panel().locator('.lc-operation-title').filter({ hasText: /^等待已取消$/ }).waitFor();
  assert.equal(await ring().getAttribute('data-complete'), 'false');
  assert.equal(await ring().locator('circle[data-phase=cancelled]').count(), 1);
  await close();
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('idle');
  assert.equal(await card('bvr').getAttribute('data-operation-phase'), 'cancelled');
  await page.getByRole('combobox', { name: '加载结果', exact: true }).selectOption('failure');
  const directBefore = await geometry();
  await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).click();
  assert.equal(await panel().count(), 0);
  assert.equal(await card('bvr').getAttribute('data-operation-phase'), 'loading');
  await unchanged(directBefore, 'one-click reload must start without a modal or layout movement');
  await shot('desktop-direct-reload.png');
  await page.locator('.lc-card[data-plugin=bvr][data-operation-phase=failed]').waitFor();
  assert.equal(await panel().count(), 0);
  await card('bvr').getByRole('button', { name: '查看重新加载详情 Bilibili Video Research', exact: true }).click();
  assert.equal(await ring().getAttribute('data-done'), '0');
  assert.equal(await ring().locator('circle[data-phase=failed]').count(), 2);
  assert.match(await ring().getAttribute('aria-label'), /2 个失败/);
  assert.match(await panel().innerText(), /重新加载当前版本 v0.2.0，不更换版本/);
  await shot('desktop-reload.png');
  await panel().getByText('加载未完成', { exact: true }).waitFor();
  assert.match(await panel().getByRole('alert').innerText(), /其他工具可继续使用/);
  assert.equal(await card('playwright').locator('.lc-connection').innerText(), '已连接');
  await close();
  await page.getByRole('combobox', { name: '加载结果', exact: true }).selectOption('success');
  await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).click();
  assert.equal(await panel().count(), 0);
  await page.locator('.lc-card[data-plugin=bvr][data-operation-phase=done]').waitFor();
  await page.locator('.notice-toast.success').getByText('Bilibili Video Research 已重新加载', { exact: true }).waitFor();
  assert.equal(await panel().count(), 0);
  await unchanged(directBefore, 'failure and successful direct retry must not shift the grid');
  assert.match(await card('bvr').locator('.lc-version').innerText(), /v0.2.0/);
  await shot('desktop-reload-success.png');
  await page.locator('.notice-toast.success').waitFor({ state: 'detached' });
  checks.push('one click starts reload without a confirmation; failures do not auto-open a dialog; direct retry keeps the version and success feedback auto-dismisses');
  await page.getByRole('combobox', { name: '加载结果', exact: true }).selectOption('failure');
  await card('playwright').getByRole('button', { name: '更新 Playwright', exact: true }).click();
  await panel().getByRole('button', { name: '更新并加载', exact: true }).click();
  await panel().getByText('新版已安装，加载未完成', { exact: true }).waitFor();
  assert.match(await card('playwright').locator('.lc-version').innerText(), /v2.0.0/);
  assert.equal(await panel().getByRole('button', { name: '更新并加载', exact: true }).count(), 0);
  await shot('desktop-update-failed.png');
  await close();
  await page.getByRole('combobox', { name: '加载结果', exact: true }).selectOption('success');
  await card('playwright').getByRole('button', { name: '更新详情 Playwright', exact: true }).click();
  await panel().getByRole('button', { name: '重试加载', exact: true }).click();
  assert.notEqual(await card('playwright').getAttribute('data-operation-phase'), 'installing');
  await panel().getByText('更新完成', { exact: true }).waitFor();
  assert.equal(await panel().locator('summary').getAttribute('aria-expanded'), 'false');
  assert.equal(await ring().getAttribute('data-complete'), 'true');
  assert.match(await panel().locator('summary').innerText(), /2\/2 已加载/);
  assert.equal(await ring().getAttribute('data-done'), '2');
  assert.equal(await ring().locator('.lc-ring-base').count(), 2);
  assert.deepEqual(await ring().locator('.lc-ring-base').evaluateAll(elements => elements.map(element =>
    element.getAttribute('stroke-dasharray'))), ['50 50', '50 50']);
  await shot('ring-success-collapsed.png');
  checks.push('installed-but-not-loaded update offers load retry without reinstalling the package');
  await page.keyboard.press('Escape');
  assert.equal(await panel().count(), 0);
  assert.equal(await card('playwright').getByRole('button', { name: '更新结果 Playwright', exact: true })
    .evaluate(element => document.activeElement === element), true);
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('busy');
  await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).click();
  await page.locator('.lc-card[data-plugin=bvr][data-operation-phase=waiting]').waitFor();
  await page.getByRole('combobox', { name: '加载结果', exact: true }).selectOption('failure');
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('idle');
  await page.locator('.lc-card[data-plugin=bvr][data-operation-phase=failed]').waitFor();
  await card('bvr').getByRole('button', { name: '查看重新加载详情 Bilibili Video Research', exact: true }).click();
  assert.equal(await ring().getAttribute('data-done'), '1');
  assert.equal(await ring().getAttribute('data-complete'), 'false');
  assert.equal(await ring().locator('circle[data-phase=done]').count(), 1);
  assert.equal(await ring().locator('circle[data-phase=failed]').count(), 1);
  assert.match(await ring().getAttribute('aria-label'), /1 个失败/);
  assert.match(await ring().getAttribute('aria-label'), /1 个成功/);
  await shot('ring-partial-failure-collapsed.png');
  await close();
  await page.getByRole('combobox', { name: '加载结果', exact: true }).selectOption('success');
  checks.push('collapsed instance rings distinguish not-started, waiting, cancelled, failed and mixed results; 2/2 success becomes one unbroken green ring with accessible status text');
  await page.getByRole('button', { name: '切换浅色', exact: true }).click();
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('busy');
  await card('steppage').getByRole('button', { name: '更新 StepPage', exact: true }).click();
  assert.equal(await ring().locator('circle[data-phase=occupied]').count(), 1);
  await shot('ring-ready-light.png');
  await panel().screenshot({ path: join(output, 'ring-ready-busy-dialog-light.png'), animations: 'disabled' });
  await close();
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('idle');
  await card('playwright').getByRole('button', { name: '重载 Playwright', exact: true }).click();
  assert.equal(await panel().count(), 0);
  await card('playwright').getByRole('button', { name: '查看重新加载详情 Playwright', exact: true }).click();
  await shot('desktop-light.png');
  await panel().getByRole('button', { name: '关闭操作详情', exact: true }).click();
  await card('git').getByRole('button', { name: '重载 Git', exact: true }).scrollIntoViewIfNeeded();
  await settleLayout(page.locator('.lc-center'));
  const lowerBefore = await geometry();
  await card('git').getByRole('button', { name: '重载 Git', exact: true }).click();
  assert.equal(await panel().count(), 0);
  const lowerOperation = await card('git').getAttribute('data-operation-id');
  await card('git').getByRole('button', { name: '重载 Git', exact: true }).click();
  assert.equal(await card('git').getAttribute('data-operation-id'), lowerOperation);
  await panel().locator('summary').click();
  await settleLayout(panel());
  await unchanged(lowerBefore, 'opening details from a lower row must not move the list');
  await shot('desktop-lower-row.png');
  await close();
  await unchanged(lowerBefore, 'returning focus to a lower row must preserve scroll');
  for (const width of [745, 390]) {
    await page.setViewportSize({ width, height: 840 });
    const sidebar = page.getByRole('button', { name: '切换侧栏', exact: true });
    if (await sidebar.getAttribute('aria-expanded') === 'true') await sidebar.click();
    await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).scrollIntoViewIfNeeded();
    await settleLayout(page.locator('.lc-center'));
    const narrowBefore = await geometry();
    await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).click();
    assert.equal(await panel().count(), 0);
    assert.equal(await page.locator('.notice-toast.success').getByText('Bilibili Video Research 已重新加载', { exact: true }).count(), 0);
    await unchanged(narrowBefore, 'narrow one-click reload must not move the list');
    await shot(`narrow-direct-${width}.png`);
    await card('bvr').getByRole('button', { name: '查看重新加载详情 Bilibili Video Research', exact: true }).click();
    await panel().getByText('重新加载完成', { exact: true }).waitFor();
    await panel().locator('summary').click();
    await settleLayout(panel());
    const layout = await page.locator('.lc-grid').evaluate(grid => {
      const cards = [...grid.querySelectorAll('.lc-card')];
      return {
        overflow: cards.some(card => card.scrollWidth > card.clientWidth + 1),
        overlap: cards.some((card, index) => cards.slice(index + 1).some(other => {
          const a = card.getBoundingClientRect(), b = other.getBoundingClientRect();
          return Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1
            && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
        })),
      };
    });
    assert.deepEqual(layout, { overflow: false, overlap: false });
    const bounds = await panel().evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
        overflow: element.scrollWidth > element.clientWidth + 1 };
    });
    assert.deepEqual(bounds, { inside: true, overflow: false });
    await unchanged(narrowBefore, 'narrow dialog must not shift or scroll the list');
    await shot(`narrow-${width}.png`);
    await page.keyboard.press('Escape');
  }
  checks.push('Escape restores trigger focus; lower-row scroll is retained; light and narrow dialogs fit without grid movement or overflow');
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('unknown');
  await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).click();
  assert.equal(await panel().count(), 0);
  await page.locator('.lc-card[data-plugin=bvr][data-operation-phase=waiting]').waitFor();
  const waitingOperation = await card('bvr').getAttribute('data-operation-id');
  await card('bvr').getByRole('button', { name: '重载 Bilibili Video Research', exact: true }).click();
  assert.equal(await card('bvr').getAttribute('data-operation-id'), waitingOperation);
  await panel().locator('summary').click();
  await panel().getByText('状态待确认', { exact: true }).waitFor();
  assert.equal(await ring().locator('circle[data-phase=unknown]').count(), 1);
  assert.equal(await ring().locator('circle[data-phase=occupied]').count(), 0);
  await panel().getByRole('button', { name: '取消等待', exact: true }).click();
  await close();
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('idle');
  checks.push('unknown target state waits safely without opening a modal; repeated reload opens the existing task; waiting can be cancelled');
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('busy');
  await card('steppage').getByRole('button', { name: '更新 StepPage', exact: true }).click();
  assert.match(await panel().locator('summary').innerText(), /1\/2 可立即加载/);
  const narrowReady = await panel().evaluate(element => ({
    overflow: element.scrollWidth > element.clientWidth + 1,
    headingWidth: element.querySelector('.lc-instance-heading').getBoundingClientRect().width,
    summaryWidth: element.querySelector('summary').getBoundingClientRect().width,
  }));
  assert.equal(narrowReady.overflow, false);
  assert.ok(narrowReady.headingWidth < narrowReady.summaryWidth);
  await shot('ring-ready-busy-narrow.png');
  await close();
  await page.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('idle');
  checks.push('before execution idle segments are solid neutral and occupied segments are hatched; unknown stays unconfirmed; readiness counts change to explicit result counts after execution, in light/dark and narrow layouts');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card('bvr').getByRole('button', { name: '卸载 Bilibili Video Research', exact: true }).click();
  await panel().getByRole('button', { name: '确认卸载', exact: true }).waitFor();
  assert.equal(await card('bvr').count(), 1);
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await card('bvr').count(), 1);
  await card('bvr').getByRole('button', { name: '卸载 Bilibili Video Research', exact: true }).click();
  await panel().getByRole('button', { name: '确认卸载', exact: true }).click();
  await card('bvr').waitFor({ state: 'detached' });
  await panel().waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('textbox', { name: '搜索插件', exact: true }).evaluate(element => document.activeElement === element), true);
  await page.getByText('插件已卸载，会话记录已保留。', { exact: true }).waitFor();
  checks.push('uninstall requires separate destructive confirmation and remains usable with reduced motion');
  const motionPage = await browser.newPage({ viewport: { width: 1000, height: 760 },
    recordVideo: { dir: join(output, 'motion'), size: { width: 1000, height: 760 } } });
  motionPage.on('pageerror', error => errors.push(error.message));
  await motionPage.goto(url);
  await motionPage.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('busy');
  await motionPage.locator('.lc-card[data-plugin=steppage]').getByRole('button', { name: '更新 StepPage', exact: true }).click();
  const motionPanel = motionPage.locator('.lc-panel');
  await settleLayout(motionPanel);
  await motionPanel.getByRole('button', { name: '更新并加载', exact: true }).click();
  const sample = duration => motionPanel.locator('.lc-instance-ring').evaluate(async (element, duration) => {
    const frames = [], start = performance.now();
    while (performance.now() - start < duration) {
      await new Promise(requestAnimationFrame);
      frames.push({
        time: Math.round(performance.now() - start),
        phases: [...element.querySelectorAll('.lc-ring-segment')].map(segment => segment.dataset.phase),
        strokes: [...element.querySelectorAll('.lc-ring-base')].map(circle => getComputedStyle(circle).stroke),
        textures: [...element.querySelectorAll('.lc-ring-texture')].map(circle => Number(getComputedStyle(circle).opacity)),
        gaps: [...element.querySelectorAll('.lc-ring-base')].map(circle => getComputedStyle(circle).strokeDasharray),
      });
    }
    return frames;
  }, duration);
  const startingFrames = await sample(1600);
  // The fixture toolbar simulates an external tool call ending while its details remain open.
  await motionPage.getByRole('combobox', { name: '目标插件占用', exact: true }).selectOption('idle', { force: true });
  const completingFrames = await sample(2200);
  assert.ok(completingFrames.some(frame => frame.textures[0] > 0 && frame.textures[0] < 1),
    'occupied texture must fade through intermediate opacity rather than switch instantly');
  const colors = new Set([...startingFrames, ...completingFrames].flatMap(frame => frame.strokes));
  assert.ok(colors.size > 5, 'neutral, loading and success colors must interpolate through actual rendered frames');
  assert.ok(completingFrames.some(frame => frame.gaps.some(value => parseFloat(value) > 48 && parseFloat(value) < 50)),
    'success gaps must close gradually');
  assert.equal(await motionPanel.locator('.lc-instance-ring').getAttribute('data-complete'), 'true');
  await motionPage.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await motionPanel.locator('.lc-instance-ring').evaluate(element => ({
    transitions: [...element.querySelectorAll('circle')].map(circle => getComputedStyle(circle).transitionDuration),
    activity: [...element.querySelectorAll('.lc-ring-activity')].map(group => getComputedStyle(group).display),
  }));
  assert.ok(reduced.transitions.every(duration => duration === '0s'));
  assert.ok(reduced.activity.every(display => display === 'none'));
  await writeFile(join(output, 'motion-frames.json'), JSON.stringify({ startingFrames, completingFrames }, null, 2));
  const video = motionPage.video();
  await motionPage.close();
  const motionVideo = await video.path();
  checks.push('recorded rendered frames show texture crossfade, interpolated colors and smooth full-ring closure; reduced motion disables transitions and activity');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ scope: 'Simulated web interaction only; no native plugin hot reload is implemented or exercised.', checks, errors, motionVideo }, null, 2));
  console.log(JSON.stringify({ checks, errors, motionVideo }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
  console.error(await panel().allTextContents());
  throw error;
} finally {
  await browser.close();
}
