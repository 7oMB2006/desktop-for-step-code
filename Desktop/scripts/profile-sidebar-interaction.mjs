import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const label = process.env.DESKTOP_SIDEBAR_LABEL ?? 'current';
const diagnostic = process.env.DESKTOP_SIDEBAR_DIAGNOSTIC === '1';
assert.match(label, /^[a-z0-9-]+$/i);
const output = resolve(root, 'test-results/sidebar-interaction');
const outDir = resolve(output, diagnostic ? 'diagnostic-site' : 'site');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn',
  plugins: diagnostic ? [{
    name: 'fixture-sidebar-render-counter',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/SessionSearchText.tsx')) return;
      const anchor = '  if (!query.trim()) return text;';
      assert.ok(source.includes(anchor));
      return source.replace(anchor,
        '  (window as any).__sidebarLabelRenders = ((window as any).__sidebarLabelRenders ?? 0) + 1;\n' + anchor);
    },
  }] : [],
  build: { outDir, emptyOutDir: true, rolldownOptions: { input: resolve(root, 'tests/fixtures/long-session-interaction.html') } } });
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const reports = [], errors = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/long-session-interaction.html`;
  for (const count of [180, 1000]) {
    await page.goto(`${url}?size=long&sessions=${count === 1000 ? 'large' : 'normal'}`);
    await page.waitForFunction(count => document.querySelectorAll('.session-row').length === count &&
      !document.querySelector('.new-chat')?.disabled, count);
    await page.waitForTimeout(500);
    const nodes = await page.locator('.session-row').count();
    await page.evaluate(() => {
      window.__sidebarLabelRenders = 0;
      const root = document.querySelector('.workspace-tree');
      const rows = [...root.querySelectorAll('.session-row')];
      window.sidebarSample = { rows, changedRows: 0, frames: [] };
      const observer = new MutationObserver(records => { window.sidebarSample.changedRows += records.length; });
      observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      let last = performance.now();
      const frame = now => {
        window.sidebarSample?.frames.push(now - last); last = now;
        if (window.sidebarSample) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      window.finishSidebarSample = () => {
        observer.disconnect();
        const sample = window.sidebarSample;
        const retained = sample.rows.every(row => row.isConnected);
        const frames = sample.frames;
        window.sidebarSample = null;
        return { retained, changedRows: sample.changedRows, frames, labelRenders: window.__sidebarLabelRenders };
      };
    });
    const before = await metrics();
    await page.evaluate(() => window.interactionFixture.startStream({ updates: 60, interval: 40 }));
    await page.waitForFunction(() => window.interactionFixture.streamUpdates === 60 && !document.querySelector('.response-active'));
    await page.waitForTimeout(250);
    const after = await metrics();
    const sample = await page.evaluate(() => window.finishSidebarSample());
    assert.equal(sample.retained, true);
    if (diagnostic && process.env.DESKTOP_SIDEBAR_REQUIRE_ISOLATION === '1')
      assert.ok(sample.labelRenders <= count + 3, 'Unchanged labels render at most once for the final catalog snapshot, not on each delta');
    assert.equal(await page.locator('.session-row').count(), nodes);
    assert.equal((await page.locator('.response-text').last().innerText()).split('Streaming text keeps arriving').length - 1, 60);
    const frames = sample.frames.sort((a, b) => a - b);
    const report = { scenario: 'stream', sessions: count, updates: 60,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      framesOver32ms: frames.filter(value => value > 32).length,
      p95FrameMs: frames[Math.floor(frames.length * .95)], maxFrameMs: Math.max(...frames),
      retained: sample.retained, changedRows: sample.changedRows, ...(diagnostic ? { labelRenders: sample.labelRenders } : {}) };
    reports.push(report); console.log(JSON.stringify(report));
  }
  await page.goto(`${url}?size=short&sessions=large`);
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelectorAll('.session-row').length === 1000);
  await page.evaluate(() => window.interactionFixture.setNavigationDelays(35, 220));
  for (const [scenario, ids] of [['cold', ['session-1']], ['resident', ['session-0']], ['rapid', ['session-2', 'session-3', 'session-4']]]) {
    const result = await page.evaluate(async ({ ids, scenario }) => {
      const started = performance.now();
      let selectedMs, readableMs, editableMs, readyMs;
      const final = ids.at(-1);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Navigation timed out')); }, 10000);
        const inspect = () => {
          if (document.querySelector(`.session-row[data-reorder-id="${final}"] > button`)?.getAttribute('aria-current') === 'page')
            selectedMs ??= performance.now() - started;
          const history = document.querySelector('.messages');
          if (document.querySelector('.window-session-title')?.textContent === `Performance ${Number(final.split('-')[1]) + 1}`
            && history?.textContent.includes('Response 3')) readableMs ??= performance.now() - started;
          const input = document.querySelector('.composer > .composer-input');
          if (readableMs !== undefined && input && !input.disabled && input.getAttribute('aria-disabled') !== 'true')
            editableMs ??= performance.now() - started;
          if (readableMs !== undefined && document.querySelector('.composer-wrap')?.getAttribute('aria-busy') !== 'true')
            readyMs ??= performance.now() - started;
          if ([selectedMs, readableMs, editableMs, readyMs].some(value => value === undefined)) return;
          clearTimeout(timeout); observer.disconnect();
          resolve({ scenario, selectedMs, readableMs, editableMs, readyMs });
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.querySelector('.app'), { subtree: true, childList: true, attributes: true, characterData: true });
        void (async () => {
          for (const id of ids) {
            document.querySelector(`.session-row[data-reorder-id="${id}"] > button`).click();
            if (ids.length > 1) await new Promise(resolve => setTimeout(resolve, 15));
          }
          inspect();
        })().catch(reject);
      });
    }, { ids, scenario });
    reports.push(result); console.log(JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, `${label}.json`), JSON.stringify({ label, diagnostic, browser: browser.version(), reports, errors }, null, 2) + '\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
