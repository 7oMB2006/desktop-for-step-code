import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { markdownWorker } from '../vite.config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const label = process.env.DESKTOP_STREAMING_LABEL ?? 'candidate';
const baseline = process.env.DESKTOP_STREAMING_BASELINE === '1';
assert.match(label, /^[a-z0-9-]+$/i);
const output = resolve(root, 'test-results/streaming-markdown');
const outDir = resolve(output, 'site');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn', worker: markdownWorker,
  build: { outDir, emptyOutDir: true, rolldownOptions: { input: resolve(root, 'tests/fixtures/streaming-markdown.html') } } });
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
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/streaming-markdown.html`;
  const assertParity = async context => {
    const markup = await page.evaluate(() => {
      const clean = element => {
        const clone = element.cloneNode(true);
        for (const span of clone.querySelectorAll('.stream-reveal')) span.replaceWith(...span.childNodes);
        for (const button of clone.querySelectorAll('.copy-button')) button.remove();
        // Offscreen coloring is intentionally delayed; test structure/source here.
        // Exact grammar/token parity is covered by markdown-highlight and verify-viewport-highlight.
        for (const code of clone.querySelectorAll('code.hljs')) {
          code.replaceChildren(document.createTextNode(code.textContent));
          code.removeAttribute('data-code-highlight');
        }
        for (const element of clone.querySelectorAll('[style=""]')) element.removeAttribute('style');
        return [...clone.childNodes].filter(node => node.nodeType !== 3 || node.textContent.trim())
          .map(node => node.outerHTML ?? node.textContent).join('');
      };
      return { actual: clean(document.querySelector('#streaming-output')), expected: clean(document.querySelector('#full-reference')) };
    });
    assert.equal(markup.actual, markup.expected, context);
  };
  for (const kind of ['prose', 'code', 'math', 'mixed', 'single-paragraph', 'growing-code']) {
    await page.goto(url);
    await page.waitForFunction(() => window.streamingFixture);
    await page.evaluate(() => {
      const result = { frames: [], tasks: [] };
      window.streamingSample = result;
      let last = performance.now();
      const frame = now => {
        result.frames.push(now - last); last = now;
        if (window.streamingSample === result) requestAnimationFrame(frame);
      };
      const observer = new PerformanceObserver(list => result.tasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask' });
      window.finishStreamingSample = () => { observer.disconnect(); window.streamingSample = null; return result; };
      requestAnimationFrame(frame);
    });
    const before = await metrics();
    await page.evaluate(kind => window.streamingFixture.start(kind), kind);
    await page.waitForFunction(() => window.streamingFixture.done, undefined, { timeout: 60000 });
    await page.waitForTimeout(250);
    const after = await metrics();
    const sample = await page.evaluate(() => ({
      ...window.finishStreamingSample(), workMs: window.streamingFixture.workMs,
      updates: window.streamingFixture.updates, characters: window.streamingFixture.source.length,
    }));
    const sorted = [...sample.workMs].sort((a, b) => a - b);
    const report = { kind, characters: sample.characters, updates: sample.updates,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      updateWorkMs: sample.workMs.reduce((sum, value) => sum + value, 0),
      p95UpdateMs: sorted[Math.floor(sorted.length * .95)], maxUpdateMs: Math.max(...sorted),
      framesOver32ms: sample.frames.filter(value => value > 32).length,
      maxFrameMs: Math.max(...sample.frames), longTasks: sample.tasks };
    console.log(JSON.stringify(report)); reports.push(report);
    const source = await page.evaluate(() => window.streamingFixture.source);
    await page.goto(`${url}?compare=1`);
    await page.waitForFunction(() => window.streamingFixture);
    for (const end of [Math.floor(source.length / 2), source.length - 4, source.length]) {
      await page.evaluate(text => window.streamingFixture.step(text), source.slice(0, end));
      await assertParity(`${kind}: immediate partial output ${end}`);
    }
    await page.evaluate(text => window.streamingFixture.step(text, false), source);
    await assertParity(`${kind}: completed output`);
  }

  await page.goto(`${url}?compare=1`);
  await page.waitForFunction(() => window.streamingFixture);
  const source = '# First\n\nKeep this **selected text**.\n\n```typescript\nconst ready = true;\n```\n\nMath $x^2$.\n\nTail';
  await page.evaluate(source => window.streamingFixture.step(source), source);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.retainedCode = document.querySelector('#streaming-output code.hljs');
    window.retainedMath = document.querySelector('#streaming-output .katex');
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#streaming-output strong'));
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.locator('#streaming-output .copy-button').first().click({ force: true });
  await page.evaluate(source => window.streamingFixture.step(source + ' continues'), source);
  const retained = await page.evaluate(() => ({
    code: window.retainedCode === document.querySelector('#streaming-output code.hljs'),
    math: window.retainedMath === document.querySelector('#streaming-output .katex'),
    selected: getSelection().toString(), copied: window.streamingFixture.copied,
    copyState: document.querySelector('#streaming-output .copy-button')?.dataset.copied,
  }));
  assert.match(retained.copied, /const ready = true/);
  if (!baseline) {
    assert.equal(retained.code, true);
    assert.equal(retained.math, true);
    assert.equal(retained.selected, 'selected text');
    assert.equal(retained.copyState, 'true');
  }
  console.log(JSON.stringify({ retained }));
  await page.evaluate(source => window.streamingFixture.step(source + ' continues', false), source);
  await page.waitForFunction(() => !document.querySelector('#streaming-output .stream-reveal'));
  const completed = await page.evaluate(() => ({
    code: window.retainedCode === document.querySelector('#streaming-output code.hljs'),
    math: window.retainedMath === document.querySelector('#streaming-output .katex'),
    selected: getSelection().toString(),
    copyState: document.querySelector('#streaming-output .copy-button')?.dataset.copied,
  }));
  if (!baseline) {
    assert.equal(completed.code, true);
    assert.equal(completed.math, true);
    assert.equal(completed.selected, 'selected text');
    assert.equal(completed.copyState, 'true');
  }
  for (const suffix of ['', '\n\n[later][ref]', '\n\n[later][ref]\n\n[ref]: https://example.com/',
    '\n\n[later][ref]\n\n> [ref]: https://nested.example/',
    '\n\n[ref]: https://first.example/\n\n> [ref]: https://second.example/\n>\n> [inside][ref]',
    '\n\nNote[^a]\n\n[^a]: A footnote.']) {
    await page.evaluate(text => window.streamingFixture.step(text), source + suffix);
    await page.waitForTimeout(220);
    await assertParity(`Full render parity: ${suffix}`);
  }
  for (const theme of ['light', 'dark']) for (const width of [1440, 760, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${url}?theme=${theme}`);
    await page.waitForFunction(() => window.streamingFixture);
    await page.evaluate(source => window.streamingFixture.step(source), source);
    await page.waitForTimeout(250);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await page.locator('.katex').count());
    assert.ok(await page.locator('code.hljs').count());
    await page.screenshot({ path: resolve(output, `${label}-${theme}-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(source => window.streamingFixture.step(source + '\n\nReduced motion text.'), source);
  assert.equal(await page.locator('.stream-reveal').last().evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.evaluate(source => window.streamingFixture.step(source, false), source);
  await page.waitForFunction(() => !document.querySelector('.stream-reveal'));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, `${label}.json`), JSON.stringify({
    label, browser: browser.version(), reports, retained, completed, errors,
    gates: ['full-render-parity', 'immediate-growing-block-parity', 'reference-definitions', 'footnotes', 'code-copy',
      'light-dark-narrow', 'reduced-motion', 'completion', ...(!baseline ? ['stable-code-math-selection'] : [])],
  }, null, 2) + '\n');
} finally {
  try { await browser?.close(); } finally { await new Promise(resolve => server.httpServer.close(resolve)); }
}
