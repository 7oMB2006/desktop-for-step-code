import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-fulltext-')));
const project = join(profile, 'project'), other = join(profile, 'other');
const root = join(profile, 'step-runtime'), sessions = join(root, 'sessions');
const workspaceKey = path => process.platform === 'win32' ? path.replaceAll('\\', '/').toLowerCase() : path;
await mkdir(project); await mkdir(other);
await mkdir(join(sessions, 'imported'), { recursive: true });
await mkdir('test-results', { recursive: true });
const preferences = {
  language: 'zh', theme: 'light', workspace: project, workspaces: [project, other],
  workspaceNames: { [workspaceKey(project)]: '阶跃项目', [workspaceKey(other)]: '另一项目' },
  archivedSessionIds: ['fulltext-archived'],
};
await writeFile(join(profile, 'preferences.json'), JSON.stringify(preferences));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
  fixture: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Offline fulltext fixture' }] },
} }));
const originals = new Map();
for (const [id, cwd, directory, days] of [
  ['main', project, sessions, 0], ['imported', other, join(sessions, 'imported'), 0],
  ['archived', project, sessions, 0], ['old', project, sessions, 60],
  ['branch', project, sessions, 0], ['subagent-child', project, sessions, 0],
]) {
  const timestamp = new Date(Date.now() - days * 86400000).toISOString();
  const sessionId = id.startsWith('subagent-') ? id : `fulltext-${id}`;
  const entries = [{ type: 'session', version: 3, id: sessionId, cwd, timestamp }];
  let parentId = null;
  for (let turn = 0; turn < (id === 'main' ? 36 : 1); turn++) {
    const message = (role, text, entryId) => {
      entries.push({ type: 'message', id: entryId, parentId, timestamp, message: {
        role, content: [{ type: 'text', text },
          ...(id === 'main' && role === 'assistant' && turn === 0 ? [{ type: 'text', text: 'laterblockneedle is only in the second text block.' }] : []),
          ...(id === 'main' && role === 'assistant' && turn === 1 ? [{ type: 'text',
            text: 'x'.repeat(40_000) + 'pageneedle is on the third page.\n' + 'y'.repeat(8_000) }] : []),
          ...(id === 'main' && role === 'assistant' && turn === 2 ? [{ type: 'text',
            text: 'x'.repeat(32_764) + 'boundaryneedle crosses a page boundary.\n' + 'y'.repeat(8_000) }] : []),
        ], timestamp: Date.parse(timestamp),
        ...(role === 'assistant' ? { api: 'openai-completions', provider: 'fixture', model: 'fixture',
          stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0,
            totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}),
      } });
      parentId = entryId;
    };
    message('user', `Inspect saved turn ${turn}.`, `user-${turn}`);
    message('assistant', (id === 'main' && turn === 0 ? 'A long saved answer must locate the keyword line, not its midpoint.\n\n'.repeat(24) : '') +
      `bodyneedle ${id} ${turn}: 正文里的事务边界。\n\nKeep the saved conversation readable. ` +
      (turn === 0 ? 'locationneedle 定位关键词。' : 'The search must not replace the active draft.'), `answer-${turn}`);
  }
  if (id === 'branch') {
    entries.push({ type: 'message', id: 'abandoned', parentId, timestamp,
      message: { role: 'user', content: 'abandonedneedle', timestamp: Date.parse(timestamp) } });
  }
  entries.push({ type: 'message', id: 'tool', parentId, timestamp,
    message: { role: 'toolResult', toolCallId: 'fixture', content: [{ type: 'text', text: 'privatetoolneedle' }], timestamp: Date.parse(timestamp) } });
  entries.push({ type: 'session_info', id: 'name', parentId: 'tool', timestamp, name: `Saved ${id}` });
  const path = join(directory, `${id}.jsonl`), content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  originals.set(path, content);
  await writeFile(path, content);
}
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.STEP_API_KEY;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
const errors = [];
let phase = 'startup';
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setSize(1280, 900);
  });
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 4 &&
    !document.querySelector('.new-chat')?.disabled, undefined, { timeout: 60000 });
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  const setTheme = async theme => {
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    // Direct fixture IPC does not run the Settings component's local state update.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' }));
    await page.waitForFunction(theme => document.documentElement.dataset.palette === theme, theme);
  };
  const before = await snapshot();
  const draft = page.getByRole('textbox', { name: '消息', exact: true });
  await draft.fill('Keep this draft while reading search results');
  await page.getByRole('button', { name: '浏览器', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#browser-panel')?.getAttribute('aria-hidden') === 'false');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const quick = page.getByRole('textbox', { name: '搜索会话', exact: true });
  await quick.fill('bodyneedle');
  await page.getByText('没有匹配的会话', { exact: true }).waitFor();
  await page.getByRole('button', { name: '搜索聊天记录', exact: true }).click();
  const panel = page.locator('.fulltext-panel');
  const query = panel.getByRole('textbox', { name: '搜索聊天记录关键词', exact: true });
  const hits = panel.locator('.fulltext-hit');
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.fulltext-scroll')?.getAttribute('aria-busy') === 'false',
      undefined, { timeout: 60000 });
  };
  const updateSearch = async action => {
    await Promise.all([
      page.waitForFunction(() => document.querySelector('.fulltext-scroll')?.getAttribute('aria-busy') === 'true'),
      action(),
    ]);
    await ready();
  };
  const search = text => updateSearch(async () => {
    if (await query.inputValue() === text) await query.press('Enter');
    else await query.fill(text);
  });
  const choose = async (label, value) => {
    await panel.getByRole('button', { name: label, exact: true }).click();
    await updateSearch(() => page.getByRole('menuitemradio', { name: value, exact: true }).click());
  };
  phase = 'native body index and bounded incremental display';
  await hits.first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.fulltext-hit').length === 30 &&
    !document.querySelector('.fulltext-panel')?.textContent.includes('索引建立中，结果尚未覆盖全部记录。'), undefined, { timeout: 60000 });
  await ready();
  assert.equal(await page.locator('.right-tool-rail').isVisible(), false);
  assert.equal(await page.locator('#browser-panel').getAttribute('aria-hidden'), 'true');
  assert.equal(await hits.count(), 30);
  await panel.getByRole('button', { name: /加载更多/ }).click();
  assert.equal(await hits.count(), 39);
  assert.ok(await panel.locator('mark').count());
  const native = await page.evaluate(() => window.desktop.searchSessions({ id: 'native-check', text: 'locationneedle' }));
  assert.equal(native.index.state, 'ready');
  assert.equal(native.hits.length, 4);
  assert.ok(native.hits.every(hit => hit.entryId === 'answer-0' && !('sessionPath' in hit)));
  assert.equal((await page.evaluate(() => window.desktop.searchSessions({ id: 'tool-check', text: 'privatetoolneedle' }))).hits.length, 0);
  phase = 'readonly entry location, highlighting, result scroll and focus return';
  const target = hits.nth(20);
  await target.scrollIntoViewIfNeeded();
  const position = await panel.locator('.fulltext-scroll').evaluate(element => element.scrollTop);
  const identity = await target.getAttribute('data-search-key');
  await target.click();
  await panel.locator('[data-search-match=true]').waitFor();
  assert.ok(await panel.locator('[data-search-match=true]').evaluate(element =>
    document.activeElement === element && element.textContent.includes('bodyneedle')));
  assert.ok(await page.evaluate(() => CSS.highlights.get('desktop-search-match')?.size > 0));
  const preview = await snapshot();
  assert.equal(preview.runtimeId, before.runtimeId);
  assert.equal(preview.draftId, before.draftId);
  assert.deepEqual(preview.runtimes, before.runtimes, 'Search and preview must not start a conversation runtime');
  for (const [path, content] of originals) assert.equal(await readFile(path, 'utf8'), content);
  await panel.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  assert.ok(await panel.locator('.fulltext-scroll').evaluate((element, position) =>
    Math.abs(element.scrollTop - position) < 2, position));
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-search-key')), identity);
  phase = 'imported history, archive, project and time filters';
  await updateSearch(() => panel.getByRole('checkbox', { name: '包含归档', exact: true }).check());
  await panel.getByRole('button', { name: /加载更多/ }).click();
  assert.ok((await hits.allTextContents()).some(text => text.includes('archived')));
  await choose('筛选项目', '另一项目');
  assert.equal(await hits.count(), 1);
  assert.ok((await hits.first().innerText()).includes('imported'));
  await choose('筛选项目', '全部项目');
  await choose('筛选时间', '最近 7 天');
  assert.ok(!(await hits.allTextContents()).some(text => text.includes('old')));
  await choose('筛选时间', '不限时间');
  await updateSearch(() => panel.getByRole('checkbox', { name: '包含归档', exact: true }).uncheck());
  await search('abandonedneedle');
  await hits.first().click();
  await panel.getByText('命中不在当前可见分支，或已被压缩；显示会话当前上下文。', { exact: true }).waitFor();
  assert.equal(await panel.locator('.fulltext-history').getByText('abandonedneedle', { exact: true }).count(), 0);
  await panel.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await search('正文');
  await panel.getByText(/短关键词仅搜索/).waitFor();
  assert.ok(await hits.count());
  phase = 'failure, partial coverage, degraded results and out-of-order responses';
  await app.evaluate(({ ipcMain }) => {
    globalThis.fulltextOriginalHandler = ipcMain._invokeHandlers.get('desktop');
    globalThis.fulltextMode = '';
    globalThis.fulltextCalls = [];
    globalThis.fulltextCancels = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'navigateSession' && globalThis.fulltextNavigationFailure) return null;
      if (method === 'cancelSessionSearch') globalThis.fulltextCancels.push(args[0]);
      if (method !== 'searchSessions' || !globalThis.fulltextMode)
        return globalThis.fulltextOriginalHandler(event, method, ...args);
      const request = args[0], mode = globalThis.fulltextMode;
      globalThis.fulltextCalls.push(request.text);
      if (mode === 'error') throw new Error('Fixture search failure');
      if (mode === 'race' && request.text === 'delayed-old') await new Promise(resolve => setTimeout(resolve, 700));
      return { id: request.id, hits: [{ sessionId: 'fulltext-main', entryId: mode === 'degraded' ? null : 'answer-0',
        role: 'assistant', timestamp: Date.now(), snippet: request.text }],
      index: { state: mode === 'partial' ? 'backfilling' : mode === 'degraded' ? 'degraded' : 'ready',
        indexed: 1, total: mode === 'partial' ? 8 : 1, pending: mode === 'partial' ? 7 : 0, errors: 0 },
      limited: mode === 'limited', limit: 100, shortQuery: false, sessionOnly: mode === 'degraded' };
    });
  });
  const mode = value => app.evaluate((_electron, value) => { globalThis.fulltextMode = value; }, value);
  await mode('error');
  await search('errorneedle');
  await panel.getByRole('alert').waitFor();
  assert.equal(await query.inputValue(), 'errorneedle');
  await mode('partial');
  await panel.getByRole('button', { name: '重新查询', exact: true }).click();
  await panel.getByText('索引建立中，结果尚未覆盖全部记录。', { exact: true }).waitFor();
  const filter = panel.getByRole('button', { name: '筛选项目', exact: true });
  await filter.focus();
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    const calls = globalThis.fulltextCalls.length;
    while (globalThis.fulltextCalls.length === calls && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    if (globalThis.fulltextCalls.length === calls) throw new Error('Backfill did not refresh');
  });
  assert.equal(await filter.evaluate(element => document.activeElement === element), true, 'Background refresh cannot steal filter focus');
  assert.equal(await hits.count(), 1);
  await mode('degraded');
  await search('degradedneedle');
  await panel.getByText(/已降级为会话级匹配/).waitFor();
  await hits.first().click();
  await panel.getByText('这是会话级匹配，显示当前可见上下文。', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await mode('limited');
  await search('limitedneedle');
  await panel.getByText(/已达到 100 条查询上限/).waitFor();
  await mode('race');
  await query.fill('delayed-old');
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.fulltextCalls.includes('delayed-old') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!globalThis.fulltextCalls.includes('delayed-old')) throw new Error('Delayed query did not start');
  });
  await search('latest-result');
  await page.waitForTimeout(800);
  assert.equal(await hits.first().locator('.fulltext-snippet').innerText(), 'latest-result');
  assert.ok(await app.evaluate(() => globalThis.fulltextCancels.length > 0));
  await mode('');
  phase = 'light/dark, narrow, focused outline and reduced motion';
  for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 620], ['dark', 620]]) {
    await setTheme(theme);
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width);
    await search('locationneedle');
    await query.focus();
    const bounds = await query.evaluate(element => {
      const field = element.closest('.fulltext-input'), rect = field.getBoundingClientRect();
      let contained = true;
      for (let parent = field.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) contained &&= rect.left - 4 >= bounds.left && rect.right + 4 <= bounds.right;
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) contained &&= rect.top - 4 >= bounds.top && rect.bottom + 4 <= bounds.bottom;
      }
      return { contained, outline: getComputedStyle(field).outlineWidth, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(bounds, { contained: true, outline: '2px', overflow: false });
    await page.screenshot({ path: `test-results/fulltext-search-${theme}-${width}.png` });
  }
  await query.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  assert.equal(await panel.isVisible(), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await query.press('Escape');
  assert.equal(await panel.isVisible(), false);
  await page.waitForFunction(() => document.activeElement?.classList.contains('window-sidebar-toggle'));
  assert.equal(await page.locator('.window-sidebar-toggle').evaluate(element => document.activeElement === element), true);
  assert.equal(await draft.innerText(), 'Keep this draft while reading search results');
  assert.deepEqual((await snapshot()).preferences.collapsedWorkspaces, before.preferences.collapsedWorkspaces);
  phase = 'explicit navigation only';
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('sidebar-compact'));
  await page.getByRole('button', { name: '搜索聊天记录', exact: true }).click();
  await search('locationneedle');
  await panel.locator('.fulltext-hit[data-search-key*="fulltext-main"]').first().click();
  await panel.locator('[data-search-match=true]').waitFor();
  await app.evaluate(() => { globalThis.fulltextNavigationFailure = true; });
  await panel.getByRole('button', { name: '打开并定位', exact: true }).click();
  await panel.getByText('会话未能打开，请稍后重试。', { exact: true }).waitFor();
  assert.equal((await snapshot()).draftId, before.draftId);
  await app.evaluate(() => { globalThis.fulltextNavigationFailure = false; });
  await panel.getByRole('button', { name: '打开并定位', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'Saved main' &&
    document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false', undefined, { timeout: 60000 });
  assert.equal((await snapshot()).state.sessionId, 'fulltext-main');
  phase = 'authoritative conversation location, persistent return and same-session navigation';
  const locationBar = page.locator('.conversation-search-location');
  const liveMatch = page.locator('#conversation-scroll [data-search-match=true]');
  const located = async () => {
    await liveMatch.waitFor();
    await page.waitForFunction(() => {
      const target = document.querySelector('#conversation-scroll [data-search-match=true]');
      const viewport = document.querySelector('#conversation-scroll');
      if (!target || !viewport) return false;
      const a = target.getBoundingClientRect(), b = viewport.getBoundingClientRect();
      const range = CSS.highlights.get('desktop-conversation-search-match')?.values().next().value;
      const match = range instanceof Range ? range.getBoundingClientRect() : null;
      return a.bottom > b.top && a.top < b.bottom && match && match.top >= b.top && match.bottom <= b.bottom &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 500;
    });
    assert.equal(await liveMatch.getAttribute('data-message-index'), '1');
    assert.ok(await liveMatch.innerText().then(text => text.includes('locationneedle')));
    assert.ok(await page.evaluate(() => CSS.highlights.get('desktop-conversation-search-match')?.size > 0));
  };
  await located();
  assert.equal(await liveMatch.evaluate(element => element === document.activeElement), true, 'Opening cannot return focus to the sidebar');
  await page.waitForTimeout(600);
  await located();
  await page.locator('#conversation-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await locationBar.getByRole('button', { name: '重新定位', exact: true }).click();
  await located();
  const targetRuntime = (await snapshot()).runtimeId;
  await locationBar.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await query.waitFor();
  assert.equal(await query.inputValue(), 'locationneedle');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-search-key')),
    JSON.stringify(['fulltext-main', 'answer-0']));
  await panel.locator('.fulltext-hit[data-search-key*="fulltext-main"]').first().click();
  await panel.getByRole('button', { name: '打开并定位', exact: true }).click();
  await located();
  assert.equal((await snapshot()).runtimeId, targetRuntime, 'Locating in the current session cannot replace its runtime');
  for (const [theme, width] of [['light', 1280], ['dark', 620]]) {
    await setTheme(theme);
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width);
    await locationBar.getByRole('button', { name: '重新定位', exact: true }).click();
    await located();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/fulltext-location-${theme}-${width}.png` });
  }
  phase = 'multiple text blocks, paginated hits and repeat location after manual paging';
  // Normal runtime restoration may append metadata; subsequent reading and locating may not.
  const navigationBaseline = new Map();
  for (const path of originals.keys()) navigationBaseline.set(path, await readFile(path, 'utf8'));
  const assertKeywordVisible = async (selector, highlight, text) => {
    await page.waitForFunction(({ selector, highlight, text }) => {
      const target = document.querySelector(`${selector} [data-search-match=true]`);
      const viewport = document.querySelector(selector);
      const range = CSS.highlights.get(highlight)?.values().next().value;
      if (!target || !viewport || !(range instanceof Range) || !target.textContent.includes(text)) return false;
      const match = range.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      const page = range.startContainer.parentElement?.closest('.large-message-text > pre')?.getBoundingClientRect();
      return range.toString().toLowerCase() === text && match.height > 0 &&
        match.top >= bounds.top && match.bottom <= bounds.bottom &&
        (!page || match.top >= page.top && match.bottom <= page.bottom);
    }, { selector, highlight, text });
  };
  for (const [text, messageIndex, expectedPage] of [
    ['laterblockneedle', '1', undefined], ['pageneedle', '3', '3'], ['boundaryneedle', '5', '2'],
  ]) {
    await locationBar.getByRole('button', { name: '返回搜索结果', exact: true }).click();
    await search(text);
    assert.equal(await hits.count(), 1);
    await hits.first().click();
    await assertKeywordVisible('.fulltext-history', 'desktop-search-match', text);
    assert.equal(await panel.locator('[data-search-match=true]').getAttribute('data-message-index'), messageIndex);
    if (expectedPage) assert.equal(await panel.locator('[data-search-match=true] .large-message-text').getAttribute('data-page'), expectedPage);
    await panel.getByRole('button', { name: '打开并定位', exact: true }).click();
    await assertKeywordVisible('#conversation-scroll', 'desktop-conversation-search-match', text);
    assert.equal(await liveMatch.getAttribute('data-message-index'), messageIndex);
    if (expectedPage) {
      const large = liveMatch.locator('.large-message-text');
      assert.equal(await large.getAttribute('data-page'), expectedPage);
      await large.getByRole('button', { name: '上一段', exact: true }).click();
      assert.notEqual(await large.getAttribute('data-page'), expectedPage);
      await page.waitForTimeout(600);
      assert.notEqual(await large.getAttribute('data-page'), expectedPage, 'Snapshots retain manual page selection');
      await locationBar.getByRole('button', { name: '重新定位', exact: true }).click();
      await assertKeywordVisible('#conversation-scroll', 'desktop-conversation-search-match', text);
      assert.equal(await large.getAttribute('data-page'), expectedPage, 'Explicit repeat location reveals the matching page again');
    }
    assert.equal((await snapshot()).runtimeId, targetRuntime);
    await page.screenshot({ path: `test-results/fulltext-location-${text}.png` });
  }
  for (const [path, content] of navigationBaseline)
    assert.equal(await readFile(path, 'utf8') === content, true, 'Same-session preview and location cannot rewrite JSONL');
  phase = 'message found without a rendered keyword is not reported as a keyword location';
  await locationBar.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await mode('limited');
  await search('notinvisibleprose');
  await hits.first().click();
  await panel.getByText('已找到消息，但当前可见正文没有匹配关键词。', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '打开并定位', exact: true }).click();
  await locationBar.getByText('已找到消息，但当前可见正文没有匹配关键词', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => CSS.highlights.get('desktop-conversation-search-match')?.size), 0);
  await mode('');
  phase = 'missing authoritative entry and conversation-level fallbacks';
  await locationBar.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await search('abandonedneedle');
  await hits.first().click();
  await panel.getByRole('button', { name: '打开并定位', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === 'Saved branch' &&
    document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false', undefined, { timeout: 60000 });
  await locationBar.getByText('命中消息已不在当前上下文中', { exact: true }).waitFor();
  assert.equal(await liveMatch.count(), 0);
  await locationBar.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await mode('degraded');
  await search('degradedneedle');
  await hits.first().click();
  await panel.getByRole('button', { name: '打开此会话', exact: true }).click();
  await locationBar.getByText('会话级匹配，无法定位具体消息', { exact: true }).waitFor();
  assert.equal(await locationBar.getByRole('button', { name: '重新定位', exact: true }).count(), 0);
  await locationBar.getByRole('button', { name: '关闭搜索定位', exact: true }).click();
  assert.equal(await locationBar.count(), 0);
  assert.equal(await page.evaluate(() => CSS.highlights.has('desktop-conversation-search-match')), false);
  await mode('');
  phase = 'English search and escape focus return';
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  await page.evaluate(() => window.desktop.preferences({ language: 'en' }));
  await page.reload();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Search chat history', exact: true }).click();
  const englishQuery = page.getByRole('textbox', { name: 'Search chat history keywords', exact: true });
  await englishQuery.fill('locationneedle');
  await hits.first().waitFor();
  await englishQuery.press('Escape');
  await page.waitForFunction(() => document.activeElement?.classList.contains('sidebar-fulltext-entry'));
  assert.equal(await page.getByRole('button', { name: 'Search chat history', exact: true })
    .evaluate(element => document.activeElement === element), true);
  assert.deepEqual(errors, []);
  console.log('PASS: native fulltext IPC, readonly entry anchors/highlights, imported/archived scope, filters, draft/runtime/JSONL isolation, fallback, cancellation/races, focus return and theme/narrow layouts');
} catch (error) {
  console.error(`Fulltext phase: ${phase}`);
  const page = await app.firstWindow().catch(() => null);
  if (page) {
    await page.screenshot({ path: 'test-results/fulltext-search-failure.png' }).catch(() => {});
    console.error(await page.locator('.app-error-banner').allTextContents().catch(() => []));
    console.error(await page.evaluate(() => ({ focus: document.activeElement?.outerHTML.slice(0, 600) })).catch(() => null));
  }
  throw error;
} finally {
  await closeDesktopFixture(app);
}
