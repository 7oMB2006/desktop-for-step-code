import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const output = resolve(process.env.FIRST_RUN_PREVIEW_OUTPUT || 'test-results/first-run');
await mkdir(output, { recursive: true });
let server;
let browser;
let page;
const errors = [];
const external = [];
const heading = text => page.getByRole('heading', { name: text, exact: true });
const menu = async (name, option) => {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
};
const screenshot = async name => {
  if (!name.startsWith('00-intro')) {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
  }
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
};
const noOverflow = async () => {
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'horizontal overflow');
  assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true, 'all visible assets loaded');
};
try {
  if (!process.env.DESKTOP_PREVIEW_URL) {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
  }
  const base = process.env.DESKTOP_PREVIEW_URL || server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (new URL(url).origin === new URL(base).origin || url.startsWith('data:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(`${base}/tests/fixtures/first-run.html`);
  await heading('连接模型服务').waitFor();
  await page.waitForFunction(() => !document.querySelector('.first-run-skip-motion'));
  await noOverflow();
  assert.match(await page.locator('.first-run-brand .first-run-wordmark').getAttribute('src'), /wordmark-light\.png/);
  const cards = await page.locator('.first-run-service').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  assert.equal(new Set(cards).size, 1, 'account choices share one row');
  await screenshot('01-account-light');
  await page.getByRole('button', { name: '重播开场', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.first-run-skip-motion'));
  await page.waitForFunction(() => document.querySelector('.first-run-brand')?.getAnimations().length > 0);
  const seekIntro = async time => page.evaluate(time => {
    for (const selector of ['.first-run-brand', '.first-run-flow']) {
      for (const animation of document.querySelector(selector).getAnimations()) { animation.pause(); animation.currentTime = time; }
    }
  }, time);
  await seekIntro(650);
  assert.notEqual(await page.locator('.first-run-brand').evaluate(element => getComputedStyle(element).transform), 'none');
  const centered = await page.locator('.first-run-brand').boundingBox();
  assert.ok(Math.abs(centered.x + centered.width / 2 - 640) < 2, 'complete brand begins centered');
  assert.equal(await page.locator('.first-run-flow').evaluate(element => getComputedStyle(element).opacity), '0', 'form waits for brand arrival');
  await screenshot('00-intro');
  await seekIntro(1050);
  const held = await page.locator('.first-run-brand').boundingBox();
  assert.ok(Math.abs(centered.y - held.y) < 1, 'brand has a readable hold');
  await screenshot('00-intro-hold');
  await seekIntro(1850);
  await screenshot('00-intro-arrival');
  await page.getByRole('button', { name: '跳过动画', exact: true }).click();
  assert.equal(await page.locator('.first-run-brand').evaluate(element => getComputedStyle(element).transform), 'none');
  assert.equal(await page.locator('.first-run-flow').evaluate(element => getComputedStyle(element).opacity), '1');

  await menu('预览状态', '无套餐');
  await page.getByRole('button', { name: '浏览器授权', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('input[value="plan"]').isChecked(), true);
  assert.equal(await heading('连接模型服务').count(), 1);
  await screenshot('02-no-plan');
  await page.getByRole('button', { name: '改用 API Key 登录', exact: true }).click();
  assert.equal(await page.locator('input[value="api"]').isChecked(), true);
  assert.equal(await page.getByRole('button', { name: '连接并继续', exact: true }).isDisabled(), true);
  await page.getByLabel('API Key', { exact: true }).fill('demo-only');
  await page.getByRole('button', { name: '连接并继续', exact: true }).click();
  await heading('从哪里开始？').waitFor();
  await page.getByLabel('独立会话', { exact: true }).check();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await heading('开始阶跃').waitFor();
  assert.equal(await page.locator('.first-run-billing').innerText(), 'API 按量付费');
  await screenshot('03-review');
  await page.getByRole('button', { name: '开始会话', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('请先帮我了解这个项目。');
  await page.getByRole('button', { name: '模拟发送', exact: true }).click();
  assert.equal(await page.getByText('已模拟发送 · 无模型调用', { exact: true }).count(), 1);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await noOverflow();
  assert.ok(await page.locator('.first-run-composer-wrap').evaluate(element => element.getBoundingClientRect().width <= 920), 'composer stays constrained');
  await page.waitForTimeout(1500);
  await screenshot('04-workspace');
  await page.getByRole('button', { name: '重播开场', exact: true }).click();
  await heading('连接模型服务').waitFor();
  await page.waitForFunction(() => document.querySelector('.first-run-brand')?.getAnimations().length > 0);
  await page.getByRole('button', { name: '跳过动画', exact: true }).click();
  assert.equal(await page.locator('.first-run-flow').evaluate(element => getComputedStyle(element).opacity), '1', 'replay from workspace can be skipped');

  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await menu('预览状态', '正常');
  await page.getByRole('button', { name: '浏览器授权', exact: true }).click();
  await page.getByRole('button', { name: '取消授权', exact: true }).click();
  await page.waitForTimeout(1150);
  assert.equal(await heading('连接模型服务').count(), 1, 'cancel must reject the late simulated result');
  await page.getByRole('button', { name: '浏览器授权', exact: true }).click();
  await heading('从哪里开始？').waitFor();
  assert.equal(await page.getByRole('button', { name: '继续', exact: true }).isDisabled(), true);
  await page.getByLabel('独立会话', { exact: true }).click();
  await page.getByLabel('项目会话', { exact: true }).click();
  const selectedScope = page.locator('.first-run-scope label.is-selected');
  assert.equal(await selectedScope.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'pointer selection does not add a second border');
  assert.equal(await selectedScope.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'selection keeps the page background');
  await screenshot('05-project-selected');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await selectedScope.evaluate(element => getComputedStyle(element).outlineStyle), 'solid', 'keyboard focus remains visible');
  await screenshot('05-project-keyboard-focus');
  await page.evaluate(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async (options) => {
      if (options.mode !== 'read') throw new Error('Unexpected write access');
      return { name: 'chosen-project' };
    } });
  });
  await page.getByRole('button', { name: '浏览文件夹', exact: true }).click();
  await page.getByText('已选择目录；浏览器仅提供目录名，未读取目录内容。', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('项目目录', { exact: true }).inputValue(), 'chosen-project');
  assert.equal(await page.getByRole('button', { name: '继续', exact: true }).isEnabled(), true);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  });
  await page.getByRole('button', { name: '浏览文件夹', exact: true }).click();
  assert.equal(await page.getByLabel('项目目录', { exact: true }).inputValue(), 'chosen-project', 'cancel keeps selection');
  await page.evaluate(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: '浏览文件夹', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await menu('选择示例目录', 'D:\\Projects\\hello-step');
  await page.getByLabel('项目目录', { exact: true }).fill('D:\\My Projects\\custom-project');
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByRole('menuitemradio').filter({ hasText: '代我批准' }).click();
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await screenshot('05-permission-menu');
  await noOverflow();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('menuitemradio').filter({ hasText: '完全访问' }).click();
  assert.match(await page.getByRole('button', { name: '访问权限', exact: true }).innerText(), /代我批准/);
  assert.equal(await page.getByRole('button', { name: '继续', exact: true }).isEnabled(), true);
  await screenshot('05-project');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  assert.equal(await page.locator('.first-run-billing').innerText(), '套餐额度');
  assert.equal(await page.getByText('D:\\My Projects\\custom-project', { exact: true }).count(), 1);
  assert.match(await page.getByRole('button', { name: '访问权限', exact: true }).innerText(), /代我批准/);

  await page.goto(`${base}/tests/fixtures/first-run.html?theme=dark&motion=off`);
  await page.locator('.first-run-wordmark').waitFor();
  assert.match(await page.locator('.first-run-brand .first-run-wordmark').getAttribute('src'), /wordmark-dark\.png/);
  await menu('预览状态', '网络失败');
  await page.getByRole('button', { name: '浏览器授权', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await heading('连接模型服务').count(), 1);
  await screenshot('06-network-dark');
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('test');
  assert.equal(await page.getByRole('button', { name: '模拟发送', exact: true }).isDisabled(), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/tests/fixtures/first-run.html?theme=dark&motion=off&lang=en`);
  await heading('Connect a model service').waitFor();
  await noOverflow();
  await page.locator('input[value="custom"]').check();
  await page.getByLabel('API Key', { exact: true }).fill('demo-only');
  await page.getByLabel('API Key', { exact: true }).focus();
  const focus = await page.getByLabel('API Key', { exact: true }).evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { left: rect.left, right: rect.right, width: innerWidth, outline: style.outlineWidth, offset: style.outlineOffset };
  });
  assert.ok(focus.left >= 4 && focus.right <= focus.width - 4, 'four-sided focus has room');
  assert.notEqual(focus.outline, '0px');
  await noOverflow();
  await screenshot('07-mobile-custom-dark');
  await page.getByRole('button', { name: 'Connect and continue', exact: true }).click();
  await heading('Where will you work?').waitFor();
  await page.getByLabel('Independent', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await heading('Take the first step').waitFor();
  await page.getByRole('button', { name: 'Access permissions', exact: true }).click();
  await noOverflow();
  await screenshot('08-mobile-permissions');
  await page.keyboard.press('Escape');
  await noOverflow();
  await screenshot('08-mobile-review');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}/tests/fixtures/first-run.html`);
  await heading('连接模型服务').waitFor();
  assert.equal(await page.locator('.first-run-skip-motion').count(), 0);
  assert.equal(await page.getByRole('button', { name: '重播开场', exact: true }).isDisabled(), true);
  assert.deepEqual(external, [], 'fixture must not connect to providers or external services');
  assert.deepEqual(errors, []);
  console.log('First-run preview passed: Plan/API/custom, billing isolation, cancellation, no-plan/network states, project/independent scopes, skip, intro/reduced motion, desktop/mobile, theme, assets and focus.');
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server?.close();
}
