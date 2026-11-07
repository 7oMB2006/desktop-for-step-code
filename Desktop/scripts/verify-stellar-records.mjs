import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const results = {};
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1', JSON.stringify({ themeMotion: false })));
  const open = async (view = 'chat') => {
    await page.goto(`${base}?view=${view}`);
    await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  };
  const shot = async name => {
    await page.mouse.move(800, 35);
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(output, `${name}.png`) });
  };
  const panel = async name => {
    const button = page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name, exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    await page.waitForTimeout(350);
  };
  const focus = async locator => {
    await locator.evaluate(async e => {
      // Check settled disclosure geometry, not its transient clipped opening frame.
      const animations = [];
      for (let node = e; node; node = node.parentElement)
        animations.push(...node.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity));
      await Promise.all(animations.map(a => a.finished.catch(() => {})));
    });
    await locator.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const result = await locator.evaluate(e => {
      const style = getComputedStyle(e), box = e.getBoundingClientRect();
      const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const clips = [];
      for (let parent = e.parentElement; parent; parent = parent.parentElement) {
        const s = getComputedStyle(parent), r = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX))
          clips.push(box.left - extent >= r.left - .5 && box.right + extent <= r.right + .5);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowY))
          clips.push(box.top - extent >= r.top - .5 && box.bottom + extent <= r.bottom + .5);
      }
      return { visible: e.matches(':focus-visible'), outline: style.outlineWidth, clips };
    });
    assert.equal(result.visible, true);
    assert.equal(result.outline, '2px');
    assert.ok(result.clips.every(Boolean), JSON.stringify(result));
  };
  await open();
  await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
  const thinking = page.locator('.thinking').first();
  await thinking.locator(':scope > summary').click();
  await page.waitForTimeout(280);
  assert.equal(await thinking.getAttribute('data-expanded'), 'true');
  assert.equal(await thinking.locator('.thinking-body').evaluate(e => e.inert), false);
  const group = page.locator('.process-tool-group').first();
  await group.locator(':scope > .tool-group-trigger').click();
  const tools = group.locator('.process-tool');
  await tools.first().locator(':scope > summary').click();
  await page.waitForTimeout(280);
  await focus(tools.first().locator(':scope > summary'));
  assert.equal(await tools.first().locator('.process-tool-body').evaluate(e => e.inert), false);
  assert.match(await tools.first().locator('.tool-output').innerText(), /#121212/);
  await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
  await shot('process-open');
  await tools.first().locator(':scope > summary').click();
  assert.equal(await tools.first().locator('.process-tool-body').evaluate(e => e.inert), true);
  await page.waitForTimeout(280);
  assert.equal(await tools.first().evaluate(e => e.open), false);
  await thinking.locator(':scope > summary').click();
  assert.equal(await thinking.locator('.thinking-body').evaluate(e => e.inert), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await thinking.locator(':scope > summary').click();
  assert.equal(await thinking.locator('.thinking-body').evaluate(e => e.getAnimations().length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await panel('上下文');
  const meter = page.getByRole('meter', { name: '上下文占用' });
  assert.equal(await meter.getAttribute('aria-valuenow'), '1.74');
  assert.equal(await page.locator('.context-capacity-strip .is-used').count(), 1);
  assert.equal(await page.locator('.context-usage-input dd').innerText(), '2,380');
  assert.equal(await page.locator('.context-usage-output dd').innerText(), '486');
  const toolFilter = page.getByRole('tab', { name: /^工具\s*2$/ });
  await toolFilter.click();
  assert.equal(await page.locator('.context-message').count(), 2);
  await page.locator('.context-message summary').first().click();
  await focus(page.locator('.context-message summary').first());
  await page.evaluate(() => { window.__copied = ''; window.desktop.copyText = async text => { window.__copied = text; }; });
  await page.getByRole('button', { name: '复制消息 JSON', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(window.__copied).role), 'toolResult');
  await page.locator('.context-panel-scroll').evaluate(e => { e.scrollTop = 0; });
  await shot('context-ledger');
  results.capacity = await page.locator('.context-capacity').evaluate(e => getComputedStyle(e).getPropertyValue('--capacity-color'));
  await page.evaluate(() => {
    const original = window.desktop.snapshot;
    window.desktop.snapshot = async () => {
      const snapshot = await original();
      snapshot.stats.contextUsage = { percent: 96, tokens: 245760, contextWindow: 256000 };
      return snapshot;
    };
  });
  await page.getByRole('button', { name: '刷新上下文', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role=meter]')?.getAttribute('aria-valuenow') === '96');
  results.warning = await page.locator('.context-capacity').evaluate(e => getComputedStyle(e).getPropertyValue('--capacity-color'));
  assert.notEqual(results.warning, results.capacity, 'Theme must preserve the capacity warning scale');
  assert.equal(await page.locator('.context-capacity-strip .is-used').count(), 39);
  await shot('context-warning');
  await page.evaluate(() => {
    const original = window.desktop.snapshot;
    window.desktop.snapshot = async () => { const snapshot = await original(); delete snapshot.stats.contextUsage; return snapshot; };
  });
  await page.getByRole('button', { name: '刷新上下文', exact: true }).click();
  await page.locator('.context-capacity-strip.is-unknown').waitFor();
  assert.equal(await meter.getAttribute('aria-valuenow'), null);
  assert.equal(await page.locator('.context-capacity-strip .is-used').count(), 0);

  await page.evaluate(() => {
    const original = window.desktop.snapshot;
    window.desktop.snapshot = async () => {
      const snapshot = await original();
      snapshot.preferences.interfaceSettings = { preset: 'simple' };
      return snapshot;
    };
  });
  await page.getByRole('button', { name: '刷新上下文', exact: true }).click();
  await page.locator('.compact-process[data-single=true]').first().waitFor();
  const single = page.locator('.compact-process[data-single=true]').first();
  assert.equal(await single.locator(':scope > .tool-group-trigger').isVisible(), false);
  assert.equal(await single.locator('.tool-group-disclosure > div').evaluate(e => getComputedStyle(e, '::before').content), 'none');
  await panel('摘要');
  const compactGroup = page.locator('.compact-process[data-single=false]').first();
  await compactGroup.locator(':scope > .tool-group-trigger').click();
  await compactGroup.locator('.process-tool > summary').first().click();
  await focus(compactGroup.locator('.process-tool > summary').first());
  await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
  await shot('process-compact');

  await open();
  await panel('变更');
  await page.locator('.review-file-row').first().click();
  await page.locator('.review-file-body.is-open .turn-diff-table').waitFor();
  await focus(page.locator('.review-file-row').first());
  const diffColors = () => page.locator('#review-panel .diff-line-add, #review-panel .diff-line-remove').evaluateAll(nodes =>
    nodes.map(e => ({ kind: e.className, color: getComputedStyle(e).backgroundColor })));
  results.unified = await diffColors();
  assert.equal(new Set(results.unified.map(e => e.color)).size, 2);
  assert.ok(results.unified.every(e => e.color !== 'rgba(0, 0, 0, 0)'));
  await shot('diff-unified');
  await page.getByRole('button', { name: '切换为左右对比', exact: true }).click();
  await page.locator('#review-panel .diff-split-table').waitFor();
  results.split = await diffColors();
  assert.equal(new Set(results.split.map(e => e.color)).size, 2);
  await shot('diff-split');

  await panel('文件预览');
  await page.locator('#file-panel > header').getByRole('button', { name: '打开文件', exact: true }).click();
  await page.locator('.file-preview-markdown h1').waitFor();
  assert.equal(await page.locator('.file-preview-identity strong').innerText(), 'stellar-notes.md');
  await shot('file-document');
  await page.getByRole('button', { name: '查看源码', exact: true }).click();
  await page.getByRole('button', { name: '自动换行', exact: true }).click();
  await page.locator('.file-preview-source.is-wrapped').waitFor();
  await focus(page.locator('.file-preview-scroll'));
  await page.evaluate(() => { window.__copied = ''; window.desktop.copyText = async text => { window.__copied = text; }; });
  await page.getByRole('button', { name: '复制文件内容', exact: true }).click();
  assert.equal(await page.locator('.file-preview-source').innerText(), await page.evaluate(() => window.__copied));
  await shot('file-source');
  await page.getByRole('button', { name: '刷新文件', exact: true }).click();
  assert.equal(await page.locator('.file-preview-identity strong').innerText(), 'stellar-notes.md');

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    for (const [name, selector] of [['上下文', '#context-panel'], ['变更', '#review-panel'], ['文件预览', '#file-panel']]) {
      await panel(name);
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${name}: ${JSON.stringify(box)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (name === '文件预览') {
        await focus(page.locator('.file-preview-scroll'));
        assert.equal(await page.locator('.file-preview-scroll').evaluate(e => e.scrollWidth > e.clientWidth), false);
      }
      await shot(`${selector.slice(1)}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '原版浅色', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  assert.equal(await page.locator('.file-preview-source').evaluate(e => getComputedStyle(e).boxShadow), 'none');
  assert.notEqual(await page.locator('.file-preview-source').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(22, 23, 25)');
  await shot('built-in-file');
  await page.setViewportSize({ width: 1908, height: 1080 });
  await open();
  await page.locator('.thinking > summary').first().click();
  await page.locator('.process-tool-group > .tool-group-trigger').first().click();
  await page.locator('.process-tool > summary').first().click();
  await panel('上下文');
  await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
  await shot('workspace-records');
  await page.evaluate(() => {
    const original = window.desktop.snapshot;
    window.desktop.snapshot = async () => {
      const snapshot = await original();
      const failed = snapshot.messages.find(message => message.toolCallId === 'read-theme');
      failed.isError = true;
      const historical = snapshot.messages.find(message => message.toolCallId === 'edit-theme');
      historical.desktopImported = true;
      delete historical.details;
      return snapshot;
    };
  });
  await page.getByRole('button', { name: '刷新上下文', exact: true }).click();
  await panel('摘要');
  await page.locator('.process-tool.failed > summary').waitFor();
  assert.match(await page.locator('.process-tool.missing > summary').innerText(), /结果未知/);
  await page.locator('.process-tool.failed > summary').click();
  await page.locator('.process-tool.missing > summary').click();
  assert.equal(await page.locator('.process-tool.failed .process-tool-status > svg, .process-tool.missing .process-tool-status > svg').count(), 0);
  results.failed = await page.locator('.process-tool.failed > summary').evaluate(e => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    e.append(probe);
    const result = { color: getComputedStyle(e).color, expected: getComputedStyle(probe).color };
    probe.remove();
    return result;
  });
  assert.equal(results.failed.color, results.failed.expected);
  await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
  await shot('process-outcomes');
  await open('permission');
  await page.getByRole('button', { name: '稍后处理', exact: true }).click();
  await page.locator('.approval-drawer').waitFor({ state: 'detached' });
  const waiting = page.locator('.process-tool.waiting');
  await waiting.locator(':scope > summary').waitFor();
  assert.match(await waiting.innerText(), /等待批准/);
  results.waiting = await waiting.locator(':scope > summary > svg').first().evaluate(e => getComputedStyle(e).color);
  assert.notEqual(results.waiting, results.failed.color);
  await shot('process-waiting');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, results, errors }));
} catch (error) {
  await writeFile(join(output, 'failure.txt'), String(error));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
