import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'desktop-account-settings-'));
await mkdir('test-results', { recursive: true });
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [] }));
const secret = 'isolated-account-fixture-only';
await writeFile(join(profile, 'step-runtime/auth.json'), JSON.stringify({ step: {
  type: 'oauth', access: secret, refresh: 'fixture', expires: Number.MAX_SAFE_INTEGER,
  profile: 'step_plan', uid: 'fixture-user-1042',
} }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Keep this unsent draft through login');
  await page.locator('.sidebar-bottom > button').click();
  await page.getByText('UID fixture-user-1042', { exact: true }).waitFor();
  const account = await page.evaluate(async () => (await window.desktop.settings()).account);
  assert.equal(account.userId, 'fixture-user-1042');
  assert.equal(account.profile, 'step_plan');
  assert.equal(await page.locator('.account-channel').count(), 4);
  await page.locator('.account-status').waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/account-settings-light.png' });
  await page.getByRole('button', { name: '供应商', exact: true }).click();
  await page.getByText('自定义供应商', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '添加供应商', exact: true }).count(), 2);
  await page.screenshot({ path: 'test-results/provider-settings-light.png' });
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await page.locator('.account-channel').nth(2).click();
  await page.getByLabel('API Key', { exact: true }).fill('fixture-key-to-discard');
  await page.locator('.account-channel').nth(3).click();
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '登录', exact: true }).isEnabled(), false);
  await page.getByLabel('API Key', { exact: true }).fill('isolated-api-fixture-only');
  const proposedBefore = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(proposedBefore.state.model.thinkingLevels, undefined, 'Fixture starts with the unauthenticated placeholder capability state');
  // Discovery becomes available after authentication; the existing proposal must refresh.
  await writeFile(join(profile, 'step-runtime/models.json'), JSON.stringify({ providers: {
    step: { apiKey: 'isolated-model-fixture-only', baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions',
      models: [{ id: 'step-5-preview', name: 'Step thinking fixture', reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
        contextWindow: 32768, maxTokens: 2048 }] },
  } }));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByText('API Key · 海外', { exact: true }).waitFor();
  const proposedAfter = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(proposedAfter.draftId, proposedBefore.draftId, 'Authentication refresh retains the proposal identity');
  assert.equal(proposedAfter.runtimeId, undefined, 'Authentication must not eagerly create a conversation');
  assert.deepEqual(proposedAfter.state.model.thinkingLevels, ['low', 'medium', 'high']);
  assert.equal(proposedAfter.state.thinkingLevel, 'medium');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '消息', exact: true }).inputValue(), 'Keep this unsent draft through login');
  await page.getByRole('button', { name: '模型与思考强度', exact: true }).click();
  const effort = page.getByRole('slider', { name: '思考强度', exact: true });
  await effort.waitFor();
  assert.equal(await effort.getAttribute('aria-valuemax'), '2', 'Fresh model levels reach the renderer without reopening a project');
  assert.equal(await page.getByText('暂无可用档位', { exact: true }).count(), 0);
  await page.screenshot({ path: 'test-results/account-thinking-after-login.png' });
  await effort.press('End');
  await page.waitForFunction(async () => (await window.desktop.snapshot()).state.thinkingLevel === 'high');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.desktop.command('set_model', { provider: 'step', modelId: 'step-5-preview' }));
  const catalog = JSON.parse(await readFile(join(profile, 'step-runtime/models.json'), 'utf8'));
  catalog.providers.step.models[0].thinkingLevelMap.high = null;
  catalog.providers.step.models[0].thinkingLevelMap.xhigh = 'xhigh';
  await writeFile(join(profile, 'step-runtime/models.json'), JSON.stringify(catalog));
  const refreshed = await page.evaluate(() => window.desktop.beginSession());
  assert.deepEqual(refreshed.state.model.thinkingLevels, ['low', 'medium', 'xhigh'], 'Explicitly selected models take fresh capabilities instead of retaining the old object');
  assert.ok(refreshed.state.model.thinkingLevels.includes(refreshed.state.thinkingLevel));
  assert.equal(refreshed.draftId, proposedBefore.draftId);
  assert.equal(refreshed.sessions.length, 0);
  assert.equal(refreshed.runtimes.length, 0);
  await page.locator('.sidebar-bottom > button').click();
  assert.equal(await page.locator('.account-user-id').count(), 0);
  const apiAccount = await page.evaluate(async () => (await window.desktop.settings()).account);
  assert.equal(apiAccount.profile, 'platform_oversea');
  assert.equal(apiAccount.userId, undefined);
  const encrypted = await readFile(join(profile, 'step-runtime/auth.dpapi'));
  assert.equal(encrypted.includes(Buffer.from('isolated-api-fixture-only')), false);
  await assert.rejects(readFile(join(profile, 'step-runtime/auth.json')), { code: 'ENOENT' });
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/主题|Theme/).selectOption('dark');
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await page.locator('html[data-theme="dark"]').waitFor();
  await page.screenshot({ path: 'test-results/account-settings-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 720));
  await page.screenshot({ path: 'test-results/account-settings-narrow.png' });
  assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await writeFile(join(profile, 'step-runtime/models.json'), JSON.stringify({ providers: {} }));
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByText('未登录', { exact: true }).waitFor();
  const signedOut = await page.evaluate(() => window.desktop.snapshot());
  assert.equal(signedOut.draftId, proposedBefore.draftId);
  assert.equal(signedOut.state.model.thinkingLevels, undefined, 'Signed-out proposal does not retain the authenticated catalog');
  assert.equal(signedOut.runtimeId, undefined);
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/语言|Language/).selectOption('en');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByText('Not signed in', { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.account-login-area').evaluate(element => getComputedStyle(element).animationName), 'none');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('desktop');
    globalThis.accountFixture = { calls: 0, login: undefined, release: undefined, finished: false };
    ipcMain.removeHandler('desktop');
    ipcMain.handle('desktop', async (event, method, ...args) => {
      if (method === 'settings') {
        const next = await original(event, method, ...args);
        if (++globalThis.accountFixture.calls === 2) {
          await new Promise(resolve => { globalThis.accountFixture.release = resolve; });
          globalThis.accountFixture.finished = true;
        }
        return { ...next, account: { loggedIn: true, validity: 'valid', profile: 'platform_cn' } };
      }
      if (method === 'login') {
        globalThis.accountFixture.login = { profile: args[0], matches: args[1] === 'overseas-race-fixture' };
        throw new Error('Fixture login intercepted');
      }
      return original(event, method, ...args);
    });
  });
  await page.locator('.sidebar-bottom > button').click();
  await page.locator('.account-channel.is-selected').filter({ hasText: 'Mainland China' }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.sidebar-bottom > button').click();
  await page.locator('.account-channel').nth(3).click();
  await page.getByLabel('API Key', { exact: true }).fill('overseas-race-fixture');
  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await app.evaluate(() => Boolean(globalThis.accountFixture.release))) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Delayed settings fixture not ready');
  });
  await app.evaluate(() => globalThis.accountFixture.release());
  await page.getByText('API Key · Mainland China', { exact: true }).waitFor();
  assert.match(await page.locator('.account-channel.is-selected').innerText(), /International/);
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), 'overseas-race-fixture');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.error-banner').filter({ hasText: 'Fixture login intercepted' }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.accountFixture.login), { profile: 'platform_oversea', matches: true });
  assert.deepEqual(errors, []);
  console.log('Account channels, UID projection, credential states, API login/logout, themes and narrow layouts passed with isolated fixtures.');
} finally {
  if (app) await app.close();
}
