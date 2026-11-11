import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { markdownWorker } from '../vite.config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results/sidebar-interaction');
const outDir = resolve(output, 'acceptance-site');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn', worker: markdownWorker,
  build: { outDir, emptyOutDir: true, rolldownOptions: { input: resolve(root, 'tests/fixtures/long-session-interaction.html') } } });
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
let browser;
let page;
const errors = [], gates = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/long-session-interaction.html`;
  await page.goto(`${url}?size=short`);
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelectorAll('.session-row').length === 180);
  const row = id => page.locator(`.session-row[data-reorder-id="${id}"]`);
  await page.evaluate(() => {
    window.sidebarRetainedRow = document.querySelector('[data-reorder-id="session-7"]');
    window.interactionFixture.setRuntimes([{ runtimeId: 'peer', sessionId: 'session-7', cwd: 'D:\\Projects\\Performance', status: 'running' }]);
  });
  await row('session-7').locator('.session-activity.running').waitFor();
  assert.equal(await row('session-7').getAttribute('data-reorder-locked'), 'true');
  for (const status of ['waiting', 'failed', 'completed']) {
    await page.evaluate(status => window.interactionFixture.setRuntimes([
      { runtimeId: 'peer', sessionId: 'session-7', cwd: 'D:\\Projects\\Performance', status },
    ], status === 'completed' ? ['session-7'] : []), status);
    await row('session-7').locator(`.session-activity.${status}`).waitFor();
  }
  await page.evaluate(() => window.interactionFixture.setRuntimes([
    { runtimeId: 'peer', sessionId: 'session-7', cwd: 'D:\\Projects\\Performance', status: 'completed' },
  ]));
  await row('session-7').locator('.session-activity.idle').waitFor({ state: 'attached' });
  assert.equal(await row('session-7').getAttribute('data-reorder-locked'), 'false');
  gates.push('live-runtime-status-unread-and-drag-lock');

  await page.evaluate(() => window.interactionFixture.setRuntimes([
    { runtimeId: 'peer', sessionId: 'session-7', cwd: 'D:\\Projects\\Performance', status: 'idle', name: 'Renamed peer' },
  ]));
  await row('session-7').getByText('Renamed peer', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.sidebarRetainedRow === document.querySelector('[data-reorder-id="session-7"]')), true);
  await row('session-7').locator('.icon-button').click();
  await page.locator('.sidebar-context [role="menuitem"]').filter({ hasText: 'Copy session reference' }).click();
  await page.locator('.sidebar-context').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.interactionFixture.copiedText), 'stepcode-desktop://sessions/session-7');
  await page.evaluate(() => window.interactionFixture.setNavigationDelays(30, 600));
  await row('session-7').locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'Renamed peer'
    && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'true');
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'Renamed peer'
    && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') !== 'true');
  gates.push('retained-row-current-name-menu-and-navigation');

  await page.evaluate(async () => {
    await window.desktop.preferences({ sessionOrder: ['session-2', 'session-1', 'session-0'] });
    window.interactionFixture.updateSessions(window.interactionFixture.sessions);
  });
  await page.waitForFunction(() => document.querySelector('[data-reorder-kind="workspace"] .session-row')?.dataset.reorderId === 'session-3');
  const expectedOrder = await page.locator('[data-reorder-kind="workspace"] .session-row')
    .evaluateAll(rows => rows.map(row => row.dataset.reorderId).filter(id => id !== 'session-1'));
  expectedOrder.splice(expectedOrder.indexOf('session-2'), 0, 'session-1');
  // Verify the entire current order, not just the moved pair from an old closure.
  await row('session-1').locator('button').first().press('Alt+ArrowUp');
  await page.waitForFunction(expected => {
    const rows = [...document.querySelectorAll('[data-reorder-kind="workspace"] .session-row')].map(row => row.dataset.reorderId);
    return JSON.stringify(rows) === JSON.stringify(expected);
  }, expectedOrder);
  gates.push('latest-sibling-order-keyboard-action');

  await page.evaluate(() => {
    for (const id of ['session-8', 'session-9', 'session-10'])
      document.querySelector(`.session-row[data-reorder-id="${id}"] > button`).click();
  });
  await page.waitForFunction(() => document.querySelector('.session-row.selected')?.dataset.reorderId === 'session-10'
    && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') !== 'true');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, 'session-10');
  gates.push('rapid-latest-selection');

  for (const theme of ['light', 'dark']) for (const width of [1440, 760, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${url}?size=short&theme=${theme}`);
    await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
    if (width <= 760) await page.locator('.window-sidebar-toggle[aria-expanded=false]').click();
    const toggle = page.locator('[data-reorder-kind="workspace"] .workspace-toggle').first();
    await page.keyboard.press('Tab');
    await toggle.focus();
    assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(output, `sidebar-${theme}-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const toggle = page.locator('[data-reorder-kind="workspace"] .workspace-toggle').first();
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[data-reorder-kind="workspace"] .workspace-toggle')?.getAttribute('aria-expanded') === 'false');
  gates.push('light-dark-narrow-focus-and-reduced-motion');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify({ gates, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ gates, errors }));
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'acceptance-failure.png') }).catch(() => {});
  await writeFile(resolve(output, 'acceptance-failure.json'), JSON.stringify({ gates, errors, failure: String(error) }, null, 2) + '\n');
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
