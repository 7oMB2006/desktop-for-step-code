import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const label = process.env.DESKTOP_PANEL_GESTURE_LABEL ?? 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const neutralizeInherited = process.env.DESKTOP_PANEL_GESTURE_NEUTRALIZE_INHERITED === '1';
const tracing = process.env.DESKTOP_PANEL_GESTURE_TRACE === '1';
const output = resolve(root, 'test-results/panel-gesture');
const outDir = resolve(output, 'site');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn',
  build: { outDir, emptyOutDir: true, ...(tracing ? { minify: false } : {}),
    rolldownOptions: { input: resolve(root, 'tests/fixtures/long-session-interaction.html') } } });
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const errors = [], reports = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/long-session-interaction.html?size=long`);
  await page.locator('.response-text').last().waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled && document.querySelector('.session-row'));
  await page.locator('.right-tool-rail [aria-controls="context-panel"]').click();
  await page.waitForTimeout(700);
  if (neutralizeInherited) await page.addStyleTag({ content: '.app[data-panel-drag] { cursor: auto; user-select: auto; }' });
  const settled = () => page.waitForFunction(() => !document.querySelector('[data-layout-window], .app[data-panel-drag]')
    && !document.querySelector('.app').getAnimations({ subtree: true }).some(animation =>
      animation instanceof CSSTransition && ['flex-basis', 'max-width'].includes(animation.transitionProperty)));
  await settled();
  await page.evaluate(() => {
    window.gestureArticles = [...document.querySelectorAll('.messages > article')];
    window.gestureSample = { frames: [], tasks: [], active: true };
    const sample = window.gestureSample;
    let previous = performance.now();
    const frame = now => {
      sample.frames.push({ at: now, duration: now - previous }); previous = now;
      if (sample.active) requestAnimationFrame(frame);
    };
    const observer = new PerformanceObserver(list => sample.tasks.push(...list.getEntries().map(entry =>
      ({ at: entry.startTime, duration: entry.duration }))));
    observer.observe({ type: 'longtask' });
    window.finishGestureSample = () => {
      observer.disconnect(); sample.active = false; return sample;
    };
    requestAnimationFrame(frame);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const events = [];
  if (tracing) {
    cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing' });
  }
  const sample = async (phase, action) => {
    const before = await metrics(), started = await page.evaluate(() => performance.now());
    await action();
    const after = await metrics(), ended = await page.evaluate(() => performance.now());
    reports.push({ phase, started, ended, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layouts: after.LayoutCount - before.LayoutCount, styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount });
  };
  const box = await page.locator('.right-panel-handle').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sample('acquire', async () => {
    await page.mouse.move(x - 20, y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  });
  const during = await page.evaluate(() => {
    const handle = document.querySelector('.right-panel-handle');
    return { locked: document.querySelectorAll('[data-layout-locked]').length,
      handleCursor: getComputedStyle(handle).cursor, handleHover: handle.matches(':hover'),
      appCursor: getComputedStyle(document.querySelector('.app')).cursor,
      appUserSelect: getComputedStyle(document.querySelector('.app')).userSelect,
      selection: getSelection()?.toString() ?? '' };
  });
  await sample('move', () => page.mouse.move(x - 180, y, { steps: 30 }));
  await sample('release', async () => { await page.mouse.up(); await settled(); });
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => window.finishGestureSample());
  if (tracing) {
    const { profile } = await cdp.send('Profiler.stop');
    await writeFile(resolve(output, `${label}.cpuprofile`), JSON.stringify(profile));
    const finished = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end'); await finished;
    await writeFile(resolve(output, `${label}-trace.json`), JSON.stringify({ traceEvents: events }));
  }
  for (const report of reports) {
    const frames = result.frames.filter(frame => frame.at >= report.started && frame.at <= report.ended).map(frame => frame.duration);
    report.framesOver32ms = frames.filter(duration => duration > 32).length;
    report.maxFrameMs = Math.max(0, ...frames);
    report.longTasks = result.tasks.filter(task => task.at >= report.started && task.at < report.ended).map(task => task.duration);
  }
  assert.ok(during.locked > 0);
  assert.equal(during.selection, '');
  assert.equal(await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.messages > article')];
    return rows.length === 360 && rows.every((row, index) => row === window.gestureArticles[index]
      && !row.style.width && !row.hasAttribute('data-layout-locked'));
  }), true);
  assert.deepEqual(errors, []);
  const receipt = { label, browser: browser.version(), tracing, neutralizeInherited, during, reports };
  await writeFile(resolve(output, `${label}.json`), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
