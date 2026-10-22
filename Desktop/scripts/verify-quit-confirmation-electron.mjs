import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { queueFixture } from './queue-demo-fixture.mjs';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-quit-review-')));
const fixture = await queueFixture(profile, { duration: 500 });
await mkdir(join(profile, 'step-runtime/agent'), { recursive: true });
await writeFile(join(profile, 'step-runtime/agent/trust.json'), JSON.stringify({ [fixture.workspace]: true }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let exited = false;
try {
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    globalThis.nativeQuitCount = 0;
    dialog.showMessageBox = async () => { globalThis.nativeQuitCount++; return { response: 0 }; };
  });
  await page.getByText('队列交互示例（本地模拟）', { exact: true }).click({ timeout: 60000 });
  await page.waitForFunction(async () => {
    const value = await window.desktop.snapshot();
    return value.status === 'connected' && value.state?.sessionId === 'queue-demo';
  });
  await page.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  const tomorrow = new Date(Date.now() + 86400000);
  const cron = `0 9 ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`;
  await page.evaluate(async cron => {
    const { runtimeId } = await window.desktop.snapshot();
    for (const durable of [false, true]) await window.desktop.cronCreate({
      runtimeId, cron, prompt: 'Isolated future quit acceptance', recurring: true, durable,
    });
  }, cron);
  const quit = () => page.evaluate(() => window.desktop.windowControl('quit'));
  const request = () => page.evaluate(async () => (await window.desktop.snapshot()).quitReview.request);
  await quit();
  await page.locator('.quit-confirmation').waitFor();
  const first = await request();
  assert.equal(first.reasons.temporaryJobs, 1);
  assert.equal(first.reasons.durableJobs, 1);
  assert.equal(first.reasons.runningTasks, 0);
  assert.equal(await page.getByText('留在后台', { exact: true }).count(), 0);
  await page.reload();
  await page.locator('.quit-confirmation').waitFor();
  assert.equal((await request()).id, first.id);
  await quit();
  assert.equal((await request()).id, first.id);
  await assert.rejects(page.evaluate(() => window.desktop.quitRespond('stale', true)));
  await assert.rejects(page.evaluate(id => window.desktop.quitRespond(id, 'true'), first.id));
  await page.getByRole('button', { name: '取消退出', exact: true }).last().click();
  await page.locator('.quit-confirmation').waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(() => window.desktop.cronList())).tasks.length, 2);
  assert.equal(fixture.requests.length, 0);
  await quit();
  await page.locator('.quit-confirmation').waitFor();
  assert.notEqual((await request()).id, first.id);
  assert.equal(await app.evaluate(() => globalThis.nativeQuitCount), 0);
  await mkdir('test-results', { recursive: true });
  await page.locator('.quit-confirmation').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: 'test-results/quit-confirmation-real-cron.png' });
  assert.deepEqual(errors, []);
  const exit = new Promise(resolve => app.process().once('exit', resolve));
  await page.getByRole('button', { name: '退出应用', exact: true }).last().click();
  await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Quit timed out')), 15000).unref())]);
  exited = true;
  const stored = (await readFile(join(fixture.workspace, '.stepcode/cron/tasks.json'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].durable, true);

  // A crashed renderer cannot show an application-owned modal; verify safe native fallback separately.
  app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
    ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
  exited = false;
  const crashPage = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const main = BrowserWindow.getAllWindows()[0];
    main.setOpacity(0); main.setIgnoreMouseEvents(true); main.showInactive();
    globalThis.nativeQuitCount = 0;
    globalThis.nativeQuitResponse = 0;
    dialog.showMessageBox = async () => {
      globalThis.nativeQuitCount++;
      return { response: globalThis.nativeQuitResponse };
    };
  });
  await crashPage.getByText('队列交互示例（本地模拟）', { exact: true }).click({ timeout: 60000 });
  await crashPage.waitForFunction(async () => (await window.desktop.snapshot()).state?.sessionId === 'queue-demo');
  await crashPage.waitForFunction(() => !document.querySelector('.new-chat')?.disabled);
  await crashPage.evaluate(() => window.desktop.windowControl('quit'));
  await crashPage.locator('.quit-confirmation').waitFor();
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const main = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('tray-menu.html'));
    main.webContents.once('render-process-gone', () => resolve());
    main.webContents.forcefullyCrashRenderer();
  }));
  await app.evaluate(({ app }) => app.quit());
  assert.equal(await app.evaluate(() => globalThis.nativeQuitCount), 1, 'Crashed-renderer fallback cancels without exiting');
  const crashExit = new Promise(resolve => app.process().once('exit', resolve));
  await app.evaluate(({ app }) => { globalThis.nativeQuitResponse = 1; app.quit(); }).catch(() => {});
  await Promise.race([crashExit, new Promise((_, reject) => setTimeout(() => reject(new Error('Crash fallback quit timed out')), 15000).unref())]);
  exited = true;
  console.log('Quit acceptance passed: real Cron, reload/cancel, replay protection, themed quit, persistence and crashed-renderer fallback.');
} finally {
  if (app && !exited) await app.evaluate(({ app }) => app.exit()).catch(() => {});
  await fixture.close();
}
