// Explicit local-only network acceptance. No login, model prompt, tool call or publishing.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') throw new Error('Windows acceptance only');
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'steppage-prepare-profile-'));
const root = join(profile, 'step-runtime');
const home = join(profile, 'outer-home');
await mkdir(root); await mkdir(home);
await mkdir(join(home, 'Documents'));
await mkdir(join(home, 'Desktop'));
await mkdir(join(home, 'Downloads'));
await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only',
  models: [{ id: 'fixture', name: 'Acceptance only', contextWindow: 32768, maxTokens: 1024 }],
} } }));
const env = { ...process.env, HOME: home, USERPROFILE: home, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.DESKTOP_STEPPAGE_BUNDLE;
const executablePath = process.env.DESKTOP_VERIFY_EXE;
let app;
const launch = async () => {
  app = await electron.launch({
    executablePath: executablePath ? resolve(executablePath) : resolve('node_modules/electron/dist/electron.exe'),
    ...(executablePath ? {} : { args: [resolve('.')] }), env, timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.locator('.app').waitFor();
  return page;
};
try {
  let page = await launch();
  await page.evaluate(() => window.desktop.snapshot());
  await page.evaluate(() => window.desktop.settings());
  assert.equal((await page.evaluate(() => window.desktop.stepPageState())).status, 'missing');
  const cronHost = await page.evaluate(async () => {
    const draft = await window.desktop.snapshot();
    const host = await window.desktop.createDraftSession(draft.draftId);
    const tomorrow = new Date(Date.now() + 86400000);
    await window.desktop.cronCreate({ runtimeId: host.runtimeId, cron: `0 9 ${tomorrow.getDate()} ${tomorrow.getMonth() + 1} *`,
      prompt: 'Isolated StepPage/Cron coexistence check; never fire during acceptance', recurring: false, durable: false });
    const { tasks } = await window.desktop.cronList();
    return { runtimeId: host.runtimeId, sessionId: host.state.sessionId, tasks: tasks.filter(job => job.runtimeId === host.runtimeId) };
  });
  assert.equal(cronHost.tasks.length, 1);
  // Exercise the actual settings entry rather than installing through a fixture hook.
  await page.locator('.sidebar-bottom button').filter({ hasText: /设置|Settings/ }).click();
  await page.getByRole('button', { name: /^(资源|Resources)$/ }).click();
  const setup = page.getByRole('button', { name: /安装并准备|Install and prepare/ });
  await setup.click();
  await page.getByRole('status').filter({ hasText: /文件就绪|Files ready/ }).waitFor({ timeout: 60000 });
  assert.equal((await page.evaluate(() => window.desktop.stepPageState())).installed, true);
  const config = await page.evaluate(() => window.desktop.settings());
  const server = config.mcp.steppage__steppage;
  assert.ok(server);
  assert.equal(server.args[0], join(root, 'steppage/bin/steppage-mcp.mjs'));
  assert.deepEqual(server.configuredSecrets.sort(), ['HOME', 'USERPROFILE']);
  assert.ok(!config.mcp.steppage);
  const afterPreparation = await page.evaluate(async () => ({
    snapshot: await window.desktop.snapshot(), cron: await window.desktop.cronList(),
  }));
  assert.equal(afterPreparation.snapshot.runtimeId, cronHost.runtimeId, 'Preparation must not replace the Cron host');
  assert.equal(afterPreparation.snapshot.state.sessionId, cronHost.sessionId);
  assert.deepEqual(afterPreparation.cron.tasks.filter(job => job.runtimeId === cronHost.runtimeId), cronHost.tasks);
  // Preparation is allowed, but this very same scheduled host must remain protected from restart.
  await page.getByRole('button', { name: /重启当前会话|Restart current session/ }).click();
  const protection = page.getByRole('alert').filter({ hasText: /未执行重启|was not restarted/ });
  await protection.waitFor();
  await page.waitForTimeout(1800); // Cross a readiness poll; operation feedback must not disappear.
  assert.equal(await protection.isVisible(), true);
  await page.screenshot({ path: join(output, 'steppage-cron-restart-protected.png') });
  assert.deepEqual((await page.evaluate(() => window.desktop.cronList())).tasks.filter(job => job.runtimeId === cronHost.runtimeId), cronHost.tasks);
  await page.getByRole('button', { name: /^MCP$/ }).click();
  await page.getByRole('button', { name: /^(资源|Resources)$/ }).click();
  await page.getByRole('status').filter({ hasText: /文件就绪|Files ready/ }).waitFor();
  await page.screenshot({ path: join(output, 'steppage-preparation-ready.png') });
  await page.evaluate(() => window.desktop.preferences({ theme: 'light', language: 'en' }));
  await page.reload();
  await page.locator('.app').waitFor();
  await page.locator('.sidebar-bottom button').filter({ hasText: 'Settings' }).click();
  await page.getByRole('button', { name: /^Resources$/ }).click();
  await page.getByRole('status').filter({ hasText: 'Files ready' }).waitFor();
  await page.screenshot({ path: join(output, 'steppage-preparation-light-en.png') });
  const mainWindow = await app.browserWindow(page);
  await mainWindow.evaluate(window => window.setSize(760, 720));
  await page.waitForFunction(() => window.innerWidth <= 760);
  await page.screenshot({ path: join(output, 'steppage-preparation-narrow.png') });
  assert.equal(await page.locator('.steppage-settings').evaluate(el => el.scrollWidth > el.clientWidth), false);
  await mainWindow.evaluate(window => window.setSize(1320, 880));
  await page.waitForFunction(() => window.innerWidth >= 1300);
  // A new worker sees the plugin without destroying the original Cron host.
  const connected = await page.evaluate(async () => {
    const active = await window.desktop.newIndependentSession();
    return (await window.desktop.summary(active.runtimeId)).mcp.filter(s => s.name.includes('steppage'));
  });
  assert.equal(connected.length, 1);
  assert.equal(connected[0].status, 'connected');
  assert.equal(connected[0].toolCount, 13);
  assert.deepEqual((await page.evaluate(() => window.desktop.cronList())).tasks.filter(job => job.runtimeId === cronHost.runtimeId), cronHost.tasks);
  await page.evaluate(({ runtimeId, jobId }) => window.desktop.cronDelete(runtimeId, jobId),
    { runtimeId: cronHost.runtimeId, jobId: cronHost.tasks[0].id });
  await page.evaluate(async () => {
    const s = await window.desktop.settings();
    await window.desktop.saveMcp('steppage__steppage', { ...s.mcp.steppage__steppage, enabled: false });
    await window.desktop.prepareStepPage();
  });
  assert.equal((await page.evaluate(() => window.desktop.settings())).mcp.steppage__steppage.enabled, false);
  const disabled = await page.evaluate(async () => {
    const s = await window.desktop.restart();
    return (await window.desktop.summary(s.runtimeId)).mcp.filter(s => s.name.includes('steppage'));
  });
  assert.deepEqual(disabled, [{ name: 'steppage__steppage', status: 'disabled', toolCount: 0 }]);
  await app.close(); app = undefined;
  page = await launch();
  assert.equal((await page.evaluate(() => window.desktop.stepPageState())).status, 'ready');
  assert.equal((await page.evaluate(() => window.desktop.settings())).mcp.steppage__steppage.enabled, false);
  const raw = await readFile(join(root, 'config.toml'), 'utf8');
  assert.ok(raw.includes(join(root, 'steppage/home').replaceAll('\\', '\\\\')));
  // An enabled declaration must not execute bytes that fail verification on next launch.
  await page.evaluate(async () => {
    const s = await window.desktop.settings();
    await window.desktop.saveMcp('steppage__steppage', { ...s.mcp.steppage__steppage, enabled: true });
  });
  await app.close(); app = undefined;
  const marker = join(profile, 'unverified-bundle-executed');
  await writeFile(join(root, 'steppage/bin/steppage-mcp.mjs'),
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'must-not-run');\n`);
  page = await launch();
  assert.equal((await page.evaluate(() => window.desktop.stepPageState())).installed, false);
  assert.equal((await page.evaluate(() => window.desktop.settings())).mcp.steppage__steppage.enabled, false);
  const quarantined = await page.evaluate(async () => {
    const active = await window.desktop.newIndependentSession();
    return (await window.desktop.summary(active.runtimeId)).mcp.filter(s => s.name.includes('steppage'));
  });
  assert.deepEqual(quarantined, [{ name: 'steppage__steppage', status: 'disabled', toolCount: 0 }]);
  assert.equal(await stat(marker).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false);
  assert.equal((await page.evaluate(() => window.desktop.prepareStepPage())).status, 'ready');
  assert.equal((await page.evaluate(() => window.desktop.settings())).mcp.steppage__steppage.enabled, false,
    'Repair must not silently undo the protective disable');
  const report = { checkedAt: new Date().toISOString(), explicitSettingsInstall: true, connected, disabled,
    idleCronPreparation: true, cronHostAndJobPreserved: true, cronRestartStillProtected: true, feedbackSurvivesPoll: true,
    rejectedBundleDisabledOnLaunch: true, unverifiedBundleNeverExecuted: true, repairKeptDisable: true,
    relaunchKeptDisable: true, desktopOwnedHome: true,
    scope: 'Official download, pinned integrity and startup checks, UI entry, real MCP handshake and disable/relaunch only; no login, publishing, model prompt or installer acceptance' };
  await writeFile(join(output, 'steppage-preparation-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(output, 'steppage-preparation-failure.png') });
    console.error((await page.locator('body').innerText()).slice(0, 4000));
  }
  throw error;
} finally {
  if (app) {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await app.close();
  }
  // This script owns the exact mkdtemp profile and all its children.
  assert.ok(profile.startsWith(join(output, 'steppage-prepare-profile-')));
  await rm(profile, { recursive: true, force: true });
}
