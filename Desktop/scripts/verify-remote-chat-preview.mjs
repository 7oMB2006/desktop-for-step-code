import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = resolve('test-results/remote-chat-preview');
await mkdir(output, { recursive: true });
let server, browser;
try {
  server = await createServer({ root: resolve('.'), cacheDir: join(output, 'vite-cache'),
    server: { host: '127.0.0.1', port: 0, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) external.push(request.url());
  });
  page.setDefaultTimeout(12000);
  const base = server.resolvedUrls.local[0];
  const button = name => page.getByRole('button', { name, exact: true });
  const input = page.getByRole('textbox', { name: '发送给飞书机器人的模拟消息' });
  const send = async text => { await input.fill(text); await button('发送消息').click(); };
  const choose = async name => {
    await button('选择演示场景').click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
  };
  const screenshot = async name => page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
  const checkOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(await page.locator('.fc-card,.fc-composer,.fc-preview-bar,.fc-chat-header').evaluateAll(elements =>
      elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), []);
  };
  await page.goto(`${base}tests/fixtures/remote-chat.html`);
  await page.getByRole('heading', { name: 'Desktop for Step Code 应用' }).waitFor();
  assert.equal(await page.locator('.fc-card > header').count(), 0);
  await screenshot('01-idle-dark');
  await button('播放一轮').click();
  await page.getByRole('status', { name: '正在处理这条消息', exact: true }).waitFor();
  await page.locator('.fc-card[data-reply=working]').waitFor();
  await button('暂停').click();
  const count = await page.locator('[data-testid=bot-card]').count();
  await screenshot('02-processing-dark');
  await button('立即完成当前回复').click();
  await page.getByRole('status', { name: '正在处理这条消息', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-testid=bot-card]').count(), count, 'Completion updates, not appends, the reply');
  assert.equal(await page.locator('.fc-card > header').count(), 0);
  assert.ok(await page.locator('.fc-card-body strong').count() > 0);
  assert.equal(await button('停止').count(), 0);
  await screenshot('03-completed-dark');
  await checkOverflow();
  await button('旧版对照').click();
  assert.match(await page.locator('.fc-transcript').innerText(), /Completed \/ 已完成/);
  await screenshot('04-old-comparison');
  await button('新版').click();
  await send('/help');
  assert.match(await page.locator('.fc-transcript').innerText(), /\/sessions/);
  await send('/session');
  assert.match(await page.locator('.fc-transcript').innerText(), /s2 · 发布准备/);
  await button('重置演示').click();
  await choose('工具审批');
  await button('播放一轮').click();
  await button('允许一次').waitFor();
  assert.equal(await button('立即完成当前回复').isDisabled(), true);
  await screenshot('05-approval-dark');
  await button('允许一次').click();
  assert.equal(await button('已允许一次').isDisabled(), true);
  await button('立即完成当前回复').click();
  await button('重置演示').click();
  await choose('中途停止');
  await button('播放一轮').click();
  await page.locator('.fc-card[data-reply=working]').waitFor();
  await page.waitForFunction(() => document.querySelector('.fc-card[data-reply=working] .fc-card-body')?.textContent?.includes('这几个'));
  await send('/stop s1');
  await page.locator('.fc-card[data-reply=interrupted]').waitFor();
  await screenshot('06-interrupted-dark');
  await button('重置演示').click();
  await choose('验证码匹配');
  await button('播放一轮').click();
  await page.getByRole('status', { name: '验证码已匹配，等待本机确认', exact: true }).waitFor();
  await button('模拟本机确认').waitFor();
  await screenshot('07-pairing-dark');
  await button('模拟本机确认').click();
  assert.match(await page.locator('.fc-transcript').innerText(), /已授权当前私聊/);
  for (const theme of ['light', 'dark']) {
    await page.goto(`${base}tests/fixtures/remote-chat.html?theme=${theme}`);
    await button('播放一轮').click();
    await page.locator('.fc-card[data-reply=working]').waitFor();
    await button('立即完成当前回复').click();
    await page.locator('.fc-card-body pre').waitFor();
    for (const width of [1440, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await checkOverflow();
      await input.focus();
      const issues = await input.evaluate(element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        const gutter = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
        const issues = [];
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const clip = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
          if (/(hidden|clip|scroll|auto)/.test(clip.overflowX) && (box.left - gutter < bounds.left || box.right + gutter > bounds.right)) issues.push('x');
          if (/(hidden|clip|scroll|auto)/.test(clip.overflowY) && (box.top - gutter < bounds.top || box.bottom + gutter > bounds.bottom)) issues.push('y');
        }
        return issues;
      });
      assert.deepEqual(issues, []);
      await screenshot(`08-${theme}-${width}`);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button('播放一轮').click();
  await page.getByRole('status', { name: '正在处理这条消息', exact: true }).waitFor();
  assert.equal(await page.locator('.fc-typing i').first().evaluate(element => getComputedStyle(element).animationName), 'none');
  await button('选择演示场景').click();
  await page.keyboard.press('Escape');
  assert.equal(await button('选择演示场景').evaluate(element => element === document.activeElement), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('Remote chat simulation passed: shared outgoing cards, reactions, same-card streaming/completion, comparison, slash commands, approvals, pairing, interruption, focus, 320–1440px light/dark and reduced motion; no external requests.');
} finally {
  await browser?.close();
  await server?.close();
}
