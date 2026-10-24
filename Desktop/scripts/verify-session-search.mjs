import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-session-search-')));
const project = join(profile, 'project');
const other = join(profile, 'other');
const standalone = join(profile, 'standalone');
const root = join(profile, 'step-runtime');
const projectKey = project.replaceAll('\\', '/').toLowerCase();
const otherKey = other.replaceAll('\\', '/').toLowerCase();
await mkdir(project);
await mkdir(other);
await mkdir(standalone);
await mkdir(join(root, 'sessions'), { recursive: true });
await mkdir('test-results', { recursive: true });
const saved = {
  language: 'zh', theme: 'light', workspaces: [project, other], workspace: project,
  workspaceNames: { [projectKey]: '阶跃项目', [otherKey]: '另一项目' },
  pinnedWorkspaces: [projectKey], collapsedWorkspaces: [projectKey, '__independent__'],
  archivedSessionIds: ['search-archived'], sessionOrder: ['search-beta', 'search-alpha', 'search-independent', 'search-other'],
};
await writeFile(join(profile, 'preferences.json'), JSON.stringify(saved));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
  fixture: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', apiKey: 'local-test-only',
    models: [{ id: 'fixture', name: 'Offline search verification' }] },
} }));
for (const [id, name, text, cwd] of [
  ['alpha', '修复登录', 'Investigate TOKEN refresh', project],
  ['beta', '登录测试', 'Check sign in', project],
  ['independent', '独立研究', 'Research notes', standalone],
  ['other', '界面布局', 'Review sidebar spacing', other],
  ['archived', '归档登录', 'TOKEN archived', project],
]) {
  const timestamp = new Date().toISOString();
  const entries = [
    { type: 'session', version: 3, id: `search-${id}`, cwd, timestamp },
    { type: 'message', id: 'user', parentId: null, timestamp,
      message: { role: 'user', content: [{ type: 'text', text }], timestamp: Date.parse(timestamp) } },
    { type: 'session_info', id: 'name', parentId: 'user', timestamp, name },
  ];
  await writeFile(join(root, 'sessions', `search-${id}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
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
  });
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 4 && !document.querySelector('.new-chat')?.disabled,
    undefined, { timeout: 60000 });
  const search = page.getByRole('textbox', { name: '搜索会话', exact: true });
  const tree = page.locator('.workspace-tree');
  const projectGroup = page.locator('[data-reorder-kind="workspace"]').filter({ has: page.getByRole('button', { name: '阶跃项目', exact: true }) });
  const rowIds = () => tree.locator('.session-row').evaluateAll(rows => rows.map(row => row.dataset.reorderId));
  const snapshot = () => page.evaluate(() => window.desktop.snapshot());
  const before = await snapshot();
  const beforeIds = await rowIds();
  const message = page.getByRole('textbox', { name: '消息', exact: true });
  await message.fill('Keep my draft while searching');
  const searchToggle = page.getByRole('button', { name: '搜索', exact: true });
  const anchor = await searchToggle.boundingBox();
  await searchToggle.press('Enter');
  assert.equal(await search.evaluate(input => document.activeElement === input && !input.readOnly), true);
  await page.locator('.sidebar-search-field').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });
  assert.deepEqual(await page.locator('.sidebar-search-toggle').boundingBox(), anchor);
  phase = 'matches and temporary expansion';
  for (const query of ['token', 'TOKEN 阶跃', '修复登录', project.replaceAll('\\', '/') + ' token']) {
    await search.fill(query);
    await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 1);
    assert.deepEqual(await rowIds(), ['search-alpha'], query);
    assert.equal(await projectGroup.locator('.workspace-disclosure').getAttribute('aria-hidden'), 'false');
    assert.ok(await tree.locator('.session-search-preview').innerText());
  }
  await search.fill('阶跃项目');
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 2);
  assert.deepEqual(await rowIds(), ['search-beta', 'search-alpha'], 'Saved order is retained within results');
  await search.fill('独立会话');
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 1);
  assert.deepEqual(await rowIds(), ['search-independent']);
  assert.equal(await tree.locator('.independent-group .workspace-disclosure').getAttribute('aria-hidden'), 'false');
  await search.fill('阶跃项目');
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 2);
  const orderBefore = (await snapshot()).preferences.sessionOrder;
  await tree.locator('[data-reorder-id="search-alpha"] > button').first().press('Alt+ArrowUp');
  assert.deepEqual((await snapshot()).preferences.sessionOrder, orderBefore, 'Filtered rows cannot rewrite manual order');
  phase = 'no matches and composition escape';
  await search.fill('not-found');
  await page.getByText('没有匹配的会话', { exact: true }).waitFor();
  assert.equal(await tree.locator('.workspace-group').count(), 0, 'Do not leave empty project headings');
  await search.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  assert.equal(await page.locator('.sidebar-search-field').evaluate(element => element.inert), false, 'IME Escape does not dismiss search');
  phase = 'query does not launch a worker or discard the draft';
  const after = await snapshot();
  assert.equal(after.draftId, before.draftId);
  assert.equal(after.runtimeId, before.runtimeId);
  assert.deepEqual(after.runtimes, before.runtimes);
  assert.deepEqual(after.preferences.collapsedWorkspaces, before.preferences.collapsedWorkspaces);
  assert.equal(await message.innerText(), 'Keep my draft while searching');
  await search.press('Escape');
  assert.equal(await searchToggle.evaluate(button => document.activeElement === button), true);
  assert.deepEqual(await rowIds(), beforeIds);
  assert.equal(await projectGroup.locator('.workspace-disclosure').getAttribute('aria-hidden'), 'true');
  phase = 'light, dark, narrow and keyboard focus bounds';
  for (const [theme, width] of [['light', 1200], ['dark', 1200], ['light', 600], ['dark', 600]]) {
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await page.reload();
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 850), width);
    await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
    if (width < 760) {
      await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('sidebar-compact'));
      const toggle = page.locator('.window-sidebar-toggle');
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    }
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await search.fill('登录');
    await search.press('ArrowRight');
    const focus = await search.evaluate(input => {
      const row = input.closest('.sidebar-utility-row');
      const style = getComputedStyle(row), rect = row.getBoundingClientRect();
      let contained = true;
      for (let parent = row.parentElement; parent; parent = parent.parentElement) {
        const bounds = parent.getBoundingClientRect(), css = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) contained &&= rect.left - 4 >= bounds.left && rect.right + 4 <= bounds.right;
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) contained &&= rect.top - 4 >= bounds.top && rect.bottom + 4 <= bounds.bottom;
      }
      return { outline: style.outlineWidth, contained, noOverflow: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.deepEqual(focus, { outline: '2px', contained: true, noOverflow: true });
    await page.locator('.sidebar').evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).filter(animation =>
        animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: `test-results/session-search-${theme}-${width}.png` });
  }
  phase = 'opening a filtered result';
  await tree.locator('[data-reorder-id="search-alpha"] > button').first().click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '修复登录' &&
    document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false' &&
    !document.querySelector('.composer > .composer-input')?.disabled, undefined, { timeout: 60000 });
  assert.equal((await snapshot()).state.sessionId, 'search-alpha');
  await page.evaluate(() => window.desktop.preferences({ language: 'en' }));
  await page.reload();
  await page.locator('.window-sidebar-toggle[aria-expanded=false]').click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('missing');
  await page.getByText('No matching sessions', { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('textbox', { name: 'Search sessions', exact: true }).press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: session search, saved ordering, temporary expansion, archived exclusion, draft/runtime isolation, filtered navigation, IME, focus bounds, themes and narrow layouts');
} catch (error) {
  console.error(`Session search phase: ${phase}`);
  const page = await app.firstWindow().catch(() => null);
  if (page) {
    await page.screenshot({ path: 'test-results/session-search-failure.png' }).catch(() => {});
    console.error(await page.locator('.app-error-banner').allTextContents().catch(() => []));
  }
  throw error;
} finally {
  await closeDesktopFixture(app);
}
