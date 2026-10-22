import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('draft management registers Step under its canonical credential/model identity', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-step-models-'));
  await mkdir(join(root, 'agent'));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "step"\ndefaultModel = "step-5-preview"\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
    step: { apiKey: 'isolated-fixture-only', baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions',
      models: [{ id: 'step-5-preview', name: 'Step fixture', reasoning: true, contextWindow: 32768, maxTokens: 2048 }] },
    'fixture-custom': { apiKey: 'isolated-fixture-only', baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions',
      models: [{ id: 'step-5-preview', name: 'Custom fixture', reasoning: false, contextWindow: 32768, maxTokens: 2048 }] },
  } }));
  const rpc = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/admin.mjs'), root, isolatedEnvironment(root));
    const options = await rpc.request('session_options', { cwd: root }, 20000);
    assert.equal(options.model.provider, 'step');
    assert.equal(options.model.id, 'step-5-preview');
    assert.ok(options.models.some((model: any) => model.provider === 'step'));
    assert.ok(options.models.some((model: any) => model.provider === 'fixture-custom'));
    assert.deepEqual(options.models.filter((model: any) => model.provider === 'step').map((model: any) => model.id), ['step-5-preview'],
      'an available official catalog is not expanded with fallback models');
    assert.equal(options.officialModel, true);
    assert.ok(!options.models.some((model: any) => model.provider === 'Step'), 'display name is not a provider identifier');
    assert.ok(options.model.thinkingLevels.includes('medium'));
    assert.equal(options.thinkingLevel, 'medium');
  } finally {
    await rpc.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('draft does not invent an official catalog without configured credentials', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-offline-models-'));
  await mkdir(join(root, 'agent'));
  const rpc = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/admin.mjs'), root, isolatedEnvironment(root));
    const options = await rpc.request('session_options', { cwd: root }, 20000);
    assert.deepEqual(options.models, [], 'no hardcoded or unrelated unconfigured models');
    assert.equal(options.model.provider, 'step');
    assert.equal(options.officialModel, true);
  } finally {
    await rpc.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('draft keeps the official catalog when only a custom provider is available', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-custom-models-'));
  await mkdir(join(root, 'agent'));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture-custom"\ndefaultModel = "custom-chat"\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
    step: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions',
      models: [{ id: 'step-fixture', name: 'Step fixture', reasoning: true, contextWindow: 32768, maxTokens: 2048 }] },
    'fixture-custom': { apiKey: 'isolated-fixture-only', baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions',
      models: [{ id: 'custom-chat', name: 'Custom fixture', reasoning: false, contextWindow: 32768, maxTokens: 2048 }] },
  } }));
  const rpc = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/admin.mjs'), root, isolatedEnvironment(root));
    for (let attempt = 0; attempt < 2; attempt++) {
      const options = await rpc.request('session_options', { cwd: root }, 20000);
      assert.ok(options.models.some((model: any) => model.provider === 'fixture-custom'), 'custom models remain selectable');
      assert.ok(options.models.some((model: any) => model.provider === 'step'), 'official fallback must not depend on the whole list being empty');
      assert.equal(options.model.provider, 'fixture-custom', 'catalog fallback must not change the selected provider');
      assert.equal(options.model.id, 'custom-chat');
      assert.equal(options.officialModel, false);
      const identities = options.models.map((model: any) => JSON.stringify([model.provider, model.id]));
      assert.equal(new Set(identities).size, identities.length, 'fallback does not duplicate provider/model pairs');
    }
  } finally {
    await rpc.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('draft reuses discovered Step models only for the same credential and endpoint', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-discovered-models-'));
  await mkdir(join(root, 'agent'));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "fixture-custom"\ndefaultModel = "custom-chat"\n');
  let available = true;
  let modelId = 'step-discovered-a';
  const server = createServer((request, response) => {
    if (!available) { response.writeHead(503, { Connection: 'close' }); response.end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: modelId,
      max_input_tokens: 32768, enable_reason: true, reasoning_effort_support_list: ['low', 'high'] }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const providers = (apiKey: string) => ({ providers: {
    step: { apiKey, baseUrl, api: 'openai-completions' },
    'fixture-custom': { apiKey: 'isolated-fixture-only', baseUrl, api: 'openai-completions',
      models: [{ id: 'custom-chat', name: 'Custom fixture', reasoning: false, contextWindow: 32768, maxTokens: 2048 }] },
  } });
  await writeFile(join(root, 'models.json'), JSON.stringify(providers('fixture-official-a')));
  await writeFile(join(root, 'auth.json'), JSON.stringify({ step: { type: 'api_key', key: 'fixture-official-a' } }));
  const rpc = new RpcProcess(() => {});
  const env = { ...isolatedEnvironment(root), STEP_PROVIDER_API_URL: baseUrl,
    STEPCODE_DEVCENTER_AUTH_CN_URL: `https://127.0.0.1:${address.port}` };
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/admin.mjs'), root, env);
    const read = () => rpc.request('session_options', { cwd: root }, 20000);
    const official = (options: any) => options.models.filter((model: any) => model.provider === 'step');
    const first = await read();
    assert.deepEqual(official(first).map((model: any) => model.id), [modelId]);
    available = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const cached = await read();
      assert.deepEqual(official(cached), official(first), 'failed discovery retains IDs and supported efforts');
      assert.equal(cached.model.provider, 'fixture-custom', 'cached catalog must not switch billing provider');
      assert.equal(cached.officialModel, false);
    }
    const originalAuth = await readFile(join(root, 'auth.json'), 'utf8');
    await assert.rejects(rpc.request('login', { profile: 'platform_cn', key: '' }), /Management operation failed: login/);
    assert.deepEqual(official(await read()), official(first), 'failed login preserves the unchanged account catalog');
    await Promise.all([
      assert.rejects(rpc.request('login', { profile: 'step_plan' }), /Management operation failed: login/),
      rpc.request('cancel_login'),
    ]);
    assert.equal(await readFile(join(root, 'auth.json'), 'utf8'), originalAuth, 'cancelled login preserves the credential');
    assert.deepEqual(official(await read()), official(first), 'cancelled login preserves the unchanged account catalog');
    await writeFile(join(root, 'auth.json'), JSON.stringify({ step: { type: 'api_key', key: 'fixture-official-b' } }));
    assert.deepEqual(official(await read()), [], 'a different credential cannot reuse the previous account catalog');
    available = true;
    modelId = 'step-discovered-b';
    assert.deepEqual(official(await read()).map((model: any) => model.id), [modelId], 'successful discovery replaces the old catalog');
    available = false;
    await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
      ...providers('fixture-official-a').providers,
      step: { ...providers('fixture-official-a').providers.step, baseUrl: 'http://127.0.0.1:1/v1' },
    } }));
    assert.deepEqual(official(await read()), [], 'a different endpoint cannot reuse the previous catalog');
  } finally {
    await rpc.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
