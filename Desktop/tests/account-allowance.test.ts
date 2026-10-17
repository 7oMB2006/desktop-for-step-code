import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountAllowanceService, decodeAccountAllowance } from '../electron/account-allowance';

const start = 1792216800000;
const snapshot = (family: 'coding' | 'token' | 'none' = 'token', now = start) => ({
  schema_version: 1, observed_at_ms: now, scope: 'personal_account', account: { id: '42' },
  plan: { state: 'known', family, name: family === 'none' ? null : 'Official plan name',
    subscription: family === 'none' ? null : { id: '7', expires_at_ms: now + 86400000 } },
  quota: { state: 'known', allowed: family !== 'none', reason: null,
    windows: family === 'coding' ? [
      { id: 'five_hour', limited: true, used_percent: 28, resets_at_ms: now + 3600000 },
      { id: 'weekly', limited: false, used_percent: null, resets_at_ms: null },
    ] : [],
    credit_buckets: family === 'token' ? [
      { type: 'subscription', total: '9223372036854775807', remaining: '1234567890123456789',
        used_percent: 31.5, resets_at_ms: now + 86400000, expires_at_ms: null },
      { type: 'topup', total: '0', remaining: '0', used_percent: null, resets_at_ms: null, expires_at_ms: null },
    ] : [],
  },
});
const auth = (profile = 'step_plan', key = 'fixture-only-key', uid = '42') => ({
  step: { type: 'oauth', access: key, uid, profile },
});

test('expired credentials refresh once before allowance and the renewed credential survives service recreation', async () => {
  let data = { step: { ...auth().step, expires: start - 1, refresh: 'fixture-refresh' } };
  let refreshes = 0, queries = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    queries++;
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer renewed-fixture');
    return Response.json(snapshot());
  };
  const service = new AccountAllowanceService(() => data, fetcher, () => start, () => start, 12000, async signal => {
    refreshes++;
    assert.equal(signal.aborted, false);
    await Promise.resolve();
    data = { step: { ...data.step, access: 'renewed-fixture', refresh: 'rotated-fixture', expires: start + 3600000 } };
  });
  const first = service.query();
  assert.equal(service.query(), first);
  assert.equal((await first).status, 'ready');
  assert.equal(refreshes, 1);
  assert.equal((await new AccountAllowanceService(() => data, fetcher, () => start).query()).status, 'ready');
  assert.equal(queries, 2);
});

test('failed, cancelled and superseded credential refreshes never query with an expired token', async () => {
  for (const scenario of ['failure', 'cancel', 'account-change']) {
    let data: Record<string, unknown> = { step: { ...auth().step, expires: start - 1 } };
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let calls = 0;
    const service = new AccountAllowanceService(() => data, async () => {
      calls++; return Response.json(snapshot());
    }, () => start, () => start, 12000, async () => {
      await gate;
      if (scenario === 'failure') throw new Error('Refresh failed');
    });
    const pending = service.query();
    if (scenario === 'cancel') service.cancel();
    if (scenario === 'account-change') { data = auth('step_plan', 'other-account', '43'); service.cached(); }
    finish();
    const result = await pending;
    assert.equal(calls, 0);
    assert.equal(result.plan, undefined);
    assert.equal(result.status, scenario === 'failure' ? 'error' : 'idle');
  }
});

test('schema 1 uses official plan name and actual quota family without inventing five-hour windows', () => {
  const token = decodeAccountAllowance(snapshot(), '42', start);
  assert.equal(token.plan?.name, 'Official plan name');
  assert.deepEqual(token.meters.map(m => m.kind), ['subscription', 'topup']);
  assert.equal(token.meters[0].remainingPercent, 68.5);
  assert.equal(token.meters[1].remainingPercent, null);
  const empty = snapshot(); empty.quota.credit_buckets[1].used_percent = 0;
  assert.equal(decodeAccountAllowance(empty, '42', start).meters[1].remainingPercent, null,
    'a zero-total bucket cannot imply a full allowance');
  assert.equal(JSON.stringify(token).includes('1234567890123456789'), false, 'raw Credit balances stay outside IPC');
  const coding = decodeAccountAllowance(snapshot('coding'), '42', start);
  assert.equal(coding.meters[0].remainingPercent, 72);
  assert.equal(coding.meters[1].unlimited, true);
  const none = decodeAccountAllowance(snapshot('none'), '42', start);
  assert.equal(none.plan?.family, 'none');
});

