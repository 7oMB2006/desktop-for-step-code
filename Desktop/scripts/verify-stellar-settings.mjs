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
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser, page;
const results = {}, errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html?view=chat`;
  const metrics = selector => page.locator(selector).first().evaluate(e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, font: s.fontFamily,
      size: s.fontSize, line: s.lineHeight, background: s.backgroundColor, color: s.color,
      border: s.borderColor, radius: s.borderRadius, shadow: s.boxShadow,
      animation: s.animation, transition: s.transition };
  });
  const focus = async (control, indicator = control) => {
    await control.scrollIntoViewIfNeeded();
    await control.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    assert.equal(await control.evaluate(e => e === document.activeElement), true);
    const state = await indicator.evaluate(e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset), fits = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p), b = p.getBoundingClientRect();
        if (/(hidden|clip|scroll|auto)/.test(ps.overflowX)) fits.push(r.left - extent >= b.left - .5 && r.right + extent <= b.right + .5);
        if (/(hidden|clip|scroll|auto)/.test(ps.overflowY)) fits.push(r.top - extent >= b.top - .5 && r.bottom + extent <= b.bottom + .5);
      }
      return { width: parseFloat(s.outlineWidth), fits };
    });
    assert.ok(state.width >= 2 && state.fits.every(Boolean), JSON.stringify(state));
  };
  for (const theme of ['plugin:stellar-cruise', 'original-light', 'original-dark']) {
    for (const width of [1440, 390]) {
      page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(theme => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
        JSON.stringify({ theme, themeMotion: false })), theme);
      await page.goto(url); await page.locator('.composer-input').waitFor();
      const key = `${theme.replace(':', '-')}-${width}`, state = {};
      results[key] = state;
      const shot = async name => {
        await page.mouse.move(2, 2); await page.waitForTimeout(180);
        await page.screenshot({ path: join(output, `${capture ? 'before' : 'after'}-${key}-${name}.png`) });
      };
      const read = async (name, selectors) => {
        state[name] = {};
        for (const selector of selectors) state[name][selector] = await metrics(selector);
      };
      await page.locator('.sidebar-bottom > button').click();
      const settings = page.getByRole('dialog', { name: '设置', exact: true });
      const nav = settings.getByRole('navigation', { name: '设置分类', exact: true });
      await nav.getByRole('button', { name: '通用', exact: true }).click();
      await page.getByRole('combobox', { name: '会话排序', exact: true }).waitFor();
      await page.setViewportSize({ width, height: 960 });
      await read('general', ['.settings-backdrop', '.settings-dialog', '.settings-dialog > header', '.settings-layout > nav',
        '.settings-layout > nav .selected', '.settings-content > h3', '.settings-content > label > select']);
      await focus(page.getByRole('combobox', { name: '会话排序', exact: true }));
      await shot('general');
      await nav.getByRole('button', { name: '外观', exact: true }).click();
      await page.locator('.appearance-settings').scrollIntoViewIfNeeded();
      await read('appearance', ['.appearance-heading', '.appearance-row', '.appearance-number input', '.appearance-preview']);
      await focus(page.getByRole('spinbutton', { name: '界面字号', exact: true }));
      await focus(page.getByRole('spinbutton', { name: '代码字号', exact: true }));
      await shot('typography');
      await nav.getByRole('button', { name: '界面复杂度', exact: true }).click();
      const toggle = page.getByRole('switch', { name: '工具详情默认展开', exact: true });
      await read('interface', ['.interface-heading', '.interface-presets', '.interface-presets button[aria-pressed=true]',
        '.interface-option', '.interface-switch', '.interface-preview']);
      const checked = await toggle.isChecked();
      await toggle.press('Space'); assert.notEqual(await toggle.isChecked(), checked);
      await toggle.press('Space'); assert.equal(await toggle.isChecked(), checked);
      await focus(toggle, toggle.locator('+ .interface-switch'));
      await shot('interface');
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
      await settings.waitFor({ state: 'detached' });
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator('.workspace-heading.current').click({ button: 'right' });
      await page.locator('.sidebar-context').getByRole('menuitem', { name: '重命名', exact: true }).click();
      const rename = page.locator('.small-dialog');
      await rename.waitFor(); await page.setViewportSize({ width, height: 960 });
      await read('rename', ['.modal-backdrop', '.small-dialog', '.small-dialog > h2', '.small-dialog > input', '.small-dialog .primary']);
      const input = rename.getByRole('textbox'), previous = await input.inputValue();
      await focus(input);
      await input.fill(''); assert.equal(await rename.getByRole('button', { name: '确认', exact: true }).isDisabled(), true);
      await input.fill(previous); assert.equal(await rename.getByRole('button', { name: '确认', exact: true }).isEnabled(), true);
      await shot('rename');
      await rename.getByRole('button', { name: '取消', exact: true }).click();
      await rename.waitFor({ state: 'detached' });
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator('.workspace-heading.current').click({ button: 'right' });
      await page.locator('.project-remove-menu').click();
      const removal = page.getByRole('dialog', { name: '移除项目', exact: true });
      await removal.waitFor(); await page.setViewportSize({ width, height: 960 });
      await read('removal', ['.project-removal-dialog', '.project-removal-dialog > header', '.project-removal-path',
        '.project-removal-dialog > .muted', '.project-remove-confirm']);
      assert.equal(await page.locator('.project-remove-confirm').evaluate(e => {
        const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; document.body.append(probe);
        const same = getComputedStyle(e).color === getComputedStyle(probe).color; probe.remove(); return same;
      }), true);
      await focus(removal.getByRole('button', { name: '取消', exact: true }));
      await shot('removal');
      await page.keyboard.press('Escape'); await removal.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 1440) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.locator('.sidebar-bottom > button').click();
        assert.equal(await settings.evaluate(e => getComputedStyle(e).animationName), 'settings-dialog-enter');
        assert.equal(await settings.evaluate(e => getComputedStyle(e).animationDuration), '0.22s');
        await settings.getByRole('button', { name: 'Close', exact: true }).click();
        await settings.waitFor({ state: 'detached' });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator('.sidebar-bottom > button').click();
        assert.equal(await settings.evaluate(e => getComputedStyle(e).animationName), 'none');
        await settings.getByRole('button', { name: 'Close', exact: true }).click();
        await settings.waitFor({ state: 'detached' });
      }
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  if (capture) await writeFile(join(output, 'before.json'), JSON.stringify(results, null, 2));
  else {
    let baseline;
    try { baseline = JSON.parse(await readFile(join(output, 'before.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (baseline) for (const [view, surfaces] of Object.entries(results)) {
      if (view.startsWith('original-')) assert.deepEqual(surfaces, baseline[view], `${view} unchanged`);
      for (const [surface, selectors] of Object.entries(surfaces))
        for (const [selector, value] of Object.entries(selectors))
          for (const name of ['x', 'y', 'width', 'height', 'font', 'size', 'line', 'animation', 'transition'])
            assert.equal(value[name], baseline[view][surface][selector][name], `${view} ${surface} ${selector} ${name}`);
    }
    await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, comparedBaseline: !!baseline, results, errors }, null, 2));
  }
  console.log(JSON.stringify({ passed: true, capturedBaseline: capture, errors }));
} catch (e) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw e;
} finally { await browser?.close(); await server.close(); }
