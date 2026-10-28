import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import { settleLayout } from './settle-layout.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-message-links-'));
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
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1322, 880);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await prepareSessionFixture(page);
  const settings = await page.evaluate(() => window.desktop.settings());
  // Real main-process request first; fixture copy below only makes visual checks reproducible offline.
  const remote = await page.evaluate(() => window.desktop.linkPreview('https://www.stepfun.com/'));
  console.log('Remote preview:', { title: remote.title, description: Boolean(remote.description), icon: Boolean(remote.icon) });
  const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/tUAAAAASUVORK5CYII=';
  const messages = [
    { role: 'user', timestamp: Date.now() - 10000, content: '可以给我阶跃星辰和 B 站的官方网站吗？' },
    { role: 'assistant', timestamp: Date.now(), content: '当然，下面是两个官方网站：\n\n[阶跃星辰官方网站](https://www.stepfun.com/)\n\n[哔哩哔哩首页](https://www.bilibili.com/)\n\n常用入口也可以直接打开：\n\n- 首页：https://www.bilibili.com/\n- 番剧与影视：[番剧](https://www.bilibili.com/anime/)\n- 直播：[哔哩哔哩直播](https://live.bilibili.com/)\n- 手机首页：`https://m.bilibili.com`\n- 开放平台：`https://platform.stepfun.com`\n\n`curl https://example.com/`\n\n```text\nhttps://example.com/code-sample\n```\n\n链接保留原始地址，点击就能访问。' },
  ];
  await app.evaluate(({ ipcMain }, { snapshot, messages, icon, remote, settings }) => {
    globalThis.linkFixture = { ...snapshot, messages };
    globalThis.previewRequests = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.linkFixture;
      if (method === 'sessions') return globalThis.linkFixture.sessions;
      if (method === 'settings') return settings;
      if (method === 'preferences') {
        Object.assign(globalThis.linkFixture.preferences, args[0]);
        return globalThis.linkFixture.preferences;
      }
      if (method === 'linkPreview') {
        globalThis.previewRequests.push(args[0]);
        return { url: args[0], title: remote.title || '阶跃星辰', description: remote.description || '网页信息暂不可用', icon };
      }
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: ['off', 'low', 'medium', 'high'] };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      return {};
    });
  }, { snapshot, messages, icon: remote.icon || icon, remote, settings });
  await page.reload();
  const mobile = page.getByRole('link', { name: 'https://m.bilibili.com', exact: true });
  await mobile.waitFor();
  assert.equal(await mobile.getAttribute('href'), 'https://m.bilibili.com/');
  assert.equal(await mobile.locator('code').count(), 0, 'standalone URL must not acquire code background');
  assert.equal(await page.locator('.response-text code').filter({ hasText: 'curl https://example.com/' }).count(), 1);
  assert.equal(await page.locator('.response-text pre a').count(), 0, 'fenced URLs stay source');
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.linkFixture.state = { ...globalThis.linkFixture.state, isStreaming: true };
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_start', runtimeId: globalThis.linkFixture.runtimeId });
  });
  await page.locator('.response-active').waitFor();
  await mobile.waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.linkFixture.state.isStreaming = false;
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_end', runtimeId: globalThis.linkFixture.runtimeId });
  });
  await page.locator('.response-active').waitFor({ state: 'detached' });
  await mobile.waitFor();
  assert.equal(await mobile.locator('code').count(), 0, 'completion preserves the link presentation');
  const link = page.getByRole('link', { name: '阶跃星辰官方网站', exact: true });
  await link.waitFor();
  assert.equal(await link.evaluate(element => getComputedStyle(element).textDecorationLine), 'none');
  await page.screenshot({ path: 'test-results/message-links-light.png' });
  assert.deepEqual(await app.evaluate(() => globalThis.previewRequests), [], 'visible links must not request previews without interaction');
  await link.hover();
  await page.locator('.link-preview-body p').waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.previewRequests), ['https://www.stepfun.com/']);
  await page.waitForTimeout(250);
  assert.equal(await link.locator('.message-link-label').evaluate(element => getComputedStyle(element).textDecorationStyle), 'dashed');
  assert.equal(await page.locator('.link-preview').count(), 1);
  await page.screenshot({ path: 'test-results/message-links-preview-light.png' });
  await page.locator('.link-preview-top > a').first().hover();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.link-preview.is-closing').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  assert.equal(await page.locator('.link-preview').count(), 0);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await link.hover(); await page.locator('.link-preview-body p').waitFor(); await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/message-links-preview-dark.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 800));
  await page.waitForTimeout(400);
  await link.hover(); await page.locator('.link-preview-body p').waitFor(); await page.waitForTimeout(250);
  const box = await page.locator('.link-preview').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 640);
  await page.screenshot({ path: 'test-results/message-links-preview-narrow.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await link.focus(); await page.locator('.link-preview').waitFor();
  assert.equal(await page.locator('.link-preview').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1322, 880));
  for (const [theme, accent, screenshot] of [
    ['酒红', '金强调色', 'wine-gold'],
    ['原版深色', '青强调色', 'original-dark-cyan'],
    ['原版浅色', '玫红强调色', 'original-light-rose'],
  ]) {
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.getByRole('button', { name: accent, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    let primary;
    try {
      // Root color transitions do not establish dismissal of the animated settings
      // descendants. Finish dismissal and scrolling before starting a fresh hover.
      await page.locator('.settings-backdrop').waitFor({ state: 'detached' });
      await page.waitForFunction(() => !document.documentElement.getAnimations().some(animation => animation.playState === 'running'));
      primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
      assert.equal(await link.evaluate(element => getComputedStyle(element).color), primary, 'message links follow the selected accent');
      await page.mouse.move(0, 0);
      await link.scrollIntoViewIfNeeded();
      await settleLayout(link);
      await link.hover();
      await page.locator('.link-preview[aria-hidden="false"] .link-preview-body p').waitFor();
    } catch (error) {
      let diagnosticTimer;
      try {
        const state = await Promise.race([
          page.evaluate(() => {
            const anchor = document.querySelector('a.message-link[href="https://www.stepfun.com/"]');
            const rect = anchor?.getBoundingClientRect();
            const describe = element => element ? { tag: element.tagName, id: element.id, className: element.className,
              href: element.getAttribute('href') } : null;
            return { visibility: document.visibilityState, hovered: anchor?.matches(':hover'),
              focused: document.activeElement === anchor, activeElement: describe(document.activeElement),
              settingsBackdrops: document.querySelectorAll('.settings-backdrop').length,
              previews: [...document.querySelectorAll('.link-preview')].map(element => ({
                className: element.className, ariaHidden: element.getAttribute('aria-hidden'),
                hasParagraph: Boolean(element.querySelector('.link-preview-body p')),
              })), rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              hitTarget: rect && describe(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
          }),
          new Promise(resolve => { diagnosticTimer = setTimeout(() => resolve({ diagnosticTimedOut: true }), 3000); }),
        ]);
        console.error('Message link preview hover failed:', { theme, accent, ...state });
      } catch (diagnosticError) {
        console.error('Message link preview diagnostics failed:', { theme, accent, message: diagnosticError.message });
      } finally { clearTimeout(diagnosticTimer); }
      await page.screenshot({ path: `test-results/message-links-accent-${screenshot}-failure.png`, timeout: 3000 })
        .catch(diagnosticError => console.error('Message link failure screenshot unavailable:', diagnosticError.message));
      throw error;
    }
    assert.equal(await page.locator('.link-preview[aria-hidden="false"] .link-preview-top > a').count(), 2, 'Both preview actions remain present');
    assert.ok(await page.locator('.link-preview-top > a').evaluateAll((elements, color) =>
      elements.every(element => getComputedStyle(element).color === color), primary), 'both preview actions share the accent');
    await page.screenshot({ path: `test-results/message-links-accent-${screenshot}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.locator('.link-preview').waitFor({ state: 'detached' });
  }
  assert.deepEqual(errors, []);
  console.log('Message link acceptance passed');
} finally { await app.close(); }
