import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CapabilityService } from '../electron/capability-service';
import { PluginHostBindingStore } from '../electron/plugin-host-contract.mjs';
import { hostService } from './fixtures/plugin-host-service';
import type { PluginHostSettingsInput } from '../src/capabilities';

async function fixture(t: test.TestContext, settings = true, available = true) {
  const f = await hostService(t, { configured: false, settings });
  await f.broker.close();
  let invalidations = 0;
  const raw = { plugins: [{ id: f.descriptor.id, name: 'Example', mcpServers: ['example'], warnings: [],
    packageDescriptor: f.descriptor }], available: [], marketplaces: [], skills: [], warnings: [],
    mcp: [{ name: `${f.descriptor.id}__example`, source: 'plugin', pluginId: f.descriptor.id,
      transport: 'stdio', enabled: true, configurable: true }] };
  const service = new CapabilityService({ root: f.root, runtime: '', node: '',
    environment: () => ({}), hostAvailable: () => available, hostStatus: async () => ({ status: 'no-session' }),
    beforePluginMutation: () => { invalidations++; } });
  // Stub only the native catalog subprocess; receipts, files, projections and
  // the production management queue remain real.
  const internals = service as unknown as { request(type: string): Promise<unknown>; hostBindings: PluginHostBindingStore };
  internals.request = async type => { assert.equal(type, 'catalog'); return raw; };
  const ref = (await service.catalog()).plugins[0].package!.ref;
  const save = (input: Omit<PluginHostSettingsInput, 'ref'>) => service.hostSettings({ ref }, { ref, ...input });
  return { ...f, service, raw, ref, save, internals, invalidations: () => invalidations };
}
test('host settings expose only a safe projection and never select a mode or call a provider on read', async t => {
  const f = await fixture(t);
  const first = await f.service.hostSettings({ ref: f.ref });
  assert.equal(first.mode, null);
  assert.equal(first.revision, 'unconfigured');
  assert.equal(first.independent?.configured, false);
  assert.equal(first.runtime.status, 'no-session');
  assert.equal(f.invalidations(), 0);
  const saved = await f.save({ revision: first.revision, mode: 'follow' });
  assert.equal(saved.mode, 'follow');
  assert.equal(saved.configurationCurrent, true);
  assert.equal(saved.independent?.configured, false, 'Follow does not save placeholder keys');
  assert.equal(saved.runtime.status, 'restart-required');
  assert.equal(f.invalidations(), 1);
  assert.equal(f.calls.length, 0);
  const json = JSON.stringify([first, saved]);
  assert.doesNotMatch(json, /receipt|fingerprint|declarationHash|broker|token|launchId|fixture-main-private-key/);
  assert.ok(!json.includes(f.root) && !json.includes(f.receipt.instance));
});
test('mode writes share the management queue and stale concurrent saves cannot revoke or overwrite the winner', async t => {
  const f = await fixture(t, false);
  const result = await Promise.allSettled([
    f.save({ revision: 'unconfigured', mode: 'follow' }),
    f.save({ revision: 'unconfigured', mode: 'follow' }),
  ]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(result.filter(item => item.status === 'rejected').length, 1);
  assert.equal(f.invalidations(), 1);
  const selected = await f.service.hostSettings({ ref: f.ref });
  assert.equal(selected.mode, 'follow');
  assert.equal(selected.independent, undefined);
});
test('independent mode commits a validated configuration and returns no stored secrets', async t => {
  const f = await fixture(t);
  const first = await f.service.hostSettings({ ref: f.ref });
  await assert.rejects(f.save({ revision: first.revision, mode: 'independent',
    configuration: { ref: f.ref, revision: 'unconfigured', values: {}, secrets: { key: { action: 'keep' } } } }), /invalid-configuration/);
  assert.equal((await f.service.hostSettings({ ref: f.ref })).mode, null);
  const saved = await f.save({ revision: first.revision, mode: 'independent',
    configuration: { ref: f.ref, revision: 'unconfigured', values: {}, secrets: { key: { action: 'replace', value: 'private-independent-key' } } } });
  assert.equal(saved.mode, 'independent');
  assert.equal(saved.configurationCurrent, true);
  assert.equal(saved.independent?.hasSecret.key, true);
  assert.doesNotMatch(JSON.stringify(saved), /private-independent-key|fixture-main-private-key/);
  const binding = await f.store.current(f.descriptor);
  assert.ok('mode' in binding);
  assert.equal(binding.configurationRevision, saved.independent?.revision);
  const followed = await f.save({ revision: saved.revision, mode: 'follow' });
  assert.equal(followed.independent?.hasSecret.key, true, 'Switching source never deletes saved independent settings');
  assert.equal(f.calls.length, 0);
});
test('a failed second pointer commit is explicit and cannot leave the old independent binding usable', async t => {
  const f = await fixture(t);
  const first = await f.save({ revision: 'unconfigured', mode: 'independent',
    configuration: { ref: f.ref, revision: 'unconfigured', values: {}, secrets: { key: { action: 'replace', value: 'original-private-key' } } } });
  const select = f.internals.hostBindings.select;
  f.internals.hostBindings.select = async () => { throw new Error('simulated pointer failure'); };
  await assert.rejects(f.save({ revision: first.revision, mode: 'independent',
    configuration: { ref: f.ref, revision: first.independent!.revision, values: {}, secrets: { key: { action: 'replace', value: 'replacement-private-key' } } } }),
  /host-selection-incomplete/);
  f.internals.hostBindings.select = select;
  const current = await f.service.hostSettings({ ref: f.ref });
  assert.equal(current.mode, 'independent');
  assert.equal(current.revision, first.revision);
  assert.equal(current.configurationCurrent, false);
  const recovered = await f.save({ revision: current.revision, mode: 'follow' });
  assert.equal(recovered.configurationCurrent, true);
  assert.doesNotMatch(JSON.stringify(current), /replacement-private-key/);
});
test('global overrides, duplicate discovery and renderer-chosen identities are rejected without a mode write', async t => {
  for (const conflict of ['global', 'duplicate', 'transport']) {
    const f = await fixture(t);
    if (conflict === 'global') f.raw.mcp[0].source = 'user';
    if (conflict === 'duplicate') f.raw.mcp.push({ ...f.raw.mcp[0] });
    if (conflict === 'transport') f.raw.mcp[0].transport = 'http';
    await assert.rejects(f.save({ revision: 'unconfigured', mode: 'follow' }), /configuration-consumer-conflict/);
    assert.equal(f.invalidations(), 0);
  }
  const f = await fixture(t);
  await assert.rejects(f.service.hostSettings({ ref: f.ref, workerId: f.worker.id } as never), /invalid-input/);
  await assert.rejects(f.service.hostSettings({ ref: f.ref }, {
    ref: f.ref, revision: 'unconfigured', mode: 'follow', workerId: f.worker.id,
  } as never), /invalid-input/);
  await assert.rejects(f.save({ revision: 'unconfigured', mode: 'follow', models: { 'model.text': 'forged-model' } } as never));
  assert.equal(f.invalidations(), 0);
});
test('old hosts can inspect declarations but cannot save or silently enable host access', async t => {
  const f = await fixture(t, false, false);
  assert.equal((await f.service.hostSettings({ ref: f.ref })).runtime.status, 'unsupported');
  await assert.rejects(f.save({ revision: 'unconfigured', mode: 'follow' }), /host-unavailable/);
  assert.equal(f.invalidations(), 0);
});
test('service disablement does not hide saved mode, but source changes invalidate opaque references', async t => {
  const f = await fixture(t);
  f.raw.mcp[0].enabled = false;
  const selected = await f.save({ revision: 'unconfigured', mode: 'follow' });
  assert.equal(selected.mode, 'follow');
  assert.equal(selected.runtime.status, 'disabled');
  const bytes = await readFile(join(f.directory, 'dfsc.host.json'));
  await writeFile(join(f.directory, 'dfsc.host.json'), Buffer.concat([bytes, Buffer.from('\n')]));
  await assert.rejects(f.service.hostSettings({ ref: f.ref }), /stale/);
});
