import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-composer-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await prepareSessionFixture(page);
  // Only this isolated process uses a command recorder; no prompt reaches a model.
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.composerFixture = { snapshot, calls: [], failAbort: false };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      const fixture = globalThis.composerFixture;
      if (method === 'snapshot') return fixture.snapshot;
      if (method === 'command') {
        fixture.calls.push(args);
        if (args[0] === 'abort' && fixture.failAbort) throw new Error('Fixture abort failed');
        return {};
      }
      if (method === 'chooseAttachments') return [{
        kind: 'image', name: 'fixture.png',
        content: { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==' },
      }];
      throw new Error(`Unexpected fixture method: ${method}`);
    });
  }, snapshot);
  const emit = type => app.evaluate(({ BrowserWindow }, type) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type }), type);
  const button = page.locator('.composer-action-button');
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const settle = () => button.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  const capture = async name => {
    await settle();
    await page.locator('.composer-wrap').screenshot({ path: `test-results/composer-${name}.png` });
  };
  assert.equal(await button.isDisabled(), true);
  assert.ok(await button.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth) > 0));
  assert.equal(await button.locator('.action-pixel-p').count(), 144, 'transition uses fine pixels, not a coarse final glyph');
  assert.equal(await button.locator('.action-pixel-shared.lucide-arrow-up').count(), 1, 'send uses the reference thin upward arrow');
  assert.equal(await button.evaluate(element => getComputedStyle(element).borderRadius), '6px', 'original rounded square is preserved');
  assert.equal(await button.evaluate(element => getComputedStyle(element).width), '32px', 'original button size is preserved');
  assert.equal(await button.evaluate(element => getComputedStyle(element).backgroundColor === getComputedStyle(element).color), false, 'arrow contrasts with its solid background');
  assert.equal(await button.locator('mask .lucide-square').getAttribute('fill'), 'white', 'stop is a filled square, not pause bars');
  assert.equal(await page.locator('.stop-button').count(), 0);
  await input.fill('检查一下当前项目的实现');
  assert.equal(await button.getAttribute('aria-label'), '发送');
  await capture('send');
  await button.click();
  assert.equal((await app.evaluate(() => globalThis.composerFixture.calls)).at(-1)[0], 'prompt');
  await emit('agent_start');
  await page.waitForFunction(() => document.querySelector('.composer-action-button').dataset.action === 'stop');
  const stopBounds = await button.boundingBox();
  assert.equal(await button.isDisabled(), false);
  assert.ok(await button.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth) > 0));
  await capture('stop');
  await page.screenshot({ path: 'test-results/composer-desktop.png' });
  await input.fill('接下来再检查测试覆盖');
  assert.equal(await button.getAttribute('aria-label'), '加入队列');
  await capture('queue');
  assert.deepEqual(await button.boundingBox(), stopBounds);
  await button.click();
  assert.equal((await app.evaluate(() => globalThis.composerFixture.calls)).at(-1)[0], 'prompt');
  await page.waitForFunction(() => document.querySelector('.composer-action-button').dataset.action === 'stop');
  await input.fill('temporary');
  await input.fill('');
  assert.equal(await button.getAttribute('data-action'), 'stop');
  await input.press('Enter');
  assert.equal((await app.evaluate(() => globalThis.composerFixture.calls)).length, 2, 'empty Enter must not abort');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  assert.equal(await button.getAttribute('data-action'), 'send');
  await page.locator('.attachment-card').hover();
  await page.getByRole('button', { name: '移除附件', exact: true }).click();
  assert.equal(await button.getAttribute('data-action'), 'stop');
  await app.evaluate(() => { globalThis.composerFixture.failAbort = true; });
  await button.click();
  await page.getByRole('alert').filter({ hasText: 'Fixture abort failed' }).waitFor();
  assert.equal(await button.isDisabled(), false, 'failed abort restores stop control');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await app.evaluate(() => { globalThis.composerFixture.failAbort = false; });
  await button.click();
  assert.equal(await button.getAttribute('aria-label'), '正在停止此轮');
  assert.equal(await button.isDisabled(), true);
  await emit('agent_end');
  await page.waitForFunction(() => document.querySelector('.composer-action-button').dataset.action === 'send');
  assert.equal(await button.isDisabled(), true);
  await emit('agent_start');
  await page.waitForFunction(() => document.querySelector('.composer-action-button').dataset.action === 'stop');
  await settle();
  // Sample staggered transition times without racing screenshot capture.
  await input.fill('下一轮');
  await button.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 100; }
  });
  const sharedOpacity = await button.locator('.action-pixel-shared').first().evaluate(element => Number(getComputedStyle(element).opacity));
  assert.equal(sharedOpacity, 1, 'shared monochrome pixels remain visible throughout the transition');
  const pixelOpacities = await button.locator('.action-pixel-p').evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity)));
  assert.ok(new Set(pixelOpacities.map(value => value.toFixed(2))).size > 3, 'transition is staggered pixel-by-pixel');
  await page.locator('.composer-wrap').screenshot({ path: 'test-results/composer-transition.png', animations: 'allow' });
  await button.screenshot({ path: 'test-results/composer-transition-detail.png', animations: 'allow' });
  await button.evaluate(element => { for (const animation of element.getAnimations({ subtree: true })) animation.finish(); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await input.fill('');
  assert.equal(await button.locator('.action-pixel-p').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  assert.equal(await button.locator('.action-pixel-p').first().evaluate(element => getComputedStyle(element).opacity), '1');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 760));
  await capture('narrow');
  await input.fill('下一轮');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await capture('dark');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('Composer acceptance passed: send/queue/stop, clear, attachments, Enter, abort failure/pending, persistent shared pixels, reduced motion and narrow layout.');
} finally {
  await app.close();
}
