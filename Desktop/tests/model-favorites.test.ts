import test from 'node:test';
import assert from 'node:assert/strict';
import { changeFavoriteModel, modelKey, modelListGroups, normalizeFavoriteModels, FAVORITE_MODEL_LIMIT } from '../src/model-favorites';
import type { Model } from '../src/contracts';

const step: Model = { provider: 'step', id: 'shared', name: 'Step model' };
const custom: Model = { provider: 'desktop-custom-fixture', providerName: 'Local provider', id: 'shared', name: 'Custom model' };
const other: Model = { provider: 'step', id: 'other', name: 'Other model' };

test('explicit favorites retain stable order, deduplicate and distinguish providers', () => {
  const favorites = changeFavoriteModel(changeFavoriteModel([], { ...step, favorite: true }), { ...custom, favorite: true });
  assert.deepEqual(favorites, [
    { provider: step.provider, id: step.id }, { provider: custom.provider, id: custom.id },
  ]);
  assert.deepEqual(changeFavoriteModel(favorites, { ...step, favorite: true }), favorites, 'repeated save cannot reorder favorites');
  assert.deepEqual(changeFavoriteModel(favorites, { ...step, favorite: false }), [favorites[1]]);
  assert.deepEqual(changeFavoriteModel(favorites, { ...other, favorite: false }), favorites);
  assert.notEqual(modelKey({ provider: 'a/b', id: 'c' }), modelKey({ provider: 'a', id: 'b/c' }));
});

test('normalization rejects corrupt preferences and strips extra model or credential fields', () => {
  assert.deepEqual(normalizeFavoriteModels(null), []);
  assert.deepEqual(normalizeFavoriteModels({ id: 'not an array' }), []);
  const favorites = [null, {}, { provider: '', id: 'a' }, { provider: 'a', id: ' '.repeat(3) },
    { provider: 'p'.repeat(201), id: 'a' }, { provider: 'a', id: 'i'.repeat(301) },
    { ...step, apiKey: 'not-to-be-persisted', endpoint: 'not-to-be-persisted' }, step];
  assert.deepEqual(normalizeFavoriteModels(favorites), [{ provider: 'step', id: 'shared' }]);
  const saved = JSON.parse(JSON.stringify(changeFavoriteModel(favorites, { ...custom, favorite: true })));
  assert.deepEqual(saved, [{ provider: step.provider, id: step.id }, { provider: custom.provider, id: custom.id }]);
});

test('favorite mutations validate identities and bound storage without evicting saved choices', () => {
  for (const change of [null, [], {}, { ...step }, { ...step, favorite: 'yes' }, { id: '', provider: 'step', favorite: true }])
    assert.throws(() => changeFavoriteModel([], change), /Invalid/);
  const full = Array.from({ length: FAVORITE_MODEL_LIMIT }, (_, id) => ({ provider: 'fixture', id: String(id) }));
  assert.deepEqual(changeFavoriteModel(full, { ...full[0], favorite: true }), full);
  assert.throws(() => changeFavoriteModel(full, { ...other, favorite: true }), /limit/);
  assert.equal(changeFavoriteModel(full, { ...full[0], favorite: false }).length, FAVORITE_MODEL_LIMIT - 1);
  assert.equal(normalizeFavoriteModels([...full, other]).length, FAVORITE_MODEL_LIMIT);
});

test('available catalog controls names and availability without deleting hidden favorites', () => {
  const missing = { provider: 'step', id: 'missing' };
  const favorites = [missing, step, custom];
  const before = structuredClone(favorites);
  const groups = modelListGroups([step, custom, other, step], favorites, '');
  assert.deepEqual(groups.favorites, [step, custom]);
  assert.deepEqual(groups.available, [other]);
  assert.deepEqual(favorites, before);
  assert.equal(groups.favorites[0], step, 'use current catalog metadata, not stale saved names');
  assert.equal(modelListGroups([step, custom, other, { ...missing, name: 'Restored' }], favorites, '').favorites[0].id, 'missing');
});

test('search returns a single deduplicated list and matches provider, name and ID terms', () => {
  const catalog = [step, custom, other, custom];
  assert.deepEqual(modelListGroups(catalog, [custom, step], 'SHARED'), { favorites: [], available: [custom, step] });
  assert.deepEqual(modelListGroups(catalog, [custom], 'local SHARED'), { favorites: [], available: [custom] });
  assert.deepEqual(modelListGroups(catalog, [custom], 'step other'), { favorites: [], available: [other] });
  assert.deepEqual(modelListGroups(catalog, [custom], 'no matches'), { favorites: [], available: [] });
  assert.deepEqual(modelListGroups([], [step], ''), { favorites: [], available: [] });
  assert.deepEqual(modelListGroups([step, custom], undefined, '  '), { favorites: [], available: [step, custom] });
});
