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
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const key = 'dfsc-stellar-preview-preferences-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ themeMotion: false }));
  });
  const read = () => page.evaluate(() => {
    const selectors = ['.sidebar-identity', '.sb-repository', '.sb-repo-change', '.sb-agents',
      '.sb-step.is-in_progress .sb-step-trigger', '.sb-mcp-trigger', '.sb-mcp', '.sb-skills',
      '.summary-board > header', '.approval-drawer', '.approval-drawer-heading',
      '.process-tool-content', '.process-tool-meta', '.process-tool-status', '.tool-output pre'];
    return Object.fromEntries(selectors.map(selector => {
      const e = document.querySelector(selector);
      if (!e) return [selector, null];
      const s = getComputedStyle(e), r = e.getBoundingClientRect(), rule = getComputedStyle(e, '::after');
      return [selector, { width: r.width, height: r.height,
        rule: { content: rule.content, left: rule.left, right: rule.right,
          height: rule.height, background: rule.backgroundColor,
          image: rule.backgroundImage, animation: rule.animationName, pointerEvents: rule.pointerEvents },
        color: s.color, background: s.backgroundColor, shadow: s.boxShadow,
        borderTop: s.borderTopColor, borderBottom: s.borderBottomColor, borderLeft: s.borderLeftColor }];
    }));
  });
  const open = async () => {
    await page.goto(base);
    await page.locator('.sb-step.is-in_progress .sb-step-trigger').waitFor();
    await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
    const group = page.locator('.process-tool-group').first();
    await group.locator(':scope > .tool-group-trigger').click();
    await group.locator('.process-tool > summary').first().click();
    await page.waitForTimeout(300);
  };
  const shot = async name => {
    await page.mouse.move(700, 30);
    await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${name}.png`) });
  };
  const theme = async name => {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  };
  await open();
  const task = page.locator('.sb-step.is-in_progress .sb-step-trigger');
  await task.click();
  assert.equal(await task.getAttribute('aria-expanded'), 'true');
  results.desktop = await read();
  await page.locator('.conversation').evaluate(e => { e.scrollTop = 0; });
  await shot('desktop');
  await task.focus(); await task.press('Tab'); await page.keyboard.press('Shift+Tab');
  const focus = await task.evaluate(e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
    const fits = [];
    for (let p = e.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
      if (/(auto|hidden|scroll|clip)/.test(ps.overflowX)) fits.push(r.left - extent >= pr.left - .5 && r.right + extent <= pr.right + .5);
      if (/(auto|hidden|scroll|clip)/.test(ps.overflowY)) fits.push(r.top - extent >= pr.top - .5 && r.bottom + extent <= pr.bottom + .5);
    }
    return { visible: e.matches(':focus-visible'), width: parseFloat(s.outlineWidth), fits };
  });
  assert.ok(focus.visible && focus.width >= 2 && focus.fits.every(Boolean), JSON.stringify(focus));
  await task.press('Enter');
  assert.equal(await task.getAttribute('aria-expanded'), 'false');
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    await page.waitForTimeout(350);
    const summary = page.getByRole('navigation', { name: '右侧工具', exact: true })
      .getByRole('button', { name: '摘要', exact: true });
    if (await summary.getAttribute('aria-pressed') !== 'true') await summary.click();
    await page.locator('.sb-step.is-in_progress .sb-step-trigger').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results[width] = await read();
    for (const selector of ['.sb-repo-change', '.sb-step.is-in_progress .sb-step-trigger', '.process-tool-content'])
      assert.ok(results[width][selector], `${width}: ${selector} exists`);
    await shot(`width-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  const captureDrawers = async (prefix, views, widths) => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 960 });
      for (const view of views) {
        await page.goto(base.replace('view=chat', `view=${view}`));
        await page.locator('.approval-drawer-heading').waitFor();
        await page.waitForTimeout(300);
        assert.equal(await page.locator('html').getAttribute('data-theme-material'), prefix === 'stellar' ? 'stellar' : null);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        results[`${prefix}-${view}-${width}`] = await read();
        await shot(`${prefix}-${view}-${width}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  };
  await captureDrawers('stellar', ['permission', 'plan', 'question'], [1440, 390]);
  await open();
  await theme('原版浅色'); results.light = await read(); await shot('light');
  await captureDrawers('light', ['plan'], [1440]);
  await open();
  await theme('原版深色'); results.dark = await read(); await shot('dark');
  await captureDrawers('dark', ['plan'], [1440]);
  if (capture) {
    await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  } else {
    // Optional baseline is captured before a visual revision; standalone runs
    // still check focus, original mark size, disclosures and no overflow.
    let baseline;
    try { baseline = JSON.parse(await readFile(join(output, 'before.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (baseline) {
      for (const [view, surfaces] of Object.entries(results))
        for (const [selector, metrics] of Object.entries(surfaces)) {
          const previous = baseline[view][selector];
          assert.deepEqual(metrics && [metrics.width, metrics.height],
            previous && [previous.width, previous.height], `${view}: ${selector} geometry`);
        }
      assert.deepEqual(results.light, baseline.light, 'Built-in light styles stay intact');
      assert.deepEqual(results.dark, baseline.dark, 'Built-in dark styles stay intact');
      for (const mode of ['light', 'dark'])
        assert.deepEqual(results[`${mode}-plan-1440`], baseline[`${mode}-plan-1440`], `${mode} drawer styles stay intact`);
      assert.deepEqual(results.desktop['.sidebar-identity'], baseline.desktop['.sidebar-identity'], 'Original brand rule stays intact');
    }
    assert.equal(results.desktop['.sb-step.is-in_progress .sb-step-trigger'].shadow, 'none');
    assert.equal(results.desktop['.process-tool-content'].borderLeft, 'rgba(188, 169, 135, 0.22)');
    assert.equal(results.desktop['.process-tool-status'].borderTop, 'rgba(0, 0, 0, 0)');
    for (const selector of ['.sb-repository', '.sb-agents', '.sb-mcp', '.sb-skills', '.summary-board > header']) {
      const rule = results.desktop[selector].rule;
      assert.equal(rule.left, '12px');
      assert.equal(rule.right, '12px');
      assert.equal(rule.height, '1px');
      assert.equal(rule.animation, 'none');
      assert.equal(rule.image, 'none');
      assert.equal(rule.pointerEvents, 'none');
    }
    for (const width of [1440, 390]) {
      for (const view of ['permission', 'plan', 'question']) {
        const heading = results[`stellar-${view}-${width}`]['.approval-drawer-heading'];
        assert.equal(heading.shadow, 'none');
        assert.equal(heading.rule.left, width === 390 ? '12px' : '20px');
        assert.equal(heading.rule.right, heading.rule.left);
        assert.equal(heading.rule.background, results.desktop['.sb-repository'].rule.background);
      }
    }
    assert.deepEqual(errors, []);
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, comparedBaseline: !!baseline, results, focus, errors }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, focus, errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser?.close(); await server.close(); }
