import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, realpath, writeFile, utimes } from 'node:fs/promises';
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
async function launch() {
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
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
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
async function drag(page, from, to, after = false, cancel = false) {
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
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  assert.deepEqual((await page.evaluate(() => window.desktop.snapshot())).preferences.workspaces.map(key), [key(projects[2]), key(projects[0]), key(projects[1])]);
  await project(page, 0).locator('.workspace-heading').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pinned-projects > .workspace-group').length === 1);
  assert.deepEqual(await projectOrder(page), [key(projects[1]), key(projects[2]), key(projects[0])]);
  await assert.rejects(page.evaluate(() => window.desktop.preferences({ workspaces: ['C:/not-remembered'] })), /Invalid workspace order/);
  const beforeRestart = await readFile(join(profile, 'preferences.json'), 'utf8');
  mark('app restart');
  closing = true;
  await app.close(); app = null;
  page = await launch();
  await page.waitForFunction(() => ['sidebar-0', 'sidebar-1', 'sidebar-2'].every(id =>
    document.querySelector(`[data-reorder-kind="session"][data-reorder-id="${id}"]`)));
  assert.deepEqual(await projectOrder(page), [key(projects[1]), key(projects[2]), key(projects[0])]);
  const restoredFixtureOrder = (await rows(project(page, 0))).filter(id => id.startsWith('sidebar-'));
  assert.deepEqual(restoredFixtureOrder, JSON.parse(beforeRestart).sessionOrder.filter(id => ['sidebar-0', 'sidebar-1', 'sidebar-2'].includes(id)));
  mark('narrow layout and keyboard reorder');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 780));
  await page.waitForFunction(() => document.querySelector('.app').classList.contains('sidebar-compact'));
  await page.locator('.window-sidebar-toggle').click();
  await page.locator('.sidebar').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'test-results/sidebar-order-narrow.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await project(page, 0).locator('.workspace-toggle').press('Alt+ArrowUp');
  await waitOrder(page, [key(projects[1]), key(projects[0]), key(projects[2])]);
  assert.deepEqual(errors, []);
  console.log('Sidebar: manual session/project drag, cancel, group boundaries, pins, sorting, IPC validation, reload/relaunch, narrow and reduced motion passed.');
} catch (error) {
  console.error(`Sidebar acceptance failed during ${phase}`);
  throw error;
} finally {
  closing = true;
  if (app) await app.close();
}
