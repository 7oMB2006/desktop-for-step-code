import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = process.env.MINI_CHAT_PREVIEW_OUTPUT || 'test-results/mini-chat-preview';
await mkdir(output, { recursive: true });
let server, browser;
const errors = [], external = [];
try {
  if (!process.env.DESKTOP_PREVIEW_URL) {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
  }
  const base = process.env.DESKTOP_PREVIEW_URL || server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  const url = `${base}/tests/fixtures/mini-chat.html`;
  await page.goto(url);
  const entry = page.locator('.window-bar').getByRole('button', { name: 'MiniChat', exact: true });
  const minimize = page.locator('.window-bar').getByRole('button', { name: '最小化', exact: true });
  const [anchorBox, minimizeBox] = await Promise.all([entry.boundingBox(), minimize.boundingBox()]);
  assert.equal(anchorBox.x + anchorBox.width, minimizeBox.x, 'entry sits immediately before Minimize');
  assert.equal(await entry.evaluate(el => getComputedStyle(el).webkitAppRegion), 'no-drag');
  await page.screenshot({ path: `${output}/entry-light.png` });
  await entry.click();
  const mini = page.locator('.mini-chat-frame');
  const editor = mini.getByRole('textbox', { name: '消息', exact: true });
  const bottom = mini.getByRole('button', { name: '回到底部', exact: true });
  await editor.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-surface="mini"] .composer-input') === document.activeElement);
  const pin = mini.getByRole('button', { name: '取消置顶', exact: true });
  assert.equal(await pin.getAttribute('aria-pressed'), 'true');
  await pin.click();
  await mini.getByRole('button', { name: '置顶窗口', exact: true }).click();

  await editor.fill('保留这个草稿，不要发送。');
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  const conversations = page.getByRole('menu', { name: '小窗会话', exact: true });
  await conversations.getByRole('menuitemradio', { name: '搜索命中定位', exact: true }).click();
  assert.equal(await editor.textContent(), '');
  assert.match(await mini.innerText(), /会话、消息、文字片段/);
  assert.match(await page.locator('.window-session-title').innerText(), /插件市场/);
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await conversations.getByRole('menuitemradio', { name: '插件市场发布检查', exact: true }).click();
  assert.equal(await editor.innerText(), '保留这个草稿，不要发送。');
  const paragraph = mini.locator('.response-text p').last();
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  const selection = page.getByRole('toolbar', { name: '选中文字', exact: true });
  await selection.getByRole('button', { name: '引用', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-surface="mini"] .composer-input') === document.activeElement);
  await mini.getByRole('button', { name: '查看引用', exact: true }).click();
  await page.getByRole('dialog', { name: '引用预览', exact: true }).waitFor();
  assert.match(await page.getByRole('dialog', { name: '引用预览', exact: true }).innerText(), /release-checklist/);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${output}/quote-light.png` });
  await mini.getByRole('button', { name: '回到主窗口', exact: true }).click();
  const mainEditor = page.locator('[data-surface="main"]').getByRole('textbox', { name: '消息', exact: true });
  assert.equal(await mainEditor.innerText(), '保留这个草稿，不要发送。');
  await page.locator('[data-surface="main"]').getByRole('button', { name: '查看引用', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-surface="main"] .composer-input') === document.activeElement);
  assert.equal(await mini.count(), 0);

  await entry.click();
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await conversations.getByRole('menuitemradio', { name: '新会话', exact: true }).click();
  await mini.getByRole('heading', { name: '新会话', exact: true }).waitFor();
  await editor.fill('请补一段检查结果。');
  await editor.press('Enter');
  await mini.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await mini.getByRole('button', { name: '发送', exact: true }).waitFor();
  assert.match(await mini.innerText(), /verifyPermissions/);
  await mini.getByRole('button', { name: '回到主窗口', exact: true }).click();
  assert.match(await page.locator('[data-surface="main"]').innerText(), /verifyPermissions/);
  assert.match(await page.locator('.window-session-title').innerText(), /新会话/);

  await page.goto(`${url}?open=1&stress=reading&stream=manual`);
  const main = page.locator('[data-surface="main"]');
  const miniViewport = mini.locator('.conversation');
  const tool = mini.locator('.process-tool');
  const thought = mini.locator('.thinking');
  const switchMini = async title => {
    await mini.getByRole('button', { name: '切换小窗会话' }).click();
    await conversations.getByRole('menuitemradio', { name: title, exact: true }).click();
  };
  const scrollTo = async (locator, top) => {
    const current = await locator.evaluate(element => element.scrollTop);
    // Position deterministically after declaring the same intent as a wheel gesture.
    await locator.dispatchEvent('wheel', { deltaY: top - current });
    await locator.evaluate((element, top) => { element.scrollTop = top; }, top);
    await page.waitForTimeout(100);
  };
  const scrollTop = locator => locator.evaluate(element => element.scrollTop);
  const atBottom = scope => page.waitForFunction(scope => {
    const element = document.querySelector(`[data-surface="${scope}"] .conversation`);
    return element && element.scrollHeight - element.scrollTop - element.clientHeight <= 1;
  }, scope);
  const anchor = locator => locator.evaluate(element => {
    const top = element.getBoundingClientRect().top;
    const article = [...element.querySelectorAll('.messages > article[data-message-index]')]
      .find(item => item.getBoundingClientRect().bottom > top);
    return { index: article.dataset.messageIndex, offset: article.getBoundingClientRect().top - top };
  });
  await thought.locator('> summary').click();
  await tool.locator('> summary').click();
  await tool.locator('.tool-input > summary').click();
  await tool.locator('.tool-output > summary').click();
  await page.waitForTimeout(300);
  await scrollTo(miniViewport, 190);
  await bottom.waitFor();
  assert.equal(await bottom.getAttribute('data-tooltip'), '回到底部');
  const readingTop = await scrollTop(miniViewport);
  await switchMini('搜索命中定位');
  await scrollTo(miniViewport, 360);
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  await entry.click();
  assert.match(await mini.locator('.mini-chat-session-copy strong').innerText(), /搜索命中定位/,
    'reopening resumes the mini selection, not the main selection');
  assert.ok(Math.abs(await scrollTop(miniViewport) - 360) <= 2, 'close/reopen preserves reading position');
  await bottom.waitFor();
  await switchMini('插件市场发布检查');
  assert.ok(Math.abs(await scrollTop(miniViewport) - readingTop) <= 2, 'session switching restores reading position');
  assert.equal(await thought.getAttribute('data-expanded'), 'true');
  assert.equal(await tool.getAttribute('data-expanded'), 'true');
  assert.equal(await tool.locator('.tool-input').evaluate(element => element.open), true);
  assert.equal(await tool.locator('.tool-output').evaluate(element => element.open), false);
  assert.equal(await main.locator('.process-tool').getAttribute('data-expanded'), 'false',
    'main and mini retain independent disclosure choices');
  assert.equal(await main.getByRole('button', { name: '回到底部', exact: true }).count(), 0,
    'the mini scroll control does not change main following state');
  const handoffAnchor = await anchor(miniViewport);
  await mini.getByRole('button', { name: '回到主窗口', exact: true }).click();
  const mainAnchor = await anchor(main.locator('.conversation'));
  assert.equal(mainAnchor.index, handoffAnchor.index);
  assert.ok(Math.abs(mainAnchor.offset - handoffAnchor.offset) <= 2, 'return transfers the visible message anchor');
  assert.equal(await main.locator('.process-tool').getAttribute('data-expanded'), 'true',
    'return transfers disclosure choices even if main already displays this session');
  assert.equal(await main.locator('.tool-input').evaluate(element => element.open), true);
  assert.equal(await main.locator('.tool-output').evaluate(element => element.open), false);
  await entry.click();
  const reopenedAnchor = await anchor(miniViewport);
  assert.ok(Math.abs(reopenedAnchor.offset - mainAnchor.offset) <= 2,
    `opening from main transfers reading position across different widths: ${JSON.stringify({ mainAnchor, reopenedAnchor })}`);
  await editor.fill('只发一次，关窗继续。');
  await editor.press('Enter');
  await mini.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await scrollTo(miniViewport, 200);
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await scrollTop(miniViewport) - 200) <= 2, 'streaming does not steal an older reading position');
  await mini.getByRole('button', { name: '关闭小窗', exact: true }).click();
  await main.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await entry.click();
  assert.ok(Math.abs(await scrollTop(miniViewport) - 200) <= 2, 'reopening during a response keeps reading position');
  await mini.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('mini-preview-release')));
  await mini.getByRole('button', { name: '发送', exact: true }).waitFor();
  assert.equal(await mini.locator('.message.user').count(), 2, 'closing and reopening never duplicates a request');
  assert.ok(Math.abs(await scrollTop(miniViewport) - 200) <= 2, 'settling does not pull the reader to the tail');
  await bottom.waitFor();
  await page.screenshot({ path: `${output}/reading-handoff-light.png` });
  const userCount = await mini.locator('.message.user').count();
  await bottom.click();
  await atBottom('mini');
  assert.equal(await bottom.count(), 0, 'the return control hides after resuming follow');
  assert.equal(await mini.locator('.message.user').count(), userCount, 'returning to bottom never sends a message');
  await page.waitForFunction(() => document.querySelector('[data-surface="mini"] .composer-input') === document.activeElement);
  await editor.fill('继续跟随末尾。');
  await editor.press('Enter');
  await mini.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await miniViewport.hover();
  await page.mouse.wheel(0, -32);
  await bottom.waitFor();
  const pausedTop = await scrollTop(miniViewport);
  await page.waitForTimeout(150);
  assert.ok(Math.abs(await scrollTop(miniViewport) - pausedTop) <= 2,
    'an upward gesture pauses following even within the old near-bottom threshold');
  await bottom.click();
  await atBottom('mini');
  await page.evaluate(() => window.dispatchEvent(new Event('mini-preview-release')));
  await mini.getByRole('button', { name: '发送', exact: true }).waitFor();
  assert.ok(await miniViewport.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight < 2),
    'readers at the tail continue following new content');
  await scrollTo(miniViewport, 200);
  await editor.fill('停止时保留正在看的位置。');
  await editor.press('Enter');
  await mini.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await scrollTo(miniViewport, 200);
  await mini.getByRole('button', { name: '停止此轮', exact: true }).click();
  assert.ok(Math.abs(await scrollTop(miniViewport) - 200) <= 2, 'stopping does not change reading position');
  await bottom.waitFor();

  await page.goto(`${url}?open=1&stress=reading`);
  await editor.waitFor();
  await editor.fill('保留未发送草稿。');
  await scrollTo(miniViewport, 0);
  await mini.locator('.message.user').hover();
  await mini.getByRole('button', { name: '编辑并重做', exact: true }).click();
  const editForm = mini.locator('.user-message-editor');
  await editForm.getByRole('textbox', { name: '编辑消息', exact: true }).fill('修改后的历史问题。');
  await editForm.getByRole('button', { name: '发送', exact: true }).click();
  await mini.getByRole('alert').getByText('请先发送或清空当前草稿和引用，再编辑重做。', { exact: true }).waitFor();
  assert.equal(await editor.innerText(), '保留未发送草稿。', 'retry editing cannot replace a pending mini draft');
  assert.equal(await mainEditor.innerText(), '保留未发送草稿。', 'retry editing cannot replace the shared main draft');
  assert.equal(await editForm.getByRole('textbox').inputValue(), '修改后的历史问题。', 'a rejected edit remains available');
  assert.equal(await mini.locator('.message.user').count(), 1, 'a rejected edit does not send a request');
  await editForm.getByRole('button', { name: '取消', exact: true }).click();
  await mini.getByRole('button', { name: '关闭提示', exact: true }).click();
  await editor.fill('');
  await page.waitForFunction(() => document.querySelector('[data-surface="mini"] .composer-input')?.value === '');
  const addMenuQuote = async text => {
    await mini.getByRole('button', { name: '添加引用', exact: true }).click();
    await mini.getByRole('option').filter({ hasText: text }).click();
  };
  await addMenuQuote('帮我整理一份插件市场的发布检查清单。');
  await addMenuQuote('发布前建议分成两组核对。');
  assert.equal(await mini.getByRole('button', { name: '查看引用', exact: true }).innerText(), '2 条引用');
  await scrollTo(miniViewport, 0);
  await mini.locator('.message.user').hover();
  await mini.getByRole('button', { name: '编辑并重做', exact: true }).click();
  await editForm.getByRole('button', { name: '发送', exact: true }).click();
  await mini.getByRole('alert').waitFor();
  assert.equal(await mini.getByRole('button', { name: '查看引用', exact: true }).innerText(), '2 条引用',
    'retry editing also protects a reference-only pending draft');
  assert.equal(await editor.evaluate(element => element.value), '');
  await editForm.getByRole('button', { name: '取消', exact: true }).click();
  await mini.getByRole('button', { name: '关闭提示', exact: true }).click();
  await mini.getByRole('button', { name: '清空引用', exact: true }).click();
  assert.equal(await mini.getByRole('button', { name: '查看引用', exact: true }).count(), 0, 'batch clearing removes every quote');
  assert.equal(await main.getByRole('button', { name: '查看引用', exact: true }).count(), 0, 'batch clearing updates both surfaces');

  for (const [index, target] of [mini.locator('.response-text p').first(), mini.locator('.response-text p').last()].entries()) {
    await target.scrollIntoViewIfNeeded();
    await target.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    await selection.getByRole('button', { name: '批注', exact: true }).click();
    await selection.getByRole('textbox', { name: '选段批注', exact: true }).fill(`保留批注 ${index + 1}`);
    await selection.getByRole('button', { name: '添加批注', exact: true }).click();
  }
  await addMenuQuote('帮我整理一份插件市场的发布检查清单。');
  assert.equal(await mini.getByRole('button', { name: '查看批注', exact: true }).innerText(), '2 条批注');
  await mini.getByRole('button', { name: '清空批注', exact: true }).click();
  assert.equal(await mini.getByRole('button', { name: '查看批注', exact: true }).count(), 0, 'batch clearing removes every annotation');
  assert.equal(await mini.getByRole('button', { name: '查看引用', exact: true }).innerText(), '1 条引用', 'clearing annotations preserves ordinary quotes');
  await mini.getByRole('button', { name: '清空引用', exact: true }).click();

  await addMenuQuote('发布前建议分成两组核对。');
  await scrollTo(miniViewport, 3000);
  await mini.getByRole('button', { name: '查看引用', exact: true }).click();
  await page.getByRole('dialog', { name: '引用预览', exact: true }).getByRole('button', { name: '查看引用 1 的原文', exact: true }).click();
  await page.waitForFunction(() => {
    const surface = document.querySelector('[data-surface="mini"]');
    const viewport = surface.querySelector('.conversation').getBoundingClientRect();
    const source = surface.querySelector('[data-message-entry-id="plugin-answer"]').getBoundingClientRect();
    return source.top >= viewport.top - 1 && source.top < viewport.top + 80;
  });
  assert.ok(await scrollTop(miniViewport) < 1000, 'whole Markdown messages navigate by saved entry identity');
  await mini.getByRole('button', { name: '清空引用', exact: true }).click();

  await editor.fill('普通消息');
  await mini.getByRole('button', { name: '添加引用', exact: true }).click();
  await editor.press('ArrowDown');
  await mini.getByRole('listbox', { name: '附件与引用', exact: true }).waitFor();
  assert.equal(await mini.getByRole('option', { selected: true }).isDisabled(), false,
    'returning focus from the add button retains reference keyboard navigation');
  await editor.press('Enter');
  await mini.getByRole('button', { name: '查看引用', exact: true }).waitFor();
  assert.equal(await editor.innerText(), '普通消息', 'reference navigation cannot submit or consume the ordinary draft');
  await mini.getByRole('button', { name: '清空引用', exact: true }).click();

  await editor.fill('/');
  await mini.getByRole('listbox', { name: '操作与指令', exact: true }).waitFor();
  assert.equal(await main.locator('.composer-discovery').count(), 0, 'draft synchronization cannot open the inactive menu');
  const miniMenuId = await mini.locator('.composer-discovery').getAttribute('id');
  assert.equal(await editor.getAttribute('aria-controls'), miniMenuId);
  await mainEditor.focus();
  await mainEditor.press('End');
  await main.getByRole('listbox', { name: '操作与指令', exact: true }).waitFor();
  assert.equal(await mini.locator('.composer-discovery').count(), 0, 'moving focus closes the former editor menu');
  const mainMenuId = await main.locator('.composer-discovery').getAttribute('id');
  assert.notEqual(mainMenuId, miniMenuId, 'each composer has its own menu identity');
  await mainEditor.press('ArrowDown');
  assert.equal(await mainEditor.evaluate(element => {
    const menu = document.getElementById(element.getAttribute('aria-controls'));
    const active = document.getElementById(element.getAttribute('aria-activedescendant'));
    return menu?.closest('[data-surface]')?.dataset.surface === 'main' && menu.contains(active);
  }), true, 'ARIA controls and active descendant point into the owning surface');
  await mainEditor.press('Escape');
  assert.equal(await mainEditor.getAttribute('aria-controls'), null);
  await mainEditor.fill('');

  const noOverflow = async () => {
    const offenders = await page.evaluate(() => [...document.querySelectorAll('.mini-chat-header,.mini-chat-content,.mini-chat-content .composer,.mini-chat-content .composer-tools')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className));
    assert.deepEqual(offenders, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  };
  const focusVisible = async (draft = '第一行\n第二行\n第三行') => {
    await editor.fill(draft);
    await editor.focus();
    const clipped = await editor.evaluate(el => {
      const composer = el.closest('.composer'), box = composer.getBoundingClientRect();
      const offenders = [];
      for (let parent = composer.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX) && (box.left - 4 < bounds.left || box.right + 4 > bounds.right)
          || /(hidden|clip|auto|scroll)/.test(style.overflowY) && (box.top - 4 < bounds.top || box.bottom + 4 > bounds.bottom)) offenders.push(parent.className);
      }
      return offenders;
    });
    assert.deepEqual(clipped, [], 'all four sides of the composer focus ring remain visible');
  };
  for (const [name, width, height, query] of [
    ['desktop-light', 1440, 940, ''],
    ['desktop-dark', 1440, 940, '&theme=dark'],
    ['narrow-light', 760, 800, ''],
    ['mobile-dark', 390, 844, '&theme=dark'],
    ['english-narrow', 440, 780, '&lang=en'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}?open=1${query}`);
    await mini.waitFor();
    await noOverflow();
    // The English editor has the same shared class, but a translated name.
    if (!query.includes('lang=en')) await focusVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${name}.png` });
    await mini.locator('.model-effort-trigger').click();
    await mini.locator('.model-effort-popover').waitFor();
    const frameBounds = await mini.boundingBox();
    const pickerBounds = await mini.locator('.model-effort-popover').boundingBox();
    assert.ok(pickerBounds.x >= frameBounds.x && pickerBounds.x + pickerBounds.width <= frameBounds.x + frameBounds.width,
      `${name}: model picker remains inside the mini window`);
    await page.keyboard.press('Escape');
    await mini.locator('.permission-trigger').click();
    await mini.locator('.permission-menu').waitFor();
    const permissionBounds = await mini.locator('.permission-menu').boundingBox();
    assert.ok(permissionBounds.x >= frameBounds.x && permissionBounds.x + permissionBounds.width <= frameBounds.x + frameBounds.width,
      `${name}: permission picker remains inside the mini window`);
    await page.keyboard.press('Escape');
  }
  for (const [name, width, height, query] of [
    ['short-light', 900, 400, ''],
    ['short-dark', 900, 400, '&theme=dark'],
    ['short-narrow', 390, 400, '&theme=dark'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}?open=1${query}`);
    await mini.waitFor();
    await page.waitForTimeout(300);
    const assertInViewport = async () => {
      const bounds = await mini.boundingBox();
      const action = await mini.locator('.composer-action-button').boundingBox();
      assert.ok(bounds.y >= 80 && bounds.y + bounds.height <= height - 4, `${name}: the entire mini frame remains inside the viewport`);
      assert.ok(action.y >= bounds.y && action.y + action.height <= height - 4, `${name}: Send/Stop remains fully visible`);
      assert.equal(await page.locator('.mini-preview-floating').evaluate(element => element.scrollTop), 0,
        `${name}: editor focus cannot scroll the header out of its clipping frame`);
    };
    await assertInViewport();
    if (!query.includes('lang=en')) await focusVisible();
    await focusVisible(Array.from({ length: 8 }, (_, index) => `多行草稿 ${index + 1}`).join('\n'));
    await addMenuQuote('帮我整理一份插件市场的发布检查清单。');
    await assertInViewport();
    await page.screenshot({ path: `${output}/${name}-draft.png` });
    await mini.getByRole('button', { name: '清空引用', exact: true }).click();
    await editor.fill('短窗口也能发送和停止。');
    await mini.getByRole('button', { name: '发送', exact: true }).click();
    await mini.getByRole('button', { name: '停止此轮', exact: true }).click();
    await assertInViewport();
    await noOverflow();
    await page.screenshot({ path: `${output}/${name}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto(`${url}?open=1`);
  await mini.waitFor();
  const dragBox = await mini.locator('.mini-chat-header').boundingBox();
  await page.mouse.move(dragBox.x + 12, dragBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + 12, dragBox.y + 150, { steps: 5 });
  await page.mouse.up();
  await page.setViewportSize({ width: 900, height: 400 });
  await page.waitForFunction(() => {
    const bounds = document.querySelector('.mini-preview-floating').getBoundingClientRect();
    return bounds.top >= 80 && bounds.bottom <= innerHeight - 4 && bounds.height >= 250;
  });
  assert.ok(await mini.locator('.composer-action-button').isVisible(), 'a dragged window remains usable after shrinking the viewport');
  for (const [name, width, height, query, reducedMotion] of [
    ['bottom-light', 1440, 940, '', 'no-preference'],
    ['bottom-dark-narrow', 390, 844, '&theme=dark', 'reduce'],
    ['bottom-english', 440, 780, '&lang=en', 'reduce'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion });
    await page.goto(`${url}?open=1&stress=reading${query}`);
    await mini.waitFor();
    await scrollTo(miniViewport, 200);
    const control = mini.getByRole('button', { name: query.includes('lang=en') ? 'Scroll to bottom' : '回到底部', exact: true });
    await control.waitFor();
    const context = await mini.locator('.composer-context-bar').boundingBox();
    const bounds = await control.boundingBox();
    assert.ok(bounds.x >= context.x && bounds.x + bounds.width <= context.x + context.width
      && bounds.y >= context.y && bounds.y + bounds.height <= context.y + context.height,
    'return-to-bottom stays inside the existing context action row');
    await noOverflow();
    await page.screenshot({ path: `${output}/${name}.png` });
    await control.focus();
    await page.keyboard.press('Enter');
    await atBottom('mini');
    assert.equal(await control.count(), 0);
    await page.waitForFunction(() => document.querySelector('[data-surface="mini"] .composer-input') === document.activeElement);
  }
  await page.goto(`${url}?open=1&theme=dark`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.mini-preview-floating').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.setViewportSize({ width: 1440, height: 940 });
  const header = mini.locator('.mini-chat-header');
  const box = await header.boundingBox();
  const before = await page.locator('.mini-preview-floating').boundingBox();
  await page.mouse.move(box.x + 12, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x - 110, box.y + 90, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator('.mini-preview-floating').boundingBox();
  assert.notEqual(before.x, after.x, 'preview window can be dragged by its header');
  await noOverflow();
  await mini.getByRole('button', { name: '关闭小窗' }).click();
  await page.waitForFunction(() => document.querySelector('.window-bar [aria-label="MiniChat"]') === document.activeElement);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('MiniChat preview passed: draft-edit protection, atomic quote/annotation clearing, Markdown source location, focused instance-scoped menus, low-height controls, entry placement, draft/reference/reading handoff, independent session scroll and disclosures, close/reopen during streaming, shared return-to-bottom, gesture-aware follow/pause, stop preserves reading, keyboard, menus, pin state, drag, responsive layout, focus gutters and reduced motion.');
} finally {
  await browser?.close();
  await server?.close();
}
