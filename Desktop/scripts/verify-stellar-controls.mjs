import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, configFile: join(root, 'vite.theme-preview.config.mjs'),
  server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
let browser, page;
const errors = [];
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/theme-pack.html`;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('dfsc-stellar-preview-preferences-v1'))
      localStorage.setItem('dfsc-stellar-preview-preferences-v1', JSON.stringify({ themeMotion: false }));
  });
  const open = async () => {
    await page.goto(`${base}?view=controls`);
    await page.locator('.composer-input').waitFor();
    await page.waitForFunction(() => document.querySelector('.model-effort-trigger')?.textContent.includes('离线样例'));
  };
  const shot = async name => {
    await page.mouse.move(800, 30);
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(output, `${name}.png`) });
  };
  const dimensions = () => page.evaluate(() => Object.fromEntries(
    ['.model-effort-popover', '.model-effort-fader', '.model-effort-fader-thumb', '.model-effort-trigger'].map(selector => {
      const e = document.querySelector(selector);
      return [selector, e ? [e.offsetWidth, e.offsetHeight] : null];
    })));
  const bounded = async locator => {
    const b = await locator.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width + .5 && b.y + b.height <= viewport.height + .5,
      JSON.stringify({ b, viewport }));
  };
  const focusFits = async locator => {
    await locator.focus();
    await locator.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const result = await locator.evaluate(e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      const extent = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
      const clips = [];
      for (let p = e.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p), pr = p.getBoundingClientRect();
        if (/(auto|hidden|scroll|clip)/.test(ps.overflowX)) clips.push(r.left - extent >= pr.left - .5 && r.right + extent <= pr.right + .5);
        if (/(auto|hidden|scroll|clip)/.test(ps.overflowY)) clips.push(r.top - extent >= pr.top - .5 && r.bottom + extent <= pr.bottom + .5);
      }
      return { focused: e === document.activeElement, outline: parseFloat(s.outlineWidth), clips };
    });
    assert.ok(result.focused && result.outline >= 2 && result.clips.every(Boolean), JSON.stringify(result));
  };
  const trigger = page.getByRole('button', { name: '模型与思考强度', exact: true });
  const dialog = page.getByRole('dialog', { name: '模型与思考强度', exact: true });
  const slider = dialog.getByRole('slider');
  const list = dialog.getByRole('listbox', { name: '模型', exact: true });
  const input = page.locator('.composer-input');
  const menu = page.locator('.composer-discovery');
  const summaryTrigger = page.getByRole('navigation', { name: '右侧工具', exact: true }).getByRole('button', { name: '摘要', exact: true });
  const models = async () => {
    await dialog.getByRole('button', { name: '选择模型', exact: true }).click();
    await page.waitForTimeout(350);
  };
  const choose = async name => {
    await models();
    await list.getByRole('option', { name: new RegExp(name) }).click();
    await page.waitForFunction(() => document.querySelector('.model-effort-popover.effort-view'));
    await page.waitForTimeout(350);
  };
  await open();
  await page.locator('.stellar-workspace-scene canvas[data-ready=true]').waitFor();
  await trigger.click();
  await slider.waitFor();
  const original = await dimensions();
  assert.deepEqual(original, { '.model-effort-popover': [370, 258], '.model-effort-fader': [82, 228],
    '.model-effort-fader-thumb': [78, 38], '.model-effort-trigger': [121, 29] });
  await shot('effort');
  await dialog.getByRole('button', { name: '模型参数', exact: true }).click();
  await page.waitForTimeout(400);
  assert.match(await dialog.locator('.model-parameters-modalities').innerText(), /音频.*未启用/s);
  await focusFits(dialog.getByRole('button', { name: '模型参数', exact: true }));
  await shot('parameters');
  await dialog.getByRole('button', { name: '模型参数', exact: true }).click();
  await models();
  assert.equal(await list.getByRole('option').count(), 4);
  await focusFits(list.getByRole('option').first());
  await list.getByRole('option').first().press('ArrowDown');
  assert.match(await page.locator(':focus').innerText(), /七档思考/);
  await shot('models');
  await page.keyboard.press('Enter');
  assert.equal(await list.getAttribute('aria-busy'), 'true');
  assert.match(await list.locator('[aria-selected=true]').innerText(), /Step/);
  assert.match(await list.locator('[data-requested=true]').innerText(), /七档思考/);
  await page.screenshot({ path: join(output, 'model-changing.png') });
  await page.waitForFunction(() => document.querySelector('.model-effort-popover.effort-view'));
  await page.waitForFunction(() => document.querySelector('[role=slider]')?.getAttribute('aria-valuemax') === '6');
  await slider.press('End');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.thinkingLevel === 'max');
  await shot('seven-levels');
  await slider.press('Home');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.thinkingLevel === 'off');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.stellarFaderFrames = [];
    window.stellarFaderSampling = true;
    const sample = () => {
      const thumb = document.querySelector('.model-effort-fader-thumb').getBoundingClientRect();
      const fill = document.querySelector('.model-effort-fader-fill').getBoundingClientRect();
      window.stellarFaderFrames.push({ thumb: thumb.y + thumb.height / 2, fill: fill.y });
      if (window.stellarFaderSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await slider.press('End');
  await page.waitForTimeout(350);
  const motion = await page.evaluate(() => { window.stellarFaderSampling = false; return window.stellarFaderFrames; });
  assert.ok(new Set(motion.map(frame => frame.thumb.toFixed(2))).size > 3);
  assert.ok(Math.max(...motion.map(frame => Math.abs(frame.thumb - frame.fill))) <= 1.1);
  await slider.press('Home');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.thinkingLevel === 'off');
  await slider.hover();
  await page.mouse.wheel(0, -110);
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.thinkingLevel === 'minimal');
  await page.waitForTimeout(250);
  const thumb = await dialog.locator('.model-effort-fader-thumb').boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 - 64, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.thinkingLevel === 'medium');
  await focusFits(slider);
  await choose('服务默认');
  assert.equal(await dialog.getByRole('slider').count(), 0);
  assert.match(await dialog.locator('.model-effort-single').innerText(), /服务默认/);
  await choose('能力未确认');
  assert.match(await dialog.locator('.model-effort-single').innerText(), /暂无可用档位/);
  await dialog.getByRole('button', { name: '模型参数', exact: true }).click();
  await page.waitForTimeout(350);
  assert.match(await dialog.locator('.model-parameters-values').innerText(), /未确认/);
  await shot('unknown-capabilities');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
  assert.equal(await summaryTrigger.getAttribute('aria-pressed'), 'true');

  await open();
  await page.evaluate(() => {
    const command = window.desktop.command;
    let fail = true;
    window.desktop.command = async (...args) => {
      if (fail && args[0] === 'set_model') { fail = false; throw new Error('离线模型切换失败样例'); }
      return command(...args);
    };
  });
  await trigger.click();
  await choose('七档思考');
  await page.getByRole('alert').filter({ hasText: '离线模型切换失败样例' }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.model.id, 'offline');
  await models();
  assert.match(await list.locator('[aria-selected=true]').innerText(), /Step/);
  assert.equal(await list.getAttribute('aria-busy'), 'false');
  await shot('model-failure');
  await list.getByRole('option', { name: /七档思考/ }).click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.model.id === 'seven-levels');

  await open();
  await input.fill('/');
  await menu.waitFor();
  assert.equal(await menu.getAttribute('data-mode'), 'commands');
  await shot('commands');
  const rowHeight = await menu.getByRole('option').first().evaluate(e => e.offsetHeight);
  assert.equal(rowHeight, 34);
  await input.fill('/check');
  await page.waitForFunction(() => document.querySelectorAll('.composer-discovery [role=option]').length === 1);
  assert.match(await menu.innerText(), /技能/);
  await shot('skill');
  await input.press('Enter');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await input.evaluate(e => e.value), '/check-focus ');
  await input.fill('/not-a-command');
  await page.locator('.composer-discovery-empty').waitFor();
  assert.equal(await input.getAttribute('aria-activedescendant'), null);
  await shot('no-matches');
  await input.press('Escape');
  assert.equal(await input.evaluate(e => e.value), '/not-a-command');
  assert.equal(await summaryTrigger.getAttribute('aria-pressed'), 'true');
  await input.fill('@');
  await menu.waitFor();
  assert.equal(await menu.getAttribute('data-mode'), 'references');
  assert.match(await menu.innerText(), /你的消息/);
  assert.match(await menu.innerText(), /助手回复/);
  await shot('references');
  await input.press('ArrowDown');
  await input.press('Enter');
  await page.locator('.quote-chip').waitFor();
  await menu.waitFor({ state: 'detached' });
  assert.equal(await input.evaluate(e => e === document.activeElement), true);
  await open();
  await page.evaluate(() => {
    window.desktop.chooseAttachments = async () => Array.from({ length: 10 }, (_, i) => ({
      kind: 'file', id: `offline-${i}`, name: `offline-${i}.md`, size: 20,
    }));
  });
  await input.fill('@');
  await menu.getByRole('option', { name: /文件和图片/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.attachment-card').length === 10);
  await input.fill('@');
  assert.equal(await menu.getByRole('option', { name: /文件和图片/ }).isDisabled(), true);
  await input.press('Enter');
  assert.equal(await menu.isVisible(), true);
  assert.equal(await page.locator('.attachment-card').count(), 10);
  await input.press('Escape');

  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 880 });
    await open();
    await trigger.click();
    await page.waitForTimeout(350);
    await bounded(dialog);
    await focusFits(slider);
    await shot(`effort-${width}`);
    await models();
    await focusFits(list.getByRole('option').last());
    await shot(`models-${width}`);
    await page.keyboard.press('Escape');
    for (const value of ['/', '@']) {
      await input.fill(value);
      await menu.waitFor();
      await bounded(menu);
      assert.equal(await menu.getByRole('option').first().evaluate(e => e.offsetHeight), 34);
      const overlap = await menu.getByRole('option').evaluateAll(rows => rows.some(row => {
        const rect = row.getBoundingClientRect();
        const cells = [...row.children].filter(e => getComputedStyle(e).display !== 'none').map(e => e.getBoundingClientRect());
        return cells.some((cell, i) => cell.left < rect.left || cell.right > rect.right + .5 || i > 0 && cell.left < cells[i - 1].right - .5);
      }));
      assert.equal(overlap, false);
      await shot(`${value === '/' ? 'commands' : 'references'}-${width}`);
      await input.press('Escape');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open();
  await input.fill('/');
  assert.equal(await menu.evaluate(e => getComputedStyle(e).animationName), 'none');
  await input.press('Escape');
  await trigger.click();
  await models();
  assert.equal(await dialog.locator('.model-effort-models-panel').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
  await page.keyboard.press('Escape');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => { await window.desktop.preferences({ theme }); }, theme);
    await open();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
    await trigger.click();
    assert.deepEqual(await dimensions(), original);
    await models();
    await list.getByRole('option').first().press('End');
    assert.match(await page.locator(':focus').innerText(), /能力未确认/);
    await focusFits(list.getByRole('option').last());
    await shot(`built-in-${theme}`);
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
    assert.equal(await summaryTrigger.getAttribute('aria-pressed'), 'true');
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({ passed: true, dimensions: original, rowHeight,
    faderFrames: motion.length, maximumFaderDrift: Math.max(...motion.map(frame => Math.abs(frame.thumb - frame.fill))), errors }, null, 2));
  console.log(JSON.stringify({ passed: true, dimensions: original, rowHeight, errors }));
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
