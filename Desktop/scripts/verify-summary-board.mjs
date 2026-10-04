import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-summary-board-'));
const workspace = join(profile, 'Summary layout fixture');
await mkdir(workspace);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspace, workspaces: [workspace] }));
const history = join(profile, 'step-runtime', 'sessions');
await mkdir(history, { recursive: true });
const timestamp = new Date().toISOString();
await writeFile(join(history, 'summary-fixture.jsonl'), [
  { type: 'session', version: 3, id: 'summary-fixture', cwd: workspace, timestamp },
  { type: 'message', id: 'user-1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: '查看右侧信息看板与会话布局。' }], timestamp: Date.now() } },
  { type: 'message', id: 'assistant-1', parentId: 'user-1', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '## 布局检查\n\n正文与输入框共用阅读列，右侧看板从顶部向下展开。\n\n窗口宽度足够时显示看板；缩小窗口后保留完整的对话区域。\n\n- 左栏仍可切换会话\n- 右侧工具仍可手动打开\n- 摘要内容暂不填充' + '\n\n正文滚动验收：摘要是非模态看板，打开后仍能阅读正文、选择文字和操作输入框。'.repeat(30) }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, timestamp: Date.now() } },
  { type: 'session_info', id: 'name-1', parentId: 'assistant-1', timestamp, name: '看板布局验收' },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const args = [
  ...(executablePath ? [] : [resolve('.')]),
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
];
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args, env, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setSize(1440, 900);
  });
  page.on('pageerror', error => errors.push(error.message));
  const board = page.getByRole('complementary', { name: '摘要', exact: true });
  const toggle = page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true });
  const settleLayout = () => page.evaluate(async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const animations = [...document.querySelectorAll('.summary-track, .messages, .composer-wrap')]
        .flatMap(element => element.getAnimations()).filter(animation => animation.playState !== 'finished');
      if (!animations.length) return;
      await Promise.all(animations.map(animation => animation.finished.catch(error => {
        if (error.name !== 'AbortError') throw error;
      })));
    }
    throw new Error('Summary layout did not settle after resize');
  });
  const sampleLayoutMotion = () => page.evaluate(() => {
    const elements = [...document.querySelectorAll('.summary-track, .messages, .composer-wrap')];
    const track = document.querySelector('.summary-track');
    const animations = elements.flatMap(element => element.getAnimations());
    if (!track.getAnimations().length) throw new Error('Main-view layout transition is missing');
    animations.forEach(animation => animation.pause());
    const sample = time => {
      animations.forEach(animation => { animation.currentTime = time; });
      const center = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return rect.x + rect.width / 2;
      };
      return { track: track.getBoundingClientRect().width, main: document.querySelector('main').getBoundingClientRect().width,
        messages: center('.messages'), composer: center('.composer-wrap') };
    };
    const result = { start: sample(0), middle: sample(160), end: sample(320) };
    animations.forEach(animation => animation.play());
    return result;
  });
  const assertLayoutMotion = (motion, opening, reservedWidth = 344) => {
    const { start, middle, end } = motion;
    console.log(opening ? 'Opening layout frames:' : 'Closing layout frames:', motion);
    assert.ok(Math.abs(start.track - (opening ? 0 : reservedWidth)) < 1);
    assert.ok(Math.abs(end.track - (opening ? reservedWidth : 0)) < 1);
    assert.ok(opening ? middle.track > reservedWidth / 2 && middle.track < reservedWidth : middle.track > 0 && middle.track < reservedWidth / 2);
    assert.ok(middle.main > Math.min(start.main, end.main) && middle.main < Math.max(start.main, end.main));
    assert.ok(middle.composer > Math.min(start.composer, end.composer) && middle.composer < Math.max(start.composer, end.composer));
    for (const point of [start, middle, end]) assert.ok(Math.abs(point.messages - point.composer) < 2);
  };
  const size = async (width, height = 900) => {
    await app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setSize(...dimensions), [width, height]);
    await page.waitForFunction(width => innerWidth === width, width);
    await page.waitForTimeout(350);
    await settleLayout();
  };
  const setTheme = async theme => {
    const hidden = await page.locator('.app').evaluate(element => element.classList.contains('sidebar-hidden'));
    if (hidden) await page.locator('.window-sidebar-toggle').click();
    await page.locator('.sidebar-bottom > button').click();
    await page.getByRole('button', { name: '通用', exact: true }).click();
    await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption(theme);
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    if (hidden) await page.locator('.window-sidebar-toggle').click();
    await page.waitForTimeout(350);
    await settleLayout();
  };
  const assertNonmodalOverlay = async () => {
    assert.equal(await page.locator('.right-panel-backdrop').count(), 0, 'Summary must not create a full-view input shield');
    const conversation = page.locator('#conversation-scroll');
    await conversation.evaluate(element => { element.scrollTop = 0; });
    await page.waitForTimeout(100);
    const bounds = await conversation.boundingBox();
    await page.mouse.move(bounds.x + 30, bounds.y + Math.min(180, bounds.height / 2));
    await page.mouse.wheel(0, 260);
    await page.waitForFunction(() => document.querySelector('#conversation-scroll').scrollTop > 100);
    assert.equal(await board.isVisible(), true, 'wheel interaction must leave Summary open');
    await page.mouse.click(bounds.x + 30, bounds.y + Math.min(180, bounds.height / 2));
    assert.equal(await board.isVisible(), true, 'reading outside Summary must not dismiss it');
    const input = page.locator('.composer > textarea');
    await input.fill('摘要打开时仍可输入');
    assert.equal(await input.inputValue(), '摘要打开时仍可输入');
    assert.equal(await board.isVisible(), true);
    await input.fill('');
  };
  await board.waitFor();
  assert.equal(await board.evaluate(element => getComputedStyle(element).animationTimingFunction), 'cubic-bezier(0.25, 0.46, 0.45, 0.94)');
  await page.getByRole('button', { name: '看板布局验收', exact: true }).click();
  await page.locator('.response-text').waitFor();
  await settleLayout();
  const layout = () => page.evaluate(() => {
    const rect = selector => {
      const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    return { board: rect('.summary-board'), main: rect('main'), messages: rect('.messages'), composer: rect('.composer-wrap'),
      rail: rect('.right-tool-rail'), viewport: innerHeight };
  });
  let boxes = await layout();
  assert.ok(boxes.board.width >= 300);
  assert.ok(boxes.main.width >= 760);
  assert.ok(boxes.board.bottom < boxes.viewport / 2, 'empty board must not become a full-height sidebar');
  assert.ok(boxes.board.x >= boxes.composer.right + 12 && boxes.board.right <= boxes.rail.x);
  assert.ok(Math.abs(boxes.messages.x + boxes.messages.width / 2 - boxes.composer.x - boxes.composer.width / 2) < 2);
  await page.screenshot({ path: 'test-results/summary-board-desktop-light.png' });
  await setTheme('dark');
  await page.screenshot({ path: 'test-results/summary-board-desktop-dark.png' });
  await size(1920, 1080);
  assert.equal(Math.round((await layout()).messages.width), 1000, 'opening Summary must preserve the wide reading width');
  assert.ok(await page.locator('.summary-track').evaluate(element => element.getBoundingClientRect().width < 120), 'wide windows must spend their existing gutter before moving the reading column');
  await page.screenshot({ path: 'test-results/summary-board-wide.png' });
  await page.locator('.window-sidebar-toggle').click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.summary-track').evaluate(element => element.getBoundingClientRect().width), 0);
  const gutterOpen = await layout();
  await page.screenshot({ path: 'test-results/summary-board-gutter-open.png' });
  await toggle.click();
  await board.waitFor({ state: 'hidden' });
  await settleLayout();
  const gutterClosed = await page.locator('.composer-wrap').boundingBox();
  assert.ok(Math.abs(gutterClosed.x - gutterOpen.composer.x) < 1);
  assert.ok(Math.abs(gutterClosed.width - gutterOpen.composer.width) < 1);
  await page.screenshot({ path: 'test-results/summary-board-gutter-closed.png' });
  await toggle.click();
  await board.waitFor();
  await settleLayout();
  const stationary = await layout();
  assert.ok(Math.abs(stationary.messages.x - gutterOpen.messages.x) < 1 && Math.abs(stationary.composer.x - gutterOpen.composer.x) < 1,
    'enough existing gutter means both transcript and composer stay stationary');
  const controls = await page.locator('.conversation-scroll-track').evaluate(element => {
    const messages = document.querySelector('.messages').getBoundingClientRect();
    const scroll = element.getBoundingClientRect();
    const board = document.querySelector('.summary-board').getBoundingClientRect();
    const marker = document.querySelector('.turn-marker-layer').getBoundingClientRect();
    return { scrollRight: scroll.right, messageRight: messages.right, boardLeft: board.left, markerRight: marker.right };
  });
  assert.ok(Math.abs(controls.scrollRight - controls.messageRight - 14) < 1);
  assert.ok(controls.scrollRight < controls.boardLeft && controls.markerRight < controls.scrollRight);
  await size(1706, 1066);
  const partial = await layout();
  const partialTrack = await page.locator('.summary-track').evaluate(element => element.getBoundingClientRect().width);
  assert.ok(partialTrack > 0 && partialTrack < 80, 'only the missing gutter is reserved near the reported window size');
  assert.ok(partial.board.x >= partial.composer.right + 12);
  await page.screenshot({ path: 'test-results/summary-board-gutter-partial.png' });
  await setTheme('light');
  await page.screenshot({ path: 'test-results/summary-board-gutter-partial-light.png' });
  await setTheme('dark');
  await toggle.click();
  await board.waitFor({ state: 'hidden' });
  assertLayoutMotion(await sampleLayoutMotion(), false, partialTrack);
  await settleLayout();
  const partialClosedCenter = await page.locator('.composer-wrap').evaluate(element => {
    const rect = element.getBoundingClientRect(); return rect.x + rect.width / 2;
  });
  assert.ok(Math.abs(partialClosedCenter - partial.composer.x - partial.composer.width / 2 - partialTrack / 2) < 1);
  await toggle.click();
  await board.waitFor();
  assertLayoutMotion(await sampleLayoutMotion(), true, partialTrack);
  await settleLayout();
  // Reload restores automatic visibility after the manual-toggle checks.
  await page.reload();
  await page.locator('.response-text').waitFor();
  await settleLayout();
  await size(1280, 800);
  await board.waitFor({ state: 'hidden' });
  await page.locator('.window-sidebar-toggle').click();
  await board.waitFor();
  await page.waitForTimeout(350);
  await page.locator('.window-sidebar-toggle').click();
  await board.waitFor({ state: 'hidden' });
  await page.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForFunction(() => innerWidth === 1440);
  await board.waitFor();
  await page.waitForTimeout(350);
  await settleLayout();
  await board.getByRole('button', { name: '关闭侧栏' }).click();
  await board.waitFor({ state: 'hidden' });
  assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
  await size(1600);
  assert.equal(await board.count(), 0, 'explicit close survives resize');
  await toggle.click();
  await board.waitFor();
  assertLayoutMotion(await sampleLayoutMotion(), true);
  const entrance = await board.evaluate(element => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error('Summary entrance animation is missing');
    animation.pause();
    const sample = time => {
      animation.currentTime = time;
      const style = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(style.transform);
      return { x: matrix.m41, y: matrix.m42, opacity: Number(style.opacity) };
    };
    const result = { start: sample(0), middle: sample(160), end: sample(320) };
    animation.play();
    return result;
  });
  assert.equal(entrance.start.x, 10);
  assert.equal(entrance.start.y, -12);
  assert.equal(entrance.start.opacity, 0);
  assert.ok(entrance.middle.x > 0 && entrance.middle.x < 5);
  assert.ok(entrance.middle.y < 0 && entrance.middle.y > -6);
  assert.ok(entrance.middle.opacity > .5 && entrance.middle.opacity < 1);
  assert.deepEqual(entrance.end, { x: 0, y: 0, opacity: 1 });
  await board.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  boxes = await layout();
  const openCenter = boxes.composer.x + boxes.composer.width / 2;
  await page.keyboard.press('Escape');
  await board.waitFor({ state: 'hidden' });
  assertLayoutMotion(await sampleLayoutMotion(), false);
  await settleLayout();
  const closedCenter = await page.locator('.composer-wrap').evaluate(element => {
    const rect = element.getBoundingClientRect(); return rect.x + rect.width / 2;
  });
  assert.ok(closedCenter - openCenter > 150, 'board shifts the composer and transcript left together');
  await size(640, 620);
  assert.equal(await board.count(), 0);
  await page.screenshot({ path: 'test-results/summary-board-small-auto-closed.png' });
  await toggle.click();
  await board.waitFor();
  await settleLayout();
  boxes = await layout();
  assert.ok(boxes.board.x >= 0 && boxes.board.right <= boxes.rail.x);
  assert.ok(boxes.board.bottom < boxes.composer.y);
  assert.ok(Math.abs(boxes.main.width - (640 - 44)) < 1, 'narrow opening must reserve no board column');
  await page.screenshot({ path: 'test-results/summary-board-small-manual.png' });
  await assertNonmodalOverlay();
  await page.screenshot({ path: 'test-results/summary-board-small-hover.png' });
  for (const width of [900, 1280, 1360]) {
    await size(width, 800);
    const retained = await page.evaluate(() => {
      const track = document.querySelector('.summary-track').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      const app = document.querySelector('.app');
      const sidebar = parseFloat(getComputedStyle(app).getPropertyValue('--sidebar-track')) || 0;
      return { track: track.width, main: main.width, available: innerWidth - sidebar - 44 };
    });
    assert.equal(retained.track, 0, 'intermediate windows must not retain a blank docked column');
    assert.ok(Math.abs(retained.main - retained.available) < 1);
    await assertNonmodalOverlay();
    await page.screenshot({ path: `test-results/summary-board-overlay-${width}.png` });
  }
  await size(640, 620);
  await board.getByRole('button', { name: '关闭侧栏' }).click();
  await board.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  assert.equal(await board.evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await page.locator('.summary-track').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '会话导航', exact: true }).click();
  await page.getByRole('complementary', { name: '会话导航', exact: true }).waitFor();
  assert.equal(await board.count(), 0);
  await page.getByRole('button', { name: '关闭右侧面板' }).click({ position: { x: 10, y: 250 } });
  await page.getByRole('complementary', { name: '会话导航', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('Summary board acceptance passed: automatic sizing, manual override, layout, focus, nonmodal overlay wheel/click/input, navigation dismissal, themes and reduced motion.');
} finally {
  await app.close();
}
