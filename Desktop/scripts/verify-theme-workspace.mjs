import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = 'http://127.0.0.1:4197/tests/fixtures/theme-pack.html';
const shot = async name => {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(450);
  return page.screenshot({ path: join(output, `${name}.png`) });
};
async function scenePixels() {
  const foregrounds = page.locator('.app > :not(.stellar-workspace-scene)');
  await foregrounds.evaluateAll(nodes => nodes.forEach(node => { node.style.visibility = 'hidden'; }));
  try {
    const bytes = await page.locator('.stellar-workspace-scene canvas').screenshot();
    return await page.evaluate(async bytes => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 25) colored++;
      image.close();
      return colored;
    }, [...bytes]);
  } finally {
    await foregrounds.evaluateAll(nodes => nodes.forEach(node => { node.style.visibility = ''; }));
  }
}
try {
  await page.goto(url);
  await page.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
  await page.locator('.sidebar-bottom > button').waitFor();
  await page.waitForTimeout(800);
  await shot('workspace-welcome');
  assert.ok(await scenePixels() > 3000, 'Desktop scene must contain colored artwork');
  const scene = page.locator('.stellar-workspace-scene canvas');
  const originalCanvas = await scene.elementHandle();
  await page.getByRole('button', { name: '主题包 · 会话预览', exact: true }).click();
  await page.locator('.messages').waitFor();
  assert.equal(await page.locator('.stellar-workspace-scene[data-reading=true]').count(), 1);
  assert.ok(await scene.evaluate((canvas, original) => canvas === original, originalCanvas));
  await page.waitForTimeout(600);
  await shot('workspace-conversation');
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  await page.getByText('核对欢迎页与会话主题', { exact: true }).waitFor();
  await shot('workspace-summary');
  await page.getByRole('button', { name: '上下文', exact: true }).click();
  await page.locator('#context-panel').waitFor();
  await shot('workspace-context');
  await page.getByRole('button', { name: '变更', exact: true }).click();
  await page.getByText('palette.json', { exact: false }).last().waitFor();
  await shot('workspace-changes');
  await page.getByRole('button', { name: '变更', exact: true }).click();
  const composer = page.locator('.composer-input[contenteditable=true]');
  await composer.fill('检查输入区的焦点状态');
  await composer.press('Enter');
  await page.waitForTimeout(350);
  await shot('workspace-working');
  await page.getByText('收到。这是一条本地模拟回复', { exact: false }).waitFor();
  await composer.fill('测试停止');
  await composer.press('Enter');
  await page.getByRole('button', { name: '停止此轮', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).state.isStreaming);
  await page.waitForTimeout(2600);
  assert.equal(await page.getByText('收到。这是一条本地模拟回复', { exact: false }).count(), 1);
  await page.getByRole('button', { name: '组件与样式校对', exact: true }).click();
  await page.getByText('检查一下组件与样式校对', { exact: false }).waitFor();
  await page.getByRole('button', { name: '主题包 · 会话预览', exact: true }).click();
  await page.getByText('收到。这是一条本地模拟回复', { exact: false }).waitFor();
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByLabel('背景亮度').fill('70');
  await page.getByLabel('背景亮度').scrollIntoViewIfNeeded();
  await shot('workspace-appearance');
  await page.getByRole('button', { name: '原版浅色', exact: true }).click();
  assert.equal(await page.locator('.stellar-workspace-scene').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  await shot('workspace-original-light');
  await page.locator('.theme-pack-select').click();
  await page.getByLabel('星海动态背景').uncheck();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(800);
  // Hide foregrounds only for pixel comparisons; the real canvas remains visible.
  const foregrounds = page.locator('.app > :not(.stellar-workspace-scene)');
  await foregrounds.evaluateAll(nodes => nodes.forEach(node => { node.style.visibility = 'hidden'; }));
  const still = await scene.screenshot();
  await page.waitForTimeout(500);
  assert.ok((await scene.screenshot()).equals(still), 'Motion-off must freeze the workspace');
  await foregrounds.evaluateAll(nodes => nodes.forEach(node => { node.style.visibility = ''; }));
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
  await composer.fill('从新会话发送一条离线消息');
  await composer.press('Enter');
  await page.getByText('收到。这是一条本地模拟回复', { exact: false }).waitFor();
  assert.equal(await page.locator('.stellar-workspace-scene[data-reading=true]').count(), 1);
  await page.reload();
  await page.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
  assert.equal(await page.evaluate(async () => (await window.desktop.snapshot()).preferences.themeBrightness), 70);
  await page.setViewportSize({ width: 760, height: 880 });
  await page.waitForTimeout(500);
  await shot('workspace-narrow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.goto(`${url}?view=chat`);
  await page.locator('.messages').waitFor();
  await page.waitForTimeout(500);
  await shot('workspace-chat-narrow');
  assert.equal(await page.locator('.stellar-workspace-scene[data-reading=true]').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await shot('workspace-chat-mobile');
  assert.ok(await scenePixels() > 500, 'Mobile scene must contain colored artwork');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, output, errors }));
} catch (error) {
  await shot('workspace-failure').catch(() => {});
  console.error((await page.locator('body').innerText()).slice(-2500));
  throw error;
} finally { await browser.close(); }
