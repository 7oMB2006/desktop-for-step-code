import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompactionConfiguration } from '../electron/compaction-configuration';
import { defaultCompactionConfiguration, validateCompactionUpdate } from '../src/compaction-settings';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-compaction-'));
  let document: Record<string, any> = {
    permissionPreset: 'ask', telemetry: { enabled: false },
    mcp_servers: { private: { env: { API_KEY: 'fixture-secret-not-for-renderer' } } },
    compaction: { enabled: false, contextProjection: 'clm-v1', keepRecentTokens: 4000, reserveTokens: 12000, future: true },
  };
  const api = createCompactionConfiguration({
    readGlobalStepConfig: () => structuredClone(document),
    updateGlobalStepConfig: (_env, update) => { document = update(structuredClone(document)); },
  }, root, { STEPCODE_STORAGE_ROOT_DIR: root, STEP_CODING_AGENT_DIR: join(root, 'agent') });
  return { api, get: () => document, replace: (next: Record<string, any>) => { document = next; },
    dispose: () => rm(root, { recursive: true, force: true }) };
}

test('compaction editor validates only bounded ratio/token/model data', () => {
  const base = { revision: 'a'.repeat(64), configuration: defaultCompactionConfiguration() };
  assert.deepEqual(validateCompactionUpdate(base), base);
  for (const triggerRatio of [.49, .951, NaN, Infinity, '0.9', null])
    assert.throws(() => validateCompactionUpdate({ ...base, configuration: { ...base.configuration, triggerRatio } }), /compaction:invalid/);
  for (const tokenLimit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100'])
    assert.throws(() => validateCompactionUpdate({ ...base, configuration: { ...base.configuration, tokenLimit } }), /compaction:invalid/);
  for (const modelTriggerRatios of [{ 'no-provider': .8 }, { 'step/a': .99 }, { 'step/a\n': .8 }, []])
    assert.throws(() => validateCompactionUpdate({ ...base, configuration: { ...base.configuration, modelTriggerRatios } }), /compaction:invalid/);
  assert.throws(() => validateCompactionUpdate({ ...base, root: 'C:/personal' }), /compaction:invalid/);
  assert.throws(() => validateCompactionUpdate({ ...base, revision: 'stale' }), /compaction:invalid/);
  assert.throws(() => validateCompactionUpdate({ ...base, revision: null }), /compaction:invalid/);
  assert.throws(() => validateCompactionUpdate({ ...base, configuration: { ...base.configuration,
    modelTriggerRatios: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`step/${index}`, .8])),
  } }), /compaction:invalid/);
});

test('compaction save and reset preserve every unrelated and CLM option', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.get());
    const initial = f.api.read();
    assert.equal(initial.triggerRatio, .9); assert.equal(initial.enabled, false);
    assert.equal(JSON.stringify(initial).includes('fixture-secret'), false);
    const changed = f.api.save({ revision: initial.revision, configuration: {
      triggerRatio: .8, tokenLimit: 50000, modelTriggerRatios: { 'step/a': .75, 'custom/a': .65 },
    } });
    assert.equal(changed.triggerRatio, .8);
    assert.deepEqual(changed.modelTriggerRatios, { 'step/a': .75, 'custom/a': .65 });
    assert.deepEqual(f.get().mcp_servers, before.mcp_servers);
    assert.equal(f.get().permissionPreset, before.permissionPreset);
    for (const [key, value] of Object.entries(before.compaction)) assert.deepEqual(f.get().compaction[key], value);
    f.api.save({ revision: changed.revision, configuration: defaultCompactionConfiguration() });
    assert.deepEqual(f.get(), before);
  } finally { await f.dispose(); }
});

test('stale saves conflict but unrelated MCP changes do not', async () => {
  const f = await fixture();
  try {
    const initial = f.api.read();
    f.get().mcp_servers.added = { enabled: false };
    const next = f.api.save({ revision: initial.revision, configuration: { ...defaultCompactionConfiguration(), triggerRatio: .7 } });
    assert.ok(f.get().mcp_servers.added);
    const stored = structuredClone(f.get());
    assert.throws(() => f.api.save({ revision: initial.revision, configuration: defaultCompactionConfiguration() }), /compaction:conflict/);
    assert.deepEqual(f.get(), stored);
    assert.notEqual(next.revision, initial.revision);
  } finally { await f.dispose(); }
});

