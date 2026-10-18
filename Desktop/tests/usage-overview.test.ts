import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The runtime adapter is a Node ESM module, also staged verbatim.
import { decodeCache, projectDesktopUsage, scanDesktopUsage } from '../electron/usage-overview.mjs';
import { UsageEstimates } from '../electron/usage-estimates';
import { emptyUsageOverview } from '../src/usage-overview';

const time = new Date(2026, 9, 18, 9).toISOString();
const date = '2026-10-18';
const usage = { input: 100, output: 20, cacheRead: 60, cacheWrite: 10 };
const native = (tokens: number) => ({ days: [{ date, tokens, chats: 1 }], chats: 1, limited: [] });
const entry = (id: string, provider: string | undefined = 'step', extra = {}) => ({ id, type: 'message',
  timestamp: time, message: { role: 'assistant', provider, model: 'model-x', usage }, ...extra });
const file = (id: string, entries: unknown[], extra = {}) => ({ path: join(tmpdir(), `${id}.jsonl`),
  header: { id, cwd: tmpdir(), ...extra }, entries });

test('Usage RPC keeps bounded post-scan headroom without changing the global request timeout', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../electron/usage-overview.mjs', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../electron/runtime.ts', import.meta.url), 'utf8');
  const deadline = Number(adapter.match(/AbortSignal\.timeout\((\d+)\)/)?.[1]);
  const timeout = Number(main.match(/admin\.request\('usage_overview', \{\}, (\d+)\)/)?.[1]);
  assert.equal(deadline, 28000);
  assert.ok(timeout >= deadline + 30000, 'Cache decode, projection and transport need their own headroom');
  assert.ok(timeout <= 90000, 'Usage requests must still have a finite, bounded wait');
  assert.match(runtime, /request\(type: string, args: Record<string, unknown> = \{\}, timeout = 30000\)/);
});

test('Usage dimensions count complete input exactly, preserving model, hour, source and unknown maintenance', () => {
  const out = projectDesktopUsage(native(190 * 2 + 10), [file('main', [
    entry('a'), entry('b', 'desktop-custom'),
    { id: 'c', type: 'compaction', timestamp: time, usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 } },
  ])]);
  const day = out.days[0];
  assert.equal(day.official, 190); assert.equal(day.custom, 190); assert.equal(day.unknown, 10);
  assert.equal(day.samples[0].hour, 9); assert.equal(day.samples[0].written, 10);
  assert.equal(day.samples[0].input + day.samples[0].output + day.samples[0].cached + day.samples[0].written, 190);
  assert.equal(out.chats.all, 1); assert.equal(out.chats.official, 1); assert.equal(out.chats.custom, 1);
  assert.ok(out.limited.includes('unknown-source'));
  assert.ok(!JSON.stringify(out).includes(tmpdir()));
});
test('Usage branch copies deduplicate by native origin, including deleted original and child sessions', () => {
  const lineage = (owner: string) => ({ id: 'lineage', type: 'custom', customType: 'step.usage_lineage', timestamp: time,
    data: { version: 1, sessionId: owner, origins: { a: { sessionId: 'original', role: 'user', cwd: tmpdir() } } } });
  const out = projectDesktopUsage(native(380), [
    file('copy-1', [entry('a'), lineage('copy-1')]),
    file('copy-2', [entry('a'), lineage('copy-2')]),
    file('subagent-child', [entry('child')]),
  ]);
  assert.equal(out.days[0].official, 380);
  assert.equal(out.chats.official, 1);
  assert.equal(out.days[0].samples.reduce((s: number, v: { total: number }) => s + v.total, 0), 380);
});
test('Usage legacy parent ancestry and CLM origin check match upstream, not current login', () => {
  const parent = file('parent', [entry('a')]);
  const out = projectDesktopUsage(native(195), [parent,
    file('child-copy', [entry('a')], { parentSession: parent.path }),
    file('subagent-clm', [{ id: 'clm', type: 'custom', customType: 'step-auto-clm-usage', timestamp: time,
      data: { sessionId: 'subagent-clm', requestedProvider: 'step', requestedModel: 'compact',
        usage: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 } } },
    { id: 'bad', type: 'custom', customType: 'step-auto-clm-usage', timestamp: time,
      data: { sessionId: 'wrong', usage } }]),
  ]);
  assert.equal(out.days[0].official, 195); assert.equal(out.chats.official, 1);
});
test('Usage rejects detail/native mismatch, incomplete cache and conflicting cache identity', () => {
  assert.throws(() => projectDesktopUsage(native(1), [file('main', [entry('a')])]));
  assert.throws(() => decodeCache('{"type":"usage-cache-meta","data":{"key":"a","version":1}}\n', 'a'));
  assert.throws(() => decodeCache('{"type":"usage-cache-meta","data":{"key":"b","version":1,"complete":true}}\n', 'a'));
  assert.deepEqual(decodeCache('{"type":"usage-cache-meta","data":{"key":"a","version":1,"complete":true}}\n', 'a'), []);
});
test('Usage without a compatible native detail cache preserves totals as unknown, never synthetic models', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usage-overview-no-cache-'));
  try {
    const out = await scanDesktopUsage({ scanUsageOverview: async () => ({
      ...native(190), limited: ['Missing usage', 'Reasoning coverage is limited'],
    }) }, root, join(root, 'missing-cache'));
    assert.equal(out.days[0].unknown, 190);
    assert.equal(out.days[0].official, 0);
    assert.deepEqual(out.days[0].samples, []);
    assert.deepEqual(out.limited, ['Missing usage', 'detail-unavailable']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Usage costs preserve recorded Plan/CNY/USD, deduplicate copies, and leave missing history unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usage-overview-estimates-'));
  try {
    const rules = { planProtected: true, apiLegacyCache: false };
    const rows = [
      { id: 'a'.repeat(64), account: '1'.repeat(64), mode: 'plan', region: 'cn', amount: 2, at: Date.now(), rules, priceVersion: 'historic' },
      { id: 'b'.repeat(64), account: '2'.repeat(64), mode: 'api', region: 'cn', amount: 3, at: Date.now(), rules, priceVersion: 'historic' },
      { id: 'c'.repeat(64), account: '3'.repeat(64), mode: 'api', region: 'global', amount: 4, at: Date.now(), rules, priceVersion: 'historic' },
      { id: 'd'.repeat(64), account: '3'.repeat(64), mode: 'api', region: 'cn', at: Date.now(), rules, priceVersion: 'historic' },
    ];
    await writeFile(join(root, `${'e'.repeat(64)}.json`), JSON.stringify(rows));
    await writeFile(join(root, `${'f'.repeat(64)}.json`), JSON.stringify(rows));
    const service = new UsageEstimates(root, () => { throw new Error('Do not infer historical login'); });
    const out = await service.overview(emptyUsageOverview());
    const day = out.days.at(-1)!;
    assert.equal(day.plan, 2); assert.equal(day.api, 3); assert.equal(day.usd, 4);
    assert.equal(out.days[0].plan, null);
    assert.deepEqual(out.estimates, { recorded: 4, unknown: 1, limited: false });
    assert.ok(!JSON.stringify(out).includes('historic'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
