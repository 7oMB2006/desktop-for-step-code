import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPreference, preferredModel, savedSessionModel, restoreSelectedModel } from '../electron/model-preference';
import type { SessionRuntime } from '../electron/session-runtimes';
import type { Model } from '../src/contracts';

const step: Model = { provider: 'step', id: 'step-5', name: 'Step 5', thinkingLevels: ['low', 'high'] };
const sol: Model = { provider: 'fixture', id: 'sol', name: 'Sol' };

test('preferred identity survives JSON persistence without credentials or stale capabilities', () => {
  const saved = modelPreference({ ...step, apiKey: 'must-not-persist' });
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { provider: 'step', id: 'step-5', name: 'Step 5' });
  assert.equal(modelPreference({ provider: '', id: 'x' }), undefined);
  assert.equal(modelPreference({ provider: 'step', id: 123 }), undefined);
  assert.equal(modelPreference({ provider: 'x'.repeat(201), id: 'x' }), undefined);
});

test('new draft prefers remembered Step independently of model ordering', () => {
  assert.equal(preferredModel([sol, step], modelPreference(step), sol), step);
  assert.equal(preferredModel([step, sol], modelPreference(sol), step), sol);
  assert.equal(preferredModel([sol, step], undefined, sol), sol);
});

test('a missing remembered model remains visible instead of silently selecting Sol', () => {
  const selected = preferredModel([sol], modelPreference(step), sol);
  assert.deepEqual(selected, modelPreference(step));
  assert.notEqual(selected?.provider, sol.provider);
});

test('session restoration follows the active branch and its latest explicit model change', () => {
  const entries = [
    { id: 'm1', parentId: null, type: 'model_change', provider: 'step', modelId: 'step-5' },
    { id: 'a1', parentId: 'm1', type: 'message', message: { role: 'assistant', content: 'old', provider: 'step', model: 'step-5' } },
    { id: 'm2', parentId: 'a1', type: 'model_change', provider: 'fixture', modelId: 'sol' },
  ];
  assert.deepEqual(savedSessionModel(entries, 'a1'), { ...modelPreference(step), name: step.id });
  assert.deepEqual(savedSessionModel(entries, 'm2'), { ...modelPreference(sol), name: sol.id });
  assert.equal(savedSessionModel(entries, null), undefined);
});

test('legacy assistant metadata can recover a model when no model-change entry exists', () => {
  assert.deepEqual(savedSessionModel([
    { id: 'a', parentId: null, type: 'message', message: { role: 'assistant', content: '', provider: 'step', model: 'step-5' } },
  ], 'a'), { ...modelPreference(step), name: step.id });
});

test('explicit model changes take precedence over an assistant-reported model alias', () => {
  const entries = [
    { id: 'm', parentId: null, type: 'model_change', provider: 'step', modelId: 'step-5' },
    { id: 'a', parentId: 'm', type: 'message', message: { role: 'assistant', content: '', provider: 'step', model: 'server-alias' } },
  ];
  assert.equal(savedSessionModel(entries, 'a')?.id, 'step-5');
});

function fixture(models: Model[], initial: Model | undefined = sol) {
  const calls: { type: string; args?: Record<string, unknown> }[] = [];
  const worker = { models, state: { model: initial, isStreaming: false }, rpc: {
    request: async (type: string, args?: Record<string, unknown>) => {
      calls.push({ type, args });
      if (type === 'set_model') worker.state!.model = models.find(model => model.provider === args?.provider && model.id === args?.modelId);
      return { ...worker.state };
    },
  } } as unknown as SessionRuntime;
  return { worker, calls };
}

test('restoration applies the exact saved provider/id and verifies the resulting runtime', async () => {
  const { worker, calls } = fixture([sol, step]);
  await restoreSelectedModel(worker, step);
  assert.equal(worker.state?.model, step);
  assert.deepEqual(calls[0], { type: 'set_model', args: { provider: 'step', modelId: 'step-5' } });
});

test('missing saved model fails closed without selecting a first or same-named provider', async () => {
  const { worker, calls } = fixture([sol, { ...step, provider: 'other' }]);
  await assert.rejects(restoreSelectedModel(worker, step), /step\/step-5.*unavailable/);
  assert.deepEqual(calls, []);
  assert.equal(worker.state?.model, sol);
});

test('already restored sessions are not overwritten by unrelated new-session defaults', async () => {
  const { worker, calls } = fixture([sol, step], step);
  await restoreSelectedModel(worker, savedSessionModel([
    { id: 'm', parentId: null, type: 'model_change', provider: 'step', modelId: 'step-5' } as any,
  ], 'm'));
  assert.equal(worker.state?.model, step);
  assert.deepEqual(calls, []);
});

test('a transport that ignores set_model cannot pass restoration verification', async () => {
  const { worker } = fixture([sol, step]);
  worker.rpc.request = async () => ({ model: sol, isStreaming: false });
  await assert.rejects(restoreSelectedModel(worker, step), /unavailable/);
});
