import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-project-trust-')));
const root = join(profile, 'step-runtime');
const workspace = join(profile, 'project');
await mkdir(root, { recursive: true });
await mkdir(workspace);
await mkdir('test-results', { recursive: true });
let modelCalls = 0;
const server = createServer((req, res) => {
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fixture' }] }));
  } else {
    modelCalls++;
    res.writeHead(500).end('Project trust must not invoke a model');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(join(profile, 'preferences.json'), JSON.stringify({
  language: 'zh', theme: 'dark', workspaces: [workspace], workspace,
}));
await writeFile(join(root, 'config.toml'), [
  'defaultProvider = "fixture"', 'defaultModel = "fixture"', 'permissionPreset = "ask"',
  '[telemetry]', 'enabled = false', '',
].join('\n'));
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'isolated-trust-test',
  models: [{ id: 'fixture', name: 'Trust fixture', contextWindow: 32768, maxTokens: 2048 }],
} } }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const results = [];
try {
  app = await electron.launch({
    ...(process.env.DESKTOP_VERIFY_EXE ? { executablePath: process.env.DESKTOP_VERIFY_EXE } : { args: [resolve('.')] }),
    env, timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive(); window.setSize(1360, 900);
  });
  const input = () => page.getByRole('textbox', { name: '消息', exact: true });
  await input().waitFor();
  await page.waitForFunction(() => document.querySelector('.composer-input')?.getAttribute('contenteditable') === 'true',
    undefined, { timeout: 60000 });
  // Exercise the real composer, IPC and native admin store, not an IPC replacement.
  await input().fill('/tru');
  await page.getByRole('option').filter({ hasText: '项目信任' }).waitFor();
  await page.getByRole('option').filter({ hasText: '项目信任' }).click();
  await input().press('Enter');
  const drawer = () => page.getByRole('dialog', { name: '信任此项目？', exact: true });
  await drawer().waitFor({ timeout: 60000 });
  const before = await page.evaluate(() => window.desktop.snapshot());
  assert.ok(before.runtimeId);
  assert.equal(before.requests[0].projectTrust.cwd, workspace);
  assert.equal(await page.locator('.small-dialog').count(), 0, 'Uses the approval drawer, not a centered modal');
  await assert.rejects(readFile(join(root, 'agent/trust.json')), { code: 'ENOENT' });
  await drawer().getByRole('button', { name: '稍后处理', exact: true }).click();
  await drawer().waitFor({ state: 'hidden' });
  const deferred = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(deferred.requests.length, 1, 'Review later retains the same request');
  // The existing approval entry is the same one used by tool approvals.
  await page.getByRole('button', { name: /待批准|批准操作|等待批准|处理审批|审批|批准/ }).first().click();
  await drawer().waitFor();
  await drawer().getByRole('button', { name: '取消项目信任', exact: true }).click();
  await drawer().waitFor({ state: 'hidden' });
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).requests.length);
  await assert.rejects(readFile(join(root, 'agent/trust.json')), { code: 'ENOENT' });
  results.push('explicit composer command, drawer, defer/reopen and cancellation without saved trust');

  await input().fill('/trust');
  await input().press('Escape');
  await input().press('Enter');
  await drawer().waitFor();
  const screenshot = async (name, width, height, theme) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await page.evaluate(theme => window.desktop.preferences({ theme }), theme);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-event', { type: 'desktop_sessions_changed' }));
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.waitForTimeout(300);
    const bounds = await drawer().boundingBox();
    assert.ok(bounds && bounds.width > 0 && bounds.height > 0);
    assert.equal(await drawer().getByRole('button', { name: '信任项目并保存' }).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: `test-results/project-trust-${name}.png` });
  };
  await screenshot('dark', 1360, 900, 'dark');
  await screenshot('light', 1000, 800, 'light');
  await screenshot('narrow', 560, 850, 'light');
  await screenshot('dark-expanded', 1360, 900, 'dark');
  await drawer().locator('.approval-drawer-grip').focus();
  await drawer().locator('.approval-drawer-grip').press('ArrowUp');
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/project-trust-expanded.png' });
  await drawer().getByRole('button', { name: '信任项目并保存', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.snapshot()).requests.length);
  const trustFile = join(root, 'agent/trust.json');
  let saved;
  for (let i = 0; i < 100; i++) {
    try { saved = JSON.parse(await readFile(trustFile, 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await page.waitForTimeout(50); }
  }
  assert.deepEqual(saved, { [workspace]: true });
  assert.equal((await page.evaluate(() => window.desktop.snapshot())).runtimeId, before.runtimeId,
    'Saving does not replace the live runtime');
  await page.getByText('项目信任已保存。重启运行时后生效；当前及其他已打开会话未自动重启。', { exact: true }).waitFor();
  results.push('persistent authorization copy, dark/light/narrow layout, native isolated trust store and no implicit restart');
  const restarted = await page.evaluate(() => window.desktop.restart());
  assert.deepEqual(restarted.messages, before.messages,
    'Management-only empty sessions have no saved history; restart must not invent chat messages');
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  results.push('explicit restart keeps empty history and trust management never calls a model');
  await writeFile('test-results/project-trust.json', JSON.stringify({ profile, results, modelCalls }, null, 2));
  console.log(`Project trust Electron acceptance passed (${results.length} cases).`);
} finally {
  if (app) {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await app.close();
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
