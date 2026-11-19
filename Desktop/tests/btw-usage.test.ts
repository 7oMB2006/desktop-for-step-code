import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BtwUsageLedger } from '../electron/btw-usage';
import { btwUsageTotals, emptyUsageOverview } from '../src/usage-overview';

test('BTW records survive restart without affecting main sessions or cost estimates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-btw-usage-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const at = Date.now(), file = join(root, `${new Date(at).toISOString().slice(0, 10)}.jsonl`);
  const base = { runtimeId: 'runtime', sessionId: 'private-session', scopeId: 'scope', requestId: 'r1', at };
  const ledger = new BtwUsageLedger(root);
  const usage = { input: 200, output: 300, cacheRead: 250, cacheWrite: 50, totalTokens: 900, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } };
  const official = { ...base, model: { id: 'step-model', provider: 'step', name: 'private-display-name' }, usage };
  ledger.record(official);
  ledger.record(official);
  ledger.record({ ...base, requestId: 'r2', model: { id: 'model-x', provider: 'custom-provider', name: 'Custom' }, usage });
  ledger.record({ ...base, requestId: 'r3', usage: { ...usage, output: 100 } });
  ledger.record({ ...base, requestId: 'r4', model: official.model });
  ledger.record({ ...base, requestId: 'r5' });
  await ledger.flush();
  const bytes = await readFile(file, 'utf8');
  for (const value of ['private-session', 'private-display-name', 'totalTokens', '"cost"'])
    assert.ok(!bytes.includes(value));

  const overview = emptyUsageOverview(), today = overview.days.at(-1)!;
  Object.assign(today, { official: 10_000, chats: 1, officialChats: 1, plan: 5 });
  overview.chats = { all: 1, official: 1, custom: 0 };
  const again = new BtwUsageLedger(root);
  const result = await again.overview(overview);
  const day = result.days.at(-1)!;
  assert.deepEqual([day.official, day.custom, day.unknown], [10_800, 800, 600]);
  assert.equal(day.plan, 5);
  assert.equal(day.chats, 1);
  assert.deepEqual(result.chats, overview.chats);
  assert.equal(today.official, 10_000);
  assert.deepEqual(btwUsageTotals(result.days, 'all'), { tokens: 2200, unreported: 2 });
  assert.deepEqual(btwUsageTotals([day], 'official'), { tokens: 800, unreported: 1 });
  assert.deepEqual(btwUsageTotals([day], 'custom'), { tokens: 800, unreported: 0 });
  assert.deepEqual(btwUsageTotals(result.days.slice(0, -1), 'all'), { tokens: 0, unreported: 0 });
  assert.deepEqual(day.samples.find(sample => sample.model === 'step-model'), {
    model: 'step-model', source: 'official', hour: new Date(at).getHours(), input: 200, output: 300, cached: 250, written: 50, total: 800,
  });
  assert.equal(result.btwLimited, false);
  await appendFile(file, '{partial write\n');
  assert.equal((await again.overview(overview)).btwLimited, true);
  assert.deepEqual(btwUsageTotals((await again.overview(overview)).days, 'all'), { tokens: 2200, unreported: 2 });
});
