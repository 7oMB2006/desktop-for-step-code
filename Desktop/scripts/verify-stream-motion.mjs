import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-stream-motion-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
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
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 850);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.motionSnapshot = snapshot;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method) => method === 'snapshot' ? globalThis.motionSnapshot : {});
  }, snapshot);
  const emit = events => app.evaluate(({ BrowserWindow }, events) => {
    const snapshot = globalThis.motionSnapshot;
    for (const event of events) {
      if (event.type === 'message_start') snapshot.messages.push(event.message);
      if (event.type === 'message_update') {
        const delta = event.assistantMessageEvent;
        const content = snapshot.messages.at(-1).content;
        if (delta.type === 'text_delta') content[delta.contentIndex] = { type: 'text', text: (content[delta.contentIndex]?.text ?? '') + delta.delta };
        if (delta.type === 'thinking_delta') content[delta.contentIndex] = { type: 'thinking', thinking: (content[delta.contentIndex]?.thinking ?? '') + delta.delta };
      }
      BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', event);
    }
  }, events);
  const delta = text => emit([{ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: text } }]);
  const startSampling = () => page.evaluate(() => {
    window.motionFrames = [];
    window.motionSampling = true;
    const sample = () => {
      if (!window.motionSampling) return;
      const scroll = document.querySelector('.conversation');
      const pulse = document.querySelector('.working');
      const text = document.querySelector('.response-active .response-text, .response-active .thinking');
      window.motionFrames.push({
        pulse: pulse.getBoundingClientRect().y,
        text: text.getBoundingClientRect().y,
        distance: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        height: scroll.scrollHeight,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const checkPositions = async name => {
    const frames = await page.evaluate(() => { window.motionSampling = false; return window.motionFrames; });
    await writeFile(`test-results/stream-${name}-frames.json`, JSON.stringify(frames, null, 2));
    assert.ok(frames.length > 10, 'position checks must cover multiple rendered frames');
    const measurements = {
      pulseRange: Math.max(...frames.map(frame => frame.pulse)) - Math.min(...frames.map(frame => frame.pulse)),
      maxTailDistance: Math.max(...frames.map(frame => frame.distance)),
      stationaryTextShift: Math.max(0, ...frames.slice(1).map((frame, index) =>
        frame.height === frames[index].height ? Math.abs(frame.text - frames[index].text) : 0)),
    };
    console.log(`${name} positions:`, measurements);
    assert.ok(measurements.pulseRange <= 1, `${name}: pulse must stay anchored at the live tail`);
    assert.ok(measurements.maxTailDistance <= 1, `${name}: no painted gap before scroll correction`);
    assert.ok(measurements.stationaryTextShift <= 1, `${name}: prose must not bounce at unchanged layout height`);
  };
  await emit([
    { type: 'agent_start' },
    { type: 'message_start', message: { role: 'user', content: '检查这一版文字淡入和思考折叠。', timestamp: Date.now() } },
    { type: 'message_start', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '逐项检查组件状态与流式事件，保留可见内容与实际执行过程。\n\n'.repeat(12) }] } },
  ]);
  const thinking = page.locator('.thinking').last();
  await thinking.locator('.thinking-body').waitFor({ state: 'visible' });
  const fullHeight = await thinking.boundingBox();
  assert.ok(fullHeight.height > 250);
  await delta('正文开始出现，思考区会平滑收起。');
  await thinking.evaluate(element => {
    const tween = element.querySelector('.thinking-body').getAnimations()[0];
    if (!tween) throw new Error('Missing thinking collapse animation');
    tween.pause(); tween.currentTime = 100;
  });
  const midHeight = await thinking.boundingBox();
  assert.ok(midHeight.height > 30 && midHeight.height < fullHeight.height, 'fold occupies a real intermediate height');
  assert.equal(await thinking.getAttribute('data-expanded'), 'false');
  await page.screenshot({ path: 'test-results/stream-thinking-mid-fold.png' });
  await thinking.evaluate(element => element.querySelector('.thinking-body').getAnimations()[0].finish());
  await page.waitForFunction(() => !document.querySelector('.thinking').open);
  assert.ok((await thinking.boundingBox()).height <= 31);
  await page.screenshot({ path: 'test-results/stream-thinking-folded.png' });
  await thinking.locator('summary').click();
  assert.equal(await thinking.getAttribute('data-expanded'), 'true');
  await thinking.locator('.thinking-body').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  await delta(' 手动展开不会被后续文字强行折叠。');
  assert.equal(await thinking.getAttribute('data-expanded'), 'true');
  await thinking.locator('summary').click();
  await thinking.locator('summary').click();
  await thinking.locator('.thinking-body').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  assert.notEqual(await thinking.getAttribute('open'), null, 'rapid reversal settles expanded');
  await thinking.locator('summary').click();
  await page.waitForFunction(() => !document.querySelector('.thinking').open);
  await page.waitForFunction(() => !document.querySelector('.response-text .stream-reveal'));
  const oldText = await page.locator('.response-text').textContent();
  await delta('\n\n这一批新文字淡入，原来的内容保持清晰。');
  await page.locator('.response-text .stream-reveal').first().waitFor();
  const reveal = page.locator('.response-text .stream-reveal').first();
  await reveal.evaluate(element => {
    const tween = element.getAnimations()[0];
    if (!tween) throw new Error('Missing text reveal animation');
    tween.pause(); tween.currentTime = 80;
  });
  assert.ok(await reveal.evaluate(element => Number(getComputedStyle(element).opacity) > .3 && Number(getComputedStyle(element).opacity) < 1));
  const fadedText = (await page.locator('.response-text .stream-reveal').allTextContents()).join('');
  assert.equal(fadedText.includes('正文开始出现'), false, 'old text must not replay');
  assert.ok((await page.locator('.response-text').textContent()).startsWith(oldText.trimEnd()));
  await page.screenshot({ path: 'test-results/stream-text-mid-reveal.png', animations: 'allow' });
  await reveal.evaluate(element => element.getAnimations()[0].finish());
  await delta('\n\n**格式**、`代码`和公式 $x^2$ 仍然正常。');
  await page.locator('.response-text .katex').waitFor();
  assert.equal(await page.locator('.response-text code .stream-reveal').count(), 0);
  assert.equal(await page.locator('.response-text .katex .stream-reveal').count(), 0);
  if (await page.locator('.jump-to-bottom').isVisible()) await page.locator('.jump-to-bottom').click();
  await page.waitForFunction(() => {
    const scroll = document.querySelector('.conversation');
    return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 50;
  });
  await delta('\n\n' + '较长输出用于检查视口跟随，不做逐字播放，也不积压模型已经输出的内容。\n\n'.repeat(25));
  await page.waitForFunction(() => {
    const scroll = document.querySelector('.conversation');
    return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 100;
  });
  await startSampling();
  for (let index = 0; index < 12; index++) {
    await delta('\n\nStreaming stability sample: a new paragraph changes the transcript height without moving the activity indicator back and forth.');
    await page.waitForTimeout(65);
  }
  await page.waitForTimeout(300);
  await checkPositions('prose');
  await page.locator('.conversation').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.jump-to-bottom').waitFor();
  await delta('继续输出时，不会把正在阅读历史的用户拉回底部。');
  await page.waitForTimeout(250);
  assert.ok(await page.locator('.conversation').evaluate(element => element.scrollTop < 5));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await delta('\n\n减少动态效果时文字立即显示。');
  if (await page.locator('.stream-reveal').count()) {
    assert.equal(await page.locator('.stream-reveal').last().evaluate(element => getComputedStyle(element).animationName), 'none');
  }
  await thinking.locator('summary').click();
  assert.equal(await thinking.locator('.thinking-body').evaluate(element => element.getAnimations().length), 0);
  await thinking.locator('summary').click();
  assert.equal(await thinking.getAttribute('open'), null);
  await emit([{ type: 'agent_end' }]);
  await page.waitForFunction(() => !document.querySelector('.stream-reveal'));
  assert.ok((await page.locator('.response-text').textContent()).includes('减少动态效果时文字立即显示。'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 760));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.jump-to-bottom').click();
  await page.waitForFunction(() => {
    const scroll = document.querySelector('.conversation');
    return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 1;
  });
  await emit([
    { type: 'agent_start' },
    { type: 'message_start', message: { role: 'user', content: '检查思考流式增长和折叠时的脉冲位置。', timestamp: Date.now() } },
    { type: 'message_start', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '思考区域在窄窗口中持续增长。\n\n'.repeat(10) }] } },
  ]);
  await page.waitForTimeout(100);
  await startSampling();
  for (let index = 0; index < 12; index++) {
    await emit([{ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '继续检查高度变化和滚动纠正是否在同一帧完成。\n\n' } }]);
    await page.waitForTimeout(65);
  }
  await page.waitForTimeout(250);
  await checkPositions('thinking');
  await startSampling();
  await delta('思考完成，正文出现。');
  await page.waitForTimeout(400);
  await checkPositions('fold');
  await page.screenshot({ path: 'test-results/stream-stable-pulse-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 850));
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'test-results/stream-stable-pulse-desktop.png' });
  await page.locator('.conversation').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.jump-to-bottom').waitFor();
  await page.locator('.thinking').last().locator('summary').evaluate(element => element.click());
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.conversation').evaluate(element => element.scrollTop < 5), 'disclosure resize must not resume follow while reading history');
  await emit([{ type: 'agent_end' }]);
  await page.locator('.working').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('Stream motion acceptance passed: real intermediate fold heights, reversal, manual reopening, new-text-only fade, Markdown/math/code, frame-stable prose/thinking/fold, resize, history reading, reduced motion and completion.');
} finally {
  await app.close();
}
