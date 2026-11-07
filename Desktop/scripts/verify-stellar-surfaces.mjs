import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2], capture = process.argv.includes('--capture-before');
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const image = (await readFile(join(root, '../theme-marketplace/plugins/stellar-cruise/cover.png'))).toString('base64');
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser, page;
const results = {}, errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(e.message));
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  const metrics = locator => locator.evaluate(e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, color: s.color,
      background: s.backgroundColor, border: s.borderColor, radius: s.borderRadius, shadow: s.boxShadow,
      font: s.fontFamily, size: s.fontSize, transition: s.transition, animation: s.animationName };
  });
  const shot = async name => {
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${name}.png`) });
  };
  // Compare decoded pixels from the settled full-page frame, not PNG encoding.
  const thumbnailHash = async (prefix, key, bounds) => {
    const png = (await readFile(join(output, `${prefix}-${key}-attachments.png`))).toString('base64');
    const pixels = await page.evaluate(async ({ png, bounds }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bounds.width - 2; canvas.height = bounds.height - 2;
      const context = canvas.getContext('2d');
      context.drawImage(image, -Math.round(bounds.x + 1), -Math.round(bounds.y + 1));
      image.close();
      return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
    }, { png, bounds });
    return createHash('sha256').update(Buffer.from(pixels)).digest('hex');
  };
  const focus = async (locator, cycle = true) => {
    if (cycle) { await locator.focus(); await locator.press('Tab'); await page.keyboard.press('Shift+Tab'); }
    const info = await locator.evaluate(e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
      const fits = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(ps.overflowX)) fits.push(r.left - extent >= pr.left - .5 && r.right + extent <= pr.right + .5);
        if (/(auto|scroll|hidden|clip)/.test(ps.overflowY)) fits.push(r.top - extent >= pr.top - .5 && r.bottom + extent <= pr.bottom + .5);
      }
      return { visible: e.matches(':focus-visible'), width: parseFloat(s.outlineWidth), fits };
    });
    assert.ok(info.visible && info.width >= 1 && info.fits.every(Boolean), JSON.stringify(info));
  };
  await page.goto(base);
  await page.locator('.composer-input').waitFor();
  for (const theme of ['plugin:stellar-cruise', 'original-light', 'original-dark']) {
    // Use the actual registered theme IDs, selected through Appearance below for built-ins.
    if (theme === 'plugin:stellar-cruise') {
      await page.evaluate(() => window.desktop.preferences({ theme: 'plugin:stellar-cruise', themeMotion: false }));
    } else {
      await page.locator('.sidebar-bottom > button').click();
      await page.getByRole('button', { name: '外观', exact: true }).click();
      await page.getByRole('button', { name: theme === 'original-light' ? '原版浅色' : '原版深色', exact: true }).click();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.locator('.settings-dialog').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.stellar-workspace-scene').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme-material')), false);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-stellar-motion')), false);
    }
    await page.goto(`${base}?view=chat`);
    await page.locator('.composer-input').waitFor();
    if (theme === 'plugin:stellar-cruise') {
      await page.waitForFunction(() => document.documentElement.dataset.stellarMotion === 'false');
      await page.locator('.stellar-workspace-scene canvas').waitFor();
    }
    await page.evaluate(() => {
      window.desktop.terminalResize = async () => {};
      window.desktop.terminalList = async () => [0, 1].map(i => ({
        id: `preview-terminal-${i}`, cwd: 'D:\\Preview\\Stellar', title: i ? 'Checks' : 'PowerShell',
        status: 'exited', cols: 80, rows: 24, exitCode: 0,
        chunks: [{ seq: 1, data: 'PS D:\\Preview\\Stellar> verify\r\n\x1b[32mPASS\x1b[0m layout\r\n\x1b[33mWARN\x1b[0m offline preview\r\n\x1b[31mERROR\x1b[0m sample only\r\n' }],
      }));
    });
    await page.evaluate(data => {
      const choose = window.desktop.chooseAttachments;
      window.desktop.chooseAttachments = async () => [...await choose(),
        { kind: 'image', name: 'stellar-cover.png', content: { type: 'image', mimeType: 'image/png', data } }];
    }, image);
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    await page.getByRole('option', { name: /文件和图片/ }).click();
    await page.locator('.attachment-card.image img').waitFor();
    await page.locator('.attachment-card.image img').evaluate(e => e.decode());
    const widths = theme === 'plugin:stellar-cruise' ? [1440, 760, 390] : [1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 960 });
      if (width < 1000) {
        const summary = page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name: '摘要', exact: true });
        if (await summary.getAttribute('aria-pressed') === 'true') await summary.click();
      }
      await page.mouse.move(190, 16);
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(250);
      const key = `${theme.replace(':', '-')}-${width}`, state = {};
      results[key] = state;
      const file = page.locator('.attachment-card.file'), picture = page.locator('.attachment-card.image');
      state.file = await metrics(file); state.fileName = await metrics(file.locator('.attachment-file > span'));
      state.image = await metrics(picture);
      assert.deepEqual([state.file.width, state.file.height], [116, 104]);
      assert.deepEqual([state.image.width, state.image.height], [116, 104]);
      assert.equal(await file.locator('.attachment-remove').evaluate(e => getComputedStyle(e).opacity), '0');
      await shot(`${key}-attachments`);
      state.pixels = await thumbnailHash(capture ? 'before' : 'after', key, state.image);
      await focus(file.locator('.attachment-remove'));
      assert.equal(await file.locator('.attachment-remove').evaluate(e => getComputedStyle(e).pointerEvents), 'auto');
      await picture.locator('.attachment-open').click();
      await page.locator('.attachment-preview').waitFor();
      await page.waitForTimeout(250);
      state.preview = await metrics(page.locator('.attachment-preview'));
      state.previewToolbar = await metrics(page.locator('.attachment-preview-toolbar'));
      state.previewImage = await metrics(page.locator('.attachment-preview-image img'));
      assert.equal(await page.locator('.attachment-preview-image img').evaluate(e => getComputedStyle(e).filter), 'none');
      await shot(`${key}-image-preview`);
      await page.keyboard.press('Escape');
      await page.locator('.attachment-preview').waitFor({ state: 'detached' });
      assert.equal(await picture.locator('.attachment-open').evaluate(e => e === document.activeElement), true);
      await page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name: '终端', exact: true }).click();
      await page.getByRole('tab', { name: 'PowerShell', exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Checks', exact: true }).click();
      assert.equal(await page.getByRole('tab', { name: 'Checks', exact: true }).getAttribute('aria-selected'), 'true');
      await page.waitForTimeout(250);
      state.terminalTabs = await metrics(page.locator('.terminal-tabs'));
      state.terminalToolbar = await metrics(page.locator('.terminal-toolbar'));
      state.terminalFooter = await metrics(page.locator('.terminal-footer'));
      state.terminalOutput = await metrics(page.locator('.terminal-output'));
      await shot(`${key}-terminal`);
      await page.getByRole('button', { name: '关闭终端面板', exact: true }).click();
      await page.waitForTimeout(200);
      await picture.locator('img').click({ button: 'right' });
      const imageMenu = page.getByRole('menu', { name: '图片操作', exact: true });
      state.context = await metrics(imageMenu);
      await imageMenu.getByRole('menuitem').first().press('ArrowDown');
      assert.equal(await imageMenu.getByRole('menuitem').last().evaluate(e => e === document.activeElement), true);
      if (!capture && theme === 'plugin:stellar-cruise') await focus(imageMenu.getByRole('menuitem').last(), false);
      await shot(`${key}-image-menu`);
      await page.keyboard.press('Escape');
      await imageMenu.waitFor({ state: 'detached' });
      assert.equal(await picture.locator('.attachment-open').evaluate(e => e === document.activeElement), true);
      const fileTrigger = page.locator('.window-menu > button').filter({ hasText: /^文件$/ });
      await fileTrigger.click();
      const windowMenu = page.locator('.window-menu-popover');
      state.windowMenu = await metrics(windowMenu);
      await shot(`${key}-window-menu`);
      await page.keyboard.press('Escape');
      assert.equal(await fileTrigger.evaluate(e => e === document.activeElement), true);
      if (width === 1440) {
        await page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name: '上下文', exact: true }).click();
        await page.getByRole('button', { name: '调整右栏宽度', exact: true }).click();
        const menu = page.getByRole('menu', { name: '右栏宽度', exact: true });
        await page.waitForTimeout(100);
        state.menu = await metrics(menu);
        state.selected = await metrics(menu.locator('[aria-checked=true]'));
        await shot(`${key}-selection-menu`);
        await page.keyboard.press('End');
        assert.equal(await menu.getByRole('menuitemradio').last().evaluate(e => e === document.activeElement), true);
        if (!capture && theme === 'plugin:stellar-cruise') await focus(menu.getByRole('menuitemradio').last(), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: '调整右栏宽度', exact: true }).evaluate(e => e === document.activeElement), true);
        await page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name: '摘要', exact: true }).click();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('.attachment-card.file .attachment-remove').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.attachment-card').count(), 1);
    if (!capture && theme === 'plugin:stellar-cruise') {
      await page.locator('.workspace-heading.current').click({ button: 'right' });
      const remove = page.locator('.sidebar-context .project-remove-menu');
      await remove.waitFor();
      assert.equal(await remove.evaluate(e => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--danger)'; document.body.append(probe);
        const same = getComputedStyle(e).color === getComputedStyle(probe).color;
        probe.remove(); return same;
      }), true, 'Project removal retains its semantic danger color');
      await focus(remove);
      await shot('project-menu');
      await page.keyboard.press('Escape');
    }
  }
  assert.deepEqual(errors, []);
  if (capture) await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  else {
    let baseline;
    try { baseline = JSON.parse(await readFile(join(output, 'before.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (baseline) {
      for (const [view, surfaces] of Object.entries(results)) {
        baseline[view].pixels = await thumbnailHash('before', view, baseline[view].image);
        if (!view.startsWith('plugin-')) assert.deepEqual(surfaces, baseline[view], `${view} unchanged`);
        for (const [name, value] of Object.entries(surfaces)) {
          if (name === 'pixels') assert.equal(value, baseline[view][name], `${view} thumbnail pixels unchanged`);
          else for (const key of ['x', 'y', 'width', 'height', 'size', 'font', 'transition', 'animation'])
            assert.equal(value[key], baseline[view][name][key], `${view} ${name} ${key}`);
        }
      }
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, comparedBaseline: !!baseline, results, errors }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser?.close(); await server.close(); }
