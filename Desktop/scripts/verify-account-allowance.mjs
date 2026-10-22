import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { closeDesktopFixture } from './close-desktop-fixture.mjs';

const profile = await mkdtemp(join(tmpdir(), 'desktop-allowance-'));
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [], autoCheckUpdates: false }));
await writeFile(join(profile, 'step-runtime/auth.json'), JSON.stringify({ step: {
  type: 'oauth', access: 'allowance-fixture-only', refresh: 'step-static-credential', expires: Date.now() - 1000,
  uid: '42', profile: 'step_plan',
} }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
let phase = 'launch';
const mark = value => { phase = value; console.log(`Account allowance acceptance: ${phase}`); };
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ net, BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
    globalThis.allowanceFixture = { requests: 0, status: 200, delay: 0, family: 'token' };
    const original = net.fetch.bind(net);
    net.fetch = async (input, init) => {
      if (String(input) !== 'https://api.stepfun.com/step_plan/v1/usage') return original(input, init);
      const fixture = globalThis.allowanceFixture;
      fixture.requests++;
      if (init.headers.authorization !== 'Bearer allowance-fixture-only') throw new Error('Unexpected fixture identity');
      if (init.redirect !== 'error' || init.credentials !== 'omit') throw new Error('Unexpected transport policy');
      if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay));
      if (fixture.status !== 200) return new Response('private-upstream-error', { status: fixture.status });
      const now = Date.now();
      return Response.json({
        schema_version: 1, scope: 'personal_account', observed_at_ms: fixture.crossedReset ? now - 2000 : now, account: { id: '42' },
        plan: { state: 'known', family: fixture.family, name: '官方套餐示例', subscription: { id: '7', expires_at_ms: now + 86400000 } },
        quota: { state: 'known', allowed: !fixture.blocked, reason: fixture.blocked ? 'blocked' : null, windows: fixture.family === 'coding' ? [
          { id: 'five_hour', limited: true, used_percent: 28, resets_at_ms: now + 3600000 },
          { id: 'weekly', limited: true, used_percent: 57, resets_at_ms: now + 86400000 },
        ] : [], credit_buckets: fixture.family === 'token' ? [
          { type: 'subscription', total: '100000', remaining: '68500', used_percent: 31.5, resets_at_ms: fixture.crossedReset ? now - 1000 : now + 86400000, expires_at_ms: null },
          { type: 'topup', total: '10000', remaining: '1200', used_percent: 88, resets_at_ms: null, expires_at_ms: now + 172800000 },
        ] : [] },
      });
    };
  });
  mark('initial account and quota');
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  await page.locator('.sidebar-bottom > button').click();
  const allowance = page.getByRole('region', { name: '套餐与额度' });
  await allowance.getByText('官方套餐示例', { exact: true }).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 2);
  assert.equal(await allowance.getByRole('meter').first().getAttribute('aria-valuenow'), '68.5');
  assert.equal(await allowance.getByText('5 小时额度', { exact: true }).count(), 0);
  assert.equal((await page.evaluate(() => window.desktop.accountAllowance())).plan.name, '官方套餐示例');
  assert.equal(await app.evaluate(() => globalThis.allowanceFixture.requests), 1, 'cached reads do not query again');
  const rules = page.getByRole('checkbox', { name: '按历史订阅保护规则估算' });
  mark('estimate rules and account isolation');
  await rules.waitFor();
  assert.equal(await rules.isChecked(), false);
  await rules.check();
  await page.waitForFunction(async () => (await window.desktop.estimateSettings()).rules.planProtected === true);
  assert.equal(await rules.isChecked(), true);
  assert.equal(await page.evaluate(async () => {
    const value = await window.desktop.estimateSettings();
    try { await window.desktop.setEstimateRules(value.rules, 'wrong-account'); return false; }
    catch { return true; }
  }), true, 'a stale account reference cannot change another account’s rules');
  await page.screenshot({ path: 'test-results/account-allowance-token-light.png', animations: 'disabled' });
  mark('restricted and stale quota');
  await app.evaluate(() => { globalThis.allowanceFixture.blocked = true; globalThis.allowanceFixture.crossedReset = true; });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await allowance.getByText('官方已限制当前账户使用；剩余额度不代表当前可用。', { exact: true }).waitFor();
  await allowance.getByText(' · 数据待刷新', { exact: true }).waitFor();
  assert.equal(await allowance.getByRole('meter').first().getAttribute('aria-valuenow'), '68.5');
  const restricted = await page.evaluate(() => window.desktop.accountAllowance());
  assert.equal(restricted.quota.allowed, false);
  assert.equal(restricted.status, 'stale');
  await app.evaluate(() => { globalThis.allowanceFixture.blocked = false; globalThis.allowanceFixture.crossedReset = false; });
  await app.evaluate(() => { globalThis.allowanceFixture.status = 503; });
  mark('temporary and authentication failures');
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await allowance.getByText(/显示的是上次获取的数据/).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 2, 'temporary error keeps stale quota');
  await app.evaluate(() => { globalThis.allowanceFixture.status = 401; });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await allowance.getByText(/无法验证额度查询权限/).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 0);
  assert.equal(await page.getByText('未订阅套餐', { exact: true }).count(), 0);
  await app.evaluate(() => { globalThis.allowanceFixture.status = 200; globalThis.allowanceFixture.family = 'coding'; });
  mark('Coding projection and tab cancellation');
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await allowance.getByText('5 小时额度', { exact: true }).waitFor();
  await app.evaluate(() => { globalThis.allowanceFixture.delay = 600; });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await allowance.getByText('5 小时额度', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  mark('credential privacy and refreshed vault');
  const result = await page.evaluate(() => window.desktop.accountAllowance());
  for (const privateText of ['allowance-fixture-only', 'private-upstream-error', '100000']) {
    assert.equal(JSON.stringify(result).includes(privateText), false);
  }
  assert.equal((await readFile(join(profile, 'step-runtime/auth.dpapi'))).includes(Buffer.from('allowance-fixture-only')), false);
  const encrypted = Array.from(await readFile(join(profile, 'step-runtime/auth.dpapi')));
  const refreshedVault = ({ safeStorage }, bytes) => {
    const saved = JSON.parse(safeStorage.decryptString(Buffer.from(bytes)));
    return saved.step.expires === Number.MAX_SAFE_INTEGER && saved.step.refresh === 'step-static-credential';
  };
  assert.equal(await app.evaluate(refreshedVault, encrypted), true, 'upstream refresh is persisted in the Desktop vault');
  await assert.rejects(readFile(join(profile, 'step-runtime/auth.json')), { code: 'ENOENT' });
  assert.deepEqual(errors, []);
  mark('orderly shutdown before restart');
  await closeDesktopFixture(app);
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const reopened = await app.firstWindow();
  reopened.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow, dialog }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  mark('restored estimate rules and credentials');
  await reopened.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  assert.equal(await reopened.evaluate(async () => (await window.desktop.estimateSettings()).rules.planProtected), true,
    'manual estimate rule survives restart and OAuth credential renewal');
  assert.equal(await app.evaluate(refreshedVault, encrypted), true, 'refreshed credential remains readable after restart');
  console.log('Account allowance Electron passed: normal vault/IPC, upstream credential refresh and persistence/restart, Token/Coding projection, cache, stale/error, tab cancellation, encrypted fixture credentials.');
} catch (error) {
  console.error(`Account allowance failed during ${phase}`);
  await app?.firstWindow().then(page => page.screenshot({ path: 'test-results/account-allowance-failure.png' })).catch(() => {});
  throw error;
} finally { if (app) await closeDesktopFixture(app); }
