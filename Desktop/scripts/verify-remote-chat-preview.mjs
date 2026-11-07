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
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || url.href.startsWith('data:image/png;base64,')) return route.continue();
    external.push(url.href);
    return route.abort();
  });
  page.setDefaultTimeout(12000);
  const base = server.resolvedUrls.local[0];
  const button = name => page.getByRole('button', { name, exact: true });
  const input = page.getByRole('textbox', { name: '发送给飞书机器人的模拟消息' });
  const ready = () => page.locator('.fc-preview[data-ready=true]').waitFor();
  const state = expected => page.waitForFunction(expected => Object.entries(expected).every(([key, value]) =>
    document.querySelector('.fc-preview')?.dataset[key] === String(value)), expected);
  const send = async text => { await input.fill(text); await button('发送消息').click(); };
  const choose = async name => {
    await button('选择演示场景').click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    await ready();
  };
  const reset = async () => { await button('重置演示').click(); await ready(); };
  const screenshot = async name => {
    await page.locator('.fc-message').evaluateAll(elements =>
      Promise.all(elements.flatMap(element => element.getAnimations().map(animation => animation.finished.catch(() => {})))));
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
  };
  const checkOverflow = async () => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(await page.locator('.fc-card,.fc-composer,.fc-preview-bar,.fc-chat-header,.fc-image').evaluateAll(elements =>
      elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)), []);
  };
  await page.goto(`${base}tests/fixtures/remote-chat.html`);
  await page.getByRole('heading', { name: 'Desktop for Step Code 应用' }).waitFor();
  await ready();
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
  let tree = page.locator('[data-testid=bot-card]').last();
  assert.match(await tree.innerText(), /p1 · Desktop for Step Code \(2\)\n  ├─ s1 · 远程访问 ← 当前 \/ Current\n  └─ s2 · 发布准备/);
  assert.match(await tree.innerText(), /p2 · 文档站 \(2\)/);
  assert.match(await tree.innerText(), /p3 · 插件实验室 \(1\)/);
  await send('/session s3');
  await send('/sessions');
  tree = page.locator('[data-testid=bot-card]').last();
  assert.match(await tree.innerText(), /s3 · 安装与升级说明 ← 当前 \/ Current/);
  assert.doesNotMatch(await tree.innerText(), /s1 · 远程访问 ←/);
  await send('/new p2');
  await state({ session: 's6' });
  assert.match(await page.locator('.fc-chat-header').innerText(), /s6 · 新会话/);
  await send('新会话的第一条消息');
  await page.locator('.fc-card[data-reply=working]').waitFor();
  assert.match(await page.locator('.fc-card[data-reply=working] footer').innerText(), /s6 · 新会话/);
  await button('立即完成当前回复').click();
  await send('/sessions');
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /p2 · 文档站 \(3\)[\s\S]*s6 · 新会话 ← 当前 \/ Current/);
  assert.equal(await page.getByRole('status', { name: '正在处理这条消息', exact: true }).count(), 0);
  await send('/sessions p4');
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /p4 · 空白项目 \(0\)[\s\S]*\/new p4/);
  await send('/new p4');
  await state({ session: 's7' });
  for (let index = 0; index < 10; index++) await send('/new p2');
  await send('/sessions p2');
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /\/sessions p2 2/);
  await send('/sessions p2 2');
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /s17 · 新会话 ← 当前 \/ Current/);
  await reset();
  await send('/new p2');
  await state({ session: 's6' });
  assert.match(await page.locator('.fc-chat-header').innerText(), /s6 · 新会话/);
  await send('没有先列出会话时也保持句柄一致');
  await page.locator('.fc-card[data-reply=working]').waitFor();
  assert.match(await page.locator('.fc-card[data-reply=working] footer').innerText(), /s6 · 新会话/);
  await button('立即完成当前回复').click();
  await reset();
  await send('A-session-one');
  await send('/session s2');
  await send('/stop');
  await state({ running: 1, session: 's2' });
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /No matching task/);
  await send('B-session-two');
  await state({ running: 2, queued: 0 });
  await send('/status s2');
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /Running/);
  await send('/stop');
  await state({ running: 1 });
  await send('/session s1');
  await button('立即完成当前回复').click();
  await state({ running: 0 });
  await reset();
  await send('FIFO-A');
  await send('FIFO-B');
  await state({ running: 1, queued: 1 });
  await button('暂停').click();
  await button('立即完成当前回复').click();
  await state({ running: 1, queued: 0 });
  await send('FIFO-C');
  await state({ running: 1, queued: 1 });
  const bubble = text => page.locator('.fc-message').filter({ has: page.locator('.fc-bubble', { hasText: text }) });
  assert.equal(await bubble('FIFO-A').getByRole('status').count(), 0);
  assert.equal(await bubble('FIFO-B').getByRole('status').count(), 1);
  assert.equal(await bubble('FIFO-C').getByRole('status').count(), 1);
  await button('立即完成当前回复').click();
  await state({ running: 1, queued: 0 });
  assert.equal(await bubble('FIFO-B').getByRole('status').count(), 0);
  assert.equal(await bubble('FIFO-C').getByRole('status').count(), 1);
  await button('立即完成当前回复').click();
  await state({ running: 0 });
  await reset();
  await choose('工具审批');
  await button('播放一轮').click();
  await button('允许一次').waitFor();
  assert.equal(await button('立即完成当前回复').isDisabled(), true);
  await screenshot('05-approval-dark');
  await button('允许一次').click();
  await page.locator('.fc-card[data-status=handled]').waitFor();
  assert.equal(await page.locator('.fc-card[data-status=handled] button').count(), 0);
  assert.match(await page.locator('.fc-card[data-status=handled]').innerText(), /Handled \/ 已处理/);
  await button('立即完成当前回复').click();
  await reset();
  await choose('工具审批');
  await button('播放一轮').click();
  const pendingApproval = page.locator('.fc-card[data-approval=pending]');
  await pendingApproval.waitFor();
  const oldApprovalId = await pendingApproval.evaluate(element => element.closest('[data-message-id]').dataset.messageId);
  const oldApproval = page.locator(`[data-message-id="${oldApprovalId}"]`);
  await send('审批时不应接收第二条任务');
  await state({ queued: 0 });
  assert.equal(await page.getByRole('status', { name: '正在处理这条消息', exact: true }).count(), 1);
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /Not accepted/);
  await send('/stop s1');
  await state({ running: 0 });
  assert.equal(await oldApproval.getByRole('button', { name: '允许一次', exact: true }).count(), 0);
  await send('/session s2');
  await send('replacement approval');
  await pendingApproval.waitFor();
  assert.equal(await oldApproval.getByRole('button', { name: '允许一次', exact: true }).count(), 0);
  await pendingApproval.getByRole('button', { name: '允许一次', exact: true }).click();
  await button('立即完成当前回复').click();
  await reset();
  await choose('工具审批');
  await button('播放一轮').click();
  await pendingApproval.waitFor();
  await send('/disconnect');
  await state({ connected: false });
  assert.equal(await page.locator('.fc-card[data-approval=pending]').count(), 0);
  assert.equal(await page.getByRole('status', { name: '正在处理这条消息', exact: true }).count(), 0);
  const disconnectedCards = await page.locator('[data-testid=bot-card]').allTextContents();
  await send('/new p2');
  await send('/session');
  await send('/stop');
  assert.deepEqual(await page.locator('[data-testid=bot-card]').allTextContents(), disconnectedCards);
  await reset();
  await choose('中途停止');
  await button('播放一轮').click();
  await page.locator('.fc-card[data-reply=working]').waitFor();
  await page.waitForFunction(() => document.querySelector('.fc-card[data-reply=working] .fc-card-body')?.textContent?.includes('这几个'));
  await send('/stop s1');
  await page.locator('.fc-card[data-reply=interrupted]').waitFor();
  await screenshot('06-interrupted-dark');
  await reset();
  await choose('验证码匹配');
  await send('/session');
  await send('/new p2');
  assert.equal(await page.locator('[data-testid=bot-card]').count(), 0);
  await button('播放一轮').click();
  await page.getByRole('status', { name: '验证码已匹配，等待本机确认', exact: true }).waitFor();
  await button('模拟本机确认').waitFor();
  await screenshot('07-pairing-dark');
  await send('/session');
  assert.equal(await page.locator('[data-testid=bot-card]').count(), 0);
  await button('模拟本机确认').click();
  await state({ connected: true });
  assert.match(await page.locator('.fc-transcript').innerText(), /已授权 4 个项目/);
  await send('配对完成后继续聊天');
  await page.getByRole('status', { name: '正在处理这条消息', exact: true }).waitFor();
  await page.locator('.fc-card[data-reply=working]').waitFor();
  await button('立即完成当前回复').click();
  await state({ running: 0 });
  const pairedReply = page.locator('.fc-card[data-reply=completed]').last();
  assert.match(await pairedReply.innerText(), /这几个边界已经整理好了/);
  assert.match(await pairedReply.locator('footer').innerText(), /s1 · 远程访问/);
  assert.equal(await page.getByRole('status', { name: '正在处理这条消息', exact: true }).count(), 0);
  await reset();
  await choose('无文字结果');
  await button('播放一轮').click();
  await page.locator('.fc-card[data-reply=working]').waitFor();
  await button('立即完成当前回复').click();
  assert.match(await page.locator('.fc-card[data-reply=completed]').last().innerText(), /本轮没有文字回复/);
  await reset();
  await choose('任务与撤回');
  await send('/tasks');
  const overview = page.locator('.fc-card[data-overview=true]').last();
  await overview.waitFor();
  assert.match(await overview.innerText(), /会话总览[\s\S]*当前输入[\s\S]*暂无进行中的任务/);
  assert.doesNotMatch(await overview.innerText(), /Remote Beta|Running sessions|\/status|\(0\)/);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await screenshot(`10-overview-empty-${theme}`);
    await overview.screenshot({ path: join(output, `10-overview-empty-card-${theme}.png`) });
  }
  await button('播放一轮').click();
  await state({ running: 2, queued: 1, session: 's2' });
  await button('暂停').click();
  assert.match(await overview.innerText(),
    /会话总览 · 2[\s\S]*需要你处理 · 1[\s\S]*s2 · 发布准备[\s\S]*待审批[\s\S]*正在进行 · 1[\s\S]*s1 · 远程访问[\s\S]*运行中 · 排队 1/);
  assert.doesNotMatch(await overview.innerText(), /Remote Beta|Approval|Queue:|Running sessions/);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await overview.scrollIntoViewIfNeeded();
      await checkOverflow();
      await screenshot(`10-overview-active-${theme}-${width}`);
      if (width === 1440) await overview.screenshot({ path: join(output, `10-overview-active-card-${theme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await bubble('补充核对队列').getByRole('button', { name: '撤回这条模拟消息', exact: true }).click();
  await state({ running: 2, queued: 0 });
  assert.match(await bubble('补充核对队列').innerText(), /已撤回/);
  await bubble('检查会话路由').getByRole('button', { name: '撤回这条模拟消息', exact: true }).click();
  await state({ running: 2, queued: 0 });
  assert.match(await page.locator('[data-testid=bot-card]').last().innerText(), /no task was stopped/);
  await page.getByTestId('tool-progress').first().waitFor();
  assert.match(await page.getByTestId('tool-progress').first().innerText(), /Active: 1.*read/);
  assert.doesNotMatch(await page.locator('.fc-transcript').innerText(), /SIMULATED_PRIVATE_TOOL_/);
  await screenshot('10-tasks-recall-progress');
  await checkOverflow();
  await reset();
  await choose('图片收发');
  const imagePermission = page.getByRole('checkbox', { name: '允许模拟图片收发', exact: true });
  assert.equal(await imagePermission.isChecked(), false);
  await button('播放一轮').click();
  await page.locator('.fc-transcript').getByText(/Images are not authorized/).waitFor();
  await state({ running: 0, imagesAllowed: false });
  assert.equal(await page.locator('.fc-bot [data-testid=simulated-image]').count(), 0);
  await imagePermission.check();
  await button('播放一轮').click();
  await page.locator('.fc-bot [data-testid=simulated-image]').waitFor();
  await button('暂停').click();
  await state({ running: 1, imagesAllowed: true });
  assert.equal(await page.locator('.fc-bot [data-testid=simulated-image]').count(), 1);
  assert.match(await page.locator('.fc-bot [data-testid=simulated-image]').innerText(), /模拟图片.*s1/);
  assert.equal(await page.locator('[data-testid=simulated-image] img').evaluateAll(async images => {
    await Promise.all(images.map(image => image.decode()));
    return images.every(image => image.complete && image.naturalWidth === 1 && image.naturalHeight === 1
      && image.src.startsWith('data:image/png;base64,'));
  }), true);
  await screenshot('11-images-opt-in-simulation');
  await checkOverflow();
  await button('立即完成当前回复').click();
  await imagePermission.uncheck();
  await button('发送模拟图片').click();
  await state({ running: 0, imagesAllowed: false });
  assert.equal(await page.locator('.fc-bot [data-testid=simulated-image]').count(), 1);
  for (const theme of ['light', 'dark']) {
    await page.goto(`${base}tests/fixtures/remote-chat.html?theme=${theme}`);
    await ready();
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
    await page.goto(`${base}tests/fixtures/remote-chat.html?theme=${theme}&scene=sessions`);
    await page.locator('[data-testid=bot-card]').last().getByText(/p3 · 插件实验室/).waitFor();
    for (const width of [1440, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await checkOverflow();
      await screenshot(`09-project-tree-${theme}-${width}`);
    }
    await page.goto(`${base}tests/fixtures/remote-chat.html?theme=${theme}&scene=images`);
    await ready();
    await imagePermission.check();
    await button('播放一轮').click();
    await page.locator('.fc-bot [data-testid=simulated-image]').waitFor();
    await button('暂停').click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await imagePermission.focus();
      await checkOverflow();
      assert.equal(await imagePermission.evaluate(element => {
        const box = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
        return box.left - 4 >= parent.left && box.top - 4 >= parent.top
          && box.right + 4 <= parent.right && box.bottom + 4 <= parent.bottom;
      }), true);
      await screenshot(`12-simulated-images-${theme}-${width}`);
    }
    await page.goto(`${base}tests/fixtures/remote-chat.html?theme=${theme}&scene=questions`);
    await ready();
    await button('播放一轮').click();
    await button('允许提问').waitFor();
    assert.equal(await page.locator('.fc-question-form').count(), 0, 'Permission is not the questionnaire');
    await button('允许提问').click();
    const question = page.locator('.fc-question-form');
    await question.waitFor();
    const choice = question.getByRole('combobox', { name: '问题 1 的答案' });
    const notes = question.getByRole('textbox', { name: '问题 2 的自行填写' });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await notes.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await notes.focus();
      await checkOverflow();
      assert.equal(await notes.evaluate(element => {
        const box = element.getBoundingClientRect(), container = element.closest('.fc-transcript').getBoundingClientRect();
        return box.left - 4 >= container.left && box.right + 4 <= container.right
          && box.top - 4 >= container.top && box.bottom + 4 <= container.bottom;
      }), true, 'Question answer focus stays visible in the scroll area');
      await screenshot(`13-questions-${theme}-${width}`);
    }
    await choice.selectOption('1');
    await notes.fill('不要打包，只验收');
    await button('提交答案').click();
    await question.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${base}tests/fixtures/remote-chat.html?theme=${theme}&scene=plan`);
    await ready();
    await button('播放一轮').click();
    await button('批准计划').waitFor();
    await screenshot(`14-plan-${theme}`);
    await button('要求修改').click();
    const feedback = page.locator('.fc-question-form');
    await feedback.waitFor();
    await feedback.getByRole('textbox').fill('补充验证步骤');
    await button('提交答案').click();
    await feedback.waitFor({ state: 'detached' });
    await page.goto(`${base}tests/fixtures/remote-chat.html?theme=${theme}&scene=markdown`);
    await ready();
    await button('播放一轮').click();
    await button('立即完成当前回复').click();
    await page.locator('.fc-card-body table').waitFor();
    assert.equal(await page.locator('.fc-card-body tbody tr').count(), 3);
    assert.ok(await page.locator('.fc-card-body :not(pre) > code').count() >= 7);
    assert.equal(await page.locator('.fc-card-body pre').count(), 1);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await checkOverflow();
      await screenshot(`15-markdown-${theme}-${width}`);
    }
  }
  await page.goto(`${base}tests/fixtures/remote-chat.html`);
  await ready();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button('播放一轮').click();
  await page.getByRole('status', { name: '正在处理这条消息', exact: true }).waitFor();
  assert.equal(await page.locator('.fc-typing i').first().evaluate(element => getComputedStyle(element).animationName), 'none');
  await button('选择演示场景').click();
  await page.keyboard.press('Escape');
  assert.equal(await button('选择演示场景').evaluate(element => element === document.activeElement), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('Remote chat simulation passed: production routing, two-stage question permission/answers, Plan review/refinements, native Markdown 2.0 tables/code, tasks, queued-only recall, progress, images, status replacements, focus, 320–1440px light/dark and reduced motion; no external requests.');
} finally {
  await browser?.close();
  await server?.close();
}
