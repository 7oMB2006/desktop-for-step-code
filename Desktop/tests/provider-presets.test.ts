import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { providerPresetDraft, providerPresetFor, providerPresets } from '../src/provider-presets';
import { discoverProviderModels, projectProviders, providerInfos, providerModelNames, runtimeAuth, saveProviderAuth } from '../electron/custom-providers';
import { testProvider } from '../electron/provider-diagnostic';
import { importProviderModel } from '../src/provider-model-import';

test('preset choices create independent unsaved drafts with no credential or active model', () => {
  assert.deepEqual([...new Set(providerPresets.map(preset => preset.brand))],
    ['deepseek', 'kimi', 'zhipu', 'bailian', 'minimax', 'openai', 'anthropic', 'gemini', 'siliconflow', 'ark']);
  assert.equal(new Set(providerPresets.map(preset => preset.id)).size, providerPresets.length);
  for (const preset of providerPresets) {
    const first = providerPresetDraft(preset, 'zh');
    assert.equal(first.hasKey, false);
    assert.equal(first.id, '');
    assert.equal(first.keyless, false);
    assert.deepEqual(first.models, []);
    assert.equal(providerPresetFor(first), preset);
    assert.equal(providerPresetFor({ ...first, baseUrl: `${first.baseUrl}.example.test` }), undefined);
    assert.equal(providerPresetFor({ ...first, baseUrl: `${first.baseUrl}/proxy` }), undefined);
    assert.notEqual(first.models, providerPresetDraft(preset, 'en').models);
  }
});

test('model branding follows the configured connection, not a shared model or catalog identity', () => {
  const model = importProviderModel({ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' });
  const preset = (id: string) => ({ ...providerPresetDraft(providerPresets.find(p => p.id === id)!, 'en'), models: [model] });
  const direct = preset('deepseek-api');
  const relay = preset('siliconflow-api-cn');
  const alias = { ...direct, name: 'Direct', baseUrl: `${direct.baseUrl}/v1/`, presetId: undefined };
  const other = { ...direct, baseUrl: 'https://gateway.example/v1', presetId: undefined, catalogProvider: 'deepseek' };
  let auth = {};
  for (const provider of [direct, relay, alias, other]) auth = saveProviderAuth(auth, provider, 'fixture-key');
  const routes = providerInfos(auth).map(p => ({ id: model.id, name: model.name, provider: p.id }));
  const decorated = providerModelNames(routes, auth);
  assert.deepEqual(decorated.map(m => m.providerBrand), ['deepseek', 'siliconflow', 'deepseek', undefined]);
  assert.deepEqual(decorated.map(m => m.providerBilling), ['usage', 'usage', undefined, undefined]);
  assert.deepEqual(decorated.map(m => m.provider), routes.map(m => m.provider));
  assert.ok(decorated.every(m => !('baseUrl' in m) && !('key' in m)));
});

const chatReply = { choices: [{ message: { role: 'assistant', content: 'OK' } }] };
const officialEndpoints = [
  ['zhipu', 'openai-completions', 'https://open.bigmodel.cn/api/paas/v4', null, '/api/paas/v4/chat/completions', chatReply],
  ['bailian', 'openai-completions', 'https://dashscope.aliyuncs.com/compatible-mode/v1', null, '/compatible-mode/v1/chat/completions', chatReply],
  ['minimax', 'openai-completions', 'https://api.minimax.cn/v1', '/v1/models', '/v1/chat/completions', chatReply],
  ['openai', 'openai-responses', 'https://api.openai.com/v1', '/v1/models', '/v1/responses',
    { object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] }],
  ['anthropic', 'anthropic-messages', 'https://api.anthropic.com', '/v1/models', '/v1/messages',
    { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }] }],
  ['gemini', 'openai-completions', 'https://generativelanguage.googleapis.com/v1beta/openai', '/v1beta/openai/models', '/v1beta/openai/chat/completions', chatReply],
  ['siliconflow', 'openai-completions', 'https://api.siliconflow.cn/v1', '/v1/models?sub_type=chat', '/v1/chat/completions', chatReply],
  ['ark', 'openai-completions', 'https://ark.cn-beijing.volces.com/api/v3', '/api/v3/models', '/api/v3/chat/completions', chatReply],
] as const;

