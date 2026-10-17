import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

await mkdir('test-results', { recursive: true });
for (const profileId of ['platform_cn', 'platform_oversea']) {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-api-balance-'));
  await mkdir(join(profile, 'step-runtime'), { recursive: true });
  await writeFile(join(profile, 'preferences.json'), JSON.stringify({
    language: 'zh', theme: profileId === 'platform_cn' ? 'light' : 'dark', workspaces: [], autoCheckUpdates: false,
  }));
  await writeFile(join(profile, 'step-runtime/auth.json'), JSON.stringify({ step: {
    type: 'oauth', access: 'balance-fixture-only', refresh: 'step-static-credential',
    expires: Number.MAX_SAFE_INTEGER, profile: profileId,
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
    await app.evaluate(({ net, shell, BrowserWindow, dialog }, profileId) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(0); window.setIgnoreMouseEvents(true); window.showInactive();
      dialog.showMessageBox = async () => ({ response: 1 });
      globalThis.balanceFixture = { requests: 0, amount: 1899.8, status: 200, type: 'prepaid', delay: 0, links: [] };
      shell.openExternal = async url => { globalThis.balanceFixture.links.push(url); };
      const original = net.fetch.bind(net);
      const endpoint = profileId === 'platform_cn' ? 'https://api.stepfun.com/v1/accounts' : 'https://api.stepfun.ai/v1/accounts';
      net.fetch = async (input, init) => {
        if (String(input) !== endpoint) return original(input, init);
        const fixture = globalThis.balanceFixture;
        fixture.requests++;
        if (init.headers.authorization !== 'Bearer balance-fixture-only' || init.redirect !== 'error' || init.credentials !== 'omit')
          throw new Error('Unexpected fixture transport');
        if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay));
        if (fixture.status !== 200) return new Response('private-balance-server-error', { status: fixture.status });
        return Response.json({ object: 'account', type: fixture.type, balance: fixture.amount,
          total_cash_balance: 9, total_voucher_balance: 3788 });
      };
    }, profileId);
    await page.getByRole('heading', { name: /^(让想法阶跃星辰|星辰因你而阶跃)$/ }).waitFor();
    await page.locator('.sidebar-bottom > button').click();
    const balance = page.getByRole('region', { name: 'API 账户余额' });
    await balance.getByText('1,899.80', { exact: true }).waitFor();
    await balance.getByText('接口未标注币种，以官网为准', { exact: true }).waitFor();
    assert.equal(await balance.getByRole('meter').count(), 0);
    assert.equal(await balance.getByText('¥', { exact: true }).count(), 0);
    const result = await page.evaluate(() => window.desktop.accountAllowance());
    assert.equal(result.balance.amount, 1899.8);
    assert.equal(result.source, 'api');
    assert.equal(await app.evaluate(() => globalThis.balanceFixture.requests), 1);
    await balance.getByRole('link', { name: '前往官网' }).click();
    await page.waitForTimeout(100);
    assert.deepEqual(await app.evaluate(() => globalThis.balanceFixture.links),
      [profileId === 'platform_cn' ? 'https://platform.stepfun.com/account-overview' : 'https://platform.stepfun.ai/']);
    await page.screenshot({ path: `test-results/account-balance-${profileId}.png`, animations: 'disabled' });
    await app.evaluate(() => { globalThis.balanceFixture.amount = 0; });
    await balance.getByRole('button', { name: '刷新余额' }).click();
    await balance.getByText('0.00', { exact: true }).waitFor();
    await balance.getByText(/可用余额不足/).waitFor();
    await app.evaluate(() => { globalThis.balanceFixture.status = 503; });
    await balance.getByRole('button', { name: '刷新余额' }).click();
    await balance.getByText(/显示的是上次获取的数据/).waitFor();
    assert.equal(await balance.getByText('0.00', { exact: true }).count(), 1);
    await app.evaluate(() => { globalThis.balanceFixture.status = 401; });
    await balance.getByRole('button', { name: '刷新余额' }).click();
    await balance.getByText(/无法验证余额查询权限/).waitFor();
    assert.equal(await balance.getByText('0.00', { exact: true }).count(), 0);
    await app.evaluate(() => { globalThis.balanceFixture.status = 200; globalThis.balanceFixture.type = 'postpaid'; globalThis.balanceFixture.amount = -12.3; });
    await balance.getByRole('button', { name: '刷新余额' }).click();
    await balance.getByText('-12.30', { exact: true }).waitFor();
    assert.equal(await balance.getByText(/可用余额不足/).count(), 0, 'postpaid balance is not a prepaid shortage');
    await app.evaluate(() => { globalThis.balanceFixture.amount = 'invalid-amount'; });
    await balance.getByRole('button', { name: '刷新余额' }).click();
    await balance.getByText(/暂时无法解析官方余额数据/).waitFor();
    await app.evaluate(() => { globalThis.balanceFixture.amount = 100; globalThis.balanceFixture.delay = 400; });
    await balance.getByRole('button', { name: '刷新余额' }).click();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('button', { name: '账户', exact: true }).click();
    await balance.getByText('100.00', { exact: true }).waitFor();
    const final = await page.evaluate(() => window.desktop.accountAllowance());
    for (const text of ['balance-fixture-only', 'private-balance-server-error', 'total_voucher_balance']) {
      assert.equal(JSON.stringify(final).includes(text), false);
    }
    assert.equal((await readFile(join(profile, 'step-runtime/auth.dpapi'))).includes(Buffer.from('balance-fixture-only')), false);
    assert.deepEqual(errors, []);
  } finally { await app?.close(); }
}
console.log('API balance Electron passed: CN/Global fixed endpoints, literal vault credential, real IPC, no invented currency, zero/error/stale/postpaid, website, cancellation and encrypted storage.');
