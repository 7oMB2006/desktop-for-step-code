import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const profile = await mkdtemp(join(tmpdir(), 'desktop-allowance-'));
await mkdir(join(profile, 'step-runtime'), { recursive: true });
await mkdir('test-results', { recursive: true });
await writeFile(join(profile, 'preferences.json'), JSON.stringify({ language: 'zh', theme: 'light', workspaces: [], autoCheckUpdates: false }));
await writeFile(join(profile, 'step-runtime/auth.json'), JSON.stringify({ step: {
  type: 'oauth', access: 'allowance-fixture-only', refresh: 'fixture', expires: Number.MAX_SAFE_INTEGER,
  uid: '42', profile: 'step_plan',
} }));
const env = { ...process.env, DESKTOP_TEST_USER_DATA: profile, DESKTOP_TEST_NO_FOCUS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.STEP_API_KEY;
let app;
try {
  const executablePath = process.env.DESKTOP_VERIFY_EXE;
  app = await electron.launch({ ...(executablePath ? { executablePath } : { args: [resolve('.')] }), env, timeout: 60000 });
  const page = await app.firstWindow();
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
        schema_version: 1, scope: 'personal_account', observed_at_ms: now, account: { id: '42' },
        plan: { state: 'known', family: fixture.family, name: '官方套餐示例', subscription: { id: '7', expires_at_ms: now + 86400000 } },
        quota: { state: 'known', allowed: true, reason: null, windows: fixture.family === 'coding' ? [
          { id: 'five_hour', limited: true, used_percent: 28, resets_at_ms: now + 3600000 },
          { id: 'weekly', limited: true, used_percent: 57, resets_at_ms: now + 86400000 },
        ] : [], credit_buckets: fixture.family === 'token' ? [
          { type: 'subscription', total: '100000', remaining: '68500', used_percent: 31.5, resets_at_ms: now + 86400000, expires_at_ms: null },
          { type: 'topup', total: '10000', remaining: '1200', used_percent: 88, resets_at_ms: null, expires_at_ms: now + 172800000 },
        ] : [] },
      });
    };
  });
  await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
  await page.locator('.sidebar-bottom > button').click();
  const allowance = page.getByRole('region', { name: '套餐与额度' });
  await allowance.getByText('官方套餐示例', { exact: true }).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 2);
  assert.equal(await allowance.getByRole('meter').first().getAttribute('aria-valuenow'), '68.5');
  assert.equal(await allowance.getByText('5 小时额度', { exact: true }).count(), 0);
  assert.equal((await page.evaluate(() => window.desktop.accountAllowance())).plan.name, '官方套餐示例');
  assert.equal(await app.evaluate(() => globalThis.allowanceFixture.requests), 1, 'cached reads do not query again');
  await page.screenshot({ path: 'test-results/account-allowance-token-light.png', animations: 'disabled' });
  await app.evaluate(() => { globalThis.allowanceFixture.status = 503; });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await allowance.getByText(/显示的是上次获取的数据/).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 2, 'temporary error keeps stale quota');
  await app.evaluate(() => { globalThis.allowanceFixture.status = 401; });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await allowance.getByText(/无法验证额度查询权限/).waitFor();
  assert.equal(await allowance.getByRole('meter').count(), 0);
  assert.equal(await page.getByText('未订阅套餐', { exact: true }).count(), 0);
  await app.evaluate(() => { globalThis.allowanceFixture.status = 200; globalThis.allowanceFixture.family = 'coding'; });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await allowance.getByText('5 小时额度', { exact: true }).waitFor();
  await app.evaluate(() => { globalThis.allowanceFixture.delay = 600; });
  await allowance.getByRole('button', { name: '刷新额度' }).click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '账户', exact: true }).click();
  await allowance.getByText('5 小时额度', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  const result = await page.evaluate(() => window.desktop.accountAllowance());
  for (const privateText of ['allowance-fixture-only', 'private-upstream-error', '100000']) {
    assert.equal(JSON.stringify(result).includes(privateText), false);
  }
  assert.equal((await readFile(join(profile, 'step-runtime/auth.dpapi'))).includes(Buffer.from('allowance-fixture-only')), false);
  await assert.rejects(readFile(join(profile, 'step-runtime/auth.json')), { code: 'ENOENT' });
  assert.deepEqual(errors, []);
  console.log('Account allowance Electron passed: normal vault/IPC, Token/Coding projection, cache, refresh, stale/error, tab cancellation, encrypted fixture credentials.');
} finally { await app?.close(); }
