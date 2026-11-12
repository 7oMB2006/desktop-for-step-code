import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { settleLayout } from './settle-layout.mjs';

const output = process.env.HERMES_PREVIEW_OUTPUT || 'test-results/hermes-preview';
await mkdir(output, { recursive: true });
let browser, server;
const errors = [];
const external = [];
const checks = [];
try {
  if (!process.env.DESKTOP_PREVIEW_URL) {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
  }
  const base = process.env.DESKTOP_PREVIEW_URL || server.resolvedUrls.local[0];
  const url = new URL('/tests/fixtures/hermes-preview.html', base).href;
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    ...(process.env.DESKTOP_VERIFY_BROWSER ? { executablePath: process.env.DESKTOP_VERIFY_BROWSER } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin)
      external.push(request.url());
  });
  const dialog = page.getByRole('dialog', { name: 'Hermes x DFSC · 智能体状态', exact: true });
  const trigger = page.getByRole('button', { name: 'Hermes x DFSC', exact: true });
  const workspace = page.locator('[data-plugin-workspace="hermes-preview"]');
  const choose = page.getByRole('combobox', { name: '模拟连接状态', exact: true });
  const showStatus = async () => {
    if (!await dialog.isVisible()) await page.getByRole('button', { name: '查看状态', exact: true }).click();
    await dialog.waitFor();
  };
  const waitStatus = async status => {
    await showStatus();
    await dialog.locator(`[data-connection-status="${status}"][aria-busy="false"]`).waitFor();
    await settleLayout(dialog);
  };
  await page.goto(url);
  await waitStatus('ready');
  assert.equal(await dialog.locator('.plugin-connection-tasks > li').count(), 3);
  assert.equal(await page.evaluate(() => typeof window.desktop), 'undefined');
  checks.push('production components render with fixture-only Chinese data');
  for (const [name, width, height, theme] of [
    ['light', 1360, 900, 'light'], ['dark', 1360, 900, 'dark'],
    ['narrow-light', 390, 844, 'light'], ['narrow-dark', 390, 844, 'dark'],
    ['short', 900, 500, 'light'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width < 700 ? 'reduce' : 'no-preference' });
    await page.goto(`${url}?theme=${theme}`);
    await waitStatus('ready');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: viewport overflow`);
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 7 && box.x + box.width <= width - 7 && box.y + box.height <= height - 7, `${name}: panel bounds`);
    const icon = trigger.locator(`.plugin-action-icon-${theme} img`);
    assert.ok(await icon.evaluate(element => element.complete && element.naturalWidth === 17 && element.width === 17));
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
    checks.push(`${name}: bounds, original 17px icon and Escape focus`);
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(url);
  for (const [scenario, status, count] of [
    ['unselected', 'unselected', 0], ['empty', 'ready', 0], ['long', 'ready', 5],
    ['companion-missing', 'companion-missing', 0], ['pairing-required', 'pairing-required', 0],
    ['connection-unavailable', 'connection-unavailable', 0], ['identity-mismatch', 'identity-mismatch', 0],
    ['error', 'error', 0],
  ]) {
    await choose.selectOption(scenario);
    await waitStatus(status);
    assert.equal(await dialog.locator('.plugin-connection-tasks > li').count(), count);
    checks.push(`${scenario}: no stale identity/task results`);
  }
  await choose.selectOption('slow');
  await showStatus();
  await dialog.getByRole('heading', { name: '正在检查连接…', exact: true }).waitFor();
  await waitStatus('ready');
  checks.push('slow query exposes loading then settles');
  await choose.selectOption('unselected');
  await waitStatus('unselected');
  await page.screenshot({ path: `${output}/unselected.png`, fullPage: true });
  await dialog.getByRole('button', { name: '打开完整工作台', exact: true }).click();
  await workspace.locator('[data-connection-status="unselected"][aria-busy="false"]').waitFor();
  await workspace.getByRole('button', { name: '选择身份目录', exact: true }).click();
  await workspace.locator('[data-connection-status="ready"][aria-busy="false"]').waitFor();
  await workspace.getByRole('tab', { name: '开始使用', exact: true }).click();
  await workspace.getByRole('heading', { name: '开始使用 Hermes x DFSC', exact: true }).waitFor();
  await workspace.getByRole('button', { name: '连接准备', exact: true }).first().click();
  await workspace.getByRole('heading', { name: '连接准备', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/workspace.png`, fullPage: true });
  await workspace.getByRole('button', { name: '返回工作区', exact: true }).click();
  await workspace.waitFor({ state: 'hidden' });
  assert.equal(await dialog.isVisible(), false, 'return does not reopen the status panel');
  const draft = page.getByRole('textbox', { name: '未发送的草稿', exact: true });
  await draft.fill('保留这段草稿，先看状态。');
  await trigger.click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '打开完整工作台', exact: true }).click();
  await workspace.getByRole('button', { name: '返回工作区', exact: true }).click();
  assert.equal(await draft.inputValue(), '保留这段草稿，先看状态。');
  checks.push('full workspace, simulated profile selection, real guides and preserved draft');
  await draft.focus();
  const focus = await draft.evaluate(element => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement.getBoundingClientRect();
    return { top: box.top - parent.top, right: parent.right - box.right, bottom: parent.bottom - box.bottom, left: box.left - parent.left };
  });
  assert.ok(Object.values(focus).every(value => value >= 4), 'complete draft focus gutter');
  for (const [name, width, height, theme] of [
    ['onboarding-light', 1360, 900, 'light'], ['onboarding-dark', 1360, 900, 'dark'],
    ['onboarding-narrow-light', 390, 844, 'light'], ['onboarding-narrow-dark', 390, 844, 'dark'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}?state=unselected&view=workspace&theme=${theme}`);
    await workspace.locator('[data-connection-status="unselected"][aria-busy="false"]').waitFor();
    await workspace.getByRole('heading', { name: 'Hermes x DFSC', exact: true, level: 1 }).waitFor();
    assert.equal(await workspace.locator('[data-preparation-step]').count(), 4);
    assert.equal(await workspace.locator('[data-preparation-step][data-result="unchecked"]').count(), 4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: viewport overflow`);
    await settleLayout(workspace);
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    await workspace.getByRole('button', { name: '查看第一项任务', exact: true }).click();
    await workspace.getByRole('heading', { name: '第一项任务', exact: true }).waitFor();
    assert.equal(await workspace.getByRole('tab', { name: '第一项任务', exact: true }).getAttribute('aria-selected'), 'true');
    assert.ok((await workspace.innerText()).includes('飞书'));
    checks.push(`${name}: branded first-install preparation, bounded layout and first-task guide`);
  }
  for (const [scenario, step, result] of [
    ['profile-missing', 'profile', 'missing'],
    ['companion-missing', 'companion', 'missing'],
    ['configuration-invalid', 'companion', 'invalid'],
    ['no-roots', 'roots', 'no-roots'],
  ]) {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(`${url}?state=${scenario}&view=workspace`);
    await workspace.locator(`[data-connection-status="${scenario === 'no-roots' ? 'ready' : scenario}"][aria-busy="false"]`).waitFor();
    assert.equal(await workspace.locator(`[data-preparation-step="${step}"]`).getAttribute('data-result'), result);
    assert.equal(await workspace.locator('.plugin-connection-tasks > li').count(), 0);
    await page.screenshot({ path: `${output}/onboarding-${scenario}.png`, fullPage: true });
    checks.push(`${scenario}: explicit missing preparation without stale tasks`);
  }
  for (const theme of ['light', 'dark']) for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    for (const scenario of ['ready', 'companion-missing', 'no-roots', 'unselected', 'error']) {
      await page.goto(`${url}?state=${scenario}&view=workspace&theme=${theme}`);
      const status = scenario === 'no-roots' ? 'ready' : scenario;
      await workspace.locator(`[data-connection-status="${status}"][aria-busy="false"]`).waitFor();
      const colors = await workspace.locator('.plugin-connection').evaluate(element => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgb = value => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const luminance = color => color.map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
        const contrast = (foreground, background) => {
          const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
          return (values[0] + .05) / (values[1] + .05);
        };
        const root = getComputedStyle(document.documentElement);
        const tokens = Object.fromEntries(['green', 'danger', 'muted', 'bg']
          .map(name => [name, rgb(root.getPropertyValue(`--${name}`))]));
        const sample = node => {
          const style = getComputedStyle(node);
          const tone = node.closest('.is-verified') ? 'green' : node.closest('.is-attention') ? 'danger' : 'muted';
          const foreground = rgb(style.color);
          const background = node.matches('.plugin-preparation-result') ? rgb(style.backgroundColor) : tokens.bg;
          const box = node.getBoundingClientRect();
          return { tone, foreground, expected: tokens[tone], contrast: contrast(foreground, background),
            hasIcon: !!node.querySelector('svg'), text: node.textContent.trim(),
            fits: node.scrollWidth <= node.clientWidth && box.width <= innerWidth - 16,
            fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight) };
        };
        const heading = element.querySelector('.plugin-connection-status');
        return { heading: { ...sample(heading.querySelector('h3')),
          icon: rgb(getComputedStyle(heading.querySelector('svg')).color) },
        badges: [...element.querySelectorAll('.plugin-preparation-result')].map(sample) };
      });
      const label = `${theme}/${width}/${scenario}`;
      for (const badge of colors.badges) {
        assert.deepEqual(badge.foreground, badge.expected, `${label}: semantic badge color`);
        assert.ok(badge.contrast >= 4.5, `${label}: badge text contrast ${badge.contrast}`);
        assert.ok(badge.hasIcon && badge.text && badge.fits, `${label}: status keeps readable icon and text`);
        assert.ok(badge.fontSize >= 12 && badge.fontWeight >= 600, `${label}: status text hierarchy`);
      }
      if (scenario !== 'unselected') {
        assert.deepEqual(colors.heading.foreground, colors.heading.expected, `${label}: heading color`);
        assert.deepEqual(colors.heading.icon, colors.heading.expected, `${label}: heading icon color`);
        assert.ok(colors.heading.contrast >= 4.5, `${label}: heading contrast`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: viewport overflow`);
      await settleLayout(workspace);
      await page.screenshot({ path: `${output}/status-${scenario}-${theme}-${width}.png`, fullPage: true });
    }
    checks.push(`${theme}/${width}: green verified, red attention and neutral unchecked statuses retain contrast, icons and readable labels`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  checks.push('focus gutter, zero page errors and zero external requests');
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, checks, errors, external }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, output }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}
