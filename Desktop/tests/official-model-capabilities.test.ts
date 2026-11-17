import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichDiscoveredModel, officialModelCapabilities, officialResponsesRequired } from '../src/official-model-capabilities';
import { importProviderModel } from '../src/provider-model-import';
import { discoverProviderModels, saveProviderAuth, validateProvider, projectProviders } from '../electron/custom-providers';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseUrl = 'https://api.openai.com/v1';
const api = 'openai-responses' as const;
const provider = { id: '', name: 'OpenAI', baseUrl, api, enabled: true, keyless: false, models: [] };
test('official metadata matches exact documented IDs at the official endpoint only', () => {
  const terra = officialModelCapabilities(baseUrl, api, 'gpt-6.1-terra')!;
  assert.equal(terra.contextWindow, 1050000); assert.equal(terra.maxTokens, 128000); assert.equal(terra.vision, true);
  assert.deepEqual(terra.thinkingLevels, ['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(terra.thinkingMapping?.off, 'none'); assert.equal(terra.thinkingDefaultLevel, 'medium');
  assert.deepEqual(terra.officialDocumentation, { url: 'https://developers.openai.com/api/docs/models/gpt-6.1-terra', verifiedAt: '2026-11-16' });
  assert.equal(officialModelCapabilities(baseUrl, api, 'gpt-6.1-sol')?.thinkingDefaultLevel, 'medium');
  for (const id of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra']) assert.ok(officialModelCapabilities(baseUrl, api, id));
  for (const url of ['https://relay.invalid/v1', 'http://api.openai.com/v1', 'https://api.openai.com/proxy/v1', 'https://key@api.openai.com/v1', `${baseUrl}?key=x`]) {
    assert.equal(officialModelCapabilities(url, api, 'gpt-6.1-terra'), undefined);
  }
  for (const id of ['gpt-6.1-terra-fake', 'gpt-6.1-terra-2099-01-01', 'gpt-anything', 'constructor', 'toString', '__proto__']) {
    assert.equal(officialModelCapabilities(baseUrl, api, id), undefined);
    assert.equal(officialResponsesRequired(baseUrl, 'openai-completions', id), false);
  }
  assert.equal(officialResponsesRequired(baseUrl, 'openai-completions', 'gpt-6.1-terra'), true);
  assert.deepEqual(officialModelCapabilities(baseUrl, 'openai-completions', 'gpt-6-luna')?.thinkingLevels, ['off']);
  assert.equal(officialModelCapabilities(baseUrl, 'anthropic-messages', 'gpt-6.1-terra'), undefined);
});
test('discovery fills missing fields from official docs while keeping explicit upstream declarations', async () => {
  const discovered = await discoverProviderModels({}, provider, 'fixture-key', async () => Response.json({ data: [{ id: 'gpt-6.1-terra' }] }));
  assert.equal(discovered[0].capabilitySources?.thinking, 'official');
  const upstream = enrichDiscoveredModel(baseUrl, api, { id: 'gpt-6.1-terra', name: 'Upstream', contextWindow: 900000, thinkingLevels: ['low', 'high'] });
  assert.equal(upstream.contextWindow, 900000); assert.equal(upstream.capabilitySources?.contextWindow, 'upstream');
  assert.equal(upstream.capabilitySources?.thinking, 'upstream'); assert.equal(upstream.thinkingMapping, undefined);
  assert.equal(upstream.maxTokens, 128000);
  const noReasoning = enrichDiscoveredModel(baseUrl, api, { id: 'gpt-6.1-terra', name: 'Upstream', reasoning: false });
  assert.deepEqual(noReasoning.thinkingLevels, ['off']);
  assert.equal(noReasoning.thinkingDefaultLevel, 'off');
  assert.equal(noReasoning.capabilitySources?.thinking, 'upstream');
});
test('unknown capabilities stay visibly unconfirmed and refresh preserves manual limits and thinking', () => {
  const unknown = importProviderModel({ id: 'unknown', name: 'Unknown' });
  assert.equal(unknown.capabilitySources?.contextWindow, 'default');
  assert.equal(unknown.capabilitySources?.maxTokens, 'default');
  assert.equal(unknown.thinkingLevels, undefined);
  const terra = officialModelCapabilities(baseUrl, api, 'gpt-6.1-terra')!;
  const configured = importProviderModel(terra);
  assert.equal(configured.thinkingControl?.source, 'official');
  const manual = { ...configured, contextWindow: 64000, capabilitySources: { ...configured.capabilitySources, contextWindow: 'manual' as const },
    reasoning: true, thinkingLevels: ['high'], thinkingControl: { source: 'manual' as const, levels: ['high'], mapping: { high: 'high' } } };
  const refreshed = importProviderModel(terra, manual);
  assert.equal(refreshed.contextWindow, 64000); assert.equal(refreshed.maxTokens, 64000);
  assert.equal(refreshed.capabilitySources?.maxTokens, 'manual');
  assert.deepEqual(refreshed.thinkingLevels, ['high']); assert.equal(refreshed.thinkingControl?.source, 'manual');
  assert.equal(refreshed.capabilitySources?.thinking, 'manual');
});
test('official controls persist, project none correctly, reject relays and preserve legacy readable configurations', async () => {
  const model = importProviderModel(officialModelCapabilities(baseUrl, api, 'gpt-6.1-terra')!);
  const auth = saveProviderAuth({}, { ...provider, models: [model] }, 'fixture-key');
  const root = await mkdtemp(join(tmpdir(), 'desktop-official-capabilities-'));
  try {
    await projectProviders(root, auth);
    const models = JSON.parse(await readFile(join(root, 'models.json'), 'utf8'));
    const projected = Object.values(models.providers)[0] as any;
    assert.equal(projected.models[0].thinkingLevelMap.off, 'none');
    assert.equal(projected.models[0].thinkingLevelMap.max, 'max');
    assert.equal(projected.models[0].contextWindow, 1050000);
    assert.throws(() => validateProvider({ ...provider, baseUrl: 'https://relay.invalid/v1', models: [model] }));
    assert.throws(() => saveProviderAuth({}, { ...provider, api: 'openai-completions', models: [importProviderModel({ id: model.id, name: model.name })] }, 'fixture-key'));
    assert.doesNotThrow(() => validateProvider({ ...provider, api: 'openai-completions', models: [importProviderModel({ id: model.id, name: model.name })] }),
      'reading an old saved config must not prevent application startup');
  } finally { await rm(root, { recursive: true, force: true }); }
});
