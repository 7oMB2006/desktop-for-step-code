import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { validateProvider, saveProviderAuth, providerInfos, providerList, runtimeAuth, mergeRuntimeAuth, deleteProviderAuth, projectProviders, discoverProviderModels, discoverModelMetadata, keylessEndpoints } from '../electron/custom-providers';
import type { CustomProvider } from '../src/contracts';

const fixture = (): CustomProvider => ({ id: '', name: 'Fixture provider', baseUrl: 'https://example.test/v1', api: 'openai-completions',
  enabled: true, keyless: false, models: [{ id: 'fixture-model', name: '', reasoning: false, vision: true, contextWindow: 128000, maxTokens: 16384 }] });
test('discovery only accepts explicit bounded metadata, never infers capabilities from model names', () => {
  assert.deepEqual(discoverModelMetadata({ id: 'vision-reasoning-gpt', owned_by: 'vendor' }), {});
  assert.deepEqual(discoverModelMetadata({ input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'], supported_reasoning_efforts: ['low', 'high'], context_length: 200000, max_output_tokens: 30000 }), {
    declaredInput: ['text', 'image', 'audio'], declaredOutput: ['text'], vision: true, reasoning: true, thinkingLevels: ['low', 'high'], contextWindow: 200000, maxTokens: 30000,
  });
  assert.deepEqual(discoverModelMetadata({ input_modalities: ['invented'], context_window: -10, max_output_tokens: '2000', thinking_levels: ['invented'], reasoning: 'yes' }), {});
  assert.deepEqual(discoverModelMetadata({ context_window: 1000, max_output_tokens: 2000 }), { contextWindow: 1000 });
  assert.throws(() => validateProvider({ ...fixture(), models: [{ ...fixture().models[0], thinkingLevels: ['high'] }] }));
  assert.throws(() => validateProvider({ ...fixture(), models: [{ ...fixture().models[0], declaredInput: ['invented'] }] }));
});
test('model discovery uses draft or saved literal keys, validates responses and rejects redirects', async () => {
  let mode = 'list';
  let headers: Record<string, string | string[] | undefined> = {};
  const server = createServer((req, res) => {
    headers = req.headers;
    assert.equal(req.url, '/v1/models');
    if (mode === 'redirect') { res.writeHead(302, { location: '/other' }); res.end(); return; }
    if (mode === 'error') { res.writeHead(401); res.end('secret-body'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(mode === 'invalid' ? { error: 'secret-body' } : { data: [{ id: 'one', display_name: 'First' }, { id: 'one', display_name: 'First' }, { id: 'two' }, { id: '\ninvalid' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const p = { ...fixture(), baseUrl: `http://127.0.0.1:${address.port}/v1`, models: [] };
  try {
    assert.deepEqual(await discoverProviderModels({}, p, '!literal$VALUE'), [{ id: 'one', name: 'First' }, { id: 'two', name: 'two' }]);
    assert.equal(headers.authorization, 'Bearer !literal$VALUE');
    const auth = saveProviderAuth({}, { ...p, models: fixture().models }, 'stored-key');
    await discoverProviderModels(auth, { ...p, id: providerList(auth)[0].id, api: 'anthropic-messages' });
    assert.equal(headers['x-api-key'], 'stored-key');
    assert.equal(headers['anthropic-version'], '2023-06-01');
    await discoverProviderModels({}, { ...p, keyless: true });
    assert.equal(headers.authorization, undefined);
    for (const value of ['redirect', 'invalid', 'error']) { mode = value; await assert.rejects(discoverProviderModels({}, p, 'key'), error => !String(error).includes('secret-body')); }
    await assert.rejects(discoverProviderModels({}, p));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('custom providers validate IDs, endpoints, protocols and capabilities', () => {
  const raw = fixture();
  const p = validateProvider(raw);
  assert.match(p.id, /^desktop-custom-/);
  assert.equal(p.models[0].name, 'fixture-model');
  for (const baseUrl of ['file:///C:/x', 'https://key@example.test', 'https://example.test?key=x', 'https://example.test/#key']) assert.throws(() => validateProvider({ ...raw, baseUrl }));
  assert.throws(() => validateProvider({ ...raw, id: 'step' }));
  assert.throws(() => validateProvider({ ...raw, models: [] }));
  assert.throws(() => validateProvider({ ...raw, models: [raw.models[0], raw.models[0]] }));
  assert.throws(() => validateProvider({ ...raw, api: 'arbitrary' }));
  assert.throws(() => validateProvider({ ...raw, models: [{ ...raw.models[0], maxTokens: 200000 }] }));
  assert.throws(() => validateProvider({ ...raw, models: [{ ...raw.models[0], contextWindow: NaN }] }));
});
test('keys stay private; account login/logout preserve custom credentials and metadata', () => {
  assert.throws(() => saveProviderAuth({}, fixture()));
  const auth = saveProviderAuth({ step: { type: 'api_key', key: 'account-fixture' } }, fixture(), 'provider-fixture');
  const p = providerList(auth)[0];
  assert.equal(providerInfos(auth)[0].hasKey, true);
  assert.equal(JSON.stringify(providerInfos(auth)).includes('provider-fixture'), false);
  assert.equal(runtimeAuth(auth).__desktopCustomProviders, undefined);
  const edited = saveProviderAuth(auth, { ...p, name: 'Renamed' });
  assert.deepEqual(edited[p.id], auth[p.id]);
  const disabled = saveProviderAuth(edited, { ...p, enabled: false });
  assert.equal(runtimeAuth(disabled)[p.id], undefined);
  const logout = mergeRuntimeAuth(disabled, {});
  assert.equal(logout.step, undefined);
  assert.deepEqual(logout[p.id], auth[p.id]);
  assert.equal(providerList(logout).length, 1);
  const deleted = deleteProviderAuth(auth, p.id);
  assert.equal(deleted[p.id], undefined);
  assert.deepEqual(deleted.step, auth.step);
  assert.throws(() => deleteProviderAuth(auth, 'step'));
});
test('keyless uses an endpoint-scoped internal sentinel without overwriting a saved key', () => {
  const auth = saveProviderAuth({}, { ...fixture(), keyless: true });
  const p = providerList(auth)[0];
  assert.deepEqual(runtimeAuth(auth)[p.id], { type: 'api_key', key: `desktop-no-auth-${p.id}` });
  assert.deepEqual(keylessEndpoints(auth), [{ baseUrl: p.baseUrl, token: `desktop-no-auth-${p.id}` }]);
  assert.deepEqual(keylessEndpoints(saveProviderAuth(auth, { ...p, enabled: false })), []);
  assert.equal(providerInfos(auth)[0].hasKey, false);
  assert.equal(mergeRuntimeAuth(auth, runtimeAuth(auth))[p.id], undefined);
  const saved = saveProviderAuth(auth, { ...p, keyless: false }, 'retained-key');
  const keyless = saveProviderAuth(saved, { ...p, keyless: true });
  assert.deepEqual(keyless[p.id], saved[p.id]);
  assert.deepEqual(mergeRuntimeAuth(keyless, runtimeAuth(keyless))[p.id], saved[p.id]);
  assert.deepEqual(keylessEndpoints(saved), []);
});
test('literal API keys cannot become upstream shell commands or environment references', () => {
  const auth = saveProviderAuth({}, fixture(), '!literal$VALUE');
  const p = providerList(auth)[0];
  assert.deepEqual(auth[p.id], { type: 'api_key', key: '!literal$VALUE' });
  assert.deepEqual(runtimeAuth(auth)[p.id], { type: 'api_key', key: '$!literal$$VALUE' });
  assert.deepEqual(mergeRuntimeAuth(auth, runtimeAuth(auth))[p.id], auth[p.id]);
});
test('runtime projection preserves unrelated models and removes disabled/deleted providers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-provider-test-'));
  try {
    const path = join(root, 'models.json');
    await writeFile(path, JSON.stringify({ customField: true, providers: { external: { baseUrl: 'https://other.test' } } }));
    const auth = saveProviderAuth({}, fixture(), 'never-write-this-key');
    const p = providerList(auth)[0];
    await projectProviders(root, auth);
    const text = await readFile(path, 'utf8');
    assert.equal(text.includes('never-write-this-key'), false);
    const config = JSON.parse(text);
    assert.equal(config.customField, true);
    assert.equal(config.providers.external.baseUrl, 'https://other.test');
    assert.deepEqual(config.providers[p.id].models[0].input, ['text', 'image']);
    await projectProviders(root, saveProviderAuth(auth, { ...p, models: [{ ...p.models[0], reasoning: true, thinkingLevels: ['low', 'high'] }] }));
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).providers[p.id].models[0].thinkingLevelMap, { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null });
    await projectProviders(root, saveProviderAuth(auth, { ...p, enabled: false }));
    assert.equal(JSON.parse(await readFile(path, 'utf8')).providers[p.id], undefined);
    await projectProviders(root, deleteProviderAuth(auth, p.id));
    assert.equal(JSON.parse(await readFile(path, 'utf8')).providers.external.baseUrl, 'https://other.test');
    await writeFile(path, '{broken');
    await assert.rejects(projectProviders(root, auth), /Cannot read/);
    assert.equal(await readFile(path, 'utf8'), '{broken');
  } finally { await rm(root, { recursive: true, force: true }); }
});
