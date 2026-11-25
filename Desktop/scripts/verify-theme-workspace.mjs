import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const output = process.argv[2];
if (!output) throw new Error('Pass an evidence directory');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = new URL('/tests/fixtures/theme-pack.html', process.env.DESKTOP_THEME_PREVIEW_URL || 'http://127.0.0.1:4197/').href;
const shot = async name => {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(450);
  return page.screenshot({ path: join(output, `${name}.png`) });
};
const fadeResults = [];
async function verifyComposerFade(surface, width, reducedMotion) {
  const sample = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
  sample.on('pageerror', error => errors.push(error.message));
  try {
    await sample.addInitScript(() => localStorage.setItem('dfsc-stellar-preview-preferences-v1',
      JSON.stringify({ themeMotion: false })));
    await sample.goto(`${url}?view=fade&surface=${surface}`);
    const transcript = sample.locator('.conversation');
    const context = sample.locator('.composer-context-bar');
    const diff = sample.getByRole('button', { name: '查看运行中的变更', exact: true });
    await diff.waitFor();
    await sample.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
    await sample.waitForTimeout(500);
    await transcript.evaluate(element => {
      const paragraphs = element.querySelectorAll('.message-body p');
      const target = paragraphs[Math.floor(paragraphs.length / 2)];
      element.scrollTop += target.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom + 24;
    });
    const bottom = sample.getByRole('button', { name: '回到底部', exact: true });
    await bottom.waitFor();
    await sample.mouse.move(0, 0);
    const mask = await transcript.evaluate(element => getComputedStyle(element).maskImage);
    assert.match(mask, /linear-gradient.*72px/, `${surface}/${width}: transcript fade exists`);
    const geometry = await context.boundingBox();
    const actionBoxes = await context.evaluate(element => {
      const row = element.getBoundingClientRect();
      return [...element.querySelectorAll('button')].map(button => {
        const box = button.getBoundingClientRect();
        return { x: box.x - row.x, y: box.y - row.y, width: box.width, height: box.height };
      });
    });
    const actions = await context.screenshot();
    const faded = await transcript.screenshot();
    await transcript.evaluate(element => { element.style.maskImage = 'none'; });
    const hardEdge = await transcript.screenshot();
    const unmaskedActions = await context.screenshot();
    assert.deepEqual(await context.boundingBox(), geometry, 'Context actions retain their original geometry');
    await transcript.evaluate(element => { element.style.removeProperty('mask-image'); });
    const pixels = await sample.evaluate(async ({ frames, actionBoxes }) => {
      const decode = async bytes => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); image.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [faded, hard, actions, unmaskedActions] = await Promise.all(frames.map(decode));
      let upper = 0, lower = 0, upperCount = 0, lowerCount = 0;
      for (let y = 0; y < faded.height; y++) for (let x = 0; x < faded.width; x++) {
        const i = (y * faded.width + x) * 4;
        const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(faded.data[i + channel] - hard.data[i + channel])));
        if (y < faded.height - 80) { upper += delta; upperCount++; }
        if (y >= faded.height - 72) { lower += delta; lowerCount++; }
      }
      let actionsDelta = 0, actionsCount = 0;
      for (const box of actionBoxes) for (let y = Math.ceil(box.y); y < box.y + box.height; y++)
        for (let x = Math.ceil(box.x); x < box.x + box.width; x++) {
          const i = (y * actions.width + x) * 4;
          actionsDelta += Math.max(...[0, 1, 2].map(channel =>
            Math.abs(actions.data[i + channel] - unmaskedActions.data[i + channel])));
          actionsCount++;
        }
      return { upper: upper / upperCount, lower: lower / lowerCount, actions: actionsDelta / actionsCount };
    }, { frames: [[...faded], [...hardEdge], [...actions], [...unmaskedActions]], actionBoxes });
    // Compositor changes can alter a few antialiased glyph edges, not control contrast.
    assert.ok(pixels.actions < 1, `Context actions stay unfaded: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.lower > .5, `Bottom transcript pixels must visibly fade: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.upper < .1, `Reading above the fade stays unchanged: ${JSON.stringify(pixels)}`);
    await sample.screenshot({ path: join(output, `composer-fade-${surface}-${width}.png`) });
    await diff.click();
    const changes = sample.getByRole('dialog', { name: '运行中的变更', exact: true });
    await changes.waitFor();
    await sample.keyboard.press('Escape');
    await changes.waitFor({ state: 'hidden' });
    await sample.keyboard.press('Tab');
    const codeCopy = transcript.locator('.code-header button').first();
    await codeCopy.focus();
    assert.equal(await codeCopy.evaluate(element => element.matches(':focus-visible')), true);
    assert.equal(await transcript.evaluate(element => getComputedStyle(element).maskImage), 'none');
    await transcript.evaluate(element => { element.tabIndex = 0; element.focus(); });
    assert.equal(await transcript.evaluate(element => element.matches(':focus-visible')), true);
    assert.equal(await transcript.evaluate(element => getComputedStyle(element).maskImage), 'none');
    await sample.locator('.composer-input').click();
    assert.equal(await transcript.evaluate(element => getComputedStyle(element).maskImage), mask);
    await bottom.click();
    await sample.waitForFunction(() => {
      const element = document.querySelector('.conversation');
      return element.scrollHeight - element.scrollTop - element.clientHeight < 2;
    });
    if (surface === 'main' && width === 1440) {
      await sample.locator('.sidebar-settings').click();
      await sample.getByRole('button', { name: '外观', exact: true }).click();
      for (const theme of ['原版浅色', '原版深色']) {
        await sample.getByRole('button', { name: theme, exact: true }).click();
        assert.equal(await transcript.evaluate(element => getComputedStyle(element).maskImage), 'none');
        assert.notEqual(await sample.locator('.composer-wrap').evaluate(element => getComputedStyle(element, '::before').display), 'none');
      }
    }
    fadeResults.push({ surface, width, reducedMotion, ...pixels });
  } finally { await sample.close(); }
}
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
async function verifyWorkspace() {
  await page.goto(url);
  await page.locator('.theme-stellar-stage canvas[data-ready=true]').waitFor();
  await page.locator('.sidebar-settings').waitFor();
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
  const summary = page.getByRole('button', { name: '摘要', exact: true });
  if (await summary.getAttribute('aria-pressed') !== 'true') await summary.click();
  const board = page.locator('#summary-board');
  const taskMap = page.locator('.stellar-task-route');
  await taskMap.getByRole('button', { name: /^定位任务: 核对欢迎页与会话主题/ }).click();
  await page.getByText('核对欢迎页与会话主题', { exact: true }).waitFor();
  await shot('workspace-summary');
  const contextButton = page.getByRole('button', { name: '上下文', exact: true });
  if (await contextButton.getAttribute('aria-pressed') !== 'true') await contextButton.click();
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
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  const taskMapToggle = page.getByRole('checkbox', { name: '推进清单星图', exact: true });
  const closeSettings = page.locator('.settings-dialog > header').getByRole('button', { name: /^(?:Close|\u5173\u95ed)$/u });
  assert.equal(await taskMapToggle.isChecked(), true);
  await page.getByLabel('背景亮度').fill('70');
  await page.getByLabel('背景亮度').scrollIntoViewIfNeeded();
  await shot('workspace-appearance');
  await taskMapToggle.uncheck();
  assert.equal(await page.getByLabel('星海动态背景').isChecked(), true);
  assert.equal(await page.getByLabel('背景亮度').inputValue(), '70');
  await closeSettings.click();
  if (await summary.getAttribute('aria-pressed') !== 'true') await summary.click();
  const progress = board.getByRole('progressbar');
  await progress.waitFor();
  assert.equal(await progress.getAttribute('aria-valuenow'), '1');
  assert.equal(await progress.getAttribute('aria-valuemax'), '6');
  assert.equal(await taskMap.count(), 0);
  await board.getByRole('button', { name: /^检查窄窗口与键盘焦点/ }).click();
  await board.getByRole('button', { name: /^检查窄窗口与键盘焦点/, expanded: true }).waitFor();
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '原版浅色', exact: true }).click();
  assert.equal(await taskMapToggle.count(), 0);
  assert.equal(await page.locator('.stellar-workspace-scene').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMaterial), undefined);
  assert.equal(await page.locator('.conversation').evaluate(element => getComputedStyle(element).maskImage), 'none');
  assert.notEqual(await page.locator('.composer-wrap').evaluate(element => getComputedStyle(element, '::before').display), 'none');
  await shot('workspace-original-light');
  await page.locator('.theme-pack-select').click();
  assert.equal(await taskMapToggle.isChecked(), false);
  await page.getByLabel('星海动态背景').uncheck();
  await closeSettings.click();
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
  assert.equal(await page.evaluate(async () => (await window.desktop.snapshot()).preferences.stellarTaskMap), false);
  await page.getByRole('button', { name: '主题包 · 会话预览', exact: true }).click();
  if (await summary.getAttribute('aria-pressed') !== 'true') await summary.click();
  await progress.waitFor();
  assert.equal(await taskMap.count(), 0);
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await taskMapToggle.focus();
  await taskMapToggle.press('Space');
  assert.equal(await taskMapToggle.isChecked(), true);
  assert.equal(await page.getByLabel('星海动态背景').isChecked(), false);
  await closeSettings.click();
  await taskMap.waitFor();
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
}
try {
  if (!process.argv.includes('--composer-fade')) await verifyWorkspace();
  for (const [surface, width, reducedMotion] of [
    ['main', 1440, 'no-preference'], ['main', 390, 'reduce'],
    ['mini', 520, 'no-preference'], ['mini', 390, 'reduce'],
  ]) await verifyComposerFade(surface, width, reducedMotion);
  assert.deepEqual(errors, []);
  const report = { passed: true, scope: process.argv.includes('--composer-fade') ? 'composer-fade-only' : 'workspace-and-composer-fade',
    output, errors, fadeResults };
  await writeFile(join(output, 'composer-fade.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} catch (error) {
  await shot('workspace-failure').catch(() => {});
  console.error((await page.locator('body').innerText()).slice(-2500));
  throw error;
} finally { await browser.close(); }
