import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const label = process.env.DESKTOP_PANEL_GESTURE_LABEL ?? 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const output = resolve(root, 'test-results/panel-gesture');
const outDir = resolve(output, 'verification-site');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn',
  build: { outDir, emptyOutDir: true,
    rolldownOptions: { input: resolve(root, 'tests/fixtures/long-session-interaction.html') } } });
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
let browser, page;
const errors = [], reports = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/long-session-interaction.html`;
  const handle = page.locator('.right-panel-handle');
  const settled = () => page.waitForFunction(() => !document.querySelector('[data-layout-window], [data-layout-locked], .app[data-panel-drag]')
    && !document.querySelector('.app').getAnimations({ subtree: true }).some(animation =>
      animation instanceof CSSTransition && ['flex-basis', 'max-width'].includes(animation.transitionProperty)));
  const rootStyle = () => page.locator('.app').evaluate(element => ({
    cursor: getComputedStyle(element).cursor, userSelect: getComputedStyle(element).userSelect,
  }));
  const clean = async () => {
    await settled();
    assert.equal(await page.locator('.messages > article').count(), 360);
    assert.equal(await page.locator('.right-inspector-surface').evaluateAll(elements =>
      elements.every(element => !element.style.width)), true);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.messages > article')].every(element =>
      !element.style.width && !element.hasAttribute('data-layout-locked'))), true);
  };
  const open = async () => {
    if (!await handle.count()) await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
    await handle.waitFor();
    await settled();
  };
  const start = async () => {
    const box = await handle.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    return point;
  };
  const captured = () => handle.evaluate(element => ({
    pointer: window.gesturePointer,
    captured: element.hasPointerCapture(window.gesturePointer),
    hover: element.matches(':hover'), cursor: getComputedStyle(element).cursor,
    userSelect: getComputedStyle(element).userSelect,
    selection: getSelection()?.toString() ?? '',
    target: window.gestureTarget,
    locked: document.querySelectorAll('[data-layout-locked]').length,
  }));
  const checkCapture = async (selection = '') => {
    const state = await captured();
    assert.equal(state.captured, true, 'The original handle must retain pointer capture outside its hit area');
    assert.equal(state.hover, true);
    assert.equal(state.cursor, 'ew-resize');
    assert.equal(state.userSelect, 'none');
    assert.equal(state.target, 'right-panel-handle');
    assert.equal(state.selection, selection, 'The gesture must not start or extend a native text selection');
    return state;
  };
  for (const { width, theme, reduced } of [
    { width: 1440, theme: 'light', reduced: false },
    { width: 760, theme: 'dark', reduced: false },
    { width: 390, theme: 'dark', reduced: true },
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.goto(`${url}?size=long&theme=${theme}`);
    await page.locator('.response-text').last().waitFor();
    await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelector('.session-row'));
    await open();
    await page.evaluate(() => {
      document.addEventListener('pointerdown', event => { window.gesturePointer = event.pointerId; }, true);
      document.addEventListener('pointermove', event => { window.gestureTarget = event.target.className; }, true);
    });
    const initialStyle = await rootStyle();
    const states = [];
    for (const direction of [-1, 1]) {
      const point = await start();
      const delta = Math.min(70, Math.max(12, point.x / 3));
      const x = Math.max(1, Math.min(width - 1, point.x + delta * direction));
      await page.mouse.move(x, point.y - 180, { steps: 8 });
      states.push(await checkCapture());
      assert.deepEqual(await rootStyle(), initialStyle, 'Dragging must not change inherited app styles');
      await page.mouse.up();
      assert.equal(await page.getByRole('menu', { name: 'Panel width', exact: true }).count(), 0,
        'A completed drag must not open the click menu');
      await clean();
      await open();
    }
    // Short clicks still open the real menu, and keyboard focus returns to its trigger.
    await handle.click();
    const menu = page.getByRole('menu', { name: 'Panel width', exact: true });
    await menu.waitFor();
    assert.equal(await menu.getByRole('menuitemradio', { name: 'Standard', exact: true }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await handle.evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await handle.evaluate(element => document.activeElement === element), true);
    assert.equal(await handle.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    await menu.waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(output, `${label}-${width}-${theme}.png`) });
    reports.push({ width, theme, reduced, initialStyle, states });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${url}?size=long`);
  await page.locator('.response-text').last().waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelector('.session-row'));
  await open();
  await page.evaluate(() => {
    document.addEventListener('pointerdown', event => { window.gesturePointer = event.pointerId; }, true);
    document.addEventListener('pointermove', event => { window.gestureTarget = event.target.className; }, true);
  });
  // Select native text after a drag, then retain that selection across another drag.
  const paragraph = page.locator('.response-text p').last();
  await paragraph.scrollIntoViewIfNeeded();
  const box = await paragraph.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 9);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(220, box.width - 4), box.y + 9, { steps: 12 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection().toString());
  assert.ok(selected.length > 10, 'Native transcript selection must work after releasing the handle');
  const point = await start();
  await page.mouse.move(point.x - 90, point.y + 150, { steps: 10 });
  const selectedState = await checkCapture(selected);
  assert.equal(selectedState.locked, 0, 'An existing selection still bypasses measured-width protection');
  await page.mouse.up();
  await clean();
  assert.equal(await page.evaluate(() => getSelection().toString()), selected);
  await page.evaluate(() => getSelection().removeAllRanges());

  for (const cancellation of ['Escape', 'pointercancel', 'lostpointercapture']) {
    await open();
    const point = await start();
    await page.mouse.move(point.x - 80, point.y - 100, { steps: 6 });
    await checkCapture();
    if (cancellation === 'Escape') await page.keyboard.press('Escape');
    else if (cancellation === 'pointercancel') await handle.dispatchEvent('pointercancel');
    else {
      await handle.evaluate(element => element.releasePointerCapture(window.gesturePointer));
      // The browser processes a pending capture release on the next pointer event.
      await page.mouse.move(point.x - 81, point.y - 100);
    }
    await page.waitForFunction(() => !document.querySelector('.app[data-panel-drag]'));
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await clean();
  }
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await clean();
  assert.ok(await page.locator('#context-panel').evaluate(element => element.getBoundingClientRect().width > 600));
  assert.deepEqual(errors, []);
  const receipt = { browser: browser.version(), reports, selectedCharacters: selected.length,
    selectedState, cancellations: ['Escape', 'pointercancel', 'lostpointercapture'], errors };
  await writeFile(resolve(output, `${label}-verification.json`), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} catch (error) {
  await page?.screenshot({ path: resolve(output, `${label}-failure.png`) }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
