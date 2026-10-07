import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('draft management registers Step under its canonical credential/model identity', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'draft-step-models-'));
  await mkdir(join(root, 'agent'));
  await writeFile(join(root, 'config.toml'), 'defaultProvider = "step"\ndefaultModel = "step-5-preview"\n');
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: {
    step: { apiKey: 'isolated-fixture-only', baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions',
      models: [{ id: 'step-5-preview', name: 'Step fixture', reasoning: true, contextWindow: 32768, maxTokens: 2048 }] },
  } }));
  const rpc = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node/node.exe'), resolve('runtime/admin.mjs'), root, isolatedEnvironment(root));
    const options = await rpc.request('session_options', { cwd: root }, 20000);
    assert.equal(options.model.provider, 'step');
    assert.equal(options.model.id, 'step-5-preview');
    assert.ok(options.models.some((model: any) => model.provider === 'step'));
    assert.ok(!options.models.some((model: any) => model.provider === 'Step'), 'display name is not a provider identifier');
    assert.ok(options.model.thinkingLevels.includes('medium'));
    assert.equal(options.thinkingLevel, 'medium');
  } finally { await rpc.stop(); }
});