test('official usage restrictions remain distinct from remaining allowance and partial results', () => {
  const raw = snapshot();
  const allowed = decodeAccountAllowance(raw, '42', start);
  raw.quota.allowed = false;
  (raw.quota as any).reason = 'subscription_expired';
  const denied = decodeAccountAllowance(raw, '42', start);
  assert.equal(allowed.quota?.allowed, true);
  assert.deepEqual(denied.quota, { allowed: false, reason: 'subscription_expired' });
  assert.deepEqual(denied.meters, allowed.meters, 'restrictions do not invent a zero balance');
  raw.quota.state = 'partial'; (raw.quota as any).credit_buckets = null;
  assert.equal(decodeAccountAllowance(raw, '42', start).quota?.allowed, false);
});

test('server observation time identifies resets and expiries crossed before receipt without treating old data as fresh', async () => {
  for (const boundary of ['reset', 'bucket-expiry', 'plan-expiry']) {
    const raw = snapshot();
    raw.observed_at_ms = start - 2000;
    if (boundary === 'reset') raw.quota.credit_buckets[0].resets_at_ms = start - 1000;
    if (boundary === 'bucket-expiry') (raw.quota.credit_buckets[0] as any).expires_at_ms = start - 1000;
    if (boundary === 'plan-expiry') raw.plan.subscription!.expires_at_ms = start - 1000;
    assert.equal(decodeAccountAllowance(raw, '42', start).status, 'stale');
    let calls = 0;
    const service = new AccountAllowanceService(() => auth(), async () => {
      calls++; return Response.json(raw);
    }, () => start, () => 0);
    assert.equal((await service.query()).status, 'stale');
    assert.equal((await service.query()).status, 'stale');
    assert.equal(calls, 2, 'pre-boundary data cannot satisfy the fresh cache');
    raw.observed_at_ms = start;
    assert.equal((await service.query()).status, 'ready', 'a post-boundary observation can be fresh');
  }
});

test('reject mismatched identities, invalid data and incompatible contracts; preserve unknown and partial quota', () => {
  assert.throws(() => decodeAccountAllowance(snapshot(), '43', start), /identity/);
  for (const change of [
    (s: any) => { s.schema_version = 2; },
    (s: any) => { s.observed_at_ms = start - 300001; },
    (s: any) => { s.quota.credit_buckets[0].used_percent = 101; },
    (s: any) => { s.quota.credit_buckets[0].remaining = 42; },
    (s: any) => { s.quota.windows = [{ id: 'five_hour', limited: true, used_percent: 12, resets_at_ms: null }]; },
    (s: any) => { s.plan.family = 'future'; },
    (s: any) => { s.plan.name = undefined; },
  ]) {
    const raw = snapshot(); change(raw);
    assert.throws(() => decodeAccountAllowance(raw, '42', start));
  }
  const partial = snapshot(); partial.quota.state = 'partial'; (partial.quota as any).credit_buckets = null;
  assert.equal(decodeAccountAllowance(partial, '42', start).issue, 'partial');
  const future = snapshot(); future.quota.credit_buckets[0].type = 'new-bucket';
  assert.equal(decodeAccountAllowance(future, '42', start).meters[0].remainingPercent, null);
});

