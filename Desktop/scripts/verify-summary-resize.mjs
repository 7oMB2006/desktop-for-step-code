import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-summary-resize-'));
const workspace = join(profile, 'Long history');
await mkdir(workspace);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspace, workspaces: [workspace] }));
const history = join(profile, 'step-runtime', 'sessions');
await mkdir(history, { recursive: true });
const timestamp = new Date().toISOString();
const entries = [{ type: 'session', version: 3, id: 'resize-fixture', cwd: workspace, timestamp }];
let parentId = null;
for (let turn = 0; turn < 60; turn++) {
  for (const role of ['user', 'assistant']) {
    const id = `${role}-${turn}`;
    const text = role === 'user' ? `第 ${turn + 1} 轮：检查长会话在还原窗口时的布局。` :
      `## 第 ${turn + 1} 轮分析\n\n${('长对话包含换行和不同长度的段落，用于检查窗口变化时是否重复排版。正文和输入框应该一起归位，不能产生反向跳动。').repeat(8)}\n\n- 保留阅读位置\n- 摘要使用右边留白\n\n| 项目 | 状态 |\n| --- | --- |\n| 窗口 | 正常 |\n| 布局 | 验收 |\n\n\`\`\`ts\nconst turn = ${turn};\nconsole.log(turn);\n\`\`\``;
    entries.push({ type: 'message', id, parentId, timestamp, message: { role, content: [{ type: 'text', text }], timestamp: Date.now(),
      ...(role === 'assistant' ? { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } : {}) } });
    parentId = id;
  }
}
entries.push({ type: 'session_info', id: 'name', parentId, timestamp, name: '长会话缩放验收' });
await writeFile(join(history, 'resize-fixture.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setSize(1280, 800);
  });
  await page.getByRole('button', { name: '长会话缩放验收', exact: true }).click();
  await page.locator('.response-text').last().waitFor();
  assert.equal(await page.locator('.response-text').count(), 60);
  await page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true }).click();
  await page.getByRole('complementary', { name: '摘要', exact: true }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const trace = [];
  if (process.env.DESKTOP_RESIZE_TRACE) {
    cdp.on('Tracing.dataCollected', event => trace.push(...event.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink', transferMode: 'ReportEvents' });
  }
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  const results = [];
  for (let pass = 0; pass < 3; pass++) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await page.getByRole('button', { name: '还原窗口', exact: true }).waitFor();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const scroll = document.querySelector('#conversation-scroll');
      scroll.scrollTop = scroll.scrollHeight;
      window.resizeFrames = [];
      window.resizeTasks = [];
      window.resizeRecording = true;
      window.resizeTaskObserver?.disconnect();
      window.resizeTaskObserver = new PerformanceObserver(list => {
        window.resizeTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })));
      });
      window.resizeTaskObserver.observe({ type: 'longtask' });
      let previous = performance.now();
      const frame = now => {
        const messages = document.querySelector('.messages').getBoundingClientRect();
        const composer = document.querySelector('.composer-wrap').getBoundingClientRect();
        const track = document.querySelector('.summary-track').getBoundingClientRect();
        window.resizeFrames.push({ dt: now - previous, width: innerWidth, messages: messages.width,
          center: messages.x + messages.width / 2, composer: composer.x + composer.width / 2,
          track: track.width, animations: document.querySelector('.summary-track').getAnimations().length });
        previous = now;
        if (window.resizeRecording) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const before = await metrics();
    // Exercise the actual titlebar IPC, not a synthetic viewport resize.
    await page.getByRole('button', { name: '还原窗口', exact: true }).click();
    await page.waitForFunction(() => innerWidth === 1280);
    await page.waitForTimeout(700);
    const after = await metrics();
    const { frames, tasks } = await page.evaluate(() => {
      window.resizeRecording = false;
      window.resizeTaskObserver.disconnect();
      return { frames: window.resizeFrames, tasks: window.resizeTasks };
    });
    const restored = frames.filter(frame => frame.width === 1280);
    const widths = new Set(restored.map(frame => Math.round(frame.messages * 100) / 100));
    results.push({ pass, layouts: after.LayoutCount - before.LayoutCount,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      frames: frames.length, over32ms: frames.filter(frame => frame.dt > 32).length,
      maxFrameMs: Math.max(...frames.map(frame => frame.dt)), restoredWidths: widths.size, tasks, samples: frames });
    assert.ok(restored.length > 5);
    assert.ok(restored.every(frame => Math.abs(frame.center - frame.composer) < 2));
    assert.equal(restored.at(-1).track, 0);
    if (!process.env.DESKTOP_RESIZE_BASELINE) {
      assert.ok(restored.every(frame => frame.animations === 0), 'native restore must not add a flex-basis transition');
      assert.equal(widths.size, 1, 'restored conversation width must settle in one layout, not rewrap every animation frame');
      const direction = Math.sign(restored.at(-1).center - restored[0].center);
      for (let index = 1; index < restored.length; index++) {
        assert.ok((restored[index].center - restored[index - 1].center) * direction >= -.5,
          'restoring must not paint the final position then jump backward to the animation start');
      }
      assert.ok(Math.abs(restored.at(-1).center - restored[0].center) > 10, 'quadratic visual movement must remain');
    }
  }
  // A history reader must not be pulled to the bottom by the resize correction.
  await page.evaluate(() => { document.querySelector('#conversation-scroll').scrollTop = 3000; });
  await page.waitForTimeout(100);
  const readingPosition = await page.locator('#conversation-scroll').evaluate(element => element.scrollTop);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await page.waitForTimeout(80);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await page.waitForTimeout(600);
  const afterReading = await page.locator('#conversation-scroll').evaluate(element => ({ top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight }));
  console.log('History reading position:', { before: readingPosition, after: afterReading });
  assert.ok(afterReading.top < afterReading.height - afterReading.viewport - 1000, 'resizing while reading history must not pull the reader to the bottom');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await page.waitForTimeout(400);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await page.waitForTimeout(30);
  assert.equal(await page.locator('.conversation-shell').evaluate(element => element.getAnimations().length), 0);
  await page.screenshot({ path: 'test-results/summary-resize-restored.png' });
  assert.deepEqual(errors, []);
  await writeFile(`test-results/summary-resize-${process.env.DESKTOP_RESIZE_BASELINE ? 'baseline' : 'fixed'}.json`, JSON.stringify(results, null, 2));
  if (process.env.DESKTOP_RESIZE_TRACE) {
    const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    await complete;
    await writeFile('test-results/summary-resize-trace.json', JSON.stringify({ traceEvents: trace }));
    console.log('Longest renderer trace spans:', trace.filter(event => event.ph === 'X' && event.dur > 10000)
      .sort((a, b) => b.dur - a.dur).slice(0, 20).map(({ name, dur, args }) => ({ name, ms: dur / 1000, args })));
  }
  console.log(results.map(({ samples, ...summary }) => summary));
} finally {
  await app.close();
}
