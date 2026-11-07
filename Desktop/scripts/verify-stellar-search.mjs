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
let browser, page;
const results = {}, errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  for (const theme of ['plugin:stellar-cruise', 'original-light', 'original-dark']) {
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(theme => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
      JSON.stringify({ theme, themeMotion: false })), theme);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`);
    await page.locator('.composer-input').waitFor();
    const state = {}; results[theme] = state;
    const metric = async (key, locator) => {
      state[key] = await locator.evaluate(e => {
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, text: e.textContent,
          font: s.fontFamily, size: s.fontSize, color: s.color, background: s.backgroundColor,
          border: s.borderColor, transition: s.transition };
      });
    };
    const shot = async name => {
      await page.mouse.move(2, 2); await page.waitForTimeout(160);
      await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${theme.replace(':', '-')}-${name}.png`) });
    };
    const selected = await page.locator('.session-row.selected').getAttribute('data-reorder-id');
    await page.locator('.composer-input').fill('Keep this offline draft.');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    const input = page.getByRole('textbox', { name: '搜索会话', exact: true });
    await input.fill('星辰 离线');
    await page.locator('.session-search-status').waitFor();
    await metric('search', page.locator('.sidebar-search-field'));
    await metric('status', page.locator('.session-search-status'));
    await metric('row', page.locator('.workspace-tree .session-row').first());
    state.ids = await page.locator('.workspace-tree .session-row').evaluateAll(es => es.map(e => e.dataset.reorderId));
    assert.ok(state.ids.length > 2);
    if (!capture) assert.equal(await page.locator('.session-search-match').count() > 0, theme.startsWith('plugin:'));
    const focus = await input.evaluate(e => {
      const parent = e.closest('.sidebar-utility-row'), s = getComputedStyle(parent), r = parent.getBoundingClientRect();
      const side = e.closest('.sidebar').getBoundingClientRect();
      return { width: s.outlineWidth, fits: r.left - 4 >= side.left && r.right + 4 <= side.right };
    });
    assert.equal(focus.width, '2px'); assert.equal(focus.fits, true);
    await shot('search');
    await input.fill('no-results-9876');
    assert.equal(await page.locator('.workspace-tree .session-row').count(), 0);
    await metric('emptySearch', page.locator('.list-empty'));
    await shot('empty-search');
    await input.press('Escape');
    assert.equal(await page.getByRole('button', { name: '搜索', exact: true }).evaluate(e => e === document.activeElement), true);
    assert.equal(await page.locator('.session-search-status').count(), 0);
    assert.equal(await page.locator('.session-search-match').count(), 0);
    assert.equal(await page.locator('.session-row.selected').getAttribute('data-reorder-id'), selected);
    assert.equal(await page.locator('.composer-input').innerText(), 'Keep this offline draft.');
    await page.locator('.composer-input').fill('');
    // Stress the real file components with offline metadata, never native files.
    await page.evaluate(() => {
      const open = window.desktop.fileOpen, diff = window.desktop.repositoryDiff;
      window.desktop.reviewMenu = async () => 'branch';
      window.desktop.fileOpen = async (...args) => {
        const value = await open(...args);
        if (value?.file) {
          value.file.name = 'stellar-workspace-session-navigation-keyboard-accessibility-and-context-recovery-integration-review-notes.md';
          value.file.path = `D:\\Preview\\Stellar\\docs\\workspace\\sessions\\navigation\\${value.file.name}`;
        }
        return value;
      };
      window.desktop.repositoryDiff = async (...args) => {
        const value = await diff(...args);
        value.files = Array.from({ length: 8 }, (_, i) => ({ ...value.files[0],
          path: `src/workspace/session-navigation/accessibility/checks-${i}/stellar-navigation-${i}.tsx` }));
        value.added = value.files.reduce((sum, file) => sum + file.added, 0);
        value.removed = value.files.reduce((sum, file) => sum + file.removed, 0);
        return value;
      };
    });
    const panel = async name => {
      await page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name, exact: true }).click();
    };
    await panel('文件预览');
    await metric('emptyFile', page.locator('.file-preview-empty'));
    await metric('emptyFileIcon', page.locator('.file-preview-empty > svg'));
    await shot('empty-file');
    await panel('变更');
    await page.getByRole('button', { name: '变更来源', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.review-file-row').length === 8);
    await metric('fileRow', page.locator('.review-file-row').first());
    await metric('path', page.locator('.review-file-name small').first());
    await shot('list');
    await page.locator('.review-file-row').first().click();
    await page.locator('.review-file-body.is-open .turn-diff-table').waitFor();
    state.diff = await page.locator('#review-panel .diff-line-add, #review-panel .diff-line-remove')
      .evaluateAll(es => es.map(e => [e.className, getComputedStyle(e).backgroundColor]));
    await page.evaluate(() => {
      const diff = window.desktop.repositoryDiff;
      window.desktop.repositoryDiff = async (...args) => ({
        ...await diff(...args), files: [], added: 0, removed: 0,
      });
    });
    await page.getByRole('button', { name: '刷新变更', exact: true }).click();
    await page.locator('.review-empty').waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot(`empty-review-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await panel('文件预览');
    await page.locator('#file-panel > header').getByRole('button', { name: '打开文件', exact: true }).click();
    await page.locator('.file-preview-identity strong').waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 }); await page.waitForTimeout(150);
      await metric(`identity${width}`, page.locator('.file-preview-identity'));
      await metric(`filename${width}`, page.locator('.file-preview-identity strong'));
      assert.equal(await page.locator('.file-preview-identity strong').evaluate(e => e.scrollWidth > e.clientWidth), true);
      if (!capture) assert.equal(await page.locator('.file-preview-identity strong').getAttribute('title'),
        'stellar-workspace-session-navigation-keyboard-accessibility-and-context-recovery-integration-review-notes.md');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shot(`file-${width}`);
    }
    await page.getByRole('button', { name: '关闭文件预览', exact: true }).click();
    await page.getByRole('button', { name: '侧栏', exact: true }).click();
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await input.fill('星辰 离线');
    assert.deepEqual(await page.locator('.workspace-tree .session-row').evaluateAll(es => es.map(e => e.dataset.reorderId)), state.ids);
    assert.equal(await input.evaluate(e => {
      const r = e.closest('.sidebar-utility-row').getBoundingClientRect();
      return r.left >= 4 && r.right + 4 <= innerWidth;
    }), true);
    await shot('search-390');
    await input.press('Escape');
    assert.equal(await page.getByRole('button', { name: '搜索', exact: true }).evaluate(e => e === document.activeElement), true);
    if (!capture && theme.startsWith('plugin:')) {
      const reading = await page.evaluate(() => {
        // Style probes isolate selection inheritance without changing fixture messages.
        const host = document.createElement('div');
        host.className = 'message-body';
        host.innerHTML = '<div class="response-text"><p>Reading <strong>emphasis</strong> <code>code</code></p><div role="alert">Warning</div><a class="message-link" href="#reading"><span class="message-link-label">Reference</span></a></div>';
        document.body.append(host);
        const snapshot = () => Object.fromEntries(['p', 'strong', 'code', '[role=alert]'].map(selector => {
          const style = getComputedStyle(host.querySelector(selector), '::selection');
          return [selector, [style.backgroundColor, style.color]];
        }));
        const themed = snapshot();
        const label = getComputedStyle(host.querySelector('.message-link-label'));
        const underline = [label.textDecorationLine, label.textDecorationStyle];
        const root = document.documentElement, material = root.dataset.themeMaterial;
        delete root.dataset.themeMaterial;
        const native = snapshot();
        root.dataset.themeMaterial = material;
        host.remove();
        return { themed, native, underline };
      });
      assert.notDeepEqual(reading.themed.p, reading.native.p);
      assert.deepEqual(reading.themed.p, reading.themed.strong);
      assert.deepEqual(reading.themed.code, reading.native.code);
      assert.deepEqual(reading.themed['[role=alert]'], reading.native['[role=alert]']);
      assert.deepEqual(reading.underline, ['underline', 'solid']);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  if (capture) await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  else {
    const before = JSON.parse(await readFile(join(output, 'before.json'), 'utf8'));
    for (const [theme, state] of Object.entries(results)) {
      if (!theme.startsWith('plugin:')) assert.deepEqual(state, before[theme]);
      for (const [key, value] of Object.entries(state)) {
        if (['ids', 'diff'].includes(key)) assert.deepEqual(value, before[theme][key]);
        else for (const prop of ['x', 'y', 'width', 'height', 'text', 'font', 'size', 'transition'])
          assert.equal(value[prop], before[theme][key][prop], `${theme} ${key} ${prop}`);
      }
    }
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, errors }));
} catch (e) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw e;
} finally { await browser?.close(); await server.close(); }
