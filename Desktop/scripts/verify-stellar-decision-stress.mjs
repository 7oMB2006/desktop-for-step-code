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
      for (const view of ['permission', 'plan', 'question']) {
        const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(theme => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
          JSON.stringify({ theme, themeMotion: false })), theme);
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=${view}&stress=decisions`);
        await page.locator('.approval-drawer').waitFor();
        await page.locator('.approval-drawer-grip').press('End');
        await page.waitForTimeout(150);
        const key = `${theme.replace(':', '-')}-${view}-${width}`;
        const state = await page.locator('.approval-drawer').evaluate(e => {
          const content = e.querySelector('.permission-approval-content');
          const actions = e.querySelector('.button-row'), r = e.getBoundingClientRect();
          const a = actions.getBoundingClientRect(), s = getComputedStyle(actions);
          return { width: r.width, height: r.height, actionsHeight: a.height,
            actionsBottom: a.bottom, border: s.borderTopColor, background: s.backgroundColor,
            overflow: content.scrollWidth > content.clientWidth + 1,
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            buttons: [...actions.querySelectorAll('button')].map(b => [b.textContent, b.disabled]),
          };
        });
        results[key] = state;
        if (!capture && theme.startsWith('plugin:')) {
          assert.equal(state.overflow, false, `${key} content overflow`);
          assert.equal(state.pageOverflow, false, `${key} page overflow`);
          assert.ok(state.actionsBottom <= 960, `${key} actions visible`);
        }
        await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${key}.png`) });
        if (view === 'question') {
          await page.getByRole('radio', { name: /其他回答/ }).check();
          const field = page.getByRole('textbox', { name: '你的回答', exact: true });
          await field.fill('保留原有尺寸。\n检查完整路径、选中状态与多行备注。\n不要隐藏警告。');
          await page.getByRole('button', { name: '稍后回答', exact: true }).click();
          await page.locator('.approval-drawer').waitFor({ state: 'detached' });
          await page.getByRole('button', { name: '打开待回答问题', exact: true }).click();
          assert.match(await field.inputValue(), /多行备注/);
        }
        await page.close();
      }
    }
  }
  assert.deepEqual(errors, []);
  if (capture) await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  else {
    const before = JSON.parse(await readFile(join(output, 'before.json'), 'utf8'));
    for (const [key, state] of Object.entries(results)) {
      if (!key.startsWith('plugin-')) assert.deepEqual(state, before[key]);
      for (const prop of ['width', 'height', 'actionsHeight', 'actionsBottom', 'buttons'])
        assert.deepEqual(state[prop], before[key][prop], `${key} ${prop}`);
    }
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, errors }));
} finally { await browser?.close(); await server.close(); }
