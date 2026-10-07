import { _electron as electron } from 'playwright';
import { mkdir, realpath, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'step-sidebar-scrollbar-')));
const project = join(profile, 'Sidebar preview');
await mkdir(project);
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  theme: 'light', language: 'zh', workspaces: [project],
}));
const sessions = join(profile, 'step-runtime', 'sessions');
await mkdir(sessions, { recursive: true });
for (let index = 0; index < 40; index++) {
  const timestamp = new Date(Date.now() - index * 1000).toISOString();
  const entries = [
    { type: 'session', version: 3, id: `scrollbar-${index}`, cwd: project, timestamp },
    { type: 'message', id: 'user', parentId: null, timestamp, message: {
      role: 'user', content: [{ type: 'text', text: `Sidebar task ${index + 1}` }],
      timestamp: Date.parse(timestamp),
    } },
    { type: 'session_info', id: 'name', parentId: 'user', timestamp,
      name: `Preview task ${String(index + 1).padStart(2, '0')}` },
  ];
  await writeFile(join(sessions, `scrollbar-${index}.jsonl`), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
await mkdir('test-results', { recursive: true });
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000,
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('Step Code \u5df2\u8fde\u63a5', { exact: true }).waitFor({ timeout: 60000 });
  const tree = page.locator('.workspace-tree');
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length >= 40);
  const measure = () => tree.evaluate(element => ({
    thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
    track: getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
    width: getComputedStyle(element, '::-webkit-scrollbar').width,
    thumbBorder: getComputedStyle(element, '::-webkit-scrollbar-thumb').borderRightWidth,
    clientWidth: element.clientWidth,
    rowWidth: element.querySelector('.session-row').getBoundingClientRect().width,
    scrollTop: element.scrollTop,
    overflow: element.scrollHeight > element.clientHeight,
  }));
  const idle = async () => {
    await page.locator('.composer textarea').focus();
    await page.mouse.move(700, 400);
  };
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await idle();
    const hidden = await measure();
    assert.equal(hidden.overflow, true);
    assert.equal(hidden.thumb, 'rgba(0, 0, 0, 0)', 'idle thumb is invisible');
    assert.equal(hidden.track, 'rgba(0, 0, 0, 0)', 'no visible track');
    assert.equal(hidden.width, '12px');
    assert.equal(hidden.thumbBorder, '4px', 'wide gutter retains a thin visible thumb');
    await page.locator('.sidebar').screenshot({ path: `test-results/sidebar-scrollbar-${theme}-idle.png` });

    await tree.hover({ position: { x: 100, y: 100 } });
    const hovered = await measure();
    assert.notEqual(hovered.thumb, hidden.thumb, 'hover reveals the thumb');
    assert.equal(hovered.clientWidth, hidden.clientWidth);
    assert.equal(hovered.rowWidth, hidden.rowWidth, 'hover must not shift session rows');
    await page.locator('.sidebar').screenshot({ path: `test-results/sidebar-scrollbar-${theme}-hover.png` });
    await page.mouse.wheel(0, 420);
    await page.waitForFunction(() => document.querySelector('.workspace-tree').scrollTop > 0);
    await tree.evaluate(element => { element.scrollTop = 0; });
    await idle();
    await page.locator('.new-chat').focus();
    assert.notEqual((await measure()).thumb, hidden.thumb, 'keyboard focus reveals the thumb');
    await idle();
    assert.equal((await measure()).thumb, hidden.thumb, 'leaving sidebar hides the thumb');
  }
  assert.deepEqual(errors, []);
  console.log('Sidebar scrollbar: idle/hover/focus, light/dark, trackless styling, wheel scrolling and stable row widths passed.');
} finally {
  if (app) await app.close();
}
