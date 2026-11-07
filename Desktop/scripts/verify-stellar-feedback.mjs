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
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
const results = {}, errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  for (const theme of ['plugin:stellar-cruise', 'original-light', 'original-dark']) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(theme => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
        JSON.stringify({ theme, themeMotion: false })), theme);
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`);
      const button = page.locator('.code-header button').first();
      await button.waitFor();
      await button.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        window.__copies = [];
        window.desktop.copyText = async text => { window.__copies.push(text); };
      });
      const metric = locator => locator.evaluate(e => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return { width: r.width, height: r.height, font: s.font, color: s.color,
          background: s.backgroundColor, opacity: s.opacity, cursor: s.cursor };
      });
      const state = { idle: await metric(button) };
      await button.click();
      await button.locator('.lucide-check').waitFor();
      if (!capture) assert.equal(await button.getAttribute('data-copied'), 'true');
      state.copied = await metric(button);
      assert.equal(state.idle.width, state.copied.width);
      assert.equal(state.idle.height, state.copied.height);
      assert.ok((await page.evaluate(() => window.__copies[0])).length > 0);
      await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${theme.replace(':', '-')}-${width}-copy.png`) });
      await button.locator('.lucide-copy').waitFor();
      await page.evaluate(() => { window.desktop.copyText = async () => { throw new Error('Offline clipboard failure'); }; });
      await button.click();
      await page.getByText('Offline clipboard failure', { exact: true }).waitFor();
      assert.equal(await button.locator('.lucide-check').count(), 0);
      if (!capture) assert.equal(await button.getAttribute('data-copied'), 'false');

      await page.evaluate(() => {
        const open = window.desktop.fileOpen;
        window.desktop.fileOpen = (...args) => new Promise(resolve => {
          window.__finishFile = async () => resolve(await open(...args));
        });
      });
      await page.getByRole('navigation', { name: '右侧工具', exact: true })
        .getByRole('button', { name: '文件预览', exact: true }).click();
      const open = page.locator('.file-preview-empty > button');
      await open.waitFor();
      state.open = await metric(open);
      await open.click();
      await page.waitForFunction(() => document.querySelector('.file-preview-empty > button')?.disabled);
      state.disabled = await metric(open);
      assert.equal(state.open.width, state.disabled.width);
      assert.equal(state.open.height, state.disabled.height);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${theme.replace(':', '-')}-${width}-disabled.png`) });
      await page.evaluate(() => window.__finishFile());
      await page.locator('.file-preview-identity').waitFor();
      results[`${theme}-${width}`] = state;
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  if (capture) await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  else {
    const before = JSON.parse(await readFile(join(output, 'before.json'), 'utf8'));
    for (const [key, state] of Object.entries(results)) {
      if (!key.startsWith('plugin:')) assert.deepEqual(state, before[key]);
      for (const [name, value] of Object.entries(state))
        for (const prop of ['width', 'height', 'font']) assert.equal(value[prop], before[key][name][prop], `${key} ${name} ${prop}`);
    }
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, errors }));
} finally { await browser?.close(); await server.close(); }
