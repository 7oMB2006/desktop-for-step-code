import { _electron as electron } from 'playwright';
import { captureWaapi } from './capture-waapi.mjs';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-scroll-follow-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'dark', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const testMaxHeight = process.env.DESKTOP_SCROLL_TEST_MAX_HEIGHT ? Number(process.env.DESKTOP_SCROLL_TEST_MAX_HEIGHT) : undefined;
if (testMaxHeight !== undefined) assert.ok(Number.isSafeInteger(testMaxHeight) && testMaxHeight >= 540, 'Invalid test window height limit');
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
let phase = 'startup';
const evidence = [];
try {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }, testMaxHeight) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (testMaxHeight) window.setMaximumSize(5000, testMaxHeight);
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1200, 850);
  }, testMaxHeight);
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const original = await prepareSessionFixture(page);
  const timestamp = Date.now();
  const messages = [
    { role: 'user', content: 'Run the command and explain its failure.', timestamp },
    { role: 'assistant', content: [{ type: 'text', text: 'Checking the command.' },
      { type: 'toolCall', id: 'failed-command', name: 'run_command', arguments: { command: 'pnpm test' } }], timestamp },
    { role: 'toolResult', toolCallId: 'failed-command', toolName: 'run_command', isError: true,
      content: [{ type: 'text', text: 'Command failed with exit code 1.\n' + 'ERROR: example diagnostic output.\n'.repeat(70) }], timestamp },
    { role: 'assistant', content: [{ type: 'text', text: 'The command failed. Review its output and retry.' }], timestamp },
  ];
  const fixture = { ...original, messages, state: { ...original.state, isStreaming: false },
    preferences: { ...original.preferences, interfaceSettings: { preset: 'detailed' } } };
  await app.evaluate(({ ipcMain }, fixture) => {
    globalThis.scrollFixture = fixture;
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.scrollFixture;
      if (method === 'summary') return { tasks: [], mcp: [], skillCount: 0 };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: [] };
      return {};
    });
  }, fixture);
  const viewport = page.locator('#conversation-scroll');
  const tool = page.locator('.process-tool');
  const track = page.locator('.main-content > .conversation-scroll-track');
  const measure = () => viewport.evaluate(v => ({ top: v.scrollTop, max: v.scrollHeight - v.clientHeight }));
  const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const reset = async ({ turns = 1, theme = 'dark', width = 1200, height = 850, outputLines = 70, compact = false } = {}) => {
    await app.evaluate(({ BrowserWindow }, { messages, turns, theme, width, height, outputLines, compact }) => {
      BrowserWindow.getAllWindows()[0].setSize(width, height);
      globalThis.scrollFixture.preferences.theme = theme;
      const rendered = structuredClone(messages);
      rendered.find(message => message.role === 'toolResult').content[0].text =
        'Command failed with exit code 1.\n' + 'ERROR: example diagnostic output.\n'.repeat(outputLines);
      if (compact) {
        // Keep the same failed command/disclosure, omitting unrelated prose and
        // the user bubble so hosted display bounds do not dictate scroll range.
        rendered.shift();
        rendered[0].content = rendered[0].content.filter(part => part.type === 'toolCall');
        rendered.at(-1).content[0].text = 'Retry.';
      }
      globalThis.scrollFixture.messages = turns === 1 ? rendered : [
        { role: 'user', content: 'Earlier question.', timestamp: Date.now() - 1000 },
        { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer.' }], timestamp: Date.now() - 1000 },
        ...rendered,
      ];
    }, { messages, turns, theme, width, height, outputLines, compact });
    await page.reload();
    await tool.waitFor();
  };
  const openTool = async () => {
    await tool.locator(':scope > summary').click();
    await tool.locator('.process-tool-body').evaluate(async body => {
      await Promise.all(body.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    await settle();
  };
  const wheel = async delta => {
    const box = await viewport.boundingBox();
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(180);
  };
  const append = async (text = ' More output.') => {
    await app.evaluate(({ BrowserWindow }, { runtimeId, text }) => {
      globalThis.scrollFixture.messages.at(-1).content[0].text += text;
      BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { runtimeId, type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } });
    }, { runtimeId: fixture.runtimeId, text });
    await settle();
  };
  const preservesReading = async label => {
    const before = await measure();
    await append();
    const after = await measure();
    evidence.push({ label, before, after });
    assert.ok(Math.abs(after.top - before.top) <= 1, `${label}: output pulled reading position from ${before.top} to ${after.top}`);
  };
  const followsOutput = async label => {
    await append('\n\n' + 'Additional output keeps the transcript growing.\n\n'.repeat(4));
    const after = await measure();
    evidence.push({ label, after });
    assert.ok(after.max - after.top <= 1, `${label}: normal tail following did not resume`);
  };
  for (const turns of [1, 2]) {
    phase = `${turns} turn: small upward wheel`;
    await reset({ turns });
    await openTool();
    const bottom = await measure();
    assert.ok(bottom.max > 100);
    await wheel(-40);
    const reading = await measure();
    assert.ok(bottom.top - reading.top > 20 && bottom.top - reading.top < 100);
    await preservesReading(phase);
    await page.locator('.jump-to-bottom').click();
    await followsOutput(`${turns} turn: explicit return to bottom`);
  }
  phase = 'upward wheel during disclosure animation';
  await reset();
  const expansion = await captureWaapi(page, '.process-tool-body', () => tool.locator(':scope > summary').click());
  await expansion.evaluate(animation => { animation.currentTime = 140; });
  await settle();
  await wheel(-40);
  const interrupted = await measure();
  await expansion.evaluate(animation => animation.finish());
  await expansion.dispose();
  await settle();
  const finished = await measure();
  assert.ok(finished.max - finished.top > 20, 'Finishing expansion must not pull an upward gesture to the tail');
  assert.ok(Math.abs(finished.top - interrupted.top) <= 1, 'Expansion must preserve the manually selected offset');
  await preservesReading(phase);

  phase = 'keyboard and scroll handle';
  await reset();
  await openTool();
  await track.focus();
  await page.keyboard.press('ArrowUp');
  await settle();
  assert.ok((await measure()).max - (await measure()).top > 20);
  await preservesReading('scrollbar ArrowUp');
  await page.keyboard.press('End');
  await settle();
  await followsOutput('scrollbar End');
  const thumb = await track.locator('.conversation-scroll-thumb').boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 - 25, { steps: 5 });
  await page.mouse.up();
  await preservesReading('scrollbar upward drag');
  await viewport.evaluate(v => { v.tabIndex = -1; v.focus(); });
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('#conversation-scroll').scrollTop === 0);
  assert.equal((await measure()).top, 0);
  await preservesReading('transcript Home');

  phase = 'single turn marker navigation';
  await reset();
  await openTool();
  await page.locator('.turn-marker').click();
  await page.waitForFunction(() => {
    const v = document.querySelector('#conversation-scroll');
    const article = v.querySelector('[data-message-index="0"]');
    return Math.abs(article.getBoundingClientRect().top - v.getBoundingClientRect().top) <= 1;
  });
  await preservesReading(phase);

  for (const selector of ['.turn-marker', '.main-content > .conversation-scroll-track']) {
    phase = `wheel over ${selector}`;
    await reset();
    await openTool();
    const before = await measure();
    await page.locator(selector).hover();
    await page.mouse.wheel(0, -40);
    await page.waitForFunction(top => document.querySelector('#conversation-scroll').scrollTop < top - 20, before.top);
    await page.waitForTimeout(180);
    await preservesReading(phase);
  }

  phase = 'upward intent before the transcript overflows';
  await reset();
  assert.equal((await measure()).max, 0);
  await wheel(-40);
  await append('\n\n' + 'Output eventually extends beyond the viewport.\n\n'.repeat(22));
  assert.ok((await measure()).max > 100);
  assert.equal((await measure()).top, 0);
  await page.locator('.jump-to-bottom').waitFor();

  for (const [theme, width] of [['dark', 1200], ['light', 1200], ['light', 700]]) {
    phase = `${theme}/${width}: less than 100 pixels of total scroll range`;
    let range;
    // Native macOS bounds may clamp a large window to the display. Measure the
    // actual viewport after each request, and use a shorter diagnostic fixture
    // if the full output cannot fit. Keep production layout and scrolling intact.
    for (const [outputLines, compact] of [[70, false], [10, false], [5, false], [0, false],
      [0, true], [2, true], [5, true], [10, true]]) {
      await reset({ theme, width, outputLines, compact });
      await openTool();
      for (let attempt = 0; attempt < 5; attempt++) {
        range = await measure();
        if (range.max > 10 && range.max < 100) break;
        const bounds = await app.evaluate(({ BrowserWindow }, adjustment) => {
          const window = BrowserWindow.getAllWindows()[0];
          const before = window.getContentSize();
          window.setContentSize(before[0], before[1] + adjustment);
          return { before, after: window.getContentSize() };
        }, range.max > 0 ? range.max - 62 : -62);
        await page.waitForTimeout(180);
        await settle();
        evidence.push({ label: `${phase}: fixture sizing`, outputLines, compact, bounds, range: await measure() });
        if (bounds.before[1] === bounds.after[1]) break;
      }
      range = await measure();
      if (range.max > 10 && range.max < 100) {
        evidence.push({ label: `${phase}: selected fixture`, outputLines, compact, range });
        break;
      }
    }
    assert.ok(range.max > 10 && range.max < 100, `Expected a short scroll range, got ${range.max}`);
    await wheel(-240);
    assert.equal((await measure()).top, 0);
    await preservesReading(phase);
    await page.locator('.jump-to-bottom').waitFor();
    await page.screenshot({ path: `test-results/conversation-scroll-${theme}-${width}.png` });
    await wheel(10);
    await preservesReading(`${phase}: partial downward gesture`);
    await wheel(1000);
    await followsOutput(`${phase}: downward gesture reaches the bottom`);
  }
  phase = 'nested command output and reduced motion';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reset();
  await openTool();
  const output = tool.locator('.process-tool-content pre').last();
  await output.evaluate(pre => { pre.scrollTop = 300; });
  const outerBefore = await measure();
  const box = await output.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 80);
  await page.mouse.wheel(0, -40);
  await page.waitForFunction(() => [...document.querySelectorAll('.process-tool-content pre')].at(-1).scrollTop < 290);
  assert.equal((await measure()).top, outerBefore.top, 'Nested scrolling must not be redirected into the transcript');
  await preservesReading(phase);
  await page.locator('.jump-to-bottom').click();
  await followsOutput('reduced motion return to bottom');
  assert.deepEqual(errors, []);
  await writeFile('test-results/conversation-scroll.json', JSON.stringify({ evidence, errors }, null, 2));
  console.log('Conversation scroll passed: small upward gestures, single/multiple turns, animated expansion, sub-100px ranges, wheel/keyboard/drag/markers, nested output, explicit/automatic resume, light/dark/narrow and reduced motion.');
} catch (error) {
  console.error(`Conversation scroll acceptance failed during ${phase}`);
  const page = await app.firstWindow().catch(() => undefined);
  const geometry = page ? await page.evaluate(() => {
    const viewport = document.querySelector('#conversation-scroll');
    const content = viewport?.querySelector('.messages');
    return { viewport: [innerWidth, innerHeight], scroll: viewport ? { top: viewport.scrollTop, height: viewport.clientHeight,
      content: viewport.scrollHeight, range: viewport.scrollHeight - viewport.clientHeight } : undefined,
      contentBounds: content?.getBoundingClientRect().toJSON() };
  }).catch(() => undefined) : undefined;
  await writeFile('test-results/conversation-scroll-failure.json', JSON.stringify({ phase, evidence, geometry }, null, 2));
  if (page) await page.screenshot({ path: 'test-results/conversation-scroll-failure.png' }).catch(() => {});
  console.error(JSON.stringify({ phase, geometry, sizing: evidence.filter(item => item.label.includes('fixture sizing')) }));
  throw error;
} finally {
  await app.close();
}
