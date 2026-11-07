import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2], capture = process.argv.includes('--capture-before');
const standalone = process.argv.includes('--standalone');
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
    for (const brightness of [40, 120]) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ theme, brightness }) => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
        JSON.stringify({ theme, themeMotion: false, themeBrightness: brightness })), { theme, brightness });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat&stress=statuses`);
      await page.locator('.session-activity.failed').first().waitFor({ state: 'attached' });
      if (theme.startsWith('plugin:')) await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
      await page.setViewportSize({ width, height: 960 });
      if (width === 390) await page.getByRole('button', { name: '侧栏', exact: true }).click();
      await page.waitForTimeout(200);
      const key = `${theme.replace(':', '-')}-${brightness}-${width}`;
      results[key] = await page.locator('.sidebar').evaluate(sidebar => {
        const rows = [...sidebar.querySelectorAll('.session-row')];
        return rows.map(row => {
          const dot = row.querySelector('.session-activity'), r = row.getBoundingClientRect();
          const s = getComputedStyle(row), d = getComputedStyle(dot);
          return { selected: row.classList.contains('selected'), state: dot.className,
            width: r.width, height: r.height, font: s.font, background: d.backgroundColor,
            border: d.borderColor, animation: d.animation, visibility: d.visibility };
        });
      });
      if (!capture && theme.startsWith('plugin:')) {
        const idle = page.locator('.session-row.selected .session-activity.idle');
        assert.equal(await idle.count(), 1);
        assert.equal(await idle.evaluate(e => {
          const probe = document.createElement('span');
          probe.style.background = 'var(--stellar-control)'; document.body.append(probe);
          const equal = getComputedStyle(e).backgroundColor === getComputedStyle(probe).backgroundColor;
          probe.remove(); return equal;
        }), true);
        for (const status of ['running', 'waiting', 'failed', 'completed'])
          assert.ok(results[key].some(row => row.state.includes(status)), `${key}: ${status}`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.mouse.move(2, 2);
      await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${key}.png`) });
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  if (capture) await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  else if (!standalone) {
    const before = JSON.parse(await readFile(join(output, 'before.json'), 'utf8'));
    for (const [key, rows] of Object.entries(results)) {
      rows.forEach((row, index) => {
        const original = before[key][index];
        if (!key.startsWith('plugin-') || !row.selected || !row.state.includes('idle'))
          assert.deepEqual(row, original, `${key}: ${index}`);
        else for (const prop of ['width', 'height', 'font', 'state', 'animation', 'visibility'])
          assert.deepEqual(row[prop], original[prop], `${key}: ${prop}`);
      });
    }
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  }
  if (standalone) await writeFile(join(output, 'acceptance.json'),
    JSON.stringify({ passed: true, comparedBaseline: false, results, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, comparedBaseline: !capture && !standalone, errors }));
} finally { await browser?.close(); await server.close(); }
