import { _electron as electron } from 'playwright';
import { prepareSessionFixture } from './session-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-composer-editing-'));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'en', theme: 'dark', workspaces: [] }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
  env, timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setOpacity(0); win.setIgnoreMouseEvents(true); win.showInactive();
  });
  const snapshot = await prepareSessionFixture(page);
  await app.evaluate(({ ipcMain }, snapshot) => {
    globalThis.editingCommands = [];
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', (_event, method, ...args) => {
      if (method === 'snapshot') return snapshot;
      if (method === 'systemTheme') return { systemDark: true };
      if (method === 'sessions') return snapshot.sessions;
      if (method === 'summary') return { tasks: [], mcp: [], skillCount: 0 };
      if (method === 'command') {
        globalThis.editingCommands.push(args[0]);
        if (args[0] === 'get_commands') return { commands: [] };
        if (args[0] === 'get_available_thinking_levels') return { levels: [] };
      }
      return {};
    });
  }, snapshot);
  await page.reload();
  const input = page.locator('.composer > .composer-input');
  await input.waitFor();
  const value = expected => page.waitForFunction(expected =>
    document.querySelector('.composer-input')?.value === expected, expected, { timeout: 5000 });
  const longDraft = 'Multiline \u4e2d\u6587 draft 123\n'.repeat(100) + 'end';
  for (const key of ['Backspace', 'Delete', 'Shift+Backspace', 'Control+Backspace', 'Control+Delete']) {
    await input.fill(longDraft);
    await value(longDraft);
    // Keep fixture insertion outside the editor's 500ms undo grouping window.
    await page.waitForTimeout(600);
    await input.press('Control+a');
    await input.press(key);
    await value('');
    assert.equal(await input.getAttribute('data-empty'), 'true', `${key} updates the controlled draft`);
    assert.equal(await page.locator('.composer-action-button').isDisabled(), true);
    await input.press('Control+z');
    await value(longDraft);
    await input.press('Control+y');
    await value('');
    await input.pressSequentially('next');
    await value('next');
  }
  for (const key of ['Backspace', 'Delete']) {
    await input.fill('prefix selected suffix');
    await input.evaluate(element => element.setSelectionRange(7, 15));
    await input.press(key);
    await value('prefix  suffix');
  }
  await input.fill('abc');
  await input.press('End');
  await input.press('Backspace');
  await value('ab');
  await input.press('Home');
  await input.press('Delete');
  await value('b');
  await input.press('Shift+Enter');
  await value('\nb');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'agent_start' }));
  await input.fill(longDraft);
  await input.press('Control+a');
  await input.press('Backspace');
  await value('');
  assert.equal(await page.locator('.composer-action-button').getAttribute('data-action'), 'stop');
  const commands = await app.evaluate(() => globalThis.editingCommands);
  assert.ok(!commands.some(command => ['prompt', 'abort', 'queue_steer_first'].includes(command)), 'Editing never sends, stops or steers a response');
  assert.deepEqual(errors, []);
  console.log('Composer editing acceptance passed: select-all deletion, partial selection, undo/redo, native character deletion, newline and busy state.');
} finally {
  await app.close();
}
