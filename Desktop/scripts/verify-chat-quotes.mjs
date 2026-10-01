import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-chat-quotes-'));
const workspace = join(profile, 'workspace');
await mkdir(workspace);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const sessions = join(profile, 'step-runtime', 'sessions');
await mkdir(sessions, { recursive: true });
const answer = '可读的选区不会抢走正文的注意力。\n\n引用是对原文的明确指向，评论则是在选段旁表达你的反馈。\n\n```ts\nconst selected = "quote";\n```\n\n保留原生拖选，让工具栏在松开鼠标之后出现。\n\n**重点**与 `inline` 代码。\n\n- 第一项\n- 第二项\n\n' +
  '长引用正文保留完整内容，滚动滑块放在移除按钮下方，正文不再为原生轨道和上下箭头让出一列空间。'.repeat(40);
for (const id of ['quote-history', 'quote-second']) {
  await writeFile(join(sessions, `${id}.jsonl`), [
    { type: 'session', version: 3, id, cwd: workspace, timestamp: new Date().toISOString() },
    { type: 'message', id: 'u1', parentId: null, timestamp: new Date().toISOString(),
      message: { role: 'user', content: id === 'quote-history' ? '看看引用和选区的效果。' : '第二个会话。', timestamp: Date.now() } },
    ...(id === 'quote-history' ? [{ type: 'message', id: 'a1', parentId: 'u1', timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: [{ type: 'text', text: answer }],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, timestamp: Date.now() } }] : []),
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
}
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
  ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, clipboard }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 850);
    globalThis.quoteClipboard = [];
    clipboard.writeText = text => globalThis.quoteClipboard.push(text);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.getByText('看看引用和选区的效果。', { exact: true }).click();
  const paragraph = page.locator('.response-text > p').first();
  await paragraph.waitFor();
  await paragraph.scrollIntoViewIfNeeded();
  if (await page.getByRole('button', { name: '关闭通知', exact: true }).count()) {
    await page.getByRole('button', { name: '关闭通知', exact: true }).click();
  }
  const select = async (selector, text) => {
    await page.evaluate(({ selector, text }) => {
      const element = [...document.querySelectorAll(selector)].find(element => !text || element.textContent.includes(text));
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
    }, { selector, text });
    await page.getByRole('toolbar', { name: '选中文字' }).waitFor({ state: 'visible' });
  };
  const toolbar = page.getByRole('toolbar', { name: '选中文字' });
  // Exercise actual mouse drag, including no popup during the drag.
  const rect = await paragraph.boundingBox();
  await page.mouse.move(rect.x + 2, rect.y + 12);
  await page.mouse.down();
  await page.mouse.move(rect.x + 210, rect.y + 12, { steps: 12 });
  assert.equal(await toolbar.count(), 0);
  await page.mouse.up();
  await toolbar.waitFor({ state: 'visible' });
  assert.ok((await page.evaluate(() => getSelection().toString())).length > 0);
  await page.screenshot({ path: 'test-results/quote-selection-native-drag.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await toolbar.waitFor({ state: 'detached' });
  await select('.response-text > p', '可读的选区');
  await toolbar.getByRole('button', { name: '复制选段' }).click();
  assert.equal(await app.evaluate(() => globalThis.quoteClipboard.at(-1)), '可读的选区不会抢走正文的注意力。');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: `test-results/quote-selection-${theme}.png`, animations: 'disabled' });
    const colors = await paragraph.evaluate(element => {
      const style = getComputedStyle(element, '::selection');
      return [style.backgroundColor, style.color];
    });
    assert.ok(colors.every(color => color !== 'rgba(0, 0, 0, 0)'));
  }
  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const openQuotes = async () => {
    if (!await page.getByRole('dialog', { name: '引用预览', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '查看引用', exact: true }).click();
      await page.getByRole('dialog', { name: '引用预览', exact: true }).waitFor();
    }
  };
  const removeQuote = async index => {
    await openQuotes();
    await page.getByRole('button', { name: `移除引用 ${index}`, exact: true }).click();
  };
  const closeQuotes = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.quote-chip > button')?.getAttribute('aria-expanded') === 'false');
  };
  await input.fill('这一段我想进一步讨论。');
  await select('.response-text > p', '可读的选区');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  assert.equal(await input.inputValue(), '这一段我想进一步讨论。');
  await page.locator('.quote-chip').waitFor();
  assert.equal(await input.evaluate(element => element === document.activeElement), true);
  await select('.response-text > p', '可读的选区');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  assert.equal(await page.locator('.composer-quote').count(), 1, 'same quote must not be duplicated');
  await select('.message.user .message-body > p');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  assert.equal(await page.locator('.composer-quote').count(), 2, 'user prose can also be quoted');
  await removeQuote(2);
  await select('.response-text pre code');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  const composerHeight = (await page.locator('.composer').boundingBox()).height;
  const contextHeight = (await page.locator('.composer-context-bar').boundingBox()).height;
  const chipBounds = await page.locator('.quote-chip').boundingBox();
  const composerBounds = await page.locator('.composer').boundingBox();
  assert.ok(chipBounds.y + chipBounds.height <= composerBounds.y, 'quote chip belongs outside the composer');
  assert.ok(Math.abs(chipBounds.x - composerBounds.x) < 1, 'quote chip aligns with the outer border');
  await openQuotes();
  assert.equal((await page.locator('.composer').boundingBox()).height, composerHeight, 'details must not resize the composer');
  for (const row of await page.locator('.composer-quote').all()) {
    const number = await row.locator('.quote-number').boundingBox();
    const excerpt = await row.locator('.quote-excerpt').boundingBox();
    assert.ok(Math.abs(number.y - excerpt.y) < 1, 'quote number and excerpt must share their first line');
  }
  await closeQuotes();
  assert.equal(await page.getByRole('button', { name: '查看引用', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByRole('button', { name: '查看引用', exact: true }).evaluate(element => element === document.activeElement), true);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: `test-results/quote-preview-${theme}.png`, animations: 'disabled' });
    await openQuotes();
    await page.screenshot({ path: `test-results/quote-details-${theme}.png`, animations: 'disabled' });
    await closeQuotes();
  }
  await removeQuote(2);
  await select('.response-text > p', '长引用正文');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  await openQuotes();
  const longRow = page.locator('.composer-quote').nth(1);
  const excerpt = longRow.locator('.quote-excerpt');
  const rail = longRow.getByRole('scrollbar', { name: '引用 2 滚动', exact: true });
  await rail.waitFor();
  assert.ok(await excerpt.evaluate(element => element.scrollHeight > element.clientHeight));
  assert.equal(await excerpt.evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
  const removeBounds = await longRow.getByRole('button', { name: '移除引用 2', exact: true }).boundingBox();
  const railBounds = await rail.boundingBox();
  assert.ok(railBounds.y >= removeBounds.y + removeBounds.height, 'scroll rail belongs below X');
  assert.ok(Math.abs(railBounds.x + railBounds.width / 2 - removeBounds.x - removeBounds.width / 2) < 1);
  const excerptBounds = await excerpt.boundingBox();
  assert.ok(excerptBounds.x + excerptBounds.width <= removeBounds.x - 5, 'text and scrollbar have separate columns');
  await rail.press('End');
  await page.waitForFunction(() => {
    const element = document.querySelectorAll('.quote-excerpt')[1];
    return Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight)) < 1;
  });
  const thumbEnd = await rail.locator('.conversation-scroll-thumb').boundingBox();
  assert.ok(Math.abs(thumbEnd.y + thumbEnd.height - railBounds.y - railBounds.height) < 1);
  await rail.press('Home');
  const thumbStart = await rail.locator('.conversation-scroll-thumb').boundingBox();
  await page.mouse.move(thumbStart.x + thumbStart.width / 2, thumbStart.y + thumbStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(railBounds.x + railBounds.width / 2, railBounds.y + railBounds.height, { steps: 10 });
  await page.mouse.up();
  assert.ok(await excerpt.evaluate(element => Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight)) < 1));
  await rail.press('Home');
  const conversationPosition = await page.locator('.conversation').evaluate(element => element.scrollTop);
  await page.mouse.move(excerptBounds.x + excerptBounds.width / 2, excerptBounds.y + 50);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => document.querySelectorAll('.quote-excerpt')[1].scrollTop > 0);
  assert.equal(await page.locator('.conversation').evaluate(element => element.scrollTop), conversationPosition);
  await rail.press('Home');
  await page.mouse.move(railBounds.x + railBounds.width / 2, railBounds.y + 30);
  await page.mouse.wheel(0, 150);
  await page.waitForFunction(() => document.querySelectorAll('.quote-excerpt')[1].scrollTop > 0);
  await page.locator('.conversation').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.jump-to-bottom').waitFor();
  const chip = await page.locator('.quote-chip').boundingBox();
  const jump = await page.locator('.jump-to-bottom').boundingBox();
  assert.ok(Math.abs(chip.y + chip.height / 2 - jump.y - jump.height / 2) < 1, 'quote and jump share the same auxiliary row');
  assert.equal((await page.locator('.composer-context-bar').boundingBox()).height, contextHeight);
  await rail.evaluate(element => element.blur());
  await page.mouse.move(20, 20);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: `test-results/quote-scroll-${theme}.png`, animations: 'disabled' });
  }
  await closeQuotes();
  await page.locator('.jump-to-bottom').click();
  await page.locator('.jump-to-bottom').waitFor({ state: 'detached' });
  assert.equal((await page.locator('.composer-context-bar').boundingBox()).height, contextHeight, 'removing the jump button must not resize the row');
  await removeQuote(2);
  // Native runtime snapshot switches must discard references from the old session.
  await page.getByText('第二个会话。', { exact: true }).click();
  await page.locator('.message.user').getByText('第二个会话。', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.composer-quote').length === 0);
  assert.equal(await page.locator('.composer-quote').count(), 0);
  await page.getByText('看看引用和选区的效果。', { exact: true }).click();
  await paragraph.waitFor();
  await select('.response-text > p', '可读的选区');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.quoteFixture = { snapshot, calls: [], fail: true };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      const fixture = globalThis.quoteFixture;
      if (method === 'snapshot') return fixture.snapshot;
      if (method === 'command') {
        fixture.calls.push(args);
        if (args[0] === 'prompt' && fixture.fail) throw new Error('Fixture quote send failure');
        return {};
      }
      throw new Error(`Unexpected fixture method ${method}`);
    });
  }, snapshot);
  await input.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Fixture quote send failure' }).waitFor();
  assert.equal(await input.inputValue(), '这一段我想进一步讨论。');
  assert.equal(await page.locator('.composer-quote').count(), 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await app.evaluate(() => { globalThis.quoteFixture.fail = false; });
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.composer-quote').length === 0);
  const prompt = await app.evaluate(() => globalThis.quoteFixture.calls.filter(call => call[0] === 'prompt').at(-1)[1].message);
  assert.match(prompt, /> 可读的选区不会抢走正文的注意力。/);
  assert.ok(prompt.endsWith('用户本轮消息：\n这一段我想进一步讨论。'));
  await select('.response-text > p', '重点');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  await select('.response-text > ul');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  await select('.response-text pre code');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.composer-quote').length === 0);
  const formatted = await app.evaluate(() => globalThis.quoteFixture.calls.filter(call => call[0] === 'prompt').at(-1)[1].message);
  assert.match(formatted, /\*\*重点\*\*/);
  assert.match(formatted, /> - 第一项/);
  assert.match(formatted, /> ```ts\n> const selected = "quote";/);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_start' }));
  await select('.response-text > p', '引用是');
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  assert.equal(await page.locator('.composer-action-button').getAttribute('data-action'), 'send');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.composer-quote').length === 0);
  assert.equal(await page.locator('.composer-action-button').getAttribute('data-action'), 'stop');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 760));
  await select('.response-text > p', '引用是');
  const menuBounds = await toolbar.boundingBox();
  assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 560);
  assert.ok(menuBounds.y >= 46 && menuBounds.y + menuBounds.height < 760);
  await page.screenshot({ path: 'test-results/quote-selection-narrow.png', animations: 'disabled' });
  await toolbar.getByRole('button', { name: '引用', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/quote-preview-narrow.png', animations: 'disabled' });
  await openQuotes();
  const detailBounds = await page.getByRole('dialog', { name: '引用预览', exact: true }).boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(detailBounds.x >= 0 && detailBounds.x + detailBounds.width <= viewport.width);
  assert.ok(detailBounds.y >= 46 && detailBounds.y + detailBounds.height <= viewport.height);
  await page.screenshot({ path: 'test-results/quote-details-narrow.png', animations: 'disabled' });
  await closeQuotes();
  await page.getByRole('button', { name: '清空引用', exact: true }).click();
  assert.equal(await page.locator('.composer-quote').count(), 0);
  assert.equal(await page.locator('.composer-action-button').getAttribute('data-action'), 'stop');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select('.response-text > p', '可读的选区');
  assert.equal(await toolbar.evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('Chat quotes passed: native drag, neutral selection, quote/copy, dedup, Markdown/user/code selection, compact count chip, anchored native popover without layout shift, Escape/focus/clear, draft preservation, session isolation, failure restore, outgoing payload, queue/stop, narrow layout and reduced motion.');
} finally {
  await app.close();
}
