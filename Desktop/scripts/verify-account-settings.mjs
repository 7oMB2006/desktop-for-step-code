import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'desktop-account-settings-'));
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
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
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
  assert.equal(await page.locator('.provider-settings button').count(), 0);
  await page.screenshot({ path: 'test-results/provider-settings-light.png' });
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await page.locator('.account-channel').nth(2).click();
  await page.getByLabel('API Key', { exact: true }).fill('fixture-key-to-discard');
  await page.locator('.account-channel').nth(3).click();
  assert.equal(await page.getByLabel('API Key', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '登录', exact: true }).isEnabled(), false);
  await page.getByLabel('API Key', { exact: true }).fill('isolated-api-fixture-only');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByText('API Key · 海外', { exact: true }).waitFor();
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
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByText('未登录', { exact: true }).waitFor();
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