test('legacy policy requires explicit migration, without enabling automatic compaction', async () => {
  const f = await fixture();
  try {
    f.get().compaction.triggerPolicy = 'legacy';
    const initial = f.api.read();
    assert.equal(initial.policy, 'legacy');
    const update = { revision: initial.revision, configuration: defaultCompactionConfiguration() };
    assert.throws(() => f.api.save(update), /compaction:legacy/);
    const next = f.api.save({ ...update, useRatioPolicy: true });
    assert.equal(next.policy, 'v2'); assert.equal(next.enabled, false);
    assert.equal(f.get().compaction.contextProjection, 'clm-v1');
  } finally { await f.dispose(); }
});

test('invalid stored thresholds are projected as upstream defaults without mutating reads', async () => {
  const f = await fixture();
  try {
    f.get().compaction = { ...f.get().compaction, triggerRatio: 5, tokenLimit: -100,
      modelTriggerRatios: { 'step/good': .8, 'step/bad': .99 } };
    const before = structuredClone(f.get()), result = f.api.read();
    assert.equal(result.invalidConfiguration, true);
    assert.equal(result.triggerRatio, .9); assert.equal(result.tokenLimit, null);
    assert.deepEqual(result.modelTriggerRatios, { 'step/good': .8 });
    assert.deepEqual(f.get(), before);
    const repaired = f.api.save({ revision: result.revision, configuration: {
      triggerRatio: result.triggerRatio, tokenLimit: result.tokenLimit, modelTriggerRatios: result.modelTriggerRatios,
    } });
    assert.equal(repaired.invalidConfiguration, false);
    assert.equal(f.get().compaction.contextProjection, 'clm-v1');
  } finally { await f.dispose(); }
});

test('unavailable model overrides survive ordinary saves and inherited policy defaults stay untouched', async () => {
  const f = await fixture();
  try {
    f.get().compaction = { ...f.get().compaction, triggerPolicy: 'unknown-policy',
      modelTriggerRatios: { 'removed-provider/old-model': .72 } };
    const initial = f.api.read();
    assert.equal(initial.policy, 'v2');
    assert.equal(initial.invalidConfiguration, false, 'Only editor-owned thresholds are repaired');
    const saved = f.api.save({ revision: initial.revision, configuration: {
      triggerRatio: .85, tokenLimit: null, modelTriggerRatios: initial.modelTriggerRatios,
    } });
    assert.deepEqual(saved.modelTriggerRatios, { 'removed-provider/old-model': .72 });
    assert.equal(f.get().compaction.triggerPolicy, 'unknown-policy');
  } finally { await f.dispose(); }
});

test('linked Desktop roots fail closed before touching the configuration', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'desktop-compaction-link-'));
  try {
    const target = join(parent, 'target');
    await mkdir(target);
    const linkedRoot = join(parent, 'linked');
    await symlink(target, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const api = createCompactionConfiguration({
      readGlobalStepConfig: () => { throw new Error('must not read'); },
      updateGlobalStepConfig: () => { throw new Error('must not write'); },
    }, linkedRoot, { STEPCODE_STORAGE_ROOT_DIR: linkedRoot, STEP_CODING_AGENT_DIR: join(linkedRoot, 'agent') });
    assert.throws(() => api.read(), /compaction:profile/);
    assert.throws(() => api.save({ revision: 'a'.repeat(64), configuration: defaultCompactionConfiguration() }), /compaction:profile/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
test('profile mismatch and malformed compaction tables fail closed', async () => {
  const f = await fixture();
  try {
    f.replace({ compaction: 'invalid' });
    assert.throws(() => f.api.read(), /compaction:unavailable/);
    const invalid = createCompactionConfiguration({
      readGlobalStepConfig: () => { throw new Error('must not read'); },
      updateGlobalStepConfig: () => { throw new Error('must not write'); },
    }, 'relative/profile', {});
    assert.throws(() => invalid.read(), /compaction:profile/);
  } finally { await f.dispose(); }
});
