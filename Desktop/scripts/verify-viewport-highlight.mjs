import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { markdownWorker } from '../vite.config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results/viewport-highlight');
const outDir = resolve(output, 'site');
await mkdir(output, { recursive: true });
await build({ root, configFile: false, base: './', logLevel: 'warn', worker: markdownWorker,
  build: { outDir, emptyOutDir: true, rolldownOptions: { input: resolve(root, 'tests/fixtures/long-session-interaction.html') } } });
const server = await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const errors = [], reports = [];
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeObserver = IntersectionObserver;
    const held = new Map();
    window.holdCodeHighlights = false;
    window.codeObservers = new Set();
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback, options) {
        super((entries, observer) => {
          if (!window.holdCodeHighlights || !entries.some(entry => entry.target.matches('code[data-code-highlight]'))) {
            callback(entries, observer); return;
          }
          const saved = held.get(observer) ?? { callback, entries: new Map() };
          entries.forEach(entry => saved.entries.set(entry.target, entry));
          held.set(observer, saved);
        }, options);
      }
      observe(element) { if (element.matches('code[data-code-highlight]')) window.codeObservers.add(this); super.observe(element); }
      unobserve(element) { held.get(this)?.entries.delete(element); super.unobserve(element); }
      disconnect() { held.delete(this); super.disconnect(); }
    };
    window.resumeCodeHighlights = () => {
      window.holdCodeHighlights = false;
      for (const [observer, saved] of held) saved.callback([...saved.entries.values()], observer);
      held.clear();
    };
  });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/long-session-interaction.html`;
  await page.goto(`${url}?size=long`);
  await page.waitForFunction(() => window.interactionFixture && document.querySelectorAll('.messages > article').length === 360);
  await page.waitForTimeout(400);
  const initial = await page.evaluate(() => ({
    articles: document.querySelectorAll('.messages > article').length,
    code: document.querySelectorAll('.response-text code.hljs').length,
    ready: document.querySelectorAll('[data-code-highlight="ready"]').length,
    observers: window.codeObservers.size,
    source: document.querySelectorAll('.response-text code')[70].textContent,
  }));
  assert.equal(initial.articles, 360);
  assert.equal(initial.code, 180);
  assert.ok(initial.ready > 0 && initial.ready < 20, 'Only near-visible code is colored during long-history opening');
  assert.equal(initial.observers, 1, 'Code blocks must share an observer, not allocate one each');
  assert.match(initial.source, /export function verify70/);
  reports.push({ initial });

  const code = page.locator('.response-text code.hljs').nth(70);
  assert.equal(await code.getAttribute('data-code-highlight'), 'pending');
  const before = await code.evaluate(element => {
    window.codeIdentity = element;
    const bounds = element.closest('pre').getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, text: element.textContent };
  });
  // Copy must work before coloring, without scrolling it into the viewport.
  await code.locator('..').locator('.copy-button').evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.interactionFixture.copiedText), before.text);
  assert.equal(await code.getAttribute('data-code-highlight'), 'pending');
  await code.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.codeIdentity.dataset.codeHighlight === 'ready');
  const after = await code.evaluate(element => {
    const bounds = element.closest('pre').getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, text: element.textContent, same: element === window.codeIdentity };
  });
  assert.equal(after.same, true);
  assert.equal(after.text, before.text);
  assert.ok(Math.abs(after.width - before.width) < 0.1 && Math.abs(after.height - before.height) < 0.1,
    'Coloring must not change the code block geometry');
  reports.push({ firstVisit: { before, after } });

  // Hold observer delivery only to deterministically select still-plain code.
  await page.evaluate(() => { window.holdCodeHighlights = true; });
  const makeHistory = source => [{ role: 'user', entryId: 'code-user', content: 'Inspect this code.' },
    { role: 'assistant', entryId: 'code-answer', content: source, stopReason: 'stop' }];
  const source = '```typescript\nconst chosen = "<script>& 中文 😀";\nexport const value = 42;\n```\n\nVisible **prose** still appears progressively.';
  await page.evaluate(messages => window.interactionFixture.setHistory(messages), makeHistory(source));
  const chosen = page.locator('.response-text code.hljs');
  await chosen.waitFor();
  await chosen.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await chosen.evaluate(element => {
    window.selectedCode = element;
    const range = document.createRange();
    range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 12);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    window.nativeCodeRange = range;
    const search = document.createRange();
    search.setStart(element.firstChild, 6); search.setEnd(element.firstChild, 12);
    window.savedCodeMatch = search;
    CSS.highlights.set('desktop-test-code-match', new Highlight(search));
    document.dispatchEvent(new Event('selectionchange'));
    window.resumeCodeHighlights();
  });
  await page.waitForTimeout(150);
  assert.equal(await chosen.getAttribute('data-code-highlight'), 'pending');
  assert.equal(await page.evaluate(() => getSelection().toString()), 'const chosen');
  assert.equal(await page.evaluate(() => window.nativeCodeRange.startContainer.isConnected), true);
  await page.getByRole('button', { name: 'Quote', exact: true }).click();
  await page.waitForFunction(() => window.selectedCode.dataset.codeHighlight === 'ready');
  const ranges = await chosen.evaluate(element => ({
    same: element === window.selectedCode, search: window.savedCodeMatch.toString(),
    connected: window.savedCodeMatch.startContainer.isConnected,
    registered: CSS.highlights.get('desktop-test-code-match').has(window.savedCodeMatch),
    markupSafe: element.querySelector('script') === null && element.textContent.includes('<script>'),
  }));
  assert.deepEqual(ranges, { same: true, search: 'chosen', connected: true, registered: true, markupSafe: true });
  await page.getByRole('button', { name: 'View quotes', exact: true }).click();
  const quotePreview = page.getByRole('dialog', { name: 'Quote preview', exact: true });
  await quotePreview.waitFor();
  assert.match(await quotePreview.innerText(), /const chosen/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Clear quotes', exact: true }).click();
  await page.evaluate(() => CSS.highlights.delete('desktop-test-code-match'));
  reports.push({ selectionAndSearch: ranges });

  // Obsolete queued source must never color a later authoritative answer.
  await page.evaluate(() => { window.holdCodeHighlights = true; });
  await page.evaluate(messages => window.interactionFixture.setHistory(messages), makeHistory('```js\nconst obsolete = 1;\n```'));
  await page.waitForFunction(() => document.querySelector('.response-text code')?.textContent.includes('obsolete'));
  await page.waitForTimeout(80);
  await page.evaluate(messages => window.interactionFixture.setHistory(messages), makeHistory('```python\ncurrent = "<value>"\nprint(current)\n```'));
  await page.waitForFunction(() => document.querySelector('.response-text code')?.textContent.includes('current'));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.resumeCodeHighlights());
  await page.waitForFunction(() => document.querySelector('.response-text code')?.dataset.codeHighlight === 'ready');
  assert.equal(await chosen.textContent(), 'current = "<value>"\nprint(current)\n');
  assert.equal(await chosen.getAttribute('class'), 'hljs language-python');

  // Compare complete token markup, not just text, including partial and unknown grammars.
  for (const language of ['typescript', 'js', 'python', 'html', 'json', 'unknown-language', 'text']) {
    const text = '/* open */\nconst value = "<script>& 中文 😀";\nreturn { ready: true, amount: 42 };\n';
    for (const value of [text.slice(0, 19) + '\n', text]) {
      await page.evaluate(messages => window.interactionFixture.setHistory(messages),
        makeHistory(`\`\`\`${language}\n${value}\`\`\``));
      await page.waitForFunction(({ value, language }) => {
        const code = document.querySelector('.response-text code');
        return code?.textContent === value && code.classList.contains(`language-${language}`) && code.dataset.codeHighlight === 'ready';
      }, { value, language });
      assert.equal(await chosen.evaluate((element, { value, language }) => {
        const node = window.interactionFixture.referenceCode(value, `language-${language}`);
        const render = node => {
          if (node.type === 'text') return document.createTextNode(node.value);
          const result = document.createElement(node.tagName);
          if (node.properties.className) result.className = node.properties.className.join(' ');
          result.append(...node.children.map(render));
          return result;
        };
        return element.innerHTML === render(node).innerHTML;
      }, { value, language }), true, `Exact code-token parity for ${language}`);
    }
  }
  reports.push({ exactTokenCases: 14 });
  for (const theme of ['light', 'dark']) for (const width of [1200, 760, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${url}?size=short&theme=${theme}`);
    const final = page.locator('.response-text code.hljs').last();
    await final.waitFor(); await final.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.response-text code')].at(-1)?.dataset.codeHighlight === 'ready');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: resolve(output, `${theme}-${width}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.interactionFixture.startStream({ updates: 8 }));
  await page.locator('.response-active .stream-reveal').first().waitFor({ state: 'attached' });
  await page.waitForFunction(() => window.interactionFixture.streamUpdates === 8 && !document.querySelector('.response-active'));
  await page.waitForFunction(() => !document.querySelector('.stream-reveal'));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'verified.json'), JSON.stringify({ browser: browser.version(), reports,
    gates: ['full-source-visible', 'shared-observer', 'offscreen-copy', 'real-height-parity', 'native-selection-protection',
      'quote-source', 'css-search-ranges', 'stale-source', 'exact-token-parity', 'light-dark-narrow', 'stream-reveal'],
    errors }, null, 2) + '\n');
} finally {
  try { await browser?.close(); } finally { await new Promise(resolve => server.httpServer.close(resolve)); }
}
