import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixtureAndWait } from './close-desktop-fixture.mjs';

export async function verifyFirstRunExit(output) {
  for (const scenario of ['failed-login', 'pending-draft', 'failed-stop']) {
    console.log(`First-run exit acceptance: ${scenario}`);
    const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-first-run-exit-')));
    const hold = join(profile, 'hold-session-options');
    const reached = join(profile, 'session-options-held');
    const preload = join(profile, 'offline-exit.cjs');
    await writeFile(preload, `
const fs = require('node:fs');
globalThis.fetch = async () => { throw new Error('Isolated offline authorization fixture'); };
const write = process.stdout.write;
process.stdout.write = function(chunk, ...args) {
  let value;
  try { value = JSON.parse(String(chunk)); } catch {}
  if (value?.type === 'response' && Array.isArray(value.data?.models)
      && value.data?.permissionPreset && fs.existsSync(${JSON.stringify(hold)})) {
    fs.writeFileSync(${JSON.stringify(reached)}, '');
    const timer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(hold)})) return;
      clearInterval(timer);
      write.call(process.stdout, chunk, ...args);
    }, 20);
    return true;
  }
  return write.call(this, chunk, ...args);
};
`);
    const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.DESKTOP_DEV_URL;
    delete env.DESKTOP_TEST_STARTUP_WINDOW;
    let app, page, popup, mainId, exited = false;
    try {
      app = await electron.launch({ ...(process.env.DESKTOP_VERIFY_EXE
        ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }), env, timeout: 60000 });
      const child = app.process();
      const exit = new Promise(resolve => child.once('exit', code => { exited = true; resolve(code); }));
      page = await app.firstWindow();
      mainId = await (await app.browserWindow(page)).evaluate(view => view.id);
      page.setDefaultTimeout(15000);
      await app.evaluate(({ BrowserWindow, Tray, shell }, { preload, mainId }) => {
        const main = BrowserWindow.fromId(mainId);
        main.setOpacity(0); main.setIgnoreMouseEvents(true); main.showInactive();
        const tooltip = Tray.prototype.setToolTip;
        Tray.prototype.setToolTip = function(text) {
          globalThis.firstRunExitTray = this;
          return tooltip.call(this, text);
        };
        const cp = process.getBuiltinModule('child_process'), spawn = cp.spawn;
        globalThis.firstRunExitSpawn = spawn;
        cp.spawn = function(file, args, options) {
          if (globalThis.firstRunExitFailStop && file === 'taskkill.exe') {
            const failed = new (process.getBuiltinModule('events').EventEmitter)();
            process.nextTick(() => failed.emit('exit', 7, null));
            return failed;
          }
          if (args?.some(arg => /admin\.mjs$/.test(arg))) args = ['--require', preload, ...args];
          return spawn.call(this, file, args, options);
        };
        const kill = cp.ChildProcess.prototype.kill;
        cp.ChildProcess.prototype.kill = function(...args) {
          if (globalThis.firstRunExitFailStop && process.platform !== 'win32')
            throw new Error('Isolated runtime shutdown failure');
          return kill.apply(this, args);
        };
        process.getBuiltinModule('module').syncBuiltinESMExports();
        shell.openExternal = async () => { throw new Error('External authorization is forbidden in this fixture'); };
      }, { preload, mainId });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('heading', { name: '连接模型服务', exact: true }).waitFor({ timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('.first-run-skip-motion'));
      assert.equal((await page.evaluate(() => window.desktop.snapshot())).firstRun.required, true);
      // Restart only the isolated admin so its next authorization is entirely offline.
      await page.evaluate(() => window.desktop.saveProvider({
        id: '', name: 'Disabled offline transport fixture', baseUrl: 'http://127.0.0.1:1/v1',
        api: 'openai-completions', enabled: false, keyless: true,
        models: [{ id: 'unused', name: 'Unused', reasoning: false, vision: false, contextWindow: 32768, maxTokens: 1024 }],
      }));
      await page.locator('.first-run-next').click();
      await page.getByRole('alert').waitFor();
      assert.equal((await page.evaluate(() => window.desktop.snapshot())).firstRun.required, true);
      await page.evaluate(() => window.desktop.preferences({ language: 'zh' }));
      const openTray = async () => {
        const opened = popup ? undefined : app.waitForEvent('window');
        await app.evaluate(() => globalThis.firstRunExitTray.emit('right-click', {}, globalThis.firstRunExitTray.getBounds()));
        if (opened) popup = await opened;
        await popup.waitForFunction(() => document.querySelector('.tray-menu')?.dataset.visible === 'true');
      };
      const quitFromTray = async () => {
        await openTray();
        await popup.getByRole('menuitem', { name: '退出应用', exact: true }).click();
      };
      const waitForExit = async () => {
        let timer;
        try {
          assert.equal(await Promise.race([exit, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`First-run ${scenario} did not exit`)), 15000);
          })]), 0);
        } finally { clearTimeout(timer); }
      };
      if (scenario === 'pending-draft') {
        await writeFile(hold, '');
        await page.evaluate(() => {
          window.firstRunExitDraft = window.desktop.beginSession().then(() => 'ready', () => 'stopped');
        });
        const until = Date.now() + 15000;
        while (!await readFile(reached).then(() => true, () => false)) {
          if (Date.now() >= until) throw new Error('The isolated draft response was not held');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        await quitFromTray();
        const request = await page.evaluate(async () => (await window.desktop.snapshot()).quitReview.request);
        assert.equal(request?.reasons.transitioning, true, 'The main process is waiting for a real transition review');
        await page.locator('.quit-confirmation').waitFor();
        await page.reload();
        await page.locator('.quit-confirmation').waitFor();
        assert.equal((await page.evaluate(async () => (await window.desktop.snapshot()).quitReview.request)).id, request.id);
        await page.screenshot({ path: join(output, 'exit-first-run-review.png') });
        await page.getByRole('button', { name: '取消退出', exact: true }).last().click();
        await page.locator('.quit-confirmation').waitFor({ state: 'detached' });
        assert.equal(exited, false);
        assert.equal((await page.evaluate(async () => (await window.desktop.snapshot()).quitReview)).request, undefined);
        await quitFromTray();
        await page.locator('.quit-confirmation').waitFor();
        await page.getByRole('button', { name: '退出应用', exact: true }).last().click();
        await waitForExit();
      } else if (scenario === 'failed-stop') {
        await app.evaluate(() => { globalThis.firstRunExitFailStop = true; });
        await quitFromTray();
        await page.locator('.notice-toast.warning').waitFor();
        assert.match(await page.locator('.notice-toast.warning').innerText(), /退出未完成/);
        assert.equal(exited, false);
        assert.equal(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), mainId), true);
        await page.screenshot({ path: join(output, 'exit-first-run-stop-failed.png') });
        const logs = join(profile, 'logs');
        const until = Date.now() + 5000;
        let recorded = false;
        while (!recorded) {
          for (const name of await readdir(logs).catch(() => [])) {
            const text = await readFile(join(logs, name), 'utf8');
            if (text.includes('kind: quit-failure') && text.includes('stage: services')) recorded = true;
          }
          if (Date.now() >= until) throw new Error('Quit failure did not retain its failed stage');
          if (!recorded) await new Promise(resolve => setTimeout(resolve, 25));
        }
        await app.evaluate(() => { globalThis.firstRunExitFailStop = false; });
        await quitFromTray();
        await waitForExit();
      } else {
        await page.evaluate(() => window.desktop.windowControl('close'));
        assert.equal(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), mainId), false);
        await quitFromTray();
        await waitForExit();
      }
    } catch (error) {
      if (app) console.error(`First-run ${scenario} window identities:`, await app.evaluate(({ BrowserWindow }, mainId) => ({
        mainId, windows: BrowserWindow.getAllWindows().map(view => ({
          id: view.id, title: view.getTitle(), visible: view.isVisible(),
        })),
      }), mainId).catch(() => undefined));
      if (page && !page.isClosed())
        await page.screenshot({ path: join(output, `exit-${scenario}-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await unlink(hold).catch(() => {});
      if (app && !exited) {
        await app.evaluate(() => { globalThis.firstRunExitFailStop = false; }).catch(() => {});
        await closeDesktopFixtureAndWait(app, 15000);
      }
    }
  }
  console.log('First-run exit passed: offline authorization failure, tray hide/quit, review reload/cancel/confirm, failed-stop feedback and retry.');
}
