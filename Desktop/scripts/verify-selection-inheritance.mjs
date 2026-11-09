import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'test-results/selection-inheritance');
await mkdir(output, { recursive: true });
const styles = (await Promise.all(['layout', 'stellar-records'].map(name =>
  readFile(resolve(root, `src/${name}.css`), 'utf8')))).join('\n');
const browser = await chromium.launch({ headless: true,
  ...(process.env.DESKTOP_BROWSER_CHANNEL ? { channel: process.env.DESKTOP_BROWSER_CHANNEL } : {}) });
const reports = [], errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark', 'stellar']) for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(`<!doctype html><html data-theme="${theme === 'light' ? 'light' : 'dark'}"
      ${theme === 'stellar' ? 'data-theme-material="stellar"' : ''}><head><meta charset="utf-8">
      <style>
        :root { --bg: ${theme === 'light' ? '#fff' : '#191a1b'}; --ink: ${theme === 'light' ? '#222' : '#eee'};
          --muted: #888; --border: #777; --surface: #777; }
        body { margin: 20px; background: var(--bg); color: var(--ink); font: 14px/1.6 Arial; }
        .message-body { max-width: 720px; }
        pre { padding: 8px; white-space: pre-wrap; background: #383838; color: #fff; }
        .hljs-keyword { color: #ef88d0; } .hljs-number { color: #75cf98; }
        table { border-collapse: collapse; } td, th { padding: 4px 8px; border: 1px solid #777; }
        a { color: #73a4ff; } textarea, [contenteditable] { font: inherit; color: var(--ink); background: var(--bg); }
        textarea { display: block; width: 100%; box-sizing: border-box; }
      </style><style>${styles}</style></head><body>
      <article class="message-body"><div class="response-text">
        <p>Readable <strong>bold <em>nested emphasis</em></strong> and <a href="https://example.com/">linked text</a>.</p>
        <p>Inline <code><span class="hljs-keyword">source</span></code> and ordinary text.</p>
        <blockquote><p>Quoted <strong>source</strong> stays selectable.</p></blockquote>
        <ul><li>First <em>item</em></li><li>Second item</li></ul>
        <pre><code><span class="hljs-keyword">const</span> value = <span class="hljs-number">42</span>;</code></pre>
        <table><thead><tr><th>Operation</th><th>Expected</th></tr></thead>
          <tbody><tr><td><strong>Open</strong></td><td><code>Readable</code></td></tr></tbody></table>
        <div role="alert"><p><strong>Diagnostic</strong> with nested <em>content</em>.</p></div>
        <div class="warning"><p>Warning <strong>details</strong>.</p></div>
        <div class="error"><p>Error <strong>details</strong>.</p></div>
      </div></article>
      <article class="message-body user"><p>User text with <em>formatting</em>.</p></article>
      <div class="composer"><div class="composer-input" contenteditable="true">Editable <strong>draft</strong>.</div></div>
      <div class="composer"><textarea class="composer-input">Textarea draft source</textarea></div>
      </body></html>`);
    const selectors = ['article:first-of-type', '.message-body.user', '[contenteditable]', 'textarea'];
    for (const [index, selector] of selectors.entries()) {
      await page.evaluate(selector => {
        const target = document.querySelector(selector);
        if (target instanceof HTMLTextAreaElement) { target.focus(); target.select(); return; }
        document.activeElement?.blur();
        const range = document.createRange(); range.selectNodeContents(target);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      }, selector);
      const read = () => page.evaluate(selector => {
        const target = document.querySelector(selector);
        return { text: target instanceof HTMLTextAreaElement ? target.value.slice(target.selectionStart, target.selectionEnd) : getSelection().toString(),
          colors: [target, ...target.querySelectorAll('*')].map(element => {
            const style = getComputedStyle(element, '::selection');
            return { color: style.color, background: style.backgroundColor };
          }) };
      }, selector);
      const actual = await read();
      assert.ok(actual.text.trim().length > 0);
      const image = await page.screenshot({ caret: 'hide', animations: 'disabled' });
      // Recreate the preceding descendant-universal rules without another fixture implementation.
      const count = await page.evaluate(() => {
        const sheet = new CSSStyleSheet();
        for (const source of document.styleSheets) for (const rule of source.cssRules) {
          if (rule.selectorText?.includes('::selection')) {
            sheet.insertRule(`${rule.selectorText}, ${rule.selectorText.replaceAll('::selection', ' ::selection')} { ${rule.style.cssText} }`, sheet.cssRules.length);
          }
        }
        document.adoptedStyleSheets = [sheet];
        return sheet.cssRules.length;
      });
      assert.equal(count, 4);
      const reference = await read();
      assert.deepEqual(actual, reference, `${theme}/${width}/${selector}: native selection colors and text must match`);
      const referenceImage = await page.screenshot({ caret: 'hide', animations: 'disabled' });
      await writeFile(resolve(output, `${theme}-${width}-${index}.png`), image);
      await writeFile(resolve(output, `${theme}-${width}-${index}-reference.png`), referenceImage);
      assert.ok(image.equals(referenceImage), `${theme}/${width}/${selector}: native selection pixels must match`);
      await page.evaluate(() => { document.adoptedStyleSheets = []; });
      reports.push({ theme, width, selector, selectedCharacters: actual.text.length, colors: 'identical', pixels: 'identical' });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ browser: browser.version(), reports, errors }, null, 2) + '\n');
  console.log(`Native selection inheritance: ${reports.length} color, text and pixel comparisons passed.`);
} finally { await browser.close(); }
