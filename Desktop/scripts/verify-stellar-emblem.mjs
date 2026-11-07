import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`); });
const emblem = page.locator('.stellar-emblem');
const canvas = emblem.locator('canvas');
const screenshot = name => page.screenshot({ path: join(output, `${name}.png`) });
const settings = async () => {
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
};
const closeSettings = () => page.getByRole('button', { name: 'Close', exact: true }).click();
const freeze = async () => {
  await page.waitForTimeout(300);
  const before = await canvas.screenshot();
  await page.waitForTimeout(500);
  assert.ok(before.equals(await canvas.screenshot()), 'Static emblem must not animate');
};
try {
  await page.goto('http://127.0.0.1:4197/tests/fixtures/theme-pack.html');
  await page.locator('.stellar-emblem[data-ready=true]').waitFor();
  await page.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
  assert.deepEqual(await emblem.evaluate(e => [e.clientWidth, e.clientHeight]), [48, 48]);
  assert.equal(await page.locator('.new-session h1').evaluate(e => getComputedStyle(e).marginTop), '22px');
  // Isolate the transparent emblem from the independently animated background.
  const isolation = await page.addStyleTag({ content: '.stellar-workspace-scene { visibility: hidden !important; }' });
  const before = await canvas.screenshot();
  await page.waitForTimeout(650);
  const after = await canvas.screenshot();
  assert.ok(!before.equals(after), 'Emblem must have living particle motion');
  const colored = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (Math.max(...pixels.slice(i, i + 3)) - Math.min(...pixels.slice(i, i + 3)) > 30) count++;
    return count;
  }, [...after]);
  const area = await canvas.evaluate(c => c.clientWidth * c.clientHeight);
  assert.ok(colored / area > .035, `Nonblank brand-colored emblem: ${colored}/${area}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freeze();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await settings();
  await page.getByLabel('星海动态背景').uncheck();
  await closeSettings();
  await freeze();
  await canvas.evaluate(c => {
    window.emblemLoss = c.getContext('webgl2').getExtension('WEBGL_lose_context');
    window.emblemLoss.loseContext();
  });
  await page.locator('.stellar-emblem[data-ready=false]').waitFor();
  assert.equal(await emblem.locator('img').isVisible(), true);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.emblemLoss.restoreContext());
  await page.locator('.stellar-emblem[data-ready=true]').waitFor();
  await freeze();
  await page.getByRole('button', { name: /^会话归属:/ }).click();
  const field = page.getByRole('textbox', { name: '搜索项目', exact: true });
  await field.fill('星辰');
  assert.ok(await field.evaluate(e => e === document.activeElement));
  const focus = await field.evaluate(e => {
    const group = e.closest('label'), menu = group.closest('[role=dialog]');
    const g = group.getBoundingClientRect(), m = menu.getBoundingClientRect(), style = getComputedStyle(group);
    return { outline: parseFloat(style.outlineWidth), room: Math.min(g.left - m.left, m.right - g.right, g.top - m.top) };
  });
  assert.ok(focus.outline >= 2 && focus.room >= 4, JSON.stringify(focus));
  await page.waitForTimeout(250);
  await screenshot('emblem-project-focus');
  await field.press('Escape');
  await settings();
  await page.getByRole('button', { name: '原版浅色', exact: true }).click();
  await closeSettings();
  assert.equal(await emblem.count(), 0);
  assert.equal(await page.locator('.empty-symbol > img').getAttribute('width'), '48');
  await settings();
  await page.locator('.theme-pack-select').click();
  await closeSettings();
  await page.locator('.stellar-emblem[data-ready=true]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  assert.deepEqual(await emblem.evaluate(e => [e.clientWidth, e.clientHeight]), [48, 48]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // Restore scenery for the final composition evidence.
  await isolation.evaluate(node => node.remove());
  await page.waitForFunction(() => {
    const output = document.querySelector('.terminal-heading-output');
    return output?.textContent === document.querySelector('.new-session h1')?.getAttribute('aria-label');
  });
  await page.waitForTimeout(250);
  await screenshot('emblem-welcome-mobile');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForTimeout(250);
  await screenshot('emblem-welcome-desktop');
  await page.getByRole('button', { name: '主题包 · 会话预览', exact: true }).click();
  await page.locator('.messages').waitFor();
  assert.equal(await emblem.count(), 0, 'Conversation must release the emblem');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, colored, focus, errors }));
} finally { await browser.close(); }
