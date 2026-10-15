import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, realpath, writeFile, utimes, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Windows runner TEMP can use an 8.3 alias; match the main process's canonical paths.
const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-desktop-sidebar-')));
const projects = ['Desktop For Step Code', 'Frontend', 'Research'].map(name => join(profile, name));
for (const path of projects) await mkdir(path);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ theme: 'light', language: 'zh', workspaces: projects, sessionOrder: Array.from({ length: 5 }, (_, i) => `sidebar-${i}`) }));
const sessionsDir = join(profile, 'step-runtime', 'sessions');
await mkdir(sessionsDir, { recursive: true });
for (let index = 0; index < 5; index++) {
  const timestamp = new Date(Date.now() - index * 1000).toISOString();
  const entries = [
    { type: 'session', version: 3, id: `sidebar-${index}`, cwd: projects[index < 3 ? 0 : index - 2], timestamp },
    { type: 'message', id: 'user-1', parentId: null, timestamp, message: { role: 'user', content: [{ type: 'text', text: `Task ${index}` }], timestamp: Date.parse(timestamp) } },
    { type: 'session_info', id: 'name-1', parentId: 'user-1', timestamp, name: ['Main feature', 'Fix streaming', 'Runtime baseline', 'Layout', 'Investigation'][index] },
  ];
  await writeFile(join(sessionsDir, `sidebar-${index}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await utimes(join(sessionsDir, `sidebar-${index}.jsonl`), new Date(timestamp), new Date(timestamp));
}
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
let phase = 'fixture setup';
let closing = false;
const mark = value => { phase = value; console.log(`Sidebar acceptance: ${phase}`); };
process.on('exit', code => {
  if (code !== 0) console.error(`Sidebar acceptance exited (${code}) during ${phase}`);
});
async function launch(unavailable = false) {
  mark('Electron launch');
  closing = false;
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  app.process().on('exit', (code, signal) => {
    if (!closing) console.error(`Unexpected Electron exit during ${phase}: code=${code}, signal=${signal}`);
  });
  mark('first window');
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    // An isolated acceptance window must never wait on an invisible native quit confirmation.
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  page.on('pageerror', error => errors.push(error.message));
  mark('runtime ready');
  if (unavailable) await page.locator('.app-error-banner').waitFor({ timeout: 60000 });
  else await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled &&
    ['sidebar-0', 'sidebar-1', 'sidebar-2', 'sidebar-3', 'sidebar-4'].every(id =>
      document.querySelector(`[data-reorder-kind="session"][data-reorder-id="${id}"]`)));
  return page;
}
const key = path => path.replaceAll('\\', '/').toLowerCase();
const project = (page, index) => page.locator(`[data-reorder-kind="workspace"][data-reorder-id="${key(projects[index])}"]`);
const session = (page, index) => page.locator(`[data-reorder-kind="session"][data-reorder-id="sidebar-${index}"]`);
const rows = group => group.locator('.session-row').evaluateAll(rows => rows.map(row => row.dataset.reorderId));
const projectOrder = page => page.locator('[data-reorder-kind="workspace"]').evaluateAll(rows => rows.map(row => row.dataset.reorderId));
const waitOrder = async (page, expected) => page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('[data-reorder-kind="workspace"]')].map(row => row.dataset.reorderId)) === JSON.stringify(expected), expected);
const settle = locator => locator.evaluate(async element => {
  await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {})));
});
async function drag(page, from, to, after = false, cancel = false) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(document.querySelector('.workspace-tree').getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
  });
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  await page.mouse.move(source.x + 65, source.y + 17);
  await page.mouse.down();
  await page.waitForTimeout(340);
  await page.locator('.session-drag-preview').waitFor();
  await page.mouse.move(target.x + 65, target.y + (after ? target.height - 3 : 3), { steps: 8 });
  if (cancel) await page.keyboard.press('Escape');
  else await page.screenshot({ path: 'test-results/sidebar-dragging.png' });
  await page.mouse.up();
  await page.locator('.session-drag-preview').waitFor({ state: 'detached' });
}
try {
  let page = await launch();
  mark('session drag and cancellation');
  const initialOrder = await rows(project(page, 0));
  const initialActive = (await page.evaluate(() => window.desktop.snapshot())).state.sessionId;
  assert.deepEqual(await projectOrder(page), projects.map(key));
  await drag(page, session(page, 2), session(page, 0));
  await page.waitForFunction(() => document.querySelector('[data-reorder-kind="workspace"] .session-row').dataset.reorderId === 'sidebar-2');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).state.sessionId, initialActive, 'drag must not navigate');
  const reorderedSessions = await rows(project(page, 0));
  assert.deepEqual(reorderedSessions, ['sidebar-2', ...initialOrder.filter(id => id !== 'sidebar-2')]);
  await drag(page, session(page, 0), session(page, 1), true, true);
  assert.deepEqual(await rows(project(page, 0)), reorderedSessions, 'Escape cancels without changing order');
  await drag(page, session(page, 0), session(page, 3));
  assert.deepEqual(await rows(project(page, 0)), reorderedSessions, 'cross-project session drag is ignored');

  mark('project drag and pinning');
  await drag(page, project(page, 2).locator('.workspace-toggle'), project(page, 0));
  await waitOrder(page, [key(projects[2]), key(projects[0]), key(projects[1])]);
  assert.equal(await project(page, 2).locator('.workspace-toggle').getAttribute('aria-expanded'), 'true', 'drag must not toggle project');
  await project(page, 0).locator('.workspace-heading').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '置顶项目', exact: true }).click();
  await page.locator('.pinned-projects').waitFor();
  assert.equal(await page.locator('.workspace-tree').evaluate(tree => tree.firstElementChild.classList.contains('independent-group')), true);
  assert.equal(await page.locator('.pinned-projects > .section-label button').count(), 0);
  assert.equal(await page.locator(`[data-reorder-kind="workspace"][data-reorder-id="${key(projects[0])}"]`).count(), 1);
  await project(page, 1).locator('.workspace-heading').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '置顶项目', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pinned-projects > .workspace-group').length === 2);
  await drag(page, project(page, 1).locator('.workspace-toggle'), project(page, 0));
  await waitOrder(page, [key(projects[1]), key(projects[0]), key(projects[2])]);
  await page.screenshot({ path: 'test-results/sidebar-order-light.png' });
  await page.locator('.sidebar').screenshot({ path: 'test-results/sidebar-order-light-detail.png' });

  mark('sorting settings');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  const sort = page.getByLabel('会话排序', { exact: true });
  assert.equal(await sort.inputValue(), 'manual');
  await sort.selectOption('updated');
  await page.waitForFunction(() => document.querySelector('[data-reorder-id="sidebar-0"]').parentElement.firstElementChild.dataset.reorderId === 'sidebar-0');
  assert.deepEqual(await projectOrder(page), [key(projects[1]), key(projects[0]), key(projects[2])]);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const beforeUpdatedDrag = await rows(project(page, 0));
  const updatedSource = await session(page, 2).boundingBox();
  await page.mouse.move(updatedSource.x + 65, updatedSource.y + 17);
  await page.mouse.down(); await page.waitForTimeout(340);
  assert.equal(await page.locator('.session-drag-preview').count(), 0, 'updated sessions cannot be manually dragged');
  await page.mouse.move(400, updatedSource.y);
  await page.mouse.up();
  assert.deepEqual(await rows(project(page, 0)), beforeUpdatedDrag);
  await drag(page, project(page, 1).locator('.workspace-toggle'), project(page, 0), true);
  await waitOrder(page, [key(projects[0]), key(projects[1]), key(projects[2])]);
  await drag(page, project(page, 1).locator('.workspace-toggle'), project(page, 0));
  await waitOrder(page, [key(projects[1]), key(projects[0]), key(projects[2])]);
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await sort.selectOption('manual');
  await page.waitForFunction(() => document.querySelector('[data-reorder-id="sidebar-2"]').parentElement.firstElementChild.dataset.reorderId === 'sidebar-2');
  await page.screenshot({ path: 'test-results/sidebar-order-settings.png' });
  await page.getByLabel('主题').selectOption('dark');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'test-results/sidebar-order-dark.png' });
  await page.locator('.sidebar').screenshot({ path: 'test-results/sidebar-order-dark-detail.png' });
  mark('reload');
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => ['sidebar-0', 'sidebar-1', 'sidebar-2'].every(id =>
    document.querySelector(`[data-reorder-kind="session"][data-reorder-id="${id}"]`)));
  assert.deepEqual(await rows(project(page, 0)), reorderedSessions);
  assert.deepEqual(await projectOrder(page), [key(projects[1]), key(projects[0]), key(projects[2])]);
  mark('remembered project open');

  // Reopening a remembered project cannot promote it above its saved siblings.
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, projects[0]);
  await page.locator('.workspace-tree > .section-label').hover();
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).preferences.workspaces.map(key), [key(projects[2]), key(projects[0]), key(projects[1])]);
  await project(page, 0).locator('.workspace-heading').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pinned-projects > .workspace-group').length === 1);
  assert.deepEqual(await projectOrder(page), [key(projects[1]), key(projects[2]), key(projects[0])]);
  await assert.rejects(page.evaluate(() => window.desktop.preferences({ workspaces: ['C:/not-remembered'] })), /Invalid workspace order/);
  mark('persisted project disclosure');
  await project(page, 1).locator('.workspace-toggle').click();
  await project(page, 2).locator('.workspace-toggle').click();
  const independentToggle = page.locator('.independent-group .workspace-toggle');
  await independentToggle.click();
  const collapsed = [key(projects[1]), key(projects[2]), '__independent__'];
  await page.waitForFunction(expected => expected.every(key =>
    key === '__independent__'
      ? document.querySelector('.independent-group .workspace-toggle')?.getAttribute('aria-expanded') === 'false'
      : document.querySelector(`[data-reorder-id="${key}"] .workspace-toggle`)?.getAttribute('aria-expanded') === 'false'), collapsed);
  await page.reload();
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  for (const index of [1, 2]) assert.equal(await project(page, index).locator('.workspace-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await independentToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await project(page, 0).locator('.workspace-toggle').getAttribute('aria-expanded'), 'true');
  const beforeRestart = await readFile(join(profile, 'preferences.json'), 'utf8');
  assert.deepEqual(JSON.parse(beforeRestart).collapsedWorkspaces.sort(), collapsed.sort());
  mark('app restart');
  closing = true;
  await app.close(); app = null;
  page = await launch();
  await page.waitForFunction(() => ['sidebar-0', 'sidebar-1', 'sidebar-2'].every(id =>
    document.querySelector(`[data-reorder-kind="session"][data-reorder-id="${id}"]`)));
  assert.deepEqual(await projectOrder(page), [key(projects[1]), key(projects[2]), key(projects[0])]);
  const restoredFixtureOrder = (await rows(project(page, 0))).filter(id => id.startsWith('sidebar-'));
  assert.deepEqual(restoredFixtureOrder, JSON.parse(beforeRestart).sessionOrder.filter(id => ['sidebar-0', 'sidebar-1', 'sidebar-2'].includes(id)));
  for (const index of [1, 2]) assert.equal(await project(page, index).locator('.workspace-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.independent-group .workspace-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await project(page, 0).locator('.workspace-toggle').getAttribute('aria-expanded'), 'true');
  // Multiple clicks in one frame must compose rather than lose another group's state.
  await page.evaluate(keys => {
    for (const key of keys) document.querySelector(`[data-reorder-id="${key}"] .workspace-toggle`).click();
  }, [key(projects[0]), key(projects[1]), key(projects[0])]);
  await page.waitForFunction(async expected => {
    const snapshot = await window.desktop.snapshot();
    return JSON.stringify([...(snapshot.preferences.collapsedWorkspaces ?? [])].sort()) === JSON.stringify(expected);
  }, [key(projects[2]), '__independent__'].sort());
  await page.waitForFunction(keys => keys.every(key =>
    document.querySelector(`[data-reorder-id="${key}"] .workspace-toggle`)?.getAttribute('aria-expanded') === 'true'),
  [key(projects[0]), key(projects[1])]);
  assert.equal(await project(page, 0).locator('.workspace-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await project(page, 1).locator('.workspace-toggle').getAttribute('aria-expanded'), 'true');
  await project(page, 2).locator('.workspace-toggle').click();
  await page.locator('.independent-group .workspace-toggle').click();
  await page.waitForFunction(async () => (await window.desktop.snapshot()).preferences.collapsedWorkspaces?.length === 0);
  mark('narrow layout and keyboard reorder');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 780));
  await page.waitForFunction(() => document.querySelector('.app').classList.contains('sidebar-compact'));
  await page.locator('.window-sidebar-toggle').click();
  await page.locator('.sidebar').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/sidebar-order-narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await project(page, 0).locator('.workspace-toggle').press('Alt+ArrowUp');
  await waitOrder(page, [key(projects[1]), key(projects[0]), key(projects[2])]);
  mark('missing project recovery and removal');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 820));
  await page.waitForFunction(() => !document.querySelector('.app').classList.contains('sidebar-compact'));
  await page.mouse.move(600, 400);
  assert.equal(await project(page, 2).locator('.workspace-heading > .icon-button').first().evaluate(button => getComputedStyle(button).opacity), '0');
  await project(page, 2).locator('.workspace-heading').hover();
  await page.waitForFunction(path => getComputedStyle(document.querySelector(`[data-reorder-id="${path}"] .workspace-heading > .icon-button`)).opacity === '1', key(projects[2]));
  const relocated = join(profile, 'Research renamed');
  const railTop = await page.locator('.right-tool-rail').evaluate(element => element.getBoundingClientRect().top);
  await page.evaluate(path => window.desktop.beginSession(path), projects[2]);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  await rename(projects[2], relocated);
  await project(page, 2).locator('.workspace-toggle').click();
  await page.waitForFunction(key => document.querySelector(`[data-reorder-id="${key}"] .workspace-toggle`)?.getAttribute('aria-expanded') === 'false', key(projects[2]));
  await project(page, 2).locator('.workspace-heading').hover();
  await project(page, 2).getByRole('button', { name: '在 Research 新建会话', exact: true }).click();
  const banner = page.locator('.app-error-banner');
  await banner.waitFor();
  assert.equal(await project(page, 2).locator('.workspace-toggle').getAttribute('aria-expanded'), 'true', 'new-session action expands its project');
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.collapsedWorkspaces.includes(key(projects[2])), false);
  assert.equal(await page.locator('.right-tool-rail').evaluate(element => element.getBoundingClientRect().top), railTop,
    'a main-view warning never displaces the fixed right rail');
  assert.equal(await banner.evaluate(element => element.parentElement.tagName), 'MAIN');
  assert.match(await banner.innerText(), /项目目录不可用/);
  assert.doesNotMatch(await banner.innerText(), /Error invoking remote method|ENOENT/);
  await page.locator('.right-tool-rail').getByRole('button', { name: '摘要', exact: true }).click();
  await page.locator('.summary-board').waitFor({ state: 'visible' });
  await settle(page.locator('.summary-board'));
  assert.equal(await banner.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.right - 20, rect.top + rect.height / 2)?.closest('.app-error-banner') === element;
  }), true, 'the warning is above the summary');
  await page.mouse.move(400, 400);
  await page.locator('[role="tooltip"]').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/sidebar-project-warning-dark.png' });
  await page.reload();
  await banner.waitFor();
  assert.match(await banner.innerText(), /Research/);
  mark('warning controls above an expanded inspector');
  await page.locator('.right-tool-rail').getByRole('button', { name: '上下文', exact: true }).click();
  const contextPanel = page.locator('#context-panel');
  // The high-priority warning can cover the inspector header; use its keyboard control.
  await contextPanel.getByRole('button', { name: '全屏查看', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.main-content').inert);
  assert.equal(await banner.evaluate(element => !!element.closest('[inert]')), false);
  await banner.getByRole('button', { name: '关闭', exact: true }).focus();
  assert.equal(await banner.getByRole('button', { name: '关闭', exact: true }).evaluate(button => button === document.activeElement), true);
  await page.screenshot({ path: 'test-results/sidebar-warning-expanded-inspector.png' });
  await banner.getByRole('button', { name: '移除项目', exact: true }).click();
  const expandedRemoval = page.getByRole('dialog', { name: '移除项目', exact: true });
  await expandedRemoval.waitFor();
  await expandedRemoval.getByRole('button', { name: '取消', exact: true }).click();
  await expandedRemoval.waitFor({ state: 'detached' });
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await banner.getByRole('button', { name: '重新定位', exact: true }).click();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.workspaces.includes(projects[2]), true);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, relocated);
  await banner.getByRole('button', { name: '重新定位', exact: true }).click();
  await banner.waitFor({ state: 'detached' });
  await page.waitForFunction(path => !!document.querySelector(`[data-reorder-id="${path}"]`), key(relocated));
  await page.locator(`[data-reorder-kind="workspace"][data-reorder-id="${key(relocated)}"] [data-reorder-id="sidebar-4"]`).waitFor();
  assert.equal(await page.locator(`[data-reorder-id="${key(projects[2])}"]`).count(), 0,
    'draft relocation refreshes catalog grouping before another snapshot');
  await contextPanel.getByRole('button', { name: '还原侧栏', exact: true }).focus();
  await page.keyboard.press('Enter');
  await session(page, 4).locator('button').first().click();
  await page.waitForFunction(() => document.querySelector('.session-row.selected')?.dataset.reorderId === 'sidebar-4');
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled &&
    !document.querySelector('.composer-wrap.session-navigation-pending'));
  await page.evaluate(path => window.desktop.relocateWorkspace(path), relocated);
  const repaired = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(repaired.state.sessionId, 'sidebar-4', 'the active original session is restored');
  assert.equal(repaired.preferences.workspace, relocated);
  assert.equal(repaired.sessions.find(session => session.id === 'sidebar-4').cwd, relocated);
  assert.equal(repaired.sessions.find(session => session.id === 'sidebar-4').independent, false);
  await page.reload();
  await page.waitForFunction(path => !!document.querySelector(`[data-reorder-id="${path}"]`), key(relocated));
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).sessions.find(session => session.id === 'sidebar-4').cwd, relocated);
  mark('recreated old directory keeps new sessions separate');
  await mkdir(projects[2]);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, projects[2]);
  const draft = await page.evaluate(() => window.desktop.chooseSessionProject());
  assert.equal(draft.preferences.workspace, projects[2]);
  const freshId = 'sidebar-recreated';
  const timestamp = new Date().toISOString();
  await writeFile(join(sessionsDir, `${freshId}.jsonl`), [
    { type: 'session', version: 3, id: freshId, cwd: projects[2], timestamp },
    { type: 'message', id: 'user-1', parentId: null, timestamp,
      message: { role: 'user', content: [{ type: 'text', text: 'New project at the reused path' }], timestamp: Date.parse(timestamp) } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const fresh = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(fresh.sessions.find(session => session.id === freshId).cwd, projects[2]);
  assert.equal(fresh.sessions.find(session => session.id === 'sidebar-4').cwd, relocated);
  await page.reload();
  const catalog = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(catalog.sessions.find(session => session.id === freshId).cwd, projects[2]);
  assert.equal(catalog.sessions.find(session => session.id === freshId).workspacePath, projects[2]);
  const openedFresh = await page.evaluate(id => window.desktop.navigateSession(id), freshId);
  assert.equal(openedFresh.state.sessionId, freshId);
  assert.equal(openedFresh.preferences.workspace, projects[2]);
  const reopened = await page.evaluate(() => window.desktop.navigateSession('sidebar-4'));
  assert.equal(reopened.state.sessionId, 'sidebar-4');
  assert.equal(reopened.preferences.workspace, relocated);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.session-row.selected')?.dataset.reorderId === 'sidebar-4' &&
    !document.querySelector('.new-chat')?.disabled);
  const relocatedGroup = page.locator(`[data-reorder-kind="workspace"][data-reorder-id="${key(relocated)}"]`);
  await relocatedGroup.locator('.workspace-heading').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移除项目…', exact: true }).click();
  const removal = page.getByRole('dialog', { name: '移除项目', exact: true });
  await removal.waitFor();
  assert.match(await removal.innerText(), /磁盘文件不会删除/);
  assert.equal(await removal.evaluate(element => getComputedStyle(element).animationName), 'settings-dialog-enter');
  await settle(page.locator('.project-removal-backdrop'));
  await page.screenshot({ path: 'test-results/sidebar-project-removal-dark.png' });
  await removal.getByRole('button', { name: '取消', exact: true }).click();
  await removal.waitFor({ state: 'detached' });
  assert.equal(await relocatedGroup.count(), 1, 'cancel leaves the project registered');
  await page.evaluate(() => window.desktop.preferences({ theme: 'light' }));
  await page.reload();
  await relocatedGroup.waitFor();
  await relocatedGroup.locator('.workspace-heading').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移除项目…', exact: true }).click();
  await removal.waitFor();
  await settle(page.locator('.project-removal-backdrop'));
  await page.screenshot({ path: 'test-results/sidebar-project-removal-light.png' });
  await removal.getByRole('button', { name: '移除项目', exact: true }).click();
  await removal.waitFor({ state: 'detached' });
  await relocatedGroup.waitFor({ state: 'detached' });
  const removed = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(removed.sessions.find(session => session.id === 'sidebar-4').independent, true);
  assert.equal(removed.state.sessionId, 'sidebar-4', 'removal does not close a resident session');
  assert.equal((await stat(relocated)).isDirectory(), true);
  assert.match(await readFile(join(sessionsDir, 'sidebar-4.jsonl'), 'utf8'), /Task 4/);
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.independent-group [data-reorder-id="sidebar-4"]'));
  mark('missing directory on app startup');
  closing = true;
  await app.close(); app = null;
  const missing = join(profile, 'Missing startup project');
  const recovery = join(profile, 'Recovered startup project');
  await mkdir(recovery);
  const preferencesPath = join(profile, 'preferences.json');
  const stored = JSON.parse(await readFile(preferencesPath, 'utf8'));
  await writeFile(preferencesPath, JSON.stringify({ ...stored, workspaces: [...stored.workspaces, missing], workspace: missing }));
  page = await launch(true);
  const startupSnapshot = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(startupSnapshot.workspaceIssue, missing);
  assert.equal(startupSnapshot.preferences.workspace, missing);
  assert.equal(startupSnapshot.draftId, undefined, 'failed startup must not retain the empty bootstrap draft');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, recovery);
  await page.locator('.app-error-banner').getByRole('button', { name: '重新定位', exact: true }).click();
  await page.locator('.app-error-banner').waitFor({ state: 'detached' });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).preferences.workspace, recovery);
  assert.deepEqual(errors, []);
  console.log('Sidebar: reorder, pins, sorting, missing-path repair, retained session identity/history, warning layering, removal/cancel, hover controls, reload and reduced motion passed.');
} catch (error) {
  console.error(`Sidebar acceptance failed during ${phase}`);
  throw error;
} finally {
  closing = true;
  if (app) await app.close();
}
