import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageEstimates } from '../electron/usage-estimates';
import { defaultEstimateRules, estimateResponse, formatEstimate, isPeakTime, type EstimateContext } from '../src/usage-estimates';
import type { Message, Usage } from '../src/contracts';

const weekday = Date.parse('2026-10-16T09:00:00+08:00');
const weekend = Date.parse('2026-10-17T09:00:00+08:00');
const usage: Usage = { input: 1000000, cacheRead: 1000000, cacheWrite: 0, output: 1000000, reasoning: 500000 };
const context = (mode: 'plan' | 'api' = 'plan'): EstimateContext => ({
  account: 'test', mode, region: 'cn', rules: { ...defaultEstimateRules },
});
test('Plan uses Credit units, exclusive input, cached price, and counts reasoning once', () => {
  assert.equal(estimateResponse(context(), 'step-5-preview', usage, weekend), 27.35);
  assert.equal(estimateResponse(context(), 'step-5-preview', usage, weekday), 54.7);
  const old = context(); old.rules.planProtected = true;
  assert.equal(estimateResponse(old, 'step-5-preview', usage, weekday), 27.35);
});
test('Beijing peak boundaries do not depend on local timezone', () => {
  for (const time of ['09:00', '11:59', '14:00', '17:59']) assert.equal(isPeakTime(Date.parse(`2026-10-16T${time}:00+08:00`)), true);
  for (const time of ['08:59', '12:00', '13:59', '18:00']) assert.equal(isPeakTime(Date.parse(`2026-10-16T${time}:00+08:00`)), false);
  assert.equal(isPeakTime(weekend), false);
});
test('API standard, API legacy cache, and global USD rates stay separate from Plan rules', () => {
  const api = context('api');
  assert.equal(estimateResponse(api, 'step-5-preview', usage, weekday), 27.7);
  api.rules.planProtected = true;
  assert.equal(estimateResponse(api, 'step-5-preview', usage, weekday), 27.7);
  api.rules.apiLegacyCache = true;
  assert.equal(estimateResponse(api, 'step-5-preview', usage, weekday), 27.35);
  api.region = 'global';
  assert.equal(estimateResponse(api, 'step-5-preview', usage, weekday), 3.8);
});
test('unknown models, router prices, international Plan and malformed usage are unavailable, not free', () => {
  for (const model of ['unknown', 'step-router-v1', 'deepseek-v4-pro']) assert.equal(estimateResponse(context(), model, usage, weekday), undefined);
  assert.equal(estimateResponse({ ...context(), region: 'global' }, 'step-5-preview', usage, weekday), undefined);
  for (const value of [-1, NaN, Infinity, 1.5]) assert.equal(estimateResponse(context(), 'step-5-preview', { ...usage, input: value }, weekday), undefined);
  assert.equal(estimateResponse(context(), 'step-5-preview', { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, weekday), undefined);
  assert.equal(estimateResponse(context(), 'step-5-preview', { ...usage, cacheWrite: 1000000 }, weekend), 34.35);
});

async function fixture(run: (f: Awaited<ReturnType<typeof createFixture>>) => Promise<void>) {
  const f = await createFixture();
  try { await run(f); } finally { await f.service.flush(); await rm(f.root, { force: true, recursive: true }); }
}
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'step-estimates-'));
  let auth: Record<string, unknown> = { step: { type: 'oauth', uid: '42', access: 'never-leak-this-key', profile: 'step_plan' } };
  const service = new UsageEstimates(root, () => auth);
  await service.initialize();
  const worker = { id: 'worker', state: { sessionId: 'session-1' }, messages: [] as Message[] };
  await service.load('session-1');
  service.attach(worker);
  let timestamp = weekend;
  const message = (model = 'step-5-preview', provider = 'step'): Message => ({
    role: 'assistant', provider, model, timestamp: ++timestamp, content: [{ type: 'text', text: 'hello' }], usage,
  });
  const start = (m: Message, at = weekend) => service.event(worker, { type: 'message_start', message: { ...m, content: [] } }, at);
  const end = (m: Message) => { service.event(worker, { type: 'message_end', message: m }); worker.messages.push(m); };
  return { root, service, worker, message, start, end, setAuth: (value: Record<string, unknown>) => { auth = value; },
    currentAuth: () => auth };
}
test('Plan -> API -> Plan preserves both groups and freezes identity at response start', () => fixture(async f => {
  const first = f.message(); f.start(first); f.end(first);
  assert.equal(f.service.summary(f.worker).active?.amount, 27.35);
  f.setAuth({ step: { type: 'oauth', uid: '42', access: 'api-key', profile: 'platform_cn' } });
  f.service.attach(f.worker);
  assert.equal(f.service.summary(f.worker).active, undefined);
  const second = f.message(); f.start(second, weekday);
  f.setAuth({ step: { type: 'oauth', uid: '42', access: 'other', profile: 'step_plan' } });
  f.end(second);
  assert.equal(f.service.summary(f.worker).active?.amount, 27.35);
  assert.equal(f.service.summary(f.worker).groups.find(g => g.mode === 'api')?.amount, 27.7);
}));
test('manual rules freeze per request; changing a rule never reprices prior records', () => fixture(async f => {
  const first = f.message(); f.start(first, weekday);
  await f.service.setRules({ ...defaultEstimateRules, planProtected: true }, f.service.settings().accountRef);
  f.end(first);
  const second = f.message(); f.start(second, weekday); f.end(second);
  assert.equal(f.service.summary(f.worker).active?.amount, 54.7 + 27.35);
  await assert.rejects(f.service.setRules({ ...defaultEstimateRules }, 'wrong-account'), /changed/);
  await assert.rejects(f.service.setRules({ planProtected: 'yes' }, f.service.settings().accountRef), /Invalid/);
}));
test('repeated end, history reads and compaction do not double-count or discard recorded costs', () => fixture(async f => {
  const m = f.message(); f.start(m); f.end(m); f.end(m);
  await f.service.load('session-1');
  f.worker.messages = [];
  assert.equal(f.service.summary(f.worker).active?.amount, 27.35);
  assert.equal(f.service.summary(f.worker).active?.responses, 1);
}));
test('third-party provider masquerading as a Step model never enters an official group', () => fixture(async f => {
  const m = f.message('step-5-preview', 'desktop-custom-example'); f.start(m); f.end(m);
  assert.equal(f.service.summary(f.worker).groups.length, 0);
}));
test('historical messages are not charged to the current account; unknown price retains partial status', () => fixture(async f => {
  f.worker.messages.push(f.message());
  assert.equal(f.service.summary(f.worker).historicalUnknown, true);
  const m = f.message('step-router-v1'); f.start(m); f.end(m);
  const summary = f.service.summary(f.worker);
  assert.equal(summary.active?.unknown, 1);
  assert.equal(formatEstimate(summary.active!, 'zh'), '--');
}));
test('rule/record persistence survives restart without storing prompts or credentials', () => fixture(async f => {
  await f.service.setRules({ ...defaultEstimateRules, planProtected: true }, f.service.settings().accountRef);
  const m = f.message(); f.start(m); f.end(m);
  await f.service.flush();
  const saved = await Promise.all((await readdir(f.root)).map(name => readFile(join(f.root, name), 'utf8')));
  assert.ok(saved.every(text => !text.includes('never-leak') && !text.includes('hello')));
  const restored = new UsageEstimates(f.root, f.currentAuth);
  await restored.initialize(); await restored.load('session-1');
  assert.equal(restored.settings().rules.planProtected, true);
  assert.equal(restored.summary(f.worker).active?.amount, 27.35);
  await restored.remove('session-1');
  assert.equal(restored.summary(f.worker).active, undefined);
}));
test('separate accounts, keys, sessions and regions never inherit each other’s totals or manual rules', () => fixture(async f => {
  await f.service.setRules({ ...defaultEstimateRules, planProtected: true }, f.service.settings().accountRef);
  const m = f.message(); f.start(m); f.end(m);
  f.setAuth({ step: { type: 'oauth', uid: '43', access: 'new-key', profile: 'step_plan' } });
  f.service.attach(f.worker);
  assert.equal(f.service.settings().rules.planProtected, false);
  assert.equal(f.service.summary(f.worker).active, undefined);
  assert.equal(f.service.summary(f.worker).groups[0].currentAccount, false);
  assert.equal(f.service.summary({ ...f.worker, state: { sessionId: 'another' } }).groups.length, 0);
  f.setAuth({ step: { type: 'oauth', uid: '42', access: 'global-key', profile: 'platform_oversea' } });
  assert.equal(f.service.summary(f.worker).active, undefined);
}));
test('events without a captured response start are never attributed after login changes', () => fixture(async f => {
  f.end(f.message());
  assert.equal(f.service.summary(f.worker).active, undefined);
  const m = f.message(); f.start(m);
  f.service.detach(f.worker); f.end(m);
  assert.equal(f.service.summary(f.worker).active, undefined);
}));
test('queued rule updates persist the last accepted setting without changing recorded responses', () => fixture(async f => {
  const ref = f.service.settings().accountRef;
  const m = f.message(); f.start(m); f.end(m);
  await Promise.all([
    f.service.setRules({ planProtected: true, apiLegacyCache: false }, ref),
    f.service.setRules({ planProtected: false, apiLegacyCache: true }, ref),
  ]);
  await f.service.flush();
  const restored = new UsageEstimates(f.root, f.currentAuth);
  await restored.initialize(); await restored.load('session-1');
  assert.deepEqual(restored.settings().rules, { planProtected: false, apiLegacyCache: true });
  assert.equal(restored.summary(f.worker).active?.amount, 27.35);
}));
