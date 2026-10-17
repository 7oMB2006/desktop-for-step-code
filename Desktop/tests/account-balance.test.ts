import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountAllowanceService, decodeAccountBalance } from '../electron/account-allowance';

const start = 1792216800000;
const response = (amount = 1899.8) => ({
  object: 'account', type: 'prepaid', balance: amount, total_cash_balance: 9, total_voucher_balance: 3788,
});
const auth = (profile = 'platform_cn', key = 'balance-fixture-key') => ({
  step: { type: 'oauth', profile, access: key, refresh: 'step-static-credential', expires: Number.MAX_SAFE_INTEGER },
});

test('API balance projects only available balance, never guesses currency or subtracts lifetime totals', () => {
  const result = decodeAccountBalance(response(), start);
  assert.equal(result.source, 'api');
  assert.equal(result.balance?.amount, 1899.8);
  assert.equal(result.balance.currency, undefined);
  assert.equal(result.plan, undefined);
  assert.deepEqual(result.meters, []);
  assert.equal(JSON.stringify(result).includes('total_cash_balance'), false);
  assert.equal(decodeAccountBalance(response(0), start).balance?.amount, 0);
  assert.equal(decodeAccountBalance({ ...response(-12.3456), type: 'postpaid', currency: 'USD' }, start).balance?.currency, 'USD');
  assert.equal(decodeAccountBalance({ ...response(), currency: 'future' }, start).balance?.currency, undefined);
  for (const change of [
    { balance: null }, { balance: '1899.80' }, { balance: Infinity }, { balance: NaN },
    { balance: Number.MAX_SAFE_INTEGER + 1 }, { type: 'other' }, { object: 'error' },
  ]) assert.throws(() => decodeAccountBalance({ ...response(), ...change }, start));
});

test('official platform profiles use region-specific accounts endpoints, not the Plan endpoint or a custom provider', async () => {
  let data: Record<string, unknown> = auth();
  const urls: string[] = [];
  const service = new AccountAllowanceService(() => data, async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer balance-fixture-key');
    return Response.json(response());
  }, () => start);
  assert.equal((await service.query()).source, 'api');
  data = auth('platform_oversea');
  assert.equal((await service.query()).source, 'api');
  assert.deepEqual(urls, ['https://api.stepfun.com/v1/accounts', 'https://api.stepfun.ai/v1/accounts']);
  data = { custom: { type: 'api_key', key: 'custom-key' } };
  assert.equal((await service.query()).status, 'unsupported');
  assert.equal(urls.length, 2);
  assert.equal(JSON.stringify(service.cached()).includes('custom-key'), false);
});

test('balance snapshots share cache, stale failure, cooldown, expiry and authentication-clearing rules', async () => {
  let now = start, calls = 0, status = 200;
  const data = auth();
  const original = JSON.stringify(data);
  const service = new AccountAllowanceService(() => data, async () => {
    calls++;
    return status === 200 ? Response.json(response()) : new Response('private-server-error', {
      status, headers: { 'Retry-After': '10' },
    });
  }, () => now, () => now);
  await service.query(); await service.query();
  assert.equal(calls, 1);
  now += 30001; status = 503;
  assert.equal((await service.query()).status, 'stale');
  assert.equal(service.cached().balance?.amount, 1899.8);
  status = 429;
  assert.equal((await service.query(true)).issue, 'rate-limit');
  const before = calls;
  await service.query(true);
  assert.equal(calls, before);
  now += 10001; status = 401;
  assert.equal((await service.query(true)).balance, undefined);
  assert.equal(service.cached().issue, 'authentication');
  status = 200; await service.query(true);
  now += 300001;
  assert.equal(service.cached().balance, undefined);
  assert.equal(service.cached().issue, 'expired');
  assert.equal(JSON.stringify(data), original);
});

test('cancel, timeout and profile/key changes discard late balances and never mix Plan data with API money', async () => {
  for (const scenario of ['cancel', 'key-change', 'plan-switch', 'timeout']) {
    let data = auth();
    let release!: (value: Response) => void;
    const service = new AccountAllowanceService(() => data, () => new Promise(done => { release = done; }),
      () => start, () => start, scenario === 'timeout' ? 10 : 12000);
    const pending = service.query();
    assert.equal(service.query(), pending);
    if (scenario === 'cancel') service.cancel();
    if (scenario === 'key-change') data = auth('platform_cn', 'second-key');
    if (scenario === 'plan-switch') data = auth('step_plan', 'plan-key');
    if (scenario === 'timeout') await pending;
    release(Response.json(response()));
    await pending;
    await new Promise(done => setTimeout(done, 0));
    assert.equal(service.cached().balance, undefined);
    assert.equal(service.cached().plan, undefined);
  }
});
