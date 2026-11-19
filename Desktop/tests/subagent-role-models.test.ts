import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SubagentRoleStore } from '../electron/subagent-role-store';
import { readSubagentModelEvidence } from '../src/subagent-role-models';

const catalog = [
  { provider: 'first', id: 'same', name: 'Same', thinkingLevels: ['high'] },
  { provider: 'second', id: 'same', name: 'Same', thinkingLevels: ['medium'] },
];
const explore = { provider: 'first', id: 'same', effort: 'high' };
const review = { provider: 'second', id: 'same', effort: 'medium' };

test('role settings serialize concurrent edits and validate exact model identity and effort', async t => {
  const root = await mkdtemp(join(tmpdir(), 'subagent-role-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'desktop-subagent-models.json');
  const store = new SubagentRoleStore(file);
  assert.deepEqual(await store.read(), {});
  await Promise.all([store.save('explore', explore, catalog), store.save('review', review, catalog)]);
  assert.deepEqual(await new SubagentRoleStore(file).read(), { explore, review });
  await assert.rejects(store.save('review', { ...review, provider: 'first' }, catalog), /Unavailable/);
  await assert.rejects(store.save('review', { ...review, id: 'sam' }, catalog), /Unavailable/);
  await assert.rejects(store.save('__proto__', review, catalog), /Unknown/);
  await store.save('review', null, []);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, roles: { explore } });
});

test('execution provenance requires an explicit runtime source and bounded model identity', () => {
  assert.equal(readSubagentModelEvidence(review), undefined);
  assert.equal(readSubagentModelEvidence({ ...review, source: 'planned' }), undefined);
  assert.deepEqual(readSubagentModelEvidence({ ...review, source: 'role', secret: 'ignored' }),
    { ...review, source: 'role' });
});
