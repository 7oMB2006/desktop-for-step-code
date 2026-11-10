import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const label = process.env.DESKTOP_STREAM_INTERACTION_LABEL ?? 'current';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Invalid profile label');
const output = resolve(root, 'test-results/streaming-interaction');
const outDir = resolve(output, 'site');
const tracing = process.env.DESKTOP_STREAM_INTERACTION_TRACE === '1';
const invalidations = process.env.DESKTOP_STREAM_INTERACTION_INVALIDATIONS === '1';
const scrollDiagnostics = process.env.DESKTOP_STREAM_INTERACTION_SCROLL_DIAGNOSTICS === '1';
const omitSettingsSelector = process.env.DESKTOP_STREAM_INTERACTION_OMIT_SETTINGS_SELECTOR === '1';
const scenarioFilter = process.env.DESKTOP_STREAM_INTERACTION_SCENARIO;
const scenarios = ['stream-only', 'stream-context', 'stream-drag'].filter(scenario => !scenarioFilter || scenario === scenarioFilter);
assert.ok(scenarios.length, 'Unknown streaming scenario');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn',
  build: { outDir, emptyOutDir: true, ...(tracing ? { minify: false } : {}),
    rolldownOptions: { input: resolve(root, 'tests/fixtures/long-session-interaction.html') } } });
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const reports = [];
const errors = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(scrollDiagnostics => {
    const query = Element.prototype.querySelector;
    Element.prototype.querySelector = function (selector) {
      if (window.streamInteractionSample && selector.startsWith('article[data-message-index='))
        window.streamInteractionSample.turnQueries++;
      return query.call(this, selector);
    };
    if (scrollDiagnostics) {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      Object.defineProperty(Element.prototype, 'scrollTop', { ...descriptor, set(value) {
        const sample = window.streamInteractionSample;
        const record = sample && this.id === 'conversation-scroll' && this.hasAttribute('data-layout-window')
          ? { at: performance.now(), kind: 'write', before: descriptor.get.call(this), value,
            updates: window.interactionFixture.streamUpdates, stack: new Error().stack } : null;
        descriptor.set.call(this, value);
        if (record) sample.scrolls.push({ ...record, after: descriptor.get.call(this) });
      } });
      document.addEventListener('scroll', event => {
        const sample = window.streamInteractionSample;
        if (sample && event.target.id === 'conversation-scroll') sample.scrolls.push({
          at: performance.now(), kind: 'event', top: event.target.scrollTop,
          locked: event.target.hasAttribute('data-layout-window'), updates: window.interactionFixture.streamUpdates,
        });
      }, true);
    }
  }, scrollDiagnostics);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/long-session-interaction.html`;
  for (const scenario of scenarios) {
    await page.goto(`${url}?size=long`);
    await page.locator('.response-text').last().waitFor();
    await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelector('.session-row'));
    if (omitSettingsSelector) await page.evaluate(() => {
      let removed = 0;
      const visit = sheet => {
        for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
          const rule = sheet.cssRules[index];
          if (rule.selectorText?.includes('.app:has(.settings-backdrop)')) { sheet.deleteRule(index); removed++; }
          else if (rule.cssRules) visit(rule);
        }
      };
      [...document.styleSheets].forEach(visit);
      if (removed !== 1) throw new Error(`Expected one settings selector, found ${removed}`);
    });
    if (scenario !== 'stream-only') await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
    await page.waitForTimeout(650);
    const trace = [];
    const collect = ({ value }) => trace.push(...value);
    if (tracing) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
      await cdp.send('Profiler.start');
      cdp.on('Tracing.dataCollected', collect);
      await cdp.send('Tracing.start', { categories: [
        'devtools.timeline', 'v8.execute', 'blink.user_timing',
        ...(invalidations ? ['disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.invalidationTracking'] : []),
      ].join(','), options: 'sampling-frequency=1000' });
    }
    await page.evaluate(() => {
      const sample = { frames: [], tasks: [], turnQueries: 0, layoutWindows: [], scrolls: [] };
      window.streamInteractionSample = sample;
      const root = document.querySelector('.app');
      const viewport = document.querySelector('#conversation-scroll');
      const layout = new MutationObserver(() => sample.layoutWindows.push({
        at: performance.now(), updates: window.interactionFixture.streamUpdates,
        dragging: root.hasAttribute('data-panel-drag'),
        locked: viewport.hasAttribute('data-layout-window'),
        lockedArticles: viewport.querySelectorAll('[data-layout-locked]').length,
      }));
      layout.observe(root, { attributes: true, attributeFilter: ['data-panel-drag'] });
      layout.observe(viewport, { attributes: true, attributeFilter: ['data-layout-window'] });
      let previous = performance.now();
      const frame = now => {
        sample.frames.push(now - previous);
        previous = now;
        if (window.streamInteractionSample === sample) requestAnimationFrame(frame);
      };
      const observer = new PerformanceObserver(list => sample.tasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask' });
      requestAnimationFrame(frame);
      window.endStreamInteractionSample = () => {
        observer.disconnect();
        layout.disconnect();
        window.streamInteractionSample = null;
        return sample;
      };
    });
    const before = await metrics();
    const started = performance.now();
    await page.evaluate(() => window.interactionFixture.startStream({ updates: 60, interval: 40 }));
    if (scenario === 'stream-drag') {
      const box = await page.locator('.right-panel-handle').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let step = 1; step <= 40; step++) {
        await page.mouse.move(box.x + box.width / 2 - Math.sin(step / 40 * Math.PI) * 180, box.y + box.height / 2);
        await page.waitForTimeout(25);
      }
      await page.mouse.up();
    }
    await page.waitForFunction(() => window.interactionFixture.streamUpdates === 60 && !document.querySelector('.response-active'));
    await page.waitForTimeout(450);
    const elapsedMs = performance.now() - started;
    const after = await metrics();
    const sample = await page.evaluate(() => window.endStreamInteractionSample());
    if (tracing) {
      const { profile } = await cdp.send('Profiler.stop');
      await writeFile(resolve(output, `${label}-${scenario}.cpuprofile`), JSON.stringify(profile));
      const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end');
      await done;
      cdp.off('Tracing.dataCollected', collect);
      await writeFile(resolve(output, `${label}-${scenario}-trace.json`), JSON.stringify({ traceEvents: trace }));
    }
    const frames = [...sample.frames].sort((a, b) => a - b);
    const content = await page.locator('.response-text').last().innerText();
    assert.equal((content.match(/Streaming text keeps arriving/g) ?? []).length, 60);
    assert.equal(await page.locator('.messages > article').count(), 362);
    reports.push({ scenario, updates: 60, elapsedMs,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layouts: after.LayoutCount - before.LayoutCount,
      frames: frames.length, framesOver32ms: frames.filter(value => value > 32).length,
      p95FrameMs: frames[Math.floor(frames.length * .95)] ?? 0,
      maxFrameMs: Math.max(0, ...frames), turnQueries: sample.turnQueries, longTasks: sample.tasks,
      layoutWindows: sample.layoutWindows, ...(scrollDiagnostics ? { scrolls: sample.scrolls } : {}) });
    console.log(JSON.stringify(reports.at(-1)));
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, `${label}.json`), JSON.stringify({ label, browser: browser.version(), tracing, invalidations, omitSettingsSelector, reports }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
