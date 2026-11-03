import test from 'node:test';
import assert from 'node:assert/strict';
import { modelKey, modelListGroups, normalizeRecentModels, rememberRecentModel, RECENT_MODEL_LIMIT } from '../src/recent-models';
import type { Model } from '../src/contracts';

const step: Model = { provider: 'step', id: 'shared', name: 'Step model' };
const custom: Model = { provider: 'desktop-custom-fixture', providerName: 'Local provider', id: 'shared', name: 'Custom model' };
const other: Model = { provider: 'step', id: 'other', name: 'Other model' };

test('recent models retain bounded identities only, promote duplicates and distinguish providers', () => {
  const history = rememberRecentModel(rememberRecentModel([], step), custom);
  assert.deepEqual(history, [
    { provider: custom.provider, id: custom.id }, { provider: step.provider, id: step.id },
  ]);
  assert.deepEqual(rememberRecentModel(history, step), [history[1], history[0]]);
  let bounded = history;
  for (let i = 0; i < 20; i++) bounded = rememberRecentModel(bounded, { provider: 'fixture', id: String(i) });
  assert.equal(bounded.length, RECENT_MODEL_LIMIT);
  assert.deepEqual(bounded.map(model => model.id), ['19', '18', '17', '16', '15']);
  assert.notEqual(modelKey({ provider: 'a/b', id: 'c' }), modelKey({ provider: 'a', id: 'b/c' }));
});

test('normalization rejects corrupt preferences and strips extra model or credential fields', () => {
  assert.deepEqual(normalizeRecentModels(null), []);
  assert.deepEqual(normalizeRecentModels({ id: 'not an array' }), []);
  const history = [null, {}, { provider: '', id: 'a' }, { provider: 'a', id: ' '.repeat(3) },
    { provider: 'p'.repeat(201), id: 'a' }, { provider: 'a', id: 'i'.repeat(301) },
    { ...step, apiKey: 'not-to-be-persisted', endpoint: 'not-to-be-persisted' }, step];
  assert.deepEqual(normalizeRecentModels(history), [{ provider: 'step', id: 'shared' }]);
  const saved = JSON.parse(JSON.stringify(rememberRecentModel(history, custom)));
  assert.deepEqual(saved, [{ provider: custom.provider, id: custom.id }, { provider: step.provider, id: step.id }]);
});

test('available catalog controls names and availability without deleting hidden history', () => {
  const missing = { provider: 'step', id: 'missing' };
  const history = [missing, step, custom];
  const before = structuredClone(history);
  const groups = modelListGroups([step, custom, other, step], history, '');
  assert.deepEqual(groups.recent, [step, custom]);
  assert.deepEqual(groups.available, [other]);
  assert.deepEqual(history, before);
  assert.equal(groups.recent[0], step, 'use current catalog metadata, not stale saved names');
  assert.equal(modelListGroups([step, custom, other, { ...missing, name: 'Restored' }], history, '').recent[0].id, 'missing');
});

test('search returns a single deduplicated list and matches provider, name and ID terms', () => {
  const catalog = [step, custom, other, custom];
  assert.deepEqual(modelListGroups(catalog, [custom, step], 'SHARED'), { recent: [], available: [step, custom] });
  assert.deepEqual(modelListGroups(catalog, [custom], 'local SHARED'), { recent: [], available: [custom] });
  assert.deepEqual(modelListGroups(catalog, [custom], 'step other'), { recent: [], available: [other] });
  assert.deepEqual(modelListGroups(catalog, [custom], 'no matches'), { recent: [], available: [] });
  assert.deepEqual(modelListGroups([], [step], ''), { recent: [], available: [] });
  assert.deepEqual(modelListGroups([step, custom], undefined, '  '), { recent: [], available: [step, custom] });
});
