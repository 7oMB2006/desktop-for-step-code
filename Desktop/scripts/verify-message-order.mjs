import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'step-message-order-'));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
  ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
let page;
try {
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  await page.getByText('Step Code 已连接', { exact: true }).waitFor({ timeout: 60000 });
  const saved = await page.evaluate(() => window.desktop.snapshot());
  await app.evaluate(({ ipcMain }, saved) => {
    const text = value => ({ role: 'assistant', content: [{ type: 'text', text: value }], timestamp: 2 });
    globalThis.messageOrderFixture = {
      saved: { ...saved, runtimeRevision: 10, state: { ...saved.state, isStreaming: true },
        messages: [{ role: 'user', content: 'Message ordering fixture', timestamp: 1 }, text('Alpha')] },
      delay: 0, requests: 0,
    };
    const original = ipcMain._invokeHandlers.get('desktop');
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'snapshot') {
        const fixture = globalThis.messageOrderFixture;
        const snapshot = structuredClone(fixture.saved);
        fixture.requests++;
        if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay));
        return snapshot;
      }
      return original(event, method, ...args);
    });
  }, saved);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
  });
  const answer = page.locator('.message.assistant p').last();
  await page.getByText('Alpha', { exact: true }).waitFor();
  const delta = async (revision, value) => app.evaluate(({ BrowserWindow }, { revision, value }) => {
    const fixture = globalThis.messageOrderFixture;
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'message_update', runtimeId: fixture.saved.runtimeId, runtimeRevision: revision,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: value },
    });
  }, { revision, value });
  const checkText = async expected => {
    await page.waitForTimeout(200);
    assert.equal(await answer.textContent(), expected);
  };
  // The snapshot already includes revision 10; its delayed delta must not append again.
  await delta(10, 'Alpha');
  await checkText('Alpha');
  // Identical text in a genuinely newer delta must still be appended.
  await delta(11, 'Alpha');
  await checkText('AlphaAlpha');
  // Hold an older snapshot response while a new delta reaches the renderer.
  const requests = await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.messageOrderFixture;
    fixture.delay = 500;
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' });
    return fixture.requests;
  });
  await app.evaluate(async (_electron, requests) => {
    const started = Date.now();
    while (globalThis.messageOrderFixture.requests <= requests) {
      if (Date.now() - started > 5000) throw new Error('Snapshot request did not start');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }, requests);
  await delta(12, 'Beta');
  await page.waitForTimeout(600);
  await checkText('AlphaAlphaBeta');
  await app.evaluate(({ BrowserWindow }) => {
    const fixture = globalThis.messageOrderFixture;
    fixture.delay = 0;
    fixture.saved.runtimeRevision = 20;
    fixture.saved.messages.at(-1).content[0].text = 'Replaced history';
    BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', {
      type: 'desktop_history', runtimeId: fixture.saved.runtimeId, runtimeRevision: 20,
      messages: fixture.saved.messages,
    });
  });
  await checkText('Replaced history');
  await delta(12, 'Beta');
  await checkText('Replaced history');
  assert.deepEqual(errors, []);
  console.log('Message ordering passed: snapshot/delta overlap, legitimate repeated text, stale refresh and history reset.');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  if (page && !page.isClosed()) await page.screenshot({ path: 'test-results/message-order-failed.png' }).catch(() => {});
  throw error;
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
  await app.close();
}