for (const [brand, api, baseUrl, modelsPath, inferencePath, reply] of officialEndpoints) {
  test(`${brand} preset uses only its official API key and routes`, async () => {
    const preset = providerPresets.find(p => p.brand === brand)!;
    const draft = providerPresetDraft(preset, 'zh');
    assert.deepEqual([draft.baseUrl, draft.api, preset.billing], [baseUrl, api, 'usage']);
    assert.equal(preset.officialApiOnly, true);
    const assertRequest = (url: string, init: RequestInit, path: string) => {
      assert.equal(url, new URL(path, baseUrl).href);
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('authorization'), brand === 'anthropic' ? null : 'Bearer fixture-key');
      assert.equal(headers.get('x-api-key'), brand === 'anthropic' ? 'fixture-key' : null);
      assert.equal(headers.get('anthropic-version'), brand === 'anthropic' ? '2023-06-01' : null);
    };
    assert.equal(preset.listFromEndpoint !== false, modelsPath !== null);
    const modelId = preset.recommendations?.[0] ?? 'fixture-model';
    const arkChat = { id: modelId, domain: 'VLM', status: 'Published', task_type: ['VisualQuestionAnswering', 'TextGeneration'],
      modalities: { output_modalities: ['text'] } };
    if (modelsPath) {
      const models = await discoverProviderModels({}, draft, 'fixture-key', async (url, init) => {
        assertRequest(url, init, modelsPath);
        return Response.json({ data: brand === 'ark' ? [
          arkChat,
          { ...arkChat, id: 'fixture-image', domain: 'ImageGeneration' },
          { ...arkChat, id: 'fixture-embedding', domain: 'Embedding' },
          { ...arkChat, id: 'fixture-video', modalities: { output_modalities: ['video'] } },
          { ...arkChat, id: 'fixture-retired', status: 'Offline' },
          { ...arkChat, id: 'fixture-translation', task_type: ['Translation'] },
        ] : [{ id: modelId }] });
      });
      assert.deepEqual(models.map(model => model.id), [modelId]);
    } else {
      assert.ok(preset.recommendations?.length);
    }
    const ready = { ...draft, models: [importProviderModel({ id: modelId, name: modelId })] };
    const auth = saveProviderAuth({}, ready, 'fixture-key');
    const tested = await testProvider(auth, providerInfos(auth)[0], modelId, undefined, undefined, async (url, init) => {
      assertRequest(url, init, inferencePath);
      assert.equal(init.method, 'POST');
      const body = JSON.parse(String(init.body));
      assert.equal(body.model, modelId);
      assert.equal(body.stream, false);
      if (brand === 'gemini' || brand === 'zhipu' || brand === 'bailian' || brand === 'siliconflow' || brand === 'ark' || brand === 'minimax') {
        assert.equal(body.max_tokens, 256);
        assert.equal(body.max_completion_tokens, undefined);
      }
      return Response.json(reply);
    });
    assert.equal(tested.outcome, 'reply');
    if (brand === 'ark') {
      const endpointId = 'ep-fixture';
      const endpointDraft = { ...draft, models: [importProviderModel({ id: endpointId, name: endpointId })] };
      const endpointTest = await testProvider({}, endpointDraft, endpointId, 'fixture-key', undefined, async (url, init) => {
        assertRequest(url, init, inferencePath);
        assert.equal(JSON.parse(String(init.body)).model, endpointId);
        return Response.json(reply);
      });
      assert.equal(endpointTest.outcome, 'reply');
    }

    const invalidKeys = brand === 'anthropic' ? [{ keyless: false, key: 'sk-ant-oat-fixture' }, { keyless: true }] : [{ keyless: true }];
    for (const { key, keyless } of invalidKeys) {
      const invalid = { ...ready, keyless };
      let calls = 0;
      const noRequest = async () => { calls++; return Response.json(reply); };
      assert.throws(() => saveProviderAuth({}, invalid, key), /An official API key is required/);
      await assert.rejects(discoverProviderModels({}, invalid, key, noRequest), /An official API key is required/);
      assert.equal((await testProvider({}, invalid, modelId, key, undefined, noRequest)).outcome, 'invalid-config');
      assert.equal(calls, 0);
    }
  });
}

test('Kimi platform and subscription use distinct endpoints, protocols and credentials', async () => {
  const [platform, subscription] = providerPresets.filter(preset => preset.brand === 'kimi');
  const model = importProviderModel({ id: 'kimi-for-coding', name: 'Kimi for Coding' });
  const draft = { ...providerPresetDraft(platform, 'en'), models: [model] };
  const plan = { ...providerPresetDraft(subscription, 'en'), models: [model] };
  const base = saveProviderAuth({}, draft, 'platform-fixture');
  const saved = providerInfos(base)[0];
  const changed = { ...plan, id: saved.id };
  const unexpected = async () => { assert.fail('an old credential must not trigger a request to another endpoint'); };
  await assert.rejects(discoverProviderModels(base, changed, undefined, unexpected), /API key is required/);
  assert.equal((await testProvider(base, changed, model.id, undefined, undefined, unexpected)).outcome, 'invalid-config');
  assert.throws(() => saveProviderAuth(base, changed), /API key is required/);
  assert.equal(providerInfos(saveProviderAuth(base, { ...changed, keyless: true }))[0].hasKey, false);

  const both = saveProviderAuth(base, plan, 'subscription-fixture');
  const records = providerInfos(both);
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(JSON.stringify(records).includes('subscription-fixture'), false);
  let calls = 0;
  const result = await testProvider(both, records[1], model.id, undefined, undefined, async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.kimi.com/coding/v1/responses');
    assert.equal(new Headers(request.headers).get('authorization'), 'Bearer subscription-fixture');
    assert.equal(JSON.parse(String(request.body)).stream, false);
    return Response.json({ object: 'response', status: 'completed', output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] },
    ] });
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'reply');
});

