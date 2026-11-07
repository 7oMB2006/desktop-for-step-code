import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only acceptance; no native tools, external websites or user profile.
const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error',
});
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
    JSON.stringify({ themeMotion: false })));
  await page.goto(base);
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  const rail = page.getByRole('navigation', { name: '右侧工具', exact: true });
  const session = page.getByRole('button', { name: '组件与样式校对', exact: true });
  const focus = async locator => {
    await locator.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await locator.evaluate(e => e.matches(':focus-visible')), true);
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
      return { outline: style.outlineWidth, color: style.outlineColor,
        primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(), clips };
    });
    assert.equal(result.outline, '2px');
    assert.equal(result.color, result.primary);
    assert.ok(result.clips.every(Boolean), JSON.stringify(result));
  };
  const dimensions = async () => page.evaluate(() =>
    [...document.querySelectorAll('.session-row, .right-tool-rail .icon-button')].map(e => {
      const r = e.getBoundingClientRect(); return [r.width, r.height];
    }));
  const before = await dimensions();
  await session.hover();
  await focus(session);
  assert.deepEqual(await dimensions(), before, 'Hover and focus must not move controls');
  await page.screenshot({ path: join(output, 'navigation-sidebar-focus.png') });
  await session.press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('.session-row.selected')?.textContent.includes('组件与样式校对'));
  assert.match(await page.locator('.session-row.selected').evaluate(e => getComputedStyle(e).boxShadow), /inset/);

  const panels = [
    ['摘要', '#summary-board'],
    ['上下文', '#context-panel'],
    ['变更', '#review-panel'],
    ['会话导航', '#conversation-navigation-panel'],
    ['文件预览', '#file-panel'],
  ];
  for (const [name, selector] of panels) {
    const button = rail.getByRole('button', { name, exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    const panel = page.locator(selector);
    await panel.waitFor();
    await page.waitForTimeout(350);
    const surface = await panel.evaluate(e => ({
      image: getComputedStyle(e).backgroundImage,
      fill: getComputedStyle(e).backgroundColor,
      expected: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    }));
    assert.equal(surface.image, 'none');
    assert.equal(surface.fill, surface.expected, 'Inspectors share the opaque reading material');
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await focus(button);
    assert.match(await button.evaluate(e => getComputedStyle(e).boxShadow), /inset/);
    if (name === '摘要') {
      const trigger = page.locator('.sb-step.is-in_progress .sb-step-trigger');
      await trigger.click();
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      await focus(trigger);
      await page.locator('.composer-input').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(output, 'navigation-summary-expanded.png') });
    }
    if (name === '会话导航') {
      await focus(panel.locator('nav button').first());
      await page.screenshot({ path: join(output, 'navigation-turns.png') });
    }
  }
  // A custom accent must not leave navigation markers in the default cyan.
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '玫红强调色', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  await focus(session);
  const active = rail.getByRole('button', { name: '文件预览', exact: true });
  await focus(active);
  assert.equal(await active.evaluate(e => getComputedStyle(e).color),
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await active.evaluate(e => getComputedStyle(e).transitionDuration), '0s');

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    const button = rail.getByRole('button', { name: '会话导航', exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    await page.waitForTimeout(350);
    await focus(button);
    const panel = page.locator('#conversation-navigation-panel');
    await focus(panel.locator('nav button').first());
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(output, `navigation-turns-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '原版浅色', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  assert.equal(await page.locator('#conversation-navigation-panel').evaluate(e => getComputedStyle(e).backgroundImage), 'none');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, panels: panels.length, widths: [1440, 760, 390], errors }));
} finally {
  await browser?.close();
  await server.close();
}
