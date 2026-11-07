import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2], capture = process.argv.includes('--capture-before');
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser, page;
const results = {}, errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const key = 'dfsc-stellar-preview-preferences-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ themeMotion: false }));
  });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`;
  const open = async () => {
    await page.goto(url);
    await page.locator('.response-text table').waitFor();
    await page.evaluate(() => { window.__readingCopy = ''; window.desktop.copyText = async text => { window.__readingCopy = text; }; });
  };
  const bottom = async () => {
    await page.locator('.conversation').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await page.mouse.move(200, 25);
    await page.waitForTimeout(250);
  };
  const read = () => page.evaluate(() => {
    const selectors = ['.response-text h3', '.response-text blockquote', '.response-text pre',
      '.response-text .code-header', '.response-text table', '.response-text th', '.response-text td',
      '.assistant-actions', '.assistant-actions .icon-button'];
    return Object.fromEntries(selectors.map(selector => {
      const e = document.querySelector(selector), s = getComputedStyle(e), r = e.getBoundingClientRect();
      return [selector, { width: r.width, height: r.height, font: s.fontFamily, size: s.fontSize,
        leading: s.lineHeight, color: s.color, background: s.backgroundColor, border: s.borderColor,
        radius: s.borderRadius, opacity: s.opacity, shadow: s.boxShadow }];
    }));
  });
  const shot = async name => {
    await bottom();
    await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${name}.png`) });
  };
  const focus = async button => {
    await button.focus(); await button.press('Tab'); await page.keyboard.press('Shift+Tab');
    const result = await button.evaluate(e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
      const fits = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
        if (/(auto|hidden|scroll|clip)/.test(ps.overflowX)) fits.push(r.left - extent >= pr.left - .5 && r.right + extent <= pr.right + .5);
        if (/(auto|hidden|scroll|clip)/.test(ps.overflowY)) fits.push(r.top - extent >= pr.top - .5 && r.bottom + extent <= pr.bottom + .5);
      }
      return { visible: e.matches(':focus-visible'), outline: parseFloat(s.outlineWidth), fits };
    });
    assert.ok(result.visible && result.outline >= 2 && result.fits.every(Boolean), JSON.stringify(result));
  };
  const theme = async name => {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  };
  await open();
  for (const width of [1440, 760, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await bottom();
    results[width] = await read();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const code = page.locator('.response-text .code-header').getByRole('button', { name: '复制', exact: true });
    const expected = await page.locator('.response-text .code-block > code').textContent();
    await code.click();
    assert.equal(await page.evaluate(() => window.__readingCopy), expected);
    await focus(code);
    const copy = page.locator('.assistant-actions').getByRole('button', { name: '复制', exact: true });
    await copy.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.assistant-actions')).opacity === '1');
    await copy.click();
    assert.match(await page.evaluate(() => window.__readingCopy), /scene\.configure/);
    await focus(copy);
    await page.mouse.move(200, 25);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.assistant-actions').evaluate(e => getComputedStyle(e).opacity), '1', 'Keyboard focus reveals actions without hover');
    await page.evaluate(() => document.activeElement?.blur());
    await shot(`width-${width}`);
    assert.equal(await page.locator('.assistant-actions').evaluate(e => getComputedStyle(e).opacity), '0', 'Actions hide after hover and focus leave');
    assert.deepEqual(await copy.evaluate(e => [e.offsetWidth, e.offsetHeight]), [28, 28]);
    if (width === 390) {
      const scroll = await page.locator('.response-text pre').evaluate(e => {
        e.scrollLeft = e.scrollWidth;
        const result = { overflows: e.scrollWidth > e.clientWidth, moved: e.scrollLeft > 0 };
        e.scrollLeft = 0;
        return result;
      });
      assert.ok(scroll.overflows && scroll.moved, 'Long code remains horizontally scrollable');
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await theme('原版浅色'); await bottom(); results.light = await read(); await shot('light');
  await theme('原版深色'); await bottom(); results.dark = await read(); await shot('dark');
  if (capture) await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  else {
    let baseline;
    try { baseline = JSON.parse(await readFile(join(output, 'before.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (baseline) {
      for (const mode of ['light', 'dark'])
        assert.deepEqual(results[mode], Object.fromEntries(Object.keys(results[mode]).map(selector => [selector, baseline[mode][selector]])));
      for (const width of [1440, 760, 390])
        for (const [selector, metrics] of Object.entries(results[width]))
          for (const key of ['font', 'size', 'leading'])
            assert.equal(metrics[key], baseline[width][selector][key], `${width} ${selector} ${key}`);
    }
    for (const width of [1440, 760, 390]) {
      assert.equal(results[width]['.assistant-actions'].opacity, '0');
      if (baseline)
        for (const selector of ['.assistant-actions', '.assistant-actions .icon-button'])
          assert.deepEqual(results[width][selector], baseline[width][selector], 'Footer styles match their original baseline');
      assert.match(results[width]['.response-text td'].border, /rgba\(0, 0, 0, 0\)/);
    }
    await page.evaluate(() => window.desktop.preferences({ theme: 'plugin:stellar-cruise' }));
    await open();
    await page.setViewportSize({ width: 390, height: 960 });
    const composer = page.locator('.composer-input[contenteditable=true]');
    await composer.fill('检查没有耗时记录的回复。');
    await composer.press('Enter');
    await page.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
    assert.equal(await page.locator('.response-active .assistant-actions').count(), 0);
    await page.getByText('收到。这是一条本地模拟回复', { exact: false }).waitFor();
    const latest = page.locator('.message.assistant').last();
    assert.equal(await latest.locator('.elapsed-total, .message-time').count(), 0, 'Missing metadata stays absent');
    await latest.locator('.assistant-actions').getByRole('button', { name: '复制', exact: true }).click();
    assert.match(await page.evaluate(() => window.__readingCopy), /本地模拟回复/);
    await page.evaluate(() => document.activeElement?.blur());
    await shot('without-metadata-390');
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, comparedBaseline: !!baseline, results, errors }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser?.close(); await server.close(); }