test('MiniMax shared endpoint preserves explicit billing identity without reusing or falling back to another key', async () => {
  const [usage, subscription] = providerPresets.filter(p => p.brand === 'minimax');
  const model = importProviderModel({ id: 'MiniMax-M3.1-Flash', name: 'Fixture model' });
  const platform = { ...providerPresetDraft(usage, 'zh'), name: 'Same name', models: [model] };
  const plan = { ...providerPresetDraft(subscription, 'zh'), name: 'Same name', models: [model] };
  const usageKey = 'platform-fixture';
  const planKey = 'sk-cp-fixture';
  const legacy = saveProviderAuth({}, { ...platform, presetId: undefined }, planKey);
  assert.equal(providerPresetFor(providerInfos(legacy)[0]), undefined);
  assert.equal(providerInfos(legacy)[0].hasKey, true);
  const existing = saveProviderAuth({}, platform, usageKey);
  const [configured] = providerInfos(existing);
  const switched = { ...plan, id: configured.id };
  const unexpected = async () => { assert.fail('A different billing route must not send a request with the stored key'); };
  assert.throws(() => saveProviderAuth(existing, switched), /API key is required/);
  await assert.rejects(discoverProviderModels(existing, switched, undefined, unexpected), /API key is required/);
  assert.equal((await testProvider(existing, switched, model.id, undefined, undefined, unexpected)).outcome, 'invalid-config');
  assert.throws(() => saveProviderAuth(existing, plan, usageKey), /subscription API key is required/);
  assert.throws(() => saveProviderAuth(existing, platform, planKey), /subscription preset/);
  assert.throws(() => saveProviderAuth(existing, { ...plan, api: 'openai-responses' }, planKey), /preset does not match/);

  const auth = saveProviderAuth(existing, plan, planKey);
  const rows = providerInfos(auth);
  assert.deepEqual(rows.map(p => p.presetId), [usage.id, subscription.id]);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].baseUrl, rows[1].baseUrl);
  assert.equal(rows[0].api, rows[1].api);
  assert.deepEqual(providerModelNames(rows.map(p => ({ ...model, provider: p.id })), auth).map(m => m.providerBilling),
    ['usage', 'subscription']);
  assert.deepEqual(rows.map(p => runtimeAuth(auth)[p.id]), [{ type: 'api_key', key: usageKey }, { type: 'api_key', key: planKey }]);
  assert.ok(!JSON.stringify(rows).includes(planKey));
  let calls = 0;
  const result = await testProvider(auth, rows[1], model.id, undefined, undefined, async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.minimax.cn/v1/chat/completions');
    assert.equal(new Headers(request.headers).get('authorization'), `Bearer ${planKey}`);
    return new Response(null, { status: 429 });
  });
  assert.equal(result.outcome, 'rate-limit');
  assert.equal(calls, 1);
  const dir = await mkdtemp(join(tmpdir(), 'dfsc-provider-plans-'));
  try {
    await projectProviders(dir, auth);
    const projected = JSON.parse(await readFile(join(dir, 'models.json'), 'utf8')).providers;
    assert.deepEqual(Object.keys(projected), rows.map(row => row.id));
    for (const row of rows) assert.equal(projected[row.id].models[0].compat.maxTokensField, 'max_tokens');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Bailian Token Plan sends a subscription key only to the official Token Plan route', async () => {
  const plan = providerPresets.find(p => p.id === 'bailian-token-plan-cn')!;
  const model = importProviderModel({ id: plan.recommendations![0], name: 'Fixture model' });
  const draft = { ...providerPresetDraft(plan, 'zh'), models: [model] };
  const key = 'sk-sp-fixture';
  assert.throws(() => saveProviderAuth({}, draft, 'sk-platform-fixture'), /subscription API key is required/);
  const auth = saveProviderAuth({}, draft, key);
  const result = await testProvider(auth, providerInfos(auth)[0], model.id, undefined, undefined, async (url, request) => {
    assert.equal(url, 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(new Headers(request.headers).get('authorization'), `Bearer ${key}`);
    assert.equal(JSON.parse(String(request.body)).max_tokens, 256);
    return Response.json(chatReply);
  });
  assert.equal(result.outcome, 'reply');
});