test('only Desktop personal Plan credentials query fixed official regional endpoints, without redirects or cookies', async () => {
  let data: Record<string, unknown> = auth();
  const seen: string[] = [];
  const service = new AccountAllowanceService(() => data, async (url, init) => {
    seen.push(String(url));
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer fixture-only-key');
    return Response.json(snapshot());
  }, () => start);
  assert.equal((await service.query()).status, 'ready');
  data = auth('step_plan_oversea');
  await service.query();
  assert.deepEqual(seen, ['https://api.stepfun.com/step_plan/v1/usage', 'https://api.stepfun.ai/step_plan/v1/usage']);
  for (const unsupported of [{}, auth('unknown-profile'), { step: { type: 'api_key', key: 'gateway' } }]) {
    data = unsupported;
    assert.equal((await service.query()).status, 'unsupported');
  }
  assert.equal(seen.length, 2);
  assert.equal(JSON.stringify(service.cached()).includes('fixture-only-key'), false);
});

test('single flight, thirty-second cache, transient stale result and five-minute expiry', async () => {
  let now = start, calls = 0, failure = false;
  const service = new AccountAllowanceService(() => auth(), async () => {
    calls++;
    return failure ? new Response('', { status: 503 }) : Response.json(snapshot('token', now));
  }, () => now, () => now);
  const one = service.query();
  assert.equal(one, service.query());
  await one; await service.query();
  assert.equal(calls, 1);
  now += 30001; failure = true;
  const stale = await service.query();
  assert.equal(stale.status, 'stale'); assert.ok(stale.plan);
  now += 300001;
  assert.equal(service.cached().plan, undefined);
});

test('401/403 clear snapshots without modifying credentials; 404 remains distinct from no subscription', async () => {
  const data = auth();
  const original = JSON.stringify(data);
  let status = 200;
  const service = new AccountAllowanceService(() => data, async () => status === 200
    ? Response.json(snapshot()) : new Response('private-server-error', { status }), () => start);
  for (const code of [401, 403, 404]) {
    status = 200; await service.query(true); status = code;
    const result = await service.query(true);
    if (code !== 404) assert.equal(result.plan, undefined);
    assert.equal(result.issue, code === 404 ? 'not-available' : 'authentication');
    assert.notEqual(result.plan?.family, 'none');
    assert.equal(JSON.stringify(result).includes('private-server-error'), false);
  }
  assert.equal(JSON.stringify(data), original);
});

test('rate limit uses Retry-After without background polling, including explicit refresh', async () => {
  let now = start, calls = 0;
  const service = new AccountAllowanceService(() => auth(), async () => {
    calls++; return new Response('', { status: 429, headers: { 'Retry-After': '10' } });
  }, () => now, () => now);
  assert.equal((await service.query()).retryAt, start + 10000);
  await service.query(true);
  assert.equal(calls, 1);
  now += 10001; await service.query(true);
  assert.equal(calls, 2);
});

test('cancel and account changes discard late responses, even if transport ignores abort', async () => {
  let data = auth();
  let resolve!: (response: Response) => void;
  const service = new AccountAllowanceService(() => data, () => new Promise(done => { resolve = done; }), () => start);
  const old = service.query();
  service.cancel();
  resolve(Response.json(snapshot()));
  await old;
  assert.equal(service.cached().plan, undefined);
  const switched = service.query();
  data = auth('step_plan', 'second-key', '43');
  resolve(Response.json(snapshot()));
  await switched;
  assert.equal(service.cached().plan, undefined);
  assert.equal(service.cached().status, 'idle');
});

test('timeout and bounded payload validation never expose a late reply or arbitrary upstream data', async () => {
  let release!: (value: Response) => void;
  const service = new AccountAllowanceService(() => auth(), () => new Promise(done => { release = done; }),
    () => start, () => start, 10);
  assert.equal((await service.query()).issue, 'network');
  release(Response.json(snapshot()));
  await new Promise(done => setTimeout(done, 0));
  assert.equal(service.cached().plan, undefined);
  for (const response of [new Response('x'.repeat(262145)), Response.json({ ...snapshot(), account: { id: '43' } })]) {
    const check = new AccountAllowanceService(() => auth(), async () => response, () => start);
    const result = await check.query();
    assert.equal(result.status, 'error');
    assert.equal(result.plan, undefined);
  }
});
