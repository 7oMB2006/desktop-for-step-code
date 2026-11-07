import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';
import { defaultCompactionConfiguration } from '../src/compaction-settings';

test('pinned admin saves isolated TOML consumed by native settings, without resetting CLM or project overrides', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-compaction-native-'));
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, '.stepcode'), { recursive: true });
  const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
  const env = { ...isolatedEnvironment(root), HOME: root, USERPROFILE: root };
  const config = join(root, 'config.toml');
  const original = '# Keep the header\npermissionPreset = "ask"\n[telemetry]\nenabled = false\n'
    + '[compaction]\ncontextProjection = "clm-v1"\nkeepRecentTokens = 4000\n'
    + '[mcp_servers.fixture.env]\nAPI_KEY = "fixture-private-value"\n';
  await writeFile(config, original);
  const admin = new RpcProcess(() => {});
  const other = new RpcProcess(() => {});
  const nativeSettings = async (trusted = false) => {
    const source = `import { pathToFileURL } from 'node:url';
      const upstream = await import(pathToFileURL(process.argv[1]).href);
      const manager = upstream.createStepSettingsManager(process.cwd(), process.env.STEP_CODING_AGENT_DIR, { projectTrusted: ${trusted} });
      console.log(JSON.stringify({ trigger: manager.getCompactionTriggerSettings(), compaction: manager.getCompactionSettings() }));`;
    const result = await promisify(execFile)(node, ['--input-type=module', '-e', source, resolve('runtime/step/dist/bundle/index.js')],
      { cwd: workspace, env, windowsHide: true, timeout: 15000 });
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
  };
  try {
    admin.start(node, resolve('runtime/admin.mjs'), workspace, env);
    other.start(node, resolve('runtime/admin.mjs'), workspace, env);
    const initial = await admin.request('compaction_settings');
    const stale = await other.request('compaction_settings');
    assert.equal(initial.triggerRatio, .9);
    assert.equal(JSON.stringify(initial).includes('fixture-private-value'), false);
    const saved = await admin.request('save_compaction_settings', { update: { revision: initial.revision,
      configuration: { triggerRatio: .8, tokenLimit: 50000, modelTriggerRatios: { 'step/shared-id': .7, 'custom/shared-id': .6 } } } });
    assert.equal(saved.triggerRatio, .8);
    const native = await nativeSettings();
    assert.equal(native.trigger.triggerRatio, .8); assert.equal(native.trigger.tokenLimit, 50000);
    assert.deepEqual(native.trigger.modelTriggerRatios, { 'step/shared-id': .7, 'custom/shared-id': .6 });
    assert.equal(native.compaction.contextProjection, 'clm-v1'); assert.equal(native.compaction.keepRecentTokens, 4000);
    const stored = await readFile(config, 'utf8');
    assert.match(stored, /^# Keep the header/); assert.match(stored, /fixture-private-value/);
    await assert.rejects(other.request('save_compaction_settings', { update: {
      revision: stale.revision, configuration: defaultCompactionConfiguration(),
    } }), /compaction:conflict/);
    assert.equal(await readFile(config, 'utf8'), stored);
    await writeFile(join(workspace, '.stepcode/config.toml'), '[compaction]\ntriggerRatio = 0.65\n');
    assert.equal((await nativeSettings(true)).trigger.triggerRatio, .65);
    const reset = await admin.request('save_compaction_settings', { update: {
      revision: saved.revision, configuration: defaultCompactionConfiguration(),
    } });
    assert.equal(reset.triggerRatio, .9); assert.equal(reset.tokenLimit, null);
    assert.equal((await nativeSettings()).compaction.contextProjection, 'clm-v1');
    await writeFile(config, 'invalid = [\n# fixture-private-value');
    await assert.rejects(admin.request('compaction_settings'), error =>
      error instanceof Error && !error.message.includes('fixture-private-value'));
    assert.equal(await readFile(config, 'utf8'), 'invalid = [\n# fixture-private-value');
  } finally {
    await admin.stop(); await other.stop();
    await rm(root, { recursive: true, force: true });
  }
});
