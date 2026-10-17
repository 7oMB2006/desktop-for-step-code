import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSessionFixture } from './session-fixture.mjs';

// Presentation-only PTY fixture: no commands are executed and no personal profile is read.
const profile = await mkdtemp(join(tmpdir(), 'step-terminal-scopes-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1320, 880);
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const base = await prepareSessionFixture(page);
  await app.evaluate(({ ipcMain }, base) => {
    const roots = process.platform === 'win32' ? ['C:/Work/Foo', 'C:/Work/Bar'] : ['/Work/Foo', '/Work/foo'];
    const sessions = roots.map((cwd, index) => ({ id: `scope-${index}`, path: `scope-${index}.jsonl`, cwd,
      name: `Scope ${index}`, firstMessage: `Scope ${index}`, modified: new Date().toISOString(), messageCount: 1 }));
    const terminals = roots.flatMap((cwd, index) => [1, 2].map(number => ({ id: `term-${index}-${number}`, cwd: process.platform === 'win32' ? cwd.toUpperCase().replaceAll('/', '\\') : cwd,
      title: `Scope ${index} terminal ${number}`, status: 'running', cols: 80, rows: 24, chunks: [] })));
    const fixture = globalThis.terminalScopeFixture = { current: 0, writes: [], terminals };
    const snapshot = () => ({ ...base, draftId: undefined, independent: false, runtimeId: `runtime-${fixture.current}`,
      messages: [], sessions, state: { ...base.state, sessionId: sessions[fixture.current].id, isStreaming: false },
      preferences: { ...base.preferences, workspace: roots[fixture.current], workspaces: roots },
      runtimes: roots.map((cwd, index) => ({ runtimeId: `runtime-${index}`, sessionId: sessions[index].id, cwd, status: 'idle' })) });
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return snapshot();
      if (method === 'sessions') return sessions;
      if (method === 'switchSession' || method === 'navigateSession') { fixture.current = sessions.findIndex(session => session.id === args[0]); return snapshot(); }
      if (method === 'terminalList') return args[0] ? terminals.filter(terminal => terminal.id.startsWith(`term-${Number(args[0].split('-')[1])}-`)) : terminals;
      if (method === 'terminalWrite') { fixture.writes.push(args); return; }
      if (method === 'terminalPasteText') return 'scope fixture\r';
      if (method === 'terminalCreate') throw new Error('Both project terminals should be restored');
      if (method === 'browserList') return { tabs: [] };
      if (method === 'command' && args[0] === 'get_commands') return { commands: [] };
      if (method === 'command' && args[0] === 'get_available_thinking_levels') return { levels: [] };
      return {};
    });
  }, base);
  await page.reload();
  await page.locator('.right-tool-rail').getByRole('button', { name: '终端', exact: true }).click();
  const tabs = page.locator('#terminal-panel').getByRole('tab');
  const select = async index => {
    await page.getByRole('button', { name: `Scope ${index}`, exact: true }).click();
    await page.waitForFunction(index => document.querySelector('.window-session-title')?.textContent === `Scope ${index}`, index);
    if (!(await page.locator('.terminal-track').getAttribute('class')).includes('is-open'))
      await page.locator('.right-tool-rail').getByRole('button', { name: '终端', exact: true }).click();
  };
  const check = async index => {
    await select(index);
    await page.getByRole('tab', { name: `Scope ${index} terminal 1`, exact: true }).waitFor();
    assert.deepEqual(await tabs.allTextContents(), [`Scope ${index} terminal 1`, `Scope ${index} terminal 2`]);
    await page.getByRole('tab', { name: `Scope ${index} terminal 2`, exact: true }).click();
    await page.getByRole('button', { name: '粘贴到终端', exact: true }).click();
    await page.waitForFunction(id => document.querySelector('.terminal-view:not([hidden])')?.dataset.terminalId === id, `term-${index}-2`);
    const deadline = Date.now() + 5000;
    while (await app.evaluate(() => globalThis.terminalScopeFixture.writes.at(-1)?.[0]) !== `term-${index}-2`) {
      assert.ok(Date.now() < deadline, 'Terminal input must reach the selected project');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const writes = await app.evaluate(() => globalThis.terminalScopeFixture.writes);
    assert.equal(writes.at(-1)?.[0], `term-${index}-2`, 'Input goes only to the selected project terminal');
  };
  await check(0);
  await check(1);
  await select(0);
  await page.waitForFunction(() => document.querySelector('.terminal-view:not([hidden])')?.dataset.terminalId === 'term-0-2');
  assert.deepEqual(await tabs.allTextContents(), ['Scope 0 terminal 1', 'Scope 0 terminal 2']);
  assert.deepEqual(errors, []);
  console.log('Terminal scope acceptance passed: restored controllers, distinct project tabs, per-project selection and input routing.');
} finally { await app.close(); }
