import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { verifyTooltipLayer } from './tooltip-layer-probe.mjs';
import { settleLayout } from './settle-layout.mjs';

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

  const switcher = mini.getByRole('button', { name: '切换小窗会话', exact: true });
  const conversations = page.getByRole('dialog', { name: '小窗会话', exact: true });
  const pickerSearch = conversations.getByRole('searchbox', { name: '搜索小窗会话', exact: true });
  const projectGroup = id => conversations.locator(`[data-project-id="${id}"]`);
  const sidebarState = () => page.locator('.mini-preview-sidebar [data-preview-project]').evaluateAll(groups =>
    groups.map(group => [group.dataset.previewProject, group.querySelector('button').getAttribute('aria-expanded')]));
  const openTooltipPicker = async () => {
    await switcher.click();
    await pickerSearch.waitFor();
    await settleLayout(conversations);
    assert.equal(await pickerSearch.evaluate(element => element === document.activeElement), true);
  };
  const showTooltip = async (anchor, keyboard = false) => {
    if (!keyboard) await anchor.scrollIntoViewIfNeeded();
    await settleLayout(conversations);
    if (keyboard) await anchor.focus();
    else { await page.mouse.move(0, 0); await anchor.hover(); }
    await page.locator('.app-tooltip').waitFor();
  };
  for (const [theme, width, height, keyboard] of [['light', 1440, 940, false], ['dark', 390, 844, true], ['light', 900, 400, true]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${url}?open=1&theme=${theme}`);
    await openTooltipPicker();
    const plus = projectGroup('desktop').getByRole('button', { name: '在 Desktop For Step Code 新建会话', exact: true });
    await showTooltip(plus, keyboard);
    await verifyTooltipLayer(page, conversations);
    assert.equal(await pickerSearch.evaluate(element => element === document.activeElement), !keyboard,
      'Showing a tooltip cannot steal focus from its trigger or search field');
    await page.screenshot({ path: `${output}/picker-tooltip-${theme}-${width}.png` });
    await pickerSearch.fill('web-app');
    const longPlus = projectGroup('web-client').getByRole('button', { name: '在 D:\\Clients\\web-app 新建会话', exact: true });
    await showTooltip(longPlus, keyboard);
    await verifyTooltipLayer(page, conversations);
    await page.screenshot({ path: `${output}/picker-tooltip-path-${theme}-${width}.png` });
    await conversations.evaluate(element => element.hidePopover());
    await page.locator('.app-tooltip').waitFor({ state: 'detached' });
    await conversations.waitFor({ state: 'hidden' });
    await openTooltipPicker();
    await pickerSearch.fill('web-app');
    await showTooltip(longPlus);
    await pickerSearch.fill('nothing-matches-this');
    await page.locator('.app-tooltip').waitFor({ state: 'detached' });
    await pickerSearch.fill('web-app');
    await showTooltip(longPlus);
    await page.keyboard.press('Escape');
    await page.locator('.app-tooltip').waitFor({ state: 'detached' });
    await conversations.waitFor({ state: 'hidden' });
    await openTooltipPicker();
    await pickerSearch.fill('web-app');
    await showTooltip(longPlus);
    await longPlus.click();
    await conversations.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.app-tooltip').count(), 0, 'Tooltip cannot intercept the new-session click');
    assert.match(await mini.locator('.mini-preview-empty').innerText(), /web-app/);
    await switcher.click();
    await pickerSearch.waitFor();
    assert.equal(await conversations.locator('.mini-session-group').first().getAttribute('data-project-id'), 'web-client');
    await pickerSearch.press('Escape');
  }
  await openTooltipPicker();
  const removedAnchor = projectGroup('web-client').getByRole('button');
  await showTooltip(removedAnchor);
  await removedAnchor.evaluate(element => element.remove());
  await page.locator('.app-tooltip').waitFor({ state: 'detached' });
  for (const [name, width, height, theme, reducedMotion, keyboard] of [
    ['mouse-light', 1440, 940, 'light', 'no-preference', false],
    ['keyboard-dark', 1440, 940, 'dark', 'no-preference', true],
    ['mouse-narrow', 390, 844, 'dark', 'reduce', false],
    ['keyboard-short', 900, 400, 'light', 'reduce', true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion });
    await page.goto(`${url}?open=1&stress=turns&theme=${theme}`);
    await switcher.click();
    await pickerSearch.waitFor();
    const desktopSummary = projectGroup('desktop').locator('summary');
    if (keyboard) { await desktopSummary.focus(); await page.keyboard.press('Enter'); }
    else await desktopSummary.locator('.mini-session-chevron').click();
    await page.waitForFunction(() => document.querySelector('.mini-session-group[data-project-id="desktop"] details')?.open === false);
    assert.equal(await switcher.getAttribute('aria-expanded'), 'true', `${name}: collapsing the current project keeps the picker open`);
    assert.equal(await conversations.isVisible(), true);
    const otherSummary = projectGroup('xiucore').locator('summary');
    if (keyboard) { await otherSummary.focus(); await page.keyboard.press('Space'); }
    else await otherSummary.click();
    await projectGroup('xiucore').getByRole('option', { name: '配置检查', exact: true }).waitFor();
    if (keyboard) await page.keyboard.press('Enter'); else await otherSummary.click();
    await page.waitForFunction(() => document.querySelector('.mini-session-group[data-project-id="xiucore"] details')?.open === false);
    assert.equal(await switcher.getAttribute('aria-expanded'), 'true', `${name}: collapsing another project keeps the picker open`);
    if (keyboard) await page.keyboard.press('Space'); else await otherSummary.click();
    const target = projectGroup('xiucore').getByRole('option', { name: '配置检查', exact: true });
    await target.waitFor();
    await page.screenshot({ path: `${output}/picker-collapse-${name}.png` });
    if (keyboard) { await target.focus(); await page.keyboard.press('Enter'); } else await target.click();
    await conversations.waitFor({ state: 'hidden' });
    assert.equal(await mini.locator('.mini-chat-session-copy strong').innerText(), '配置检查');
    assert.match(await mini.locator('.mini-chat-project').innerText(), /XiuCore/);
    assert.match(await page.locator('.window-session-title').innerText(), /插件市场/);
  }
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`${url}?open=1`);
  await editor.waitFor();
  const mainProjects = await sidebarState();
  await switcher.click();
  await pickerSearch.waitFor();
  assert.equal(await pickerSearch.evaluate(element => element === document.activeElement), true);
  assert.equal(await switcher.getAttribute('aria-controls'), await conversations.getAttribute('id'));
  assert.equal(await conversations.locator('.mini-session-group').count(), 5);
  assert.equal(await projectGroup('desktop').locator('summary').getAttribute('aria-expanded'), 'true');
  assert.equal(await projectGroup('xiucore').locator('summary').getAttribute('aria-expanded'), 'false');
  assert.equal(await projectGroup('desktop').locator('.mini-session-count').innerText(), '13');
  assert.equal(await projectGroup('web-local').locator('small').first().innerText(), 'C:\\Projects\\web-app');
  assert.equal(await projectGroup('web-client').locator('small').first().innerText(), 'D:\\Clients\\web-app');
  const groupScroll = conversations.locator('.mini-session-groups');
  assert.ok(await groupScroll.evaluate(element => element.scrollHeight > element.clientHeight), 'long lists scroll inside the picker');
  await groupScroll.hover();
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.querySelector('.mini-session-groups').scrollTop > 100);
  await projectGroup('xiucore').locator('summary').click();
  await pickerSearch.fill('配置检查');
  assert.equal(await conversations.getByRole('option').count(), 3, 'search crosses collapsed projects without merging duplicate titles');
  assert.deepEqual(await conversations.locator('summary').evaluateAll(items => items.map(item => item.getAttribute('aria-expanded'))),
    ['true', 'true', 'true']);
  await pickerSearch.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  assert.equal(await switcher.getAttribute('aria-expanded'), 'true', 'IME confirmation cannot select a conversation');
  await page.screenshot({ path: `${output}/picker-search-duplicates-light.png` });
  await conversations.getByRole('button', { name: '清除搜索', exact: true }).click();
  assert.equal(await projectGroup('xiucore').locator('summary').getAttribute('aria-expanded'), 'true',
    'clearing search restores manual disclosure choices');
  assert.equal(await projectGroup('web-local').locator('summary').getAttribute('aria-expanded'), 'false');
  await pickerSearch.fill('nothing-matches-this');
  await conversations.getByRole('status').getByText('没有匹配的会话', { exact: true }).waitFor();
  await pickerSearch.press('Enter');
  assert.equal(await switcher.getAttribute('aria-expanded'), 'true', 'empty results cannot navigate');
  await pickerSearch.fill('配置检查');
  await pickerSearch.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('data-mini-session'), 'xiu-config');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('data-mini-session'), 'web-config');
  await page.keyboard.press('End');
  assert.equal(await page.locator(':focus').getAttribute('data-mini-session'), 'client-config');
  await page.keyboard.press('Enter');
  await conversations.waitFor({ state: 'hidden' });
  await switcher.click();
  await pickerSearch.waitFor();
  assert.equal(await conversations.locator('.mini-session-group').first().getAttribute('data-project-id'), 'web-client');
  assert.equal(await conversations.getByRole('option', { selected: true }).getAttribute('data-mini-session'), 'client-config');
  assert.equal(await pickerSearch.inputValue(), '', 'reopening starts with a fresh search');
  await pickerSearch.fill('XiuCore');
  await projectGroup('xiucore').getByRole('button', { name: '在 XiuCore 新建会话', exact: true }).click();
  await mini.getByRole('heading', { name: '新会话', exact: true }).waitFor();
  assert.match(await mini.locator('.mini-preview-empty').innerText(), /XiuCore/);
  await editor.fill('切换草稿目录仍然保留输入。');
  await switcher.click();
  await pickerSearch.fill('独立会话');
  await projectGroup('__independent__').getByRole('button', { name: '新建独立会话', exact: true }).click();
  await mini.getByRole('heading', { name: '新会话', exact: true }).waitFor();
  assert.match(await mini.locator('.mini-preview-empty').innerText(), /独立会话/);
  assert.equal(await editor.innerText(), '切换草稿目录仍然保留输入。');
  assert.match(await page.locator('.window-session-title').innerText(), /插件市场/);
  assert.deepEqual(await sidebarState(), mainProjects, 'search, disclosures, navigation and project drafts do not change main sidebar state');
  await switcher.click();
  await pickerSearch.waitFor();
  await pickerSearch.press('Escape');
  await page.waitForFunction(() => document.activeElement?.matches('.mini-chat-session'));
  await switcher.click();
  await pickerSearch.waitFor();
  await mini.getByRole('button', { name: '取消置顶', exact: true }).click();
  await conversations.waitFor({ state: 'hidden' });
  assert.equal(await mini.getByRole('button', { name: '置顶窗口', exact: true }).evaluate(element => element === document.activeElement), true,
    'outside dismissal does not steal the next control focus');
  await page.locator('.mini-session-picker').waitFor({ state: 'hidden' });
  await page.goto(`${url}?open=1`);
  await editor.waitFor();

  await editor.fill('保留这个草稿，不要发送。');
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await conversations.getByRole('option', { name: '搜索命中定位', exact: true }).click();
  assert.equal(await editor.textContent(), '');
  assert.match(await mini.innerText(), /会话、消息、文字片段/);
  assert.match(await page.locator('.window-session-title').innerText(), /插件市场/);
  await mini.getByRole('button', { name: '切换小窗会话' }).click();
  await conversations.getByRole('option', { name: '插件市场发布检查', exact: true }).click();
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
  await conversations.getByRole('option', { name: '新会话', exact: true }).click();
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
    await conversations.getByRole('option', { name: title, exact: true }).click();
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
  await editor.fill('最小化后保留的草稿。');
  const minimizedEditor = await editor.elementHandle();
  const miniMinimize = mini.getByRole('button', { name: '最小化', exact: true });
  assert.equal(await miniMinimize.getAttribute('data-tooltip'), '最小化');
  assert.equal(await miniMinimize.evaluate(element => getComputedStyle(element.closest('.mini-chat-window-actions')).webkitAppRegion), 'no-drag');
  await miniMinimize.focus();
  await miniMinimize.press('Enter');
  await mini.waitFor({ state: 'hidden' });
  assert.equal(await entry.getAttribute('aria-pressed'), 'true', 'Minimize retains the open window');
  await entry.click();
  await editor.waitFor();
  assert.equal(await editor.evaluate((element, previous) => element === previous, minimizedEditor), true,
    'Restoring does not remount the editor');
  await minimizedEditor.dispose();
  assert.equal(await editor.innerText(), '最小化后保留的草稿。');
  assert.ok(Math.abs(await scrollTop(miniViewport) - readingTop) <= 2, 'minimize/restore preserves reading position');
  assert.equal(await thought.getAttribute('data-expanded'), 'true');
  assert.equal(await tool.getAttribute('data-expanded'), 'true');
  await editor.fill('');
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
  await mini.getByRole('button', { name: '最小化', exact: true }).click();
  await mini.waitFor({ state: 'hidden' });
  await main.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  await entry.click();
  await mini.getByRole('button', { name: '停止此轮', exact: true }).waitFor();
  assert.ok(Math.abs(await scrollTop(miniViewport) - 200) <= 2, 'minimize/restore during streaming keeps reading position');
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
  await editor.press('ControlOrMeta+A');
  await editor.press('Backspace');
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
    const minimizeControl = mini.getByRole('button', { name: query.includes('lang=en') ? 'Minimize' : '最小化', exact: true });
    assert.equal(await minimizeControl.getAttribute('data-tooltip'), query.includes('lang=en') ? 'Minimize' : '最小化');
    const [minimizeBox, closeBox] = await Promise.all([
      minimizeControl.boundingBox(), mini.locator('.mini-chat-close').boundingBox(),
    ]);
    assert.ok(minimizeBox.x + minimizeBox.width <= closeBox.x, `${name}: Minimize sits immediately before Close`);
    const [headerBox, sessionBox] = await Promise.all([
      mini.locator('.mini-chat-header').boundingBox(), mini.locator('.mini-chat-session').boundingBox(),
    ]);
    assert.ok(sessionBox.width <= 360 && sessionBox.width <= headerBox.width * .6,
      `${name}: conversation switching has a bounded hit target`);
    const projectLabel = mini.locator('.mini-chat-project > span:first-child > span');
    const projectName = await projectLabel.innerText();
    await projectLabel.evaluate(element => {
      element.textContent = 'a-very-long-project-name-that-must-not-expand-the-conversation-switcher';
    });
    await noOverflow();
    await projectLabel.evaluate((element, text) => { element.textContent = text; }, projectName);
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
    const english = query.includes('lang=en');
    await mini.getByRole('button', { name: english ? 'Switch MiniChat conversation' : '切换小窗会话', exact: true }).click();
    const sessionPicker = page.getByRole('dialog', { name: english ? 'MiniChat conversations' : '小窗会话', exact: true });
    await sessionPicker.waitFor();
    const sessionBounds = await sessionPicker.boundingBox();
    assert.ok(sessionBounds.x >= 8 && sessionBounds.x + sessionBounds.width <= width - 8
      && sessionBounds.y >= 8 && sessionBounds.y + sessionBounds.height <= height - 8, `${name}: grouped picker remains within the viewport`);
    assert.equal(await sessionPicker.locator('.mini-session-search').evaluate(element => {
      const box = element.getBoundingClientRect(), outer = element.closest('.mini-session-picker').getBoundingClientRect();
      return box.left - 4 >= outer.left && box.right + 4 <= outer.right && box.top - 4 >= outer.top && box.bottom + 4 <= outer.bottom;
    }), true, `${name}: complete search focus outline stays visible`);
    await sessionPicker.getByRole('searchbox').fill(english ? 'Configuration' : '配置检查');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/picker-${name}.png` });
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
    await switcher.click();
    await pickerSearch.waitFor();
    const shortPicker = await conversations.boundingBox();
    assert.ok(shortPicker.y >= 8 && shortPicker.y + shortPicker.height <= height - 8,
      `${name}: project picker stays reachable in low-height windows`);
    await page.keyboard.press('Escape');
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
  console.log('MiniChat preview passed: minimize/restore retains mounted editor, draft, reading, disclosures and streaming; localized Minimize placement; current/other-project collapse remains open for mouse/keyboard and cross-project selection, grouped project/session search, same-name path disambiguation, independent drafts, main-sidebar isolation, keyboard/IME/outside dismissal, bounded picker/focus gutters, draft-edit protection, atomic quote/annotation clearing, Markdown source location, focused instance-scoped menus, low-height controls, entry placement, draft/reference/reading handoff, independent session scroll and disclosures, close/reopen during streaming, shared return-to-bottom, gesture-aware follow/pause, stop preserves reading, keyboard, menus, pin state, drag, responsive layout, focus gutters and reduced motion.');
} catch (error) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
