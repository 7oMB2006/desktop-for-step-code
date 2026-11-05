import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = resolve(process.env.DESKTOP_PREVIEW_OUTPUT ?? 'test-results/plugin-input-mcp');
await mkdir(output, { recursive: true });
const cacheDir = await mkdtemp(join(tmpdir(), 'dfsc-plugin-input-mcp-vite-'));
const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' });
await server.listen();
const address = server.httpServer.address();
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/tests/fixtures/plugin-input-mcp.html`);
  const user = page.locator('.message.user');
  await user.getByText('/bvr \u8fd9\u662f\u4ec0\u4e48', { exact: true }).waitFor();
  assert.equal(await user.innerText().then(text => text.includes('BVR_INTERNAL_TEMPLATE_SENTINEL')), false);
  await user.hover();
  await user.getByRole('button', { name: '\u590d\u5236', exact: true }).click();
  assert.equal(await page.evaluate(() => window.pluginInputMcpFixture.copied()), '/bvr \u8fd9\u662f\u4ec0\u4e48');
  await user.getByRole('button', { name: '\u7f16\u8f91\u5e76\u91cd\u505a', exact: true }).click();
  assert.equal(await user.getByRole('textbox').inputValue(), '/bvr \u8fd9\u662f\u4ec0\u4e48');
  await user.getByRole('textbox').press('Escape');
  await page.evaluate(() => window.pluginInputMcpFixture.reload());
  await user.getByText('/bvr \u8fd9\u662f\u4ec0\u4e48', { exact: true }).waitFor();
  const board = page.locator('.summary-board');
  await board.locator('.sb-mcp-trigger').click();
  const plugin = board.getByRole('switch', { name: '\u542f\u7528 bilibili-video-research__bvr', exact: true });
  const standalone = board.getByRole('switch', { name: '\u542f\u7528 bilibili_video_research', exact: true });
  await plugin.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[role=switch]')?.disabled);
  await plugin.hover();
  await page.waitForTimeout(280);
  assert.equal(await plugin.evaluate(element => getComputedStyle(element).backgroundColor), await plugin.evaluate(element => {
    const swatch = document.createElement('span');
    swatch.style.color = 'var(--primary)';
    element.append(swatch);
    const color = getComputedStyle(swatch).color;
    swatch.remove();
    return color;
  }), 'Hover must retain the enabled track color');
  await plugin.click();
  assert.equal(await plugin.isDisabled(), true, 'Repeated submission is blocked while saving');
  await page.waitForFunction(() => document.querySelector('[aria-label="\u542f\u7528 bilibili-video-research__bvr"]')?.getAttribute('aria-checked') === 'false');
  assert.equal(await standalone.getAttribute('aria-checked'), 'true', 'Distinct BVR services must not be toggled together');
  assert.deepEqual(await page.evaluate(() => window.pluginInputMcpFixture.calls), [
    { action: 'mcp-toggle', name: 'bilibili-video-research__bvr', enabled: false },
  ]);
  assert.equal(await board.locator('.sb-mcp-count').textContent(), '2 / 2', 'Saving does not claim the live connection was closed');
  await board.getByText('\u5f85\u91cd\u542f', { exact: true }).waitFor();
  const apply = board.getByRole('button', { name: '\u91cd\u542f\u4f1a\u8bdd\u5e94\u7528', exact: true });
  await page.evaluate(() => window.pluginInputMcpFixture.busy(true));
  await page.waitForFunction(() => document.querySelector('[role=switch]')?.disabled);
  assert.equal(await apply.isDisabled(), true, 'Busy sessions cannot be restarted');
  await page.evaluate(() => window.pluginInputMcpFixture.busy(false));
  await page.waitForFunction(() => !document.querySelector('[role=switch]')?.disabled);
  await page.evaluate(() => window.pluginInputMcpFixture.failRestart(true));
  await apply.click();
  await board.getByRole('alert').waitFor();
  assert.equal(await plugin.getAttribute('aria-checked'), 'false', 'Rejected restart retains the saved setting');
  assert.equal(await board.locator('.sb-mcp-count').textContent(), '2 / 2', 'Rejected restart never reports the server as closed');
  await page.evaluate(() => window.pluginInputMcpFixture.failRestart(false));
  await apply.click();
  await board.locator('.sb-mcp-trigger').click();
  await board.getByText('\u5df2\u5173\u95ed', { exact: true }).waitFor();
  assert.equal(await board.locator('.sb-mcp-count').textContent(), '1 / 2');
  assert.equal(await board.locator('.sb-mcp-apply').count(), 0);
  await page.evaluate(() => window.pluginInputMcpFixture.failMutation(true));
  await standalone.click();
  await board.getByRole('alert').waitFor();
  assert.equal(await standalone.getAttribute('aria-checked'), 'true', 'Failed saves do not flip the switch');
  await page.evaluate(() => window.pluginInputMcpFixture.failMutation(false));
  await standalone.click();
  await board.getByText('\u5f85\u91cd\u542f', { exact: true }).waitFor();
  await page.evaluate(() => window.pluginInputMcpFixture.externalToggle('bilibili-video-research__bvr', true));
  await page.waitForFunction(() => {
    const control = document.querySelector('[aria-label="\u542f\u7528 bilibili-video-research__bvr"]');
    return control?.getAttribute('aria-checked') === 'true' && !control.disabled;
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.pluginInputMcpFixture.theme(theme), theme);
    await page.waitForTimeout(400);
    for (const width of [1440, 640, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.keyboard.press('Tab');
      await plugin.focus();
      await page.waitForTimeout(270);
      const clipped = await plugin.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        const extent = Math.max(0, parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset));
        const clipped = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll)/.test(style.overflowX)
            && (rect.left - extent < box.left + parent.clientLeft - 1
              || rect.right + extent > box.left + parent.clientLeft + parent.clientWidth + 1)) clipped.push('x');
          if (/(hidden|clip|auto|scroll)/.test(style.overflowY)
            && (rect.top - extent < box.top + parent.clientTop - 1
              || rect.bottom + extent > box.top + parent.clientTop + parent.clientHeight + 1)) clipped.push('y');
        }
        return clipped;
      });
      assert.deepEqual(clipped, [], `${theme}/${width}: focus outline remains visible`);
      for (const control of [plugin, standalone]) {
        assert.equal(await control.evaluate(element => {
          const track = element.getBoundingClientRect(), knob = element.querySelector('i').getBoundingClientRect();
          return knob.left >= track.left + 1 && knob.right <= track.right - 1;
        }), true, 'Thumb stays inside its track');
      }
      assert.equal(await plugin.evaluate(element => {
        const color = getComputedStyle(element.querySelector('i')).backgroundColor;
        return color !== 'rgba(0, 0, 0, 0)' && color !== getComputedStyle(element).backgroundColor;
      }), true, 'Enabled thumb remains visible in the real application theme');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${theme}/${width}: no overflow`);
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await board.locator('.sb-mcp-trigger').click();
  assert.equal(await plugin.isVisible(), false);
  await board.locator('.sb-mcp-trigger').click();
  assert.equal(await plugin.isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('Production transcript and summary MCP passed: source input, copy/edit/reload, exact server ownership, idle/save/restart/failure states, themes, narrow layouts and reduced motion.');
  console.log(output);
} finally { await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
