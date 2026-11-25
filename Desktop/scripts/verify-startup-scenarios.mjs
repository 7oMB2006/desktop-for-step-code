import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4197/';
const output = resolve(process.argv[3] || 'test-results/startup-scenarios-desktop');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const errors = [], external = [], checks = [], surfaceMotion = [];
const sceneUrl = scenario => new URL(`tests/fixtures/startup-scenarios.html?scenario=${scenario}`, base).href;
const scene = page => page.locator('.scenario-run');
const phase = (page, value, timeout = 13000) =>
  page.locator(`.scenario-run[data-phase="${value}"]`).waitFor({ timeout });
const ready = page => page.locator('.scenario-run[data-shell-ready=true]').waitFor({ timeout: 17000 });
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(base).origin) external.push(url.origin);
  });
};
const open = async (scenario, width = 1100, reducedMotion = 'no-preference') => {
  const page = await browser.newPage({ viewport: { width, height: 860 }, reducedMotion });
  watch(page);
  await page.goto(sceneUrl(scenario));
  return page;
};
const fits = async page => assert.equal(await page.evaluate(() =>
  document.documentElement.scrollWidth > innerWidth), false, 'no outer horizontal overflow');
const choose = async (page, name) => {
  const radio = page.getByRole('radio', { name, exact: true });
  await page.locator('label').filter({ has: radio }).click();
  assert.equal(await radio.isChecked(), true);
};
const desktopPixels = async page => {
  const screen = page.locator('.scenario-screen');
  const png = await screen.screenshot();
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return [[.2, .12], [.86, .12], [.9, .7]].map(([x, y]) =>
      [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data]);
  }, [...png]);
};
const logoPosition = page => page.locator('.scenario-logo').boundingBox();
const sameLogoPosition = (before, after) => {
  for (const axis of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(before[axis] - after[axis]) < .5, `the emblem retains its ${axis}`);
  }
};
const anchoredReveal = async (page, target, fade = true) => {
  const motion = await page.locator('.scenario-splash').evaluate((surface, target) =>
    new Promise((resolve, reject) => {
      const logo = surface.querySelector('.scenario-logo');
      const bounds = () => {
        const rect = logo.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      };
      const initial = bounds(), samples = [];
      let enteredAt, frame;
      const timeout = setTimeout(() => {
        cancelAnimationFrame(frame);
        reject(new Error(`Surface ${target} did not settle`));
      }, 12000);
      const sample = now => {
        const color = getComputedStyle(surface).backgroundColor.match(/[\d.]+/g);
        samples.push({
          shift: Math.max(...bounds().map((value, index) => Math.abs(value - initial[index]))),
          alpha: color.length === 4 ? Number(color[3]) : 1,
          text: Number(getComputedStyle(surface.querySelector('.scenario-message')).opacity),
        });
        if (surface.dataset.surface === target) enteredAt ??= now;
        if (enteredAt !== undefined && now - enteredAt >= 600) {
          clearTimeout(timeout);
          resolve({
            target, maxShift: Math.max(...samples.map(sample => sample.shift)),
            backgroundFrames: samples.filter(sample => sample.alpha > .01 && sample.alpha < .99).length,
            textFrames: samples.filter(sample => sample.text > .01 && sample.text < .99).length,
            final: samples.at(-1),
          });
        } else frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    }), target);
  assert.ok(motion.maxShift < .5, `the emblem stays anchored throughout ${target}, moved ${motion.maxShift}px`);
  if (fade) {
    assert.ok(motion.backgroundFrames > 0, 'the local background fades through intermediate alpha values');
    assert.ok(motion.textFrames > 0, 'the message fades without fading or moving the emblem');
  }
  assert.equal(motion.final.alpha, 1);
  assert.equal(motion.final.text, 1);
  surfaceMotion.push(motion);
};
const readDiagnostic = async page => {
  const before = await logoPosition(page);
  const message = page.locator('.scenario-message');
  await message.hover();
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.querySelector('.scenario-message').scrollTop > 0);
  const visibleLines = await page.locator('.scenario-diagnostic pre').evaluate(pre => {
    const bounds = pre.getBoundingClientRect();
    const viewport = pre.closest('.scenario-message').getBoundingClientRect();
    return Math.min(bounds.bottom, viewport.bottom) - Math.max(bounds.top, viewport.top);
  });
  assert.ok(visibleLines >= 60, 'the diagnostic text is readable by scrolling its bounded message area');
  sameLogoPosition(before, await logoPosition(page));
};
const brandCaption = async page => {
  const font = await page.locator('.scenario-window-bar > span').evaluate(async caption => {
    await document.fonts.ready;
    const style = getComputedStyle(caption);
    const bounds = caption.getBoundingClientRect();
    const window = caption.closest('.scenario-splash').getBoundingClientRect();
    const close = caption.parentElement.querySelector('button')?.getBoundingClientRect();
    return {
      family: style.fontFamily, size: style.fontSize, weight: style.fontWeight,
      loaded: [...document.fonts].some(face => face.family === 'Orbitron' && face.status === 'loaded'),
      contained: bounds.left >= window.left + 12 && bounds.right <= (close ? close.left - 8 : window.right - 12),
      bodyFont: getComputedStyle(document.querySelector('.scenario-message')).fontFamily,
    };
  });
  assert.ok(font.family.startsWith('Orbitron'), 'the product caption reuses the v0.5.0 brand typeface');
  assert.equal(font.loaded, true, 'the local font file is loaded rather than a system fallback');
  assert.equal(font.size, '11px');
  assert.equal(font.weight, '400');
  assert.equal(font.contained, true, 'the full product name fits beside the close button');
  assert.ok(!font.bodyFont.includes('Orbitron'), 'status messages retain their readable UI typeface');
};
const readableWindow = async page => {
  await page.locator('.scenario-splash').evaluate(async surface => {
    await Promise.all(surface.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  const properties = await page.locator('.scenario-splash').evaluate(surface => {
    const style = getComputedStyle(surface);
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const background = luminance(style.backgroundColor);
    const contrast = selector => {
      const foreground = luminance(getComputedStyle(surface.querySelector(selector)).color);
      return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
    };
    return { background: style.backgroundColor, opacity: style.opacity,
      backdrop: style.backdropFilter, titleContrast: contrast('h1'), bodyContrast: contrast('p') };
  });
  assert.equal(properties.background, 'rgb(37, 38, 41)', 'the local window has an opaque background');
  assert.equal(properties.opacity, '1');
  assert.equal(properties.backdrop, 'none', 'readability does not depend on wallpaper blur');
  assert.ok(properties.titleContrast >= 4.5 && properties.bodyContrast >= 4.5);
  const windowBox = await page.locator('.scenario-splash').boundingBox();
  const taskbar = await page.locator('.scenario-taskbar').boundingBox();
  assert.ok(windowBox.y + windowBox.height <= taskbar.y - 8, 'the window remains above the desktop taskbar');
  await brandCaption(page);
  return properties;
};
try {
  let page = await open('normal');
  await page.frameLocator('.scenario-logo').locator('.logo[data-ready=true]').waitFor();
  assert.equal(await page.locator('.scenario-splash').getAttribute('data-surface'), 'transparent');
  assert.equal(await page.locator('.scenario-message').isVisible(), false, 'normal startup has no floating text');
  assert.equal(await page.locator('.scenario-splash').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.deepEqual(await page.frameLocator('.scenario-logo').locator('img').evaluate(image =>
    [image.offsetWidth, image.offsetHeight]), [88, 88]);
  await page.screenshot({ path: join(output, 'normal-transparent-light.png') });
  assert.deepEqual(await desktopPixels(page), Array(3).fill([241, 242, 244, 255]));
  await phase(page, 'handoff');
  await ready(page);
  await page.frameLocator('.scenario-workspace').locator('.app').waitFor();
  await page.screenshot({ path: join(output, 'normal-workspace.png') });
  checks.push('normal startup retains the transparent 256px window and 88px emblem without floating text, then opens the actual offline workspace');
  await page.close();

  page = await open('slow');
  const original = await page.locator('.scenario-logo').elementHandle();
  await phase(page, 'waiting');
  await page.frameLocator('.scenario-logo').locator('html[data-startup-complete=true]').waitFor();
  await page.screenshot({ path: join(output, 'slow-before-notice.png') });
  await anchoredReveal(page, 'notice');
  await phase(page, 'delayed');
  await page.getByRole('heading', { name: '启动耗时较长' }).waitFor();
  assert.equal(await page.locator('.scenario-splash').getAttribute('data-surface'), 'notice');
  await readableWindow(page);
  assert.deepEqual(await desktopPixels(page), Array(3).fill([241, 242, 244, 255]), 'no full-desktop dimming during the slow notice');
  assert.equal(await original.evaluate(element => element.isConnected), true);
  await page.screenshot({ path: join(output, 'slow-waiting.png') });
  await phase(page, 'handoff');
  await ready(page);
  checks.push('slow startup keeps the emblem fixed while the surface fades in, uses the local Orbitron brand caption, then completes');
  await page.close();

  page = await open('timeout');
  const hung = await page.locator('.scenario-logo').elementHandle();
  await page.frameLocator('.scenario-logo').locator('html[data-startup-complete=true]').waitFor();
  await anchoredReveal(page, 'notice');
  await anchoredReveal(page, 'recovery', false);
  await phase(page, 'timeout');
  const timeoutLogo = await logoPosition(page);
  await page.getByText('查看模拟诊断', { exact: true }).click();
  sameLogoPosition(timeoutLogo, await logoPosition(page));
  assert.match(await page.locator('.scenario-diagnostic pre').innerText(), /PREVIEW_INIT_TIMEOUT/);
  await page.screenshot({ path: join(output, 'timeout-diagnostic.png') });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '继续等待', exact: true }).click();
  await phase(page, 'waiting');
  sameLogoPosition(timeoutLogo, await logoPosition(page));
  assert.equal(await page.locator('.scenario-splash').getAttribute('data-surface'), 'notice', 'continuing retains a readable local notice');
  assert.equal(await hung.evaluate(element => element.isConnected), true, 'continue does not replay the entrance');
  await page.waitForTimeout(500);
  assert.notEqual(await scene(page).getAttribute('data-phase'), 'timeout', 'waiting restarts from the actual click time');
  await choose(page, '正常启动');
  await phase(page, 'handoff');
  await ready(page);
  checks.push('hung initialization times out, diagnostic data is explicit, continue preserves the emblem, switching cancels the previous run');
  await page.close();

  page = await open('failure');
  await page.frameLocator('.scenario-logo').locator('html[data-startup-complete=true]').waitFor();
  await anchoredReveal(page, 'recovery');
  await phase(page, 'failed');
  const failureLogo = await logoPosition(page);
  const failedLogo = await page.locator('.scenario-logo').elementHandle();
  await page.getByRole('heading', { name: '启动未完成', exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'Desktop for Step Code 启动恢复' }).waitFor();
  const brightPixels = await desktopPixels(page);
  await readableWindow(page);
  await page.screenshot({ path: join(output, 'failure-desktop-light.png') });
  await choose(page, '深色桌面');
  await readableWindow(page);
  assert.deepEqual(await desktopPixels(page), Array(3).fill([21, 26, 33, 255]));
  await page.screenshot({ path: join(output, 'failure-desktop-dark.png') });
  await choose(page, '复杂壁纸');
  await page.locator('.scenario-wallpaper').evaluate(image => image.decode());
  const busyPixels = await desktopPixels(page);
  assert.notDeepEqual(busyPixels, brightPixels, 'the actual wallpaper asset is rendered');
  assert.equal(await failedLogo.evaluate(element => element.isConnected), true, 'changing desktop backgrounds does not replay startup');
  sameLogoPosition(failureLogo, await logoPosition(page));
  await readableWindow(page);
  const diagnosticTrigger = page.getByText('查看模拟诊断', { exact: true });
  const before = await diagnosticTrigger.boundingBox();
  await diagnosticTrigger.click();
  const after = await diagnosticTrigger.boundingBox();
  assert.ok(Math.abs(before.y - after.y) < 1, 'diagnostic disclosure preserves its trigger position');
  sameLogoPosition(failureLogo, await logoPosition(page));
  assert.deepEqual(await desktopPixels(page), busyPixels, 'opening diagnostics does not mask the wallpaper');
  await readableWindow(page);
  await readDiagnostic(page);
  await page.screenshot({ path: join(output, 'failure-actions.png') });
  await page.getByRole('button', { name: '重试启动', exact: true }).click();
  assert.equal(await failedLogo.evaluate(element => element.isConnected), false, 'retry begins a fresh run');
  await phase(page, 'handoff');
  await ready(page);
  await page.getByText('重试 · 正常恢复', { exact: true }).waitFor();
  checks.push('opaque recovery windows retain readable text over bright, dark and real wallpaper backgrounds, without masking the desktop; diagnostic anchoring and retry work');
  await page.close();

  page = await open('animation');
  await page.locator('.scenario-run[data-degraded=true]').waitFor();
  const splash = page.frameLocator('.scenario-logo');
  await splash.locator('.logo[data-fallback=true]').waitFor();
  assert.equal(await splash.locator('img').evaluate(image => getComputedStyle(image).visibility), 'visible');
  assert.equal(await splash.locator('canvas').evaluate(canvas => getComputedStyle(canvas).visibility), 'hidden');
  assert.equal(await page.locator('.scenario-message').isVisible(), false, 'cosmetic fallback has no unnecessary floating warning');
  await page.screenshot({ path: join(output, 'animation-static-fallback.png') });
  await phase(page, 'handoff');
  await ready(page);
  checks.push('a fixture WebGL-loss event exercises the actual static fallback and does not prevent handoff');
  await page.close();

  page = await open('slow');
  await choose(page, '原版');
  await phase(page, 'waiting');
  const defaultLogo = page.frameLocator('.scenario-logo');
  assert.equal(await defaultLogo.locator('html').getAttribute('data-startup-material'), 'default');
  assert.deepEqual(await defaultLogo.locator('img').evaluate(image => [image.offsetWidth, image.offsetHeight]), [88, 88]);
  await anchoredReveal(page, 'notice');
  await phase(page, 'delayed');
  await page.screenshot({ path: join(output, 'original-slow-waiting.png') });
  await page.getByRole('button', { name: '结束演示', exact: true }).click();
  await page.getByText('演示已停止', { exact: true }).waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.getByRole('button', { name: '重新演示', exact: true }).click();
  await phase(page, 'opening');
  checks.push('the default 88px logo shares the same proposed flow; stop unmounts the run and replay works');
  await page.close();

  page = await open('failure', 390);
  await page.frameLocator('.scenario-logo').locator('html[data-startup-complete=true]').waitFor();
  await anchoredReveal(page, 'recovery');
  await phase(page, 'failed');
  await page.getByText('查看模拟诊断', { exact: true }).click();
  await fits(page);
  await readableWindow(page);
  await readDiagnostic(page);
  await page.screenshot({ path: join(output, 'failure-diagnostic-390.png'), fullPage: true });
  const retry = page.getByRole('button', { name: '重试启动', exact: true });
  await retry.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.ok(await retry.evaluate(button => getComputedStyle(button).outlineStyle !== 'none'));
  const box = await retry.boundingBox();
  assert.ok(box.x >= 4 && box.x + box.width <= 386, 'the complete focus gutter fits narrow screens');
  const insideWindow = await retry.evaluate(button => {
    const bounds = button.getBoundingClientRect(), window = button.closest('.scenario-splash').getBoundingClientRect();
    return bounds.left - 4 >= window.left && bounds.right + 4 <= window.right
      && bounds.top - 4 >= window.top && bounds.bottom + 4 <= window.bottom;
  });
  assert.equal(insideWindow, true, 'the focus indicator fits all four sides of the native-window mock');
  await page.screenshot({ path: join(output, 'failure-390.png'), fullPage: true });
  checks.push('390px controls, recovery actions, diagnostic wrapping and keyboard focus remain visible');
  await page.close();

  page = await open('slow', 1100, 'reduce');
  await phase(page, 'waiting');
  const canvas = page.frameLocator('.scenario-logo').locator('canvas');
  const still = await canvas.screenshot({ omitBackground: true });
  await page.waitForTimeout(220);
  assert.deepEqual(await canvas.screenshot({ omitBackground: true }), still);
  await anchoredReveal(page, 'notice', false);
  assert.equal(await page.locator('.scenario-splash').evaluate(surface =>
    getComputedStyle(surface).transitionDuration), '0s', 'reduced motion disables the surface fade');
  await fits(page);
  checks.push('OS reduced motion keeps the actual stellar emblem static and reveals the notice without a transition');
  await page.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(join(output, 'verification.json'), JSON.stringify({
    passed: true, checks, surfaceMotion, errors, external,
    scope: 'Browser fixture only. Mock desktop and bounded opaque notice/recovery windows; actual startup renderer and offline workspace. No OS compositor/input acceptance, production native startup changes, real profile access, packaging or model requests.',
  }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2));
} finally { await browser.close(); }
