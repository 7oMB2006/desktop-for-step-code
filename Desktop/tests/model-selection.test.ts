import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelSelections, modelThinkingLevels } from '../electron/model-selection';
import type { SessionRuntime } from '../electron/session-runtimes';
import type { Model } from '../src/contracts';

const a: Model = { id: 'a', provider: 'fixture', name: 'Original Model', reasoning: true, thinkingLevels: ['off', 'low', 'high'] };
const b: Model = { id: 'b', provider: 'fixture', name: 'Next Model', thinkingLevels: ['off', 'high'] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'step-selection-'));
  const calls: { type: string; args?: Record<string, unknown> }[] = [];
  const worker = { id: 'worker-a', models: [a, b], state: { sessionId: 'session-a', model: a, thinkingLevel: 'low', isStreaming: false },
    busy: false, runActive: false, mutating: false, messages: [{ role: 'assistant', content: 'Previous answer', provider: 'fixture', model: 'a' }],
    rpc: { request: async (type: string, args?: Record<string, unknown>) => {
      calls.push({ type, args });
      if (type === 'set_model') worker.state!.model = worker.models.find(model => model.id === args?.modelId)!;
      if (type === 'set_thinking_level') worker.state!.thinkingLevel = String(args?.level);
      if (type === 'get_state') return { ...worker.state };
      return {};
    } },
  } as unknown as SessionRuntime;
  const selections = new ModelSelections(root, () => {});
  await selections.load('session-a');
  const close = async () => { await selections.flush(); await rm(root, { recursive: true, force: true }); };
  return { selections, worker, calls, root, close };
}
test('running selection and steering never mutate the active model; last choice applies before a new prompt', async () => {
  const { selections, worker, calls, close } = await fixture();
  try {
    worker.busy = worker.runActive = true;
    selections.select(worker, b);
    selections.selectEffort(worker, 'high');
    await selections.prepare(worker, 'steer');
    assert.equal(calls.length, 0);
    assert.equal(worker.state?.model?.id, 'a');
    assert.equal(selections.changes(worker).length, 0);
    worker.busy = worker.runActive = false;
    await selections.prepare(worker, 'next task');
    assert.equal(worker.state?.model?.id, 'b');
    assert.equal(worker.state?.thinkingLevel, 'high');
    assert.equal(worker.pendingModel, undefined);
    assert.equal(selections.changes(worker).length, 0, 'not a fabricated user message');
    assert.equal(selections.delivered(worker, 'system reminder', 1), false);
    assert.equal(selections.delivered(worker, 'next task', 2), true);
    assert.equal(selections.delivered(worker, 'next task', 2), false, 'delivery updates do not duplicate');
    assert.deepEqual(selections.changes(worker)[0].from, { id: 'a', provider: 'fixture', name: 'Original Model' });
    assert.equal(selections.changes(worker)[0].to.id, 'b');
    assert.deepEqual(worker.messages, [{ role: 'assistant', content: 'Previous answer', provider: 'fixture', model: 'a' }]);
  } finally { await close(); }
});
test('selecting back to the original configuration cancels pending changes without RPC or a timeline note', async () => {
  const { selections, worker, calls, close } = await fixture();
  try {
    worker.busy = true;
    selections.select(worker, b);
    selections.select(worker, a, 'low');
    assert.equal(worker.pendingModel, undefined);
    worker.busy = false;
    await selections.prepare(worker, 'next');
    assert.equal(calls.length, 0);
    assert.equal(selections.delivered(worker, 'next', 3), false);
  } finally { await close(); }
});
test('thinking-only changes do not claim a model switch; unsupported effort fails closed', async () => {
  const { selections, worker, calls, close } = await fixture();
  try {
    selections.selectEffort(worker, 'high');
    await selections.prepare(worker, 'task');
    assert.equal(worker.state?.thinkingLevel, 'high');
    assert.equal(calls.some(call => call.type === 'set_model'), false);
    assert.throws(() => selections.selectEffort(worker, 'xhigh'), /Unsupported/);
    assert.equal(selections.delivered(worker, 'task', 2), false);
  } finally { await close(); }
});
test('failed application keeps the selection for retry, releases its lock and emits no false switch', async () => {
  const { selections, worker, close } = await fixture();
  try {
    selections.select(worker, b);
    const request = worker.rpc.request;
    worker.rpc.request = async (type, args) => {
      if (type === 'set_model') throw new Error('fixture authentication failure');
      return request(type, args);
    };
    await assert.rejects(selections.prepare(worker, 'task'), /authentication/);
    assert.equal(worker.mutating, false);
    assert.equal(worker.pendingModel?.model.id, 'b');
    assert.equal(selections.delivered(worker, 'task', 1), false);
    worker.rpc.request = request;
    await selections.prepare(worker, 'retry');
    assert.equal(selections.delivered(worker, 'retry', 2), true);
  } finally { await close(); }
});
test('idle choices collapse before consumption; sidecars survive reopen and contain no prompt text', async () => {
  const { selections, worker, root, close } = await fixture();
  try {
    selections.select(worker, b);
    await selections.apply(worker);
    selections.select(worker, a, 'low');
    await selections.apply(worker);
    await selections.prepare(worker, 'no change');
    assert.equal(selections.delivered(worker, 'no change', 1), false);
    selections.select(worker, b, 'high');
    await selections.prepare(worker, 'PRIVATE PROMPT TEXT');
    await selections.flush();
    const reopened = new ModelSelections(root, () => {});
    await reopened.load('session-a');
    assert.equal(reopened.delivered(worker, 'PRIVATE PROMPT TEXT', 5), true);
    await reopened.flush();
    const saved = await readFile(join(root, (await readdir(root))[0]), 'utf8');
    assert.equal(saved.includes('PRIVATE PROMPT TEXT'), false);
    const history = new ModelSelections(root, () => {});
    await history.load('session-a');
    assert.equal(history.changes(worker).length, 1);
    assert.equal(history.changes({ ...worker, state: { ...worker.state!, sessionId: 'session-b' } }).length, 0);
  } finally { await close(); }
});
test('upstream busy state is rechecked before application and concurrent mutation is rejected', async () => {
  const { selections, worker, calls, close } = await fixture();
  try {
    selections.select(worker, b);
    worker.state!.isStreaming = true;
    await assert.rejects(selections.prepare(worker, 'task'), /finish/);
    assert.equal(calls.some(call => call.type === 'set_model'), false);
    worker.state!.isStreaming = false;
    worker.mutating = true;
    await assert.rejects(selections.apply(worker), /operation/);
  } finally { await close(); }
});
test('effort capabilities follow declared maps, not model names', () => {
  assert.deepEqual(modelThinkingLevels({ ...a, thinkingLevels: undefined, reasoning: false }), ['off']);
  assert.deepEqual(modelThinkingLevels({ ...a, thinkingLevels: undefined, thinkingLevelMap: { low: null, xhigh: 'high' } } as Model),
    ['off', 'minimal', 'medium', 'high', 'xhigh']);
});
test('model setup for a proposed first turn is not presented as switching an existing conversation', async () => {
  const { selections, worker, close } = await fixture();
  try {
    worker.messages = [];
    selections.select(worker, b, 'high');
    await selections.prepare(worker, 'first task');
    assert.equal(worker.state?.model?.id, 'b');
    assert.equal(selections.delivered(worker, 'first task', 1), false);
    assert.equal(selections.changes(worker).length, 0);
  } finally { await close(); }
});
