import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, realpath, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-desktop-archives-')));
const projects = [join(profile, 'Desktop For Step Code'), join(profile, '阶跃测试')];
const independent = join(profile, 'workspaces', 'independent', 'archived');
for (const path of [...projects, independent]) await mkdir(path, { recursive: true });
const sentinel = join(projects[0], 'keep-project.txt');
await writeFile(sentinel, 'Project files must survive deleting conversation history.');
const sessionDir = join(profile, 'step-runtime', 'sessions');
await mkdir(sessionDir, { recursive: true });
const names = ['主线 · 左栏整理', '优化流式输出', '引用与回复', '会话并发测试', '修复滚动位置',
  '数学公式渲染', '运行状态与提示音', '项目置顶', '晚上好', '一个很长的归档会话标题，用于检查窄窗口下的截断与操作按钮是否互相遮挡'];
const archivedIds = names.map((_, index) => `archive-${index}`);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'light', language: 'zh', workspaces: projects, archivedSessionIds: archivedIds,
}));
const turns = [
  '把已归档的会话整理到设置里面，支持恢复和永久删除。',
  '会话导航里每轮的发送时间也保留下来，方便回看。',
  '亮色和暗色都看一下，窗口缩小时也要能正常使用。',
];
async function history(id, cwd, name, questions, timestamp) {
  let parentId = null;
  const entries = [{ type: 'session', version: 3, id, cwd, timestamp: new Date(timestamp).toISOString() }];
  for (let index = 0; index < questions.length; index++) {
    const time = timestamp + index * 9 * 60000;
    const entryId = `${id}-user-${index}`;
    entries.push({ type: 'message', id: entryId, parentId, timestamp: new Date(time).toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: questions[index] }], timestamp: time } });
    parentId = entryId;
    const replyId = `${id}-assistant-${index}`;
    entries.push({ type: 'message', id: replyId, parentId, timestamp: new Date(time + 1000).toISOString(),
      message: { role: 'assistant', content: [{ type: 'text', text: [
        '可以。归档记录会与左栏分开管理，项目和现有会话的顺序保持不变。\n\n删除会话记录不会删除工作目录或项目文件。',
        '时间放在每条轮次摘要下方的右侧，使用实际发送时间。点击轮次仍然可以回到对应的消息。',
        '归档列表按项目分组，独立会话单独一组。搜索和项目筛选可以组合使用。',
      ][index % 3] }], timestamp: time + 1000,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } });
    parentId = replyId;
  }
  entries.push({ type: 'session_info', id: `${id}-name`, parentId, timestamp: new Date(timestamp).toISOString(), name });
  const file = join(sessionDir, `${id}.jsonl`);
  await writeFile(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  await utimes(file, new Date(timestamp), new Date(timestamp));
}
await history('current', projects[0], '归档与会话导航', turns, new Date(2026, 9, 3, 14, 41).getTime());
for (let index = 0; index < names.length; index++) {
  await history(archivedIds[index], index < 5 ? projects[0] : index < 8 ? projects[1] : independent,
    names[index], [names[index]], new Date(2026, 9, 3 - index, 14, 31).getTime());
}
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    window.setSize(1360, 900);
    globalThis.archiveDialogs = [];
    dialog.showMessageBox = async (_window, options) => {
      globalThis.archiveDialogs.push(options);
      throw new Error('Archived deletion must not show a confirmation dialog');
    };
  });
  await page.waitForFunction(() => !document.querySelector('.composer > textarea')?.disabled, undefined, { timeout: 60000 });
  return page;
}
async function archives(page) {
  if (await page.locator('.right-panel-backdrop').isVisible()) await page.locator('.conversation-nav-panel header button').click();
  if (await page.locator('.app').evaluate(element => element.classList.contains('sidebar-hidden'))) await page.locator('.window-sidebar-toggle').click();
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await page.locator('.archived-settings').waitFor();
}
async function screenshot(page, path) {
  await page.mouse.move(10, 10);
  await page.waitForTimeout(200);
  await page.screenshot({ path });
}
const row = (page, index) => page.locator(`[data-archived-session-id="archive-${index}"]`);
const persistedIds = async () => JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).archivedSessionIds;
try {
  let page = await launch();
  assert.equal(await page.locator('.archived-group').count(), 0);
  assert.equal(await page.locator('.sidebar [data-reorder-id^="archive-"]').count(), 0);
  await page.getByRole('button', { name: '归档与会话导航', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '归档与会话导航');
  await page.getByRole('button', { name: '会话导航', exact: true }).click();
  const dates = page.locator('.nav-turn-time');
  await dates.first().waitFor();
  assert.deepEqual(await dates.allTextContents(), ['10月03日 14:41', '10月03日 14:50', '10月03日 14:59']);
  assert.equal(await dates.first().evaluate(element => getComputedStyle(element).opacity), '1');
  await page.mouse.move(10, 10);
  await page.screenshot({ path: 'test-results/navigation-turn-dates-light.png' });
  const navigationBox = await page.locator('.conversation-nav-panel').boundingBox();
  await page.screenshot({ path: 'test-results/navigation-turn-dates-detail.png', clip: { ...navigationBox, height: Math.min(navigationBox.height, 350) } });
  await archives(page);
  assert.equal(await page.locator('.archive-project').count(), 3);
  assert.equal(await page.locator('[data-archived-session-id]').count(), names.length);
  await screenshot(page, 'test-results/archives-settings-light.png');
  const search = page.getByRole('searchbox', { name: '搜索归档会话' });
  await search.fill('引用');
  assert.equal(await page.locator('[data-archived-session-id]').count(), 1);
  await search.fill('');
  await page.getByLabel('筛选归档项目').selectOption({ label: '独立会话' });
  assert.equal(await page.locator('[data-archived-session-id]').count(), 2);
  await page.getByLabel('筛选归档项目').selectOption('');
  await search.fill('不存在的会话');
  await page.getByText('没有匹配的归档会话', { exact: true }).waitFor();
  await search.fill('');
  await row(page, 0).getByRole('button', { name: '查看 主线 · 左栏整理', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '主线 · 左栏整理');
  assert.ok((await persistedIds()).includes('archive-0'), 'reading an archive must not restore it');
  assert.equal(await page.locator('.sidebar [data-reorder-id="archive-0"]').count(), 0);
  await page.getByRole('button', { name: '归档与会话导航', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.window-session-title')?.textContent === '归档与会话导航');
  await archives(page);
  await row(page, 8).getByRole('button', { name: '取消归档', exact: true }).click();
  await row(page, 8).waitFor({ state: 'detached' });
  assert.ok(!(await persistedIds()).includes('archive-8'));
  assert.ok(await readFile(join(sessionDir, 'archive-8.jsonl'), 'utf8'));
  // Direct deletion keeps IPC authorization and path guards, without a second confirmation.
  await assert.rejects(page.evaluate(() => window.desktop.deleteArchivedSessions(['current'])), /Only known archived/);
  await assert.rejects(page.evaluate(() => window.desktop.deleteArchivedSessions(['unknown'])), /Only known archived/);
  await assert.rejects(page.evaluate(() => window.desktop.deleteArchivedSessions(['archive-0', 'archive-0'])), /Invalid/);
  await row(page, 0).getByRole('button', { name: '永久删除 主线 · 左栏整理', exact: true }).click();
  await row(page, 0).waitFor({ state: 'detached' });
  await assert.rejects(readFile(join(sessionDir, 'archive-0.jsonl')), /ENOENT/);
  assert.ok(!(await persistedIds()).includes('archive-0'));
  assert.deepEqual(await app.evaluate(() => globalThis.archiveDialogs), []);
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByLabel('主题').selectOption('dark');
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await screenshot(page, 'test-results/archives-settings-dark.png');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'test-results/navigation-turn-dates-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 800));
  await page.waitForFunction(() => document.querySelector('.app').classList.contains('sidebar-compact'));
  await page.screenshot({ path: 'test-results/navigation-turn-dates-narrow.png' });
  await archives(page);
  await screenshot(page, 'test-results/archives-settings-narrow.png');
  assert.equal(await page.locator('.archived-settings').evaluate(element => element.scrollWidth > element.clientWidth), false);
  const layout = await row(page, 9).evaluate(element => {
    const title = element.querySelector('.archive-session-text').getBoundingClientRect();
    const deletion = element.querySelector('.archive-delete').getBoundingClientRect();
    return title.right <= deletion.left;
  });
  assert.equal(layout, true, 'long titles must not overlap delete controls');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByLabel('语言').selectOption('en');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'Unarchive', exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation navigation', exact: true }).click();
  assert.deepEqual(await dates.allTextContents(), ['10/03 14:41', '10/03 14:50', '10/03 14:59']);
  console.log('Archive actions, light/dark/narrow layouts and bilingual dates passed; checking delete guards and restart.');
  // A forged IPC call cannot delete the currently viewed archived session.
  const stored = await persistedIds();
  await page.evaluate(ids => window.desktop.preferences({ archivedSessionIds: [...ids, 'current'] }), stored);
  await assert.rejects(page.evaluate(() => window.desktop.deleteArchivedSessions(['current'])), /different session/);
  await page.evaluate(ids => window.desktop.preferences({ archivedSessionIds: ids }), stored);
  await page.reload();
  await page.getByText('Step Code connected', { exact: true }).waitFor({ state: 'attached', timeout: 60000 });
  await page.locator('.window-sidebar-toggle').click();
  await page.locator('.sidebar-bottom > button').click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all', exact: true }).click();
  await page.getByText('No archived sessions', { exact: true }).waitFor();
  assert.deepEqual(await persistedIds(), []);
  for (let index = 0; index < names.length; index++) {
    if (index === 8) continue;
    await assert.rejects(readFile(join(sessionDir, `${archivedIds[index]}.jsonl`)), /ENOENT/);
  }
  assert.ok(await readFile(join(sessionDir, 'current.jsonl'), 'utf8'));
  assert.ok(await readFile(join(sessionDir, 'archive-8.jsonl'), 'utf8'));
  assert.equal(await readFile(sentinel, 'utf8'), 'Project files must survive deleting conversation history.');
  assert.deepEqual(await app.evaluate(() => globalThis.archiveDialogs), []);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await app.close(); app = null;
  page = await launch();
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).sessions.some(session => session.id === 'archive-0'), false);
  assert.deepEqual(errors, []);
  console.log('Archives: settings-only grouping/search/filter/read, restore, direct single/bulk permanent delete without confirmation, IPC guards, project preservation, reload/relaunch, light/dark/narrow/bilingual dates passed.');
} finally {
  if (app) await app.close();
}
