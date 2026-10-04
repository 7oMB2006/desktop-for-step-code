import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyInspectorExpansion } from './verify-inspector-expansion.mjs';

const profile = await mkdtemp(join(tmpdir(), 'step-context-panel-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('.')]), '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion'], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1706, 1066);
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const original = await page.evaluate(() => window.desktop.snapshot());
  const now = Date.now();
  const usage = { input: 2136, output: 824, cacheRead: 11240, cacheWrite: 0, reasoning: 256,
    totalTokens: 14200, cost: { input: .004272, output: .006592, cacheRead: .002248, cacheWrite: 0, total: .013112 } };
  const messages = [
    { role: 'user', content: '检查 SSE 在工具调用后是否正确续流。先给出根因，再做最小范围的修复。', timestamp: now - 120000 },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '先检查事件序列与结束标记，区分模型输出和前端状态。\n\n' },
      { type: 'text', text: '先读事件解析器与回归测试。' },
      { type: 'toolCall', id: 'call-read', name: 'read_file', arguments: { path: 'src/stream.ts' } }], usage, timestamp: now - 115000 },
    { role: 'toolResult', toolCallId: 'call-read', toolName: 'read_file', content: [{ type: 'text', text: 'export function parseEvent(line: string) {\n  return JSON.parse(line);\n}' }], timestamp: now - 100000 },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'call-test', name: 'run_command', arguments: { command: 'pnpm test -- stream', api_key: 'fixture-secret' } }], usage, timestamp: now - 85000 },
    { role: 'toolResult', toolCallId: 'call-test', toolName: 'run_command', content: [{ type: 'text', text: 'PASS stream-events: 12 tests passed.' }], timestamp: now - 70000 },
    { role: 'assistant', provider: 'stepfun', model: 'step-5-preview', stopReason: 'stop', content: [{ type: 'text', text:
      '## 已定位：工具结束不是会话结束\n\nSSE 流本身没有断开。工具结果到达后，界面把单次工具完成事件当成了整轮结束，导致后续文字未被消费。\n\n### 调整范围\n\n- 工具结果只更新对应的工具状态。\n- 整轮状态由 agent_end 事件关闭。\n- 保留正在生成的正文，不重复播放旧文本。\n\n### 验证\n\n覆盖连续工具调用、工具结果后的正文续流，以及中断后重新发送。\n\n' + '回归检查：保持消息顺序与滚动位置，工具执行完成后继续接收正文。\n\n'.repeat(8) }], usage, timestamp: now - 50000 },
  ];
  const fixture = { ...original, preferences: { ...original.preferences, theme: 'light' }, messages,
    sessions: original.sessions.map(session => session.id === original.state?.sessionId ? { ...session, name: '修复 SSE 续流' } : session),
    state: { ...original.state, sessionName: '修复 SSE 续流', model: { id: 'step-5-preview', name: 'Step 5 Preview', provider: 'stepfun', reasoning: true } },
    stats: { toolCalls: 2, assistantMessages: 3, userMessages: 1, toolResults: 2, totalMessages: 6, cost: .039336,
      tokens: { input: 6408, output: 2472, cacheRead: 33720, cacheWrite: 0, total: 42600 },
      contextUsage: { tokens: 14200, contextWindow: 200000, percent: 7.1 } } };
  // Isolated presentation fixture at the existing IPC boundary; no production
  // fallback data, provider requests or writes to the user's clipboard.
  await app.evaluate(({ ipcMain }, fixture) => {
    globalThis.contextFixture = fixture;
    globalThis.contextCopies = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return globalThis.contextFixture;
      if (method === 'preferences') { Object.assign(globalThis.contextFixture.preferences, args[0]); return globalThis.contextFixture.preferences; }
      if (method === 'copyText') { globalThis.contextCopies.push(args[0]); return; }
      if (method === 'settings') return { account: { loggedIn: false, validity: 'unknown' }, profiles: [], mcp: {}, skills: [] };
      if (method === 'command' && args[0] === 'get_session_stats') return globalThis.contextFixture.stats;
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: ['off', 'low', 'medium', 'high'] };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      return {};
    });
  }, fixture);
  await page.reload();
  await page.locator('.response-text').last().waitFor();
  const panel = page.getByRole('complementary', { name: '上下文', exact: true });
  const toggle = page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true });
  assert.equal(await page.locator('.right-tool-rail > button').nth(1).getAttribute('aria-label'), '上下文');
  await toggle.click();
  await panel.waitFor();
  const motion = await panel.evaluate(element => {
    const style = getComputedStyle(element);
    return { name: style.animationName, ease: style.animationTimingFunction, duration: style.animationDuration };
  });
  assert.deepEqual(motion, { name: 'right-panel-enter', ease: 'cubic-bezier(0.22, 1, 0.36, 1)', duration: '0.26s' });
  async function verifyTrackless(locator) {
    const style = await locator.evaluate(element => ({
      width: getComputedStyle(element, '::-webkit-scrollbar').width,
      height: getComputedStyle(element, '::-webkit-scrollbar').height,
      track: getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
      buttons: getComputedStyle(element, '::-webkit-scrollbar-button').display,
      nativeWidth: getComputedStyle(element).scrollbarWidth,
    }));
    assert.deepEqual(style, { width: '4px', height: '4px', track: 'rgba(0, 0, 0, 0)', buttons: 'none', nativeWidth: 'auto' });
  }
  await verifyTrackless(panel.locator('.context-panel-scroll'));
  await page.waitForTimeout(500);
  assert.equal(await panel.getByRole('meter').getAttribute('aria-valuenow'), '7.1');
  assert.ok((await panel.innerText()).includes('$0.0393'));
  assert.equal(await panel.locator('.context-message').count(), 6);
  await page.mouse.move(700, 25);
  await page.screenshot({ path: 'test-results/context-panel-light.png' });
  async function verifyCapacityScale(theme) {
    for (const percent of [7.1, 50, 80, 95, 0]) {
      await app.evaluate((_electron, percent) => {
        globalThis.contextFixture.stats.contextUsage.percent = percent;
        globalThis.contextFixture.stats.contextUsage.tokens = percent * 2000;
      }, percent);
      await panel.getByRole('button', { name: '刷新上下文', exact: true }).click();
      await page.waitForFunction(percent => document.querySelector('.context-capacity-strip')?.getAttribute('aria-valuenow') === String(percent), percent);
      const appearance = await panel.locator('.context-capacity').evaluate(element => {
        const strip = element.querySelector('.context-capacity-strip');
        strip.style.color = 'var(--capacity-color)';
        const fill = getComputedStyle(strip).color;
        strip.style.removeProperty('color');
        return {
          color: getComputedStyle(element.querySelector('.context-capacity-number > strong')).color,
          fill, used: element.querySelectorAll('.is-used').length,
        };
      });
      assert.equal(appearance.color, appearance.fill);
      assert.equal(appearance.used, Math.ceil(percent / 2.5));
      if (percent) await panel.locator('.context-capacity').screenshot({ path: `test-results/context-capacity-${theme}-${percent}.png` });
    }
    await app.evaluate(() => {
      globalThis.contextFixture.stats.contextUsage = { percent: 7.1, tokens: 14200, contextWindow: 200000 };
    });
    await panel.getByRole('button', { name: '刷新上下文', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.context-capacity-strip')?.getAttribute('aria-valuenow') === '7.1');
  }
  await verifyCapacityScale('light');
  const switchFrames = [];
  async function verifyNavigationAnchor(source, settle = 380) {
    await page.locator('.right-tool-rail').getByRole('button', { name: source, exact: true }).click();
    await page.waitForTimeout(settle);
    const frames = await page.evaluate(async () => {
      document.querySelector('.right-tool-rail button[aria-label="会话导航"]').click();
      const frames = [];
      const start = performance.now();
      while (performance.now() - start < 420) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const panel = document.querySelector('.conversation-nav-panel').getBoundingClientRect();
        const rail = document.querySelector('.right-tool-rail').getBoundingClientRect();
        frames.push({ gap: rail.x - panel.right, track: document.querySelector('.summary-track').getBoundingClientRect().width });
      }
      return frames;
    });
    switchFrames.push({ source, settle, frames });
    assert.ok(frames.length > 3);
    assert.ok(frames.every(frame => frame.gap >= -8.5 && frame.gap <= .5),
      `${source} -> navigation moved away from rail: ${JSON.stringify(frames)}`);
    assert.ok(frames.every(frame => frame.track < .5));
    await page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true }).click();
    await page.waitForTimeout(380);
  }
  // Run at the wide, docked size; the zero-reservation overlay cannot expose this bug.
  await panel.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await verifyNavigationAnchor('上下文');
  await panel.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await verifyNavigationAnchor('摘要');
  await panel.getByRole('button', { name: '关闭上下文', exact: true }).click();
  await verifyNavigationAnchor('上下文', 30);
  await page.locator('.right-tool-rail').getByRole('button', { name: '会话导航', exact: true }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/right-panel-navigation-anchor-fixed.png' });
  await toggle.click();
  await page.waitForTimeout(380);
  await writeFile('test-results/right-panel-switch-frames.json', JSON.stringify(switchFrames, null, 2));
  await panel.locator('.context-message summary').first().click();
  await panel.locator('.context-json pre').waitFor();
  await verifyTrackless(panel.locator('.context-json pre'));
  assert.ok((await panel.locator('.context-json pre').innerText()).includes('step-5-preview'));
  const openJson = await panel.locator('.context-json pre').innerText();
  await verifyInspectorExpansion(page, panel, 'context-expanded-light');
  assert.equal(await panel.locator('.context-json pre').innerText(), openJson);
  await panel.getByRole('button', { name: '复制消息 JSON', exact: true }).click();
  assert.ok(await app.evaluate(() => globalThis.contextCopies.at(-1).includes('step-5-preview')));
  await panel.getByRole('tab', { name: /工具/ }).click();
  assert.equal(await panel.locator('.context-message').count(), 2);
  await panel.getByRole('tab', { name: /助手/ }).click();
  await panel.locator('.context-message summary').nth(1).click();
  await panel.locator('.context-json pre').waitFor();
  assert.ok(!(await panel.locator('.context-json pre').innerText()).includes('fixture-secret'));
  await panel.getByRole('tab', { name: /全部/ }).click();
  await panel.locator('.context-message summary').nth(1).click();
  await panel.locator('.context-json pre').waitFor();
  await panel.locator('.context-panel-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.mouse.move(700, 25);
  await page.screenshot({ path: 'test-results/context-panel-json-light.png' });
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('dark');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await verifyCapacityScale('dark');
  await panel.locator('.context-panel-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.mouse.move(700, 25);
  await page.screenshot({ path: 'test-results/context-panel-json-dark.png' });
  await panel.screenshot({ path: 'test-results/context-panel-detail-dark.png' });
  await verifyInspectorExpansion(page, panel, 'context-expanded-dark');
  await panel.locator('.context-message[open] summary').click();
  await panel.locator('.context-panel-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.mouse.move(700, 25);
  await page.screenshot({ path: 'test-results/context-panel-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 850));
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.right-panel-backdrop').count(), 0);
  const box = await panel.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 900 - 44 + 1);
  const conversation = page.locator('#conversation-scroll');
  await conversation.evaluate(element => { element.scrollTop = 0; });
  const bounds = await conversation.boundingBox();
  await page.mouse.move(bounds.x + 30, bounds.y + 150);
  await page.mouse.wheel(0, 260);
  await page.waitForFunction(() => document.querySelector('#conversation-scroll').scrollTop > 100);
  assert.equal(await panel.isVisible(), true);
  await page.screenshot({ path: 'test-results/context-panel-narrow.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await page.waitForTimeout(500);
  const small = await panel.boundingBox();
  assert.ok(small.x >= 0 && small.x + small.width <= 640 - 44 + 1);
  assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: 'test-results/context-panel-small.png' });
  await verifyInspectorExpansion(page, panel, 'context-expanded-narrow');
  await app.evaluate(({ ipcMain }) => { globalThis.contextFixture.stats.contextUsage.tokens = null; globalThis.contextFixture.stats.contextUsage.percent = null; });
  await panel.getByRole('button', { name: '刷新上下文', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.context-capacity-strip').getAttribute('aria-valuetext') === '未知');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await toggle.evaluate(element => document.activeElement === element), true);
  await toggle.click();
  assert.equal(await panel.evaluate(element => getComputedStyle(element).animationName), 'none');
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  assert.equal(await panel.evaluate(element => getComputedStyle(element.closest('.right-inspector-surface')).transitionDuration), '0s');
  await page.keyboard.press('Escape');
  assert.equal(await panel.getByRole('button', { name: '全屏查看', exact: true }).count(), 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(() => {
    globalThis.contextFixture.messages = Array.from({ length: 36 }, (_, index) => ({
      role: 'user', content: `第 ${index + 1} 轮：检查右栏的滚动与会话导航。`,
      timestamp: Date.now() - (36 - index) * 60000,
    }));
  });
  await panel.getByRole('button', { name: '刷新上下文', exact: true }).click();
  const contextShell = await panel.evaluate(element => ({
    width: element.getBoundingClientRect().width, background: getComputedStyle(element).backgroundColor,
    headerHeight: element.querySelector('header').getBoundingClientRect().height,
    headerPadding: getComputedStyle(element.querySelector('header')).paddingLeft,
  }));
  await panel.getByRole('button', { name: '全屏查看', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.right-tool-rail').getByRole('button', { name: '会话导航', exact: true }).click();
  const navigation = page.getByRole('complementary', { name: '会话导航', exact: true });
  await navigation.waitFor();
  assert.equal(await page.locator('main').evaluate(element => element.inert), false);
  assert.deepEqual(await navigation.evaluate(element => {
    const style = getComputedStyle(element);
    return { properties: style.transitionProperty, ease: style.transitionTimingFunction, duration: style.transitionDuration };
  }), { properties: 'opacity, transform', ease: `${motion.ease}, ${motion.ease}`, duration: '0.26s, 0.26s' });
  const turnList = navigation.getByRole('navigation');
  assert.equal(await navigation.getByRole('button', { name: '全屏查看', exact: true }).count(), 0);
  await verifyTrackless(turnList);
  await page.waitForTimeout(350);
  assert.ok(await turnList.evaluate(element => {
    const row = element.querySelector('button');
    const outer = element.getBoundingClientRect();
    const inner = row.getBoundingClientRect();
    const right = inner.right - 8;
    return Math.abs(inner.x - outer.x) < 1 && inner.right >= outer.right - 5 &&
      document.elementFromPoint(inner.x + 8, inner.y + 10)?.closest('button') === row &&
      document.elementFromPoint(right, inner.y + 10)?.closest('button') === row;
  }), 'navigation interaction rows must reach both edges');
  assert.deepEqual(await navigation.evaluate(element => ({
    width: element.getBoundingClientRect().width, background: getComputedStyle(element).backgroundColor,
    headerHeight: element.querySelector('header').getBoundingClientRect().height,
    headerPadding: getComputedStyle(element.querySelector('header')).paddingLeft,
  })), contextShell);
  assert.equal(await page.locator('.right-panel-backdrop').count(), 0);
  await conversation.evaluate(element => { element.scrollTop = 0; });
  const navConversation = await conversation.boundingBox();
  await page.mouse.move(navConversation.x + 30, navConversation.y + 120);
  await page.mouse.wheel(0, 260);
  await page.waitForFunction(() => document.querySelector('#conversation-scroll').scrollTop > 100);
  const input = page.locator('.composer > textarea');
  const inputBounds = await input.boundingBox();
  await page.mouse.click(inputBounds.x + 12, inputBounds.y + 12);
  assert.equal(await input.evaluate(element => element === document.activeElement), true);
  await input.fill('会话导航非模态输入验收');
  assert.equal(await navigation.isVisible(), true);
  await input.fill('');
  await navigation.screenshot({ path: 'test-results/navigation-unified-detail-dark.png' });
  await turnList.getByRole('button').first().hover({ position: { x: 8, y: 10 } });
  await navigation.screenshot({ path: 'test-results/navigation-full-row-hover.png' });
  await page.screenshot({ path: 'test-results/navigation-unified-narrow.png' });
  const navBounds = await turnList.boundingBox();
  await page.mouse.move(navBounds.x + 60, navBounds.y + 120);
  await page.mouse.wheel(0, 280);
  await page.waitForFunction(() => document.querySelector('.conversation-nav-panel nav').scrollTop > 100);
  await page.screenshot({ path: 'test-results/right-panel-navigation-trackless.png' });
  async function verifyClose() {
    const frames = await page.evaluate(async () => {
      document.querySelector('.conversation-nav-panel header button').click();
      const frames = [];
      const start = performance.now();
      while (performance.now() - start < 360) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const panel = document.querySelector('.conversation-nav-panel');
        frames.push(panel ? { opacity: Number(getComputedStyle(panel).opacity), inert: panel.inert,
          width: document.querySelector('.conversation-nav-track').getBoundingClientRect().width } : null);
      }
      return frames;
    });
    const visible = frames.filter(Boolean);
    assert.ok(visible.some(frame => frame.opacity > .01 && frame.opacity < .99), 'navigation must fade over frames');
    assert.ok(visible.every(frame => frame.inert));
    assert.equal(frames.at(-1), null, 'navigation must unmount after exit');
    return frames;
  }
  const closing = await verifyClose();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1706, 1066));
  await page.locator('.right-tool-rail').getByRole('button', { name: '会话导航', exact: true }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/navigation-unified-dark.png' });
  const dockedClosing = await verifyClose();
  assert.ok(dockedClosing.filter(Boolean).some(frame => frame.width > 1 && frame.width < 344));
  await page.locator('.right-tool-rail').getByRole('button', { name: '会话导航', exact: true }).click();
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    document.querySelector('.conversation-nav-panel header button').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    document.querySelector('.right-tool-rail button[aria-label="会话导航"]').click();
  });
  await page.waitForTimeout(350);
  assert.equal(await navigation.evaluate(element => element.inert), false);
  assert.equal(await navigation.evaluate(element => getComputedStyle(element).opacity), '1');
  await writeFile('test-results/navigation-close-frames.json', JSON.stringify({ closing, dockedClosing }, null, 2));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.conversation-nav-panel').count(), 0);
  await page.locator('.right-tool-rail').getByRole('button', { name: '会话导航', exact: true }).click();
  assert.equal(await navigation.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('light');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await navigation.getByRole('navigation').evaluate(element => { element.scrollTop = 0; });
  await page.mouse.move(700, 25);
  await navigation.screenshot({ path: 'test-results/navigation-unified-detail-light.png' });
  await page.screenshot({ path: 'test-results/navigation-unified-light.png' });
  assert.deepEqual(errors, []);
  console.log('Context inspector presentation passed: roles, usage, cost, unknown occupancy, JSON/copy/redaction, themes, native wheel under overlay, focus and reduced motion. Data is an isolated presentation fixture, not real-provider acceptance.');
} finally {
  await app.close();
}
