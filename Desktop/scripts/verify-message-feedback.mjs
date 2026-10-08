import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-message-feedback-'));
const workspace = join(profile, 'workspace');
await mkdir(workspace);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
const sessions = join(profile, 'step-runtime', 'sessions');
await mkdir(sessions, { recursive: true });
await writeFile(join(sessions, 'feedback-history.jsonl'), [
  { type: 'session', version: 3, id: 'feedback-history', cwd: workspace, timestamp: new Date().toISOString() },
  { type: 'message', id: 'user-1', parentId: null, timestamp: new Date().toISOString(),
    message: { role: 'user', content: '历史用户消息不播放发送动画。', timestamp: Date.now() } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, clipboard }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 850);
    // Substitute only the final OS write; retain production IPC and validation.
    globalThis.feedbackClipboard = { original: clipboard.writeText, values: [], fail: false };
    clipboard.writeText = async text => {
      if (globalThis.feedbackClipboard.fail) throw new Error('Fixture native clipboard failure');
      globalThis.feedbackClipboard.values.push(text);
    };
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const history = await page.evaluate(async () => (await window.desktop.snapshot()).sessions.find(session => session.id === 'feedback-history'));
  assert.ok(history, 'isolated history fixture must be discoverable');
  // Use the normal history action so both the runtime and React receive the snapshot.
  await page.getByText('历史用户消息不播放发送动画。', { exact: true }).click();
  await page.locator('.message.user').first().waitFor();
  assert.equal(await page.locator('.message.user').first().evaluate(element => element.getAnimations().length), 0);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error('Browser clipboard must not be used'); };
  });
  await assert.rejects(page.evaluate(() => window.desktop.copyText({ text: 'not a string' })), /Invalid text/);
  await assert.rejects(page.evaluate(() => window.desktop.copyText('x'.repeat(2000001))), /Invalid text/);
  assert.equal(await app.evaluate(() => globalThis.feedbackClipboard.values.length), 0);
  const emit = events => app.evaluate(({ BrowserWindow }, events) => {
    for (const event of events) BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', event);
  }, events);
  const answer = '回复正文保留 **Markdown**。\n\n```ts\nconst value = 1;\n```\n\n第二段正文。';
  await emit([{ type: 'message_start', message: { role: 'assistant', content: [
    { type: 'thinking', thinking: '思考内容不能混入回复复制。' },
    { type: 'toolCall', id: 'copy-tool', name: 'read_file', arguments: { path: 'fixture.md' } },
    { type: 'text', text: answer },
  ] } }]);
  const userCopy = page.locator('.message.user').first().getByRole('button', { name: '复制', exact: true });
  await page.locator('.message.user').first().hover();
  await userCopy.click();
  await userCopy.locator('.lucide-check').waitFor();
  assert.equal(await app.evaluate(() => globalThis.feedbackClipboard.values.at(-1)), '历史用户消息不播放发送动画。');
  const assistant = page.locator('.message.assistant').last();
  await assistant.locator('.assistant-actions').getByRole('button', { name: '复制', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.feedbackClipboard.values.at(-1)), answer);
  const codeCopy = assistant.locator('.code-header').getByRole('button', { name: '复制', exact: true });
  await codeCopy.click();
  assert.equal(await app.evaluate(() => globalThis.feedbackClipboard.values.at(-1)), 'const value = 1;\n');
  await app.evaluate(() => { globalThis.feedbackClipboard.fail = true; });
  await codeCopy.click();
  await page.getByRole('alert').filter({ hasText: 'Fixture native clipboard failure' }).waitFor();
  assert.equal(await codeCopy.locator('.lucide-check').count(), 0, 'failed copy must not retain success feedback');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await app.evaluate(() => { globalThis.feedbackClipboard.fail = false; });
  await codeCopy.click();
  await codeCopy.locator('.lucide-check').waitFor();

  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.feedbackFixture = { snapshot, calls: [], queue: [], fail: false };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      const fixture = globalThis.feedbackFixture;
      if (method === 'snapshot') return fixture.snapshot;
      if (method === 'command') {
        fixture.calls.push(args);
        if (args[0] === 'prompt') {
          if (fixture.fail) throw new Error('Fixture prompt failure');
          fixture.queue.push({ role: 'user', content: args[1].message, timestamp: Date.now() });
        }
        return {};
      }
      throw new Error(`Unexpected fixture method: ${method}`);
    });
  }, snapshot);
  // Freeze only new user animations so intermediate opacity/position can be inspected.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const result = animate.apply(this, args);
      if (this.matches('.message.user')) { result.pause(); result.currentTime = 70; }
      return result;
    };
  });
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const admit = () => app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.feedbackFixture;
    const message = fixture.queue.shift();
    fixture.snapshot.messages.push(message);
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.send('runtime-event', { type: 'message_start', message });
    window.webContents.send('runtime-event', { type: 'agent_start' });
  });
  await input.fill('发送后的轻量落定动画。');
  await input.press('Enter');
  assert.equal(await input.inputValue(), '', 'sending must clear immediately, without waiting for motion');
  assert.equal(await app.evaluate(() => globalThis.feedbackFixture.queue.length), 1);
  await admit();
  const arriving = page.locator('.message.user').last();
  await arriving.getByText('发送后的轻量落定动画。', { exact: true }).waitFor();
  const intermediate = await arriving.evaluate(element => ({
    opacity: Number(getComputedStyle(element).opacity), transform: getComputedStyle(element).transform,
    duration: element.getAnimations()[0]?.effect.getTiming().duration, height: element.offsetHeight,
  }));
  assert.ok(intermediate.opacity > .45 && intermediate.opacity < 1);
  assert.notEqual(intermediate.transform, 'none');
  assert.equal(intermediate.duration, 160);
  const pulse = page.locator('.working');
  const pulseBefore = await pulse.boundingBox();
  await page.screenshot({ path: 'test-results/user-send-mid-animation.png', animations: 'allow' });
  await arriving.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  assert.equal(await arriving.evaluate(element => element.offsetHeight), intermediate.height, 'motion must not animate transcript height');
  assert.ok(Math.abs((await pulse.boundingBox()).y - pulseBefore.y) < 1, 'user arrival must not move the pulse');
  await emit([{ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '正在处理新消息。' }] } }]);
  assert.equal(await arriving.evaluate(element => element.getAnimations().length), 0, 'response updates must not replay arrival');
  const userCount = await page.locator('.message.user').count();
  await input.fill('执行中加入队列的消息。');
  await page.locator('.composer-action-button').click();
  assert.equal(await input.inputValue(), '');
  assert.equal(await page.locator('.message.user').count(), userCount, 'queued messages must not imply they have entered the transcript');
  await admit();
  await page.locator('.message.user').last().getByText('执行中加入队列的消息。', { exact: true }).waitFor();
  assert.equal(await page.locator('.message.user').last().evaluate(element => element.getAnimations().length), 1);
  await page.locator('.message.user').last().evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await app.evaluate(() => { globalThis.feedbackFixture.fail = true; });
  await input.fill('失败后恢复输入草稿。');
  await input.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Fixture prompt failure' }).waitFor();
  assert.equal(await input.inputValue(), '失败后恢复输入草稿。');
  assert.equal(await page.locator('.message.user').count(), userCount + 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await app.evaluate(() => { globalThis.feedbackFixture.fail = false; });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await input.fill('减少动态效果时立即显示。');
  await input.press('Enter');
  await admit();
  await page.locator('.message.user').last().getByText('减少动态效果时立即显示。', { exact: true }).waitFor();
  assert.equal(await page.locator('.message.user').last().evaluate(element => element.getAnimations().length), 0);

  const longDraft = '第1行：输入框使用原生细滚动条。\n'.repeat(40);
  await input.fill(longDraft);
  assert.ok(await input.evaluate(element => element.scrollHeight > element.clientHeight));
  const scrollStyle = await input.evaluate(element => ({
    width: getComputedStyle(element, '::-webkit-scrollbar').width,
    track: getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
    buttons: getComputedStyle(element, '::-webkit-scrollbar-button').display,
  }));
  assert.equal(scrollStyle.width, '4px');
  assert.equal(scrollStyle.track, 'rgba(0, 0, 0, 0)', 'scrollbar track stays transparent');
  assert.equal(scrollStyle.buttons, 'none', 'trackless scrollbar has no end buttons');
  await input.evaluate(element => { element.scrollTop = 100; });
  const inputBefore = await input.evaluate(element => element.scrollTop);
  const conversationBefore = await page.locator('.conversation').evaluate(element => element.scrollTop);
  const inputBounds = await input.boundingBox();
  await page.mouse.move(inputBounds.x + inputBounds.width / 2, inputBounds.y + inputBounds.height / 2);
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(previous => document.querySelector('.composer > textarea').scrollTop > previous, inputBefore);
  assert.equal(await page.locator('.conversation').evaluate(element => element.scrollTop), conversationBefore);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.locator('.composer-wrap').screenshot({ path: `test-results/composer-native-scroll-${theme}.png` });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 760));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.composer-wrap').screenshot({ path: 'test-results/composer-native-scroll-narrow.png' });
  await input.fill('');
  assert.equal(await input.evaluate(element => element.scrollHeight > element.clientHeight), false);
  assert.deepEqual(errors, []);
  console.log('Message feedback passed: real text-copy IPC/validation/failure, user/assistant/code, history without motion, Enter/click/queue/failure, reduced motion, unchanged pulse and native textarea scrolling.');
} finally {
  await app.close();
}
