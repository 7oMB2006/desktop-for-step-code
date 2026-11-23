import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { assertFocusVisible } from './assert-focus-visible.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:4197';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  await page.addInitScript(() => {
    const theme = new URLSearchParams(location.search).get('theme');
    localStorage.setItem('dfsc-stellar-preview-preferences-v1', JSON.stringify({ theme, themeMotion: false }));
  });
  const open = fixture => page.goto(`${base}/tests/fixtures/${fixture}`);
  const button = name => page.getByRole('button', { name, exact: true });
  const assertTextFocus = async (field, name, width) => {
    await assertFocusVisible(page, field, name, { focus: false });
    assert.equal(await field.evaluate(element => getComputedStyle(element).outlineWidth), `${width}px`, name);
  };

  for (const [theme, width, height] of [['light', 1280, 820], ['dark', 640, 540], ['stellar', 1280, 820]]) {
    await page.setViewportSize({ width, height });
    const stellar = theme === 'stellar';
    const workspace = `theme-pack.html?theme=${stellar ? 'plugin:stellar-cruise' : `original-${theme}`}&view=`;
    const outlineWidth = 1;
    await open(`${workspace}plan`);
    await button('提出修改').click();
    const plan = page.getByRole('textbox', { name: '修改意见', exact: true });
    await plan.click();
    await assertTextFocus(plan, `${theme} plan (pointer)`, outlineWidth);

    await open(`${workspace}question`);
    await page.getByRole('radio', { name: '其他回答', exact: true }).check();
    const question = page.getByRole('textbox', { name: '你的回答', exact: true });
    await assertTextFocus(question, `${theme} question (autofocus)`, outlineWidth);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await assertTextFocus(question, `${theme} question (Tab)`, outlineWidth);
    if (!stellar) {
      await page.emulateMedia({ forcedColors: 'active' });
      await assertTextFocus(question, `${theme} question (forced colors)`, 2);
      await page.emulateMedia({ forcedColors: 'none' });
    }

    if (theme === 'dark') await page.setViewportSize({ width: 390, height: 360 });
    await open(`${workspace}queue`);
    const queue = page.getByRole('dialog', { name: '待发送消息', exact: true });
    await page.locator('.queue-trigger').click();
    await button('编辑第 1 条').click();
    const edit = queue.getByRole('textbox', { name: '编辑待发送消息', exact: true });
    await assertTextFocus(edit, `${theme} queue (autofocus)`, 1);
    await edit.fill('Updated queued message');
    await button('保存队列编辑').click();
    await queue.locator('.queue-full-text').getByText('Updated queued message').waitFor();

    if (stellar) continue;
    await page.setViewportSize({ width, height });
    await open(`session-import.html?theme=${theme}&lang=en`);
    await button('Source directories').press('Enter');
    for (const source of ['Codex', 'Claude Code']) {
      await page.keyboard.press('Tab');
      await assertTextFocus(page.getByLabel(source, { exact: true }), `${theme} import ${source}`, 1);
    }
  }

  const checkSearch = async (selector, name) => {
    const shell = page.locator(selector);
    const input = shell.locator('input');
    await input.click();
    await input.fill('focus test');
    await shell.locator('button').waitFor();
    await page.waitForFunction(selector => {
      const shell = document.querySelector(selector);
      const style = shell && getComputedStyle(shell);
      return style?.outlineWidth === '1px' && style.outlineColor !== 'rgba(0, 0, 0, 0)' && !shell.getAnimations().length;
    }, selector);
    assert.equal(await input.evaluate(element => getComputedStyle(element).outlineStyle), 'none', `${name}: input does not draw a second ring`);
    await page.keyboard.press('Tab');
    assert.equal(await shell.evaluate(element => getComputedStyle(element).outlineColor), 'rgba(0, 0, 0, 0)', `${name}: shell does not light when clear has focus`);
    await assertFocusVisible(page, shell.locator('button'), `${name} clear button`, { focus: false });
    await page.keyboard.press('Enter');
    assert.equal(await input.inputValue(), '', `${name}: keyboard clear still works`);
  };

  await open('capability-settings.html?preview=skill-detail&theme=light&lang=en');
  await checkSearch('.skills-preview-search', 'Skills');
  await page.setViewportSize({ width: 1280, height: 820 });
  await open('theme-pack.html?theme=original-dark&view=chat');
  await button('设置').click();
  await checkSearch('.settings-search', 'Settings');
  await page.locator('.settings-dialog > header .icon-button').last().click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  await page.locator('.model-effort-trigger').click();
  await button('选择模型').click();
  await checkSearch('.model-picker-search', 'Model picker');
  await page.keyboard.press('Escape');
  await button('搜索').click();
  await button('搜索聊天记录').click();
  await checkSearch('.fulltext-input', 'Chat history');

  await open('mini-chat.html');
  await button('MiniChat').click();
  await button('切换小窗会话').click();
  await checkSearch('.mini-session-search', 'MiniChat');
  console.log('Form focus passed: Plan, Question, queue, import sources, and five search surfaces.');
} finally {
  await browser.close();
}
