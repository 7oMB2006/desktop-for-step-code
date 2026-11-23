import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelCatalog } from '../electron/model-catalog';
import { discoverProviderModels, saveProviderAuth, providerList, validateProvider, projectProviders } from '../electron/custom-providers';
import { modelListing, parseModelListing, readModelJson } from '../electron/provider-discovery';
import { resolveCatalogProvider } from '../src/provider-catalog';
import { importProviderModel } from '../src/provider-model-import';
import type { CustomProvider } from '../src/contracts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const provider = (patch: Partial<CustomProvider> = {}): CustomProvider => ({
  id: '', name: 'Fixture', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1',
  enabled: true, keyless: false, models: [], ...patch,
});
const listing = [{ id: 'fixture-model', name: 'Fixture' }];
const catalog = {
  openai: { models: { 'fixture-model': {
    limit: { context: 256000, output: 32000 }, modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    reasoning: true, reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high'] }],
  } } },
};
test('catalog identity requires an exact official endpoint/protocol or explicit user binding', () => {
  assert.equal(resolveCatalogProvider('https://api.openai.com/v1/', 'openai-responses'), 'openai');
  assert.equal(resolveCatalogProvider('https://api.anthropic.com/v1', 'anthropic-messages'), 'anthropic');
  for (const endpoint of ['https://api.openai.com.evil/v1', 'http://api.openai.com/v1', 'https://api.openai.com/proxy/v1',
    'https://key@api.openai.com/v1', 'https://api.openai.com/v1?key=x', 'https://relay.test/v1']) {
    assert.equal(resolveCatalogProvider(endpoint, 'openai-responses'), undefined);
  }
  assert.equal(resolveCatalogProvider('https://api.openai.com/v1', 'anthropic-messages'), undefined);
  assert.equal(resolveCatalogProvider('https://relay.test/v1', 'openai-responses', 'openai'), 'openai');
  assert.equal(resolveCatalogProvider('https://api.openai.com/v1', 'openai-responses', 'none'), undefined);
});
test('listing adapters normalize native paths and standard arrays/maps without capability inference', () => {
  for (const base of ['https://api.test', 'https://api.test/v1/', 'https://api.test/gateway/v1/']) {
    const { url, headers } = modelListing(new URL(base), 'anthropic-messages', 'synthetic');
    assert.equal(url.pathname, base.includes('gateway') ? '/gateway/v1/models' : '/v1/models');
    assert.equal(headers['x-api-key'], 'synthetic'); assert.equal(headers.Authorization, undefined);
  }
  assert.equal(modelListing(new URL('https://api.test/gateway/v1/'), 'openai-responses').url.pathname, '/gateway/v1/models');
  const result = parseModelListing({ models: {
    alias: { id: 'canonical', name: 'Alias', contextWindow: 128000, maxTokens: 8000, modalities: { input: ['text', 'image'] } },
    metadata: 4, description: 'Directory metadata, not a model', invalid: null,
  } });
  assert.equal(result.length, 1); assert.equal(result[0].id, 'alias'); assert.equal(result[0].vision, true);
  assert.equal(result[0].maxTokens, 8000);
  assert.deepEqual(parseModelListing(['one', { id: 'two' }, { id: 'two', name: 'Duplicate' }, null, 4]), [
    { id: 'one', name: 'one' }, { id: 'two', name: 'two' },
  ]);
  assert.deepEqual(parseModelListing({ data: [], models: { ignored: {} } }), []);
  assert.throws(() => parseModelListing({ message: 'private' }));
});
test('catalog uses only credential-free fixed public URL and fills missing fields exactly', async () => {
  let calls = 0;
  const directory = new ModelCatalog(async (url, init) => {
    calls++;
    assert.equal(url, 'https://models.dev/api.json');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('authorization'), null);
    assert.equal(new Headers(init.headers).get('x-api-key'), null);
    assert.ok(init.signal);
    return Response.json(catalog);
  });
  const [result] = await directory.enrich(provider(), listing);
  assert.equal(result.contextWindow, 256000); assert.equal(result.capabilitySources?.contextWindow, 'catalog');
  assert.equal(result.vision, true); assert.deepEqual(result.declaredInput, ['text', 'image', 'file']);
  assert.deepEqual(result.thinkingLevels, ['off', 'low', 'high']); assert.equal(result.thinkingMapping?.off, 'none');
  assert.equal(result.catalogMetadata?.stale, false);
  const [explicit] = await directory.enrich(provider(), [{ ...listing[0], contextWindow: 16000, reasoning: false, vision: false }]);
  assert.equal(explicit.contextWindow, 16000); assert.equal(explicit.vision, false); assert.equal(explicit.thinkingLevels, undefined);
  const variants = await directory.enrich(provider(), [{ id: 'fixture-model-latest', name: '' }, { id: 'openai/fixture-model', name: '' }]);
  assert.ok(variants.every(m => m.catalogMatch === 'none' && m.contextWindow === undefined));
  assert.equal(calls, 1);
  const relay = provider({ baseUrl: 'https://relay.test/v1' });
  assert.deepEqual(await directory.enrich(relay, listing), listing);
  assert.equal((await directory.enrich({ ...relay, catalogProvider: 'openai' }, listing))[0].catalogMatch, 'exact');
  assert.deepEqual(await directory.enrich(provider({ catalogProvider: 'none' }), listing), listing);
});
test('catalog coalesces concurrent reads, bounds cache age and degrades without losing upstream results', async () => {
  let now = 1_000_000, calls = 0, fail = false;
  const directory = new ModelCatalog(async () => {
    calls++; if (fail) throw new Error('private-network-error');
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json(catalog);
  }, () => now);
  await Promise.all([directory.enrich(provider(), listing), directory.enrich(provider(), listing)]);
  assert.equal(calls, 1);
  now += 11 * 60 * 1000; fail = true;
  const [stale] = await directory.enrich(provider(), listing);
  assert.equal(stale.catalogMetadata?.stale, true);
  now += 24 * 60 * 60 * 1000;
  assert.deepEqual(await directory.enrich(provider(), listing), [{ ...listing[0], catalogMatch: 'unavailable' }]);
  const broken = new ModelCatalog(async () => Response.json({ error: 'private' }));
  assert.deepEqual(await broken.enrich(provider(), listing), [{ ...listing[0], catalogMatch: 'unavailable' }]);
});
test('bounded response reader cancels oversized streams and refused catalog responses', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readModelJson(response, 10)); assert.equal(cancelled, true);
  cancelled = false;
  const directory = new ModelCatalog(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 }));
  assert.equal((await directory.enrich(provider(), listing))[0].catalogMatch, 'unavailable');
  assert.equal(cancelled, true);
});
test('catalog booleans, budgets and unfamiliar enums do not invent reasoning controls', async () => {
  for (const reasoning_options of [undefined, [{ type: 'budget', values: [1000, 2000] }], [{ type: 'effort', values: ['low', 'invented'] }]]) {
    const directory = new ModelCatalog(async () => Response.json({ openai: { models: { 'fixture-model': { reasoning: true, reasoning_options } } } }));
    assert.equal((await directory.enrich(provider(), listing))[0].thinkingLevels, undefined);
  }
  const directory = new ModelCatalog(async () => Response.json(catalog));
  assert.equal((await directory.enrich(provider({ api: 'anthropic-messages', catalogProvider: 'openai' }), listing))[0].thinkingLevels, undefined);
  const conflict = new ModelCatalog(async () => Response.json({ openai: { models: {
    'fixture-model': { reasoning: false, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] },
  } } }));
  assert.equal((await conflict.enrich(provider(), listing))[0].thinkingLevels, undefined);
});
test('saved credentials stay bound to their endpoint and discovery never falls back to catalog-only models', async () => {
  const p = provider({ models: [importProviderModel(listing[0])] });
  const auth = saveProviderAuth({}, p, 'synthetic-secret');
  const saved = providerList(auth)[0];
  let calls = 0;
  const request = async () => { calls++; return Response.json({ data: listing }); };
  await assert.rejects(discoverProviderModels(auth, { ...saved, baseUrl: 'https://other.test/v1' }, undefined, request));
  assert.equal(calls, 0);
  await discoverProviderModels(auth, { ...saved, baseUrl: 'https://other.test/v1' }, 'new-synthetic', request);
  assert.equal(calls, 1);
  const directory = new ModelCatalog(async () => Response.json(catalog));
  assert.deepEqual(await discoverProviderModels({}, provider(), 'fixture-key', async () => Response.json({ data: [] }), directory), []);
  await assert.rejects(discoverProviderModels({}, provider(), 'fixture-key', async () => new Response('', { status: 401 }), directory), /Model discovery HTTP 401/);
});
test('catalog controls survive import/save/runtime projection and manual refresh remains authoritative', async () => {
  const directory = new ModelCatalog(async () => Response.json(catalog));
  const [discovered] = await directory.enrich(provider(), listing);
  const imported = importProviderModel(discovered);
  const saved = validateProvider(provider({ models: [imported] }));
  assert.equal(saved.models[0].thinkingControl?.source, 'catalog');
  const root = await mkdtemp(join(tmpdir(), 'desktop-catalog-unit-'));
  try {
    await projectProviders(root, saveProviderAuth({}, saved, 'fixture-key'));
    const config = JSON.parse(await readFile(join(root, 'models.json'), 'utf8'));
    const projected = Object.values(config.providers)[0] as any;
    assert.equal(projected.models[0].thinkingLevelMap.off, 'none');
  } finally { await rm(root, { recursive: true, force: true }); }
  const manual = { ...imported, vision: false, reasoning: true, thinkingLevels: ['high'],
    thinkingControl: { source: 'manual' as const, levels: ['high'], mapping: { high: 'ultra' } },
    capabilitySources: { ...imported.capabilitySources, vision: 'manual' as const } };
  const refreshed = importProviderModel(discovered, manual);
  assert.equal(refreshed.vision, false); assert.equal(refreshed.thinkingControl?.mapping?.high, 'ultra');
  const withdrawn = importProviderModel(listing[0], imported);
  assert.equal(withdrawn.capabilitySources?.contextWindow, 'default');
  assert.equal(withdrawn.catalogMetadata, undefined); assert.equal(withdrawn.thinkingLevels, undefined);
  assert.doesNotThrow(() => validateProvider(provider({ models: [withdrawn] })));
  assert.throws(() => validateProvider(provider({ baseUrl: 'https://relay.test/v1', models: [imported] })));
  assert.doesNotThrow(() => validateProvider(provider({ baseUrl: 'https://relay.test/v1', catalogProvider: 'openai', models: [imported] })));
});
