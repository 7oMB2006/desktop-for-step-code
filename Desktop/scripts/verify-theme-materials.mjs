import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only visual acceptance. The fixture uses actual components with offline data.
const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
const before = process.argv.includes('--capture-before');
const compareBefore = process.argv.includes('--compare-before');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
  root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error',
});
const results = {};
let browser;
const rgb = value => value.match(/[\d.]+/g).map(Number);
const luminance = channels => channels.slice(0, 3).reduce((sum, c, i) => {
  const v = c / 255;
  return sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
}, 0);
const contrast = (a, b) => {
  const sorted = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (sorted[0] + .05) / (sorted[1] + .05);
};
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1908, height: 902 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
    JSON.stringify({ themeMotion: false })));
  const open = async view => {
    await page.goto(`${base}?view=${view}`);
    await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
    await page.waitForTimeout(450);
  };
  const capture = async (name, selectors) => {
    await page.waitForTimeout(350);
    const surfaces = {};
    for (const selector of selectors) {
      const el = page.locator(selector).first();
      await el.waitFor();
      surfaces[selector] = await el.evaluate(e => {
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        return { rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10),
          fill: s.backgroundColor, image: s.backgroundImage, border: s.borderTopColor,
          ink: s.color, muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),
          shadow: s.boxShadow, blur: s.backdropFilter };
      });
      if (!before) {
        const material = surfaces[selector], channels = rgb(material.fill);
        assert.equal(material.image, 'none', `${name}: ${selector} must not use a tinted gradient`);
        assert.ok(Math.max(...channels.slice(0, 3)) - Math.min(...channels.slice(0, 3)) <= 10,
          `${name}: ${selector} is not neutral: ${material.fill}`);
        assert.ok(channels.length < 4 || channels[3] >= .96,
          `${name}: ${selector} must protect text from moving scenery`);
        assert.ok(contrast(material.ink, material.fill) >= 4.5, `${name}: unreadable body text`);
        assert.ok(contrast(material.muted, material.fill) >= 4.5, `${name}: unreadable secondary text`);
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results[name] = surfaces;
    await page.screenshot({ path: join(output, `${before ? 'before' : 'after'}-${name}.png`) });
  };
  const focusFits = async field => {
    await field.focus();
    await field.scrollIntoViewIfNeeded();
    const result = await field.evaluate(e => {
      const s = getComputedStyle(e), box = e.getBoundingClientRect();
      const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
      const clips = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p), r = p.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(ps.overflowX))
          clips.push(box.left - extent >= r.left - .5 && box.right + extent <= r.right + .5);
        if (/(hidden|clip|auto|scroll)/.test(ps.overflowY))
          clips.push(box.top - extent >= r.top - .5 && box.bottom + extent <= r.bottom + .5);
      }
      return { width: parseFloat(s.outlineWidth), clips };
    });
    assert.ok(result.width >= 2 && result.clips.every(Boolean), JSON.stringify(result));
  };
  await open('plan');
  await capture('plan-wide', ['.approval-drawer', '.summary-board', '.message.user .message-body']);
  await page.setViewportSize({ width: 1440, height: 960 });
  await open('chat');
  await capture('chat', ['.composer', '.summary-board', '.message.user .message-body']);
  const rail = page.getByRole('navigation', { name: '右侧工具', exact: true });
  for (const [label, selector] of [['上下文', '#context-panel'], ['变更', '#review-panel'],
    ['会话导航', '#conversation-navigation-panel'], ['文件预览', '#file-panel']]) {
    await rail.getByRole('button', { name: label, exact: true }).click();
    await capture(selector.slice(1), [selector]);
  }
  for (const view of ['permission', 'question']) {
    await open(view);
    await capture(view, ['.approval-drawer']);
  }
  await open('welcome');
  await page.locator('.stellar-emblem[data-ready=true]').waitFor();
  assert.deepEqual(await page.locator('.stellar-emblem').evaluate(e => [e.clientWidth, e.clientHeight]), [48, 48]);
  await page.getByRole('button', { name: /^会话归属:/ }).click();
  await page.getByRole('textbox', { name: '搜索项目', exact: true }).fill('星辰');
  await capture('project-picker', ['.new-session-project-picker']);
  await page.keyboard.press('Escape');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await capture('settings', ['.settings-dialog']);
  await page.getByRole('button', { name: '玫红强调色', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '主题包 · 会话预览', exact: true }).click();
  await page.locator('.composer-input').fill('检查强调色与材质');
  await page.locator('.composer-input').focus();
  const accent = await page.evaluate(() => ({
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    fill: getComputedStyle(document.querySelector('.composer-action-button')).backgroundColor,
    border: getComputedStyle(document.querySelector('.composer')).borderTopColor,
  }));
  assert.equal(accent.fill, accent.primary);
  assert.equal(accent.border, accent.primary);
  await capture('accent', ['.composer']);

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    for (const view of ['plan', 'question']) {
      await open(view);
      if (view === 'plan') {
        await page.getByRole('button', { name: '提出修改', exact: true }).click();
        await focusFits(page.getByRole('textbox', { name: '修改意见', exact: true }));
      } else {
        await page.getByRole('radio', { name: /安静阅读/ }).check();
        await focusFits(page.getByRole('textbox', { name: '你的回答', exact: true }));
      }
      await capture(`${view}-${width}`, ['.approval-drawer']);
      const rect = results[`${view}-${width}`]['.approval-drawer'].rect;
      assert.ok(rect[0] >= 0 && rect[0] + rect[2] <= width + 1);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.approval-drawer').evaluate(e => getComputedStyle(e).animationName), 'none');
  assert.equal(await page.locator('.approval-drawer').evaluate(e => getComputedStyle(e).transitionDuration), '0s');

  if (!before && compareBefore) {
    const baseline = JSON.parse(await readFile(join(output, 'before.json'), 'utf8'));
    for (const [name, surfaces] of Object.entries(results))
      for (const [selector, material] of Object.entries(surfaces))
        assert.deepEqual(material.rect, baseline[name][selector].rect, `${name}: ${selector} geometry changed`);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, `${before ? 'before' : 'after'}.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, mode: before ? 'baseline' : 'acceptance',
    comparedGeometry: !before && compareBefore, captures: Object.keys(results).length, accent, errors }));
} finally {
  await browser?.close();
  await server.close();
}
