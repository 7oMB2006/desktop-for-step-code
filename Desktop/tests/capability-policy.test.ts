import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService } from '../electron/capability-service';
import { capabilityPolicy, type CapabilityPolicy } from '../electron/capability-policy';
import { packageFingerprint } from '../electron/plugin-files.mjs';
import { RpcManagementStopError, type RpcProcess } from '../electron/runtime';
import type { CapabilityMutation } from '../src/capabilities';

const actions: CapabilityMutation['action'][] = [
  'marketplace-add', 'marketplace-update', 'marketplace-remove', 'plugin-check-updates',
  'plugin-install', 'plugin-remove', 'plugin-update', 'plugin-toggle',
  'mcp-toggle', 'skill-create', 'skill-toggle', 'skill-remove',
];

test('every action has a fail-closed trusted scope; only verified package operations can become themes', () => {
  for (const action of actions) {
    const discovery = action.startsWith('marketplace-') || action === 'plugin-check-updates';
    assert.equal(capabilityPolicy(action).scope, discovery ? 'discovery' : 'runtime');
    assert.equal(capabilityPolicy(action, 'theme').scope,
      ['plugin-install', 'plugin-remove', 'plugin-update'].includes(action) ? 'theme' : discovery ? 'discovery' : 'runtime');
    assert.equal(Object.isFrozen(capabilityPolicy(action)), true);
  }
  for (const action of ['constructor', '__proto__', 'future-action', undefined])
    assert.throws(() => capabilityPolicy(action as any), /invalid-input/);
});

async function fixture(t: test.TestContext, guardRecovery?: (id: string) => Promise<void | (() => void)>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-operation-policy-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const calls: { type: string; args: any }[] = [];
  let workers = 0, stops = 0, invalidations = 0;
  let catalog: any = { plugins: [], available: [], mcp: [], skills: [], marketplaces: [], warnings: [] };
  let requestHook = async (_type: string, _args: any): Promise<any> => undefined;
  let stopHook = async () => {};
  const service = new CapabilityService({
    root, node: 'never-spawn', runtime: root, environment: () => ({}), guardRecovery,
    beforePluginMutation: () => { invalidations++; },
    createWorker: () => {
      workers++;
      return {
        start() {},
        async request(type: string, args: any) {
          calls.push({ type, args });
          const value = await requestHook(type, args);
          return value ?? (type === 'catalog' ? catalog : { warnings: [] });
        },
        async stopManagement() { stops++; await stopHook(); },
      } as unknown as RpcProcess;
    },
  });
  const theme = async (directory: string, version = '1.0.0') => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'step.plugin.json'), JSON.stringify({
      id: 'theme', name: 'Theme', version, skills: [], commands: [], agents: [],
    }));
    await writeFile(join(directory, 'dfsc.theme.json'), '{"schemaVersion":1,"renderer":"stellar-v1"}');
    return packageFingerprint(directory);
  };
  return {
    root, service, calls, theme, workers: () => workers, stops: () => stops, invalidations: () => invalidations,
    setCatalog(value: any) { catalog = value; },
    setRequest(hook: typeof requestHook) { requestHook = hook; },
    setStop(hook: typeof stopHook) { stopHook = hook; },
  };
}

test('discovery has no runtime guard even while its network request is pending', async t => {
  const f = await fixture(t);
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let settingsLocked = false;
  f.setRequest(async type => { if (type === 'mutate') { entered(); await pending; } });
  const operation = f.service.mutate({ action: 'marketplace-update', name: 'fixture' }, async policy => {
    settingsLocked = policy.scope === 'runtime';
    assert.equal(policy.scope, 'discovery');
    return () => { settingsLocked = false; };
  });
  await started;
  // Remote submit/approval must see the lock as free throughout the awaited work.
  assert.equal(settingsLocked, false);
  finish();
  await operation;
  assert.equal(settingsLocked, false);
  assert.equal(f.calls.find(call => call.type === 'mutate')?.args.input.preserveRuntime, true);
  assert.equal(f.invalidations(), 0, 'discovery does not revoke a live host lease');
});

test('theme removal does not consult session task state and releases its resource guard after completion', async t => {
  const f = await fixture(t);
  await f.theme(join(f.root, 'plugins/theme'));
  const events: string[] = [];
  f.setRequest(async type => { if (type === 'mutate') events.push('commit'); });
  await f.service.mutate({ action: 'plugin-remove', id: 'theme' }, async policy => {
    assert.deepEqual(policy, { scope: 'theme', pluginId: 'theme' });
    events.push('resource-guard');
    return () => { events.push('release'); };
  });
  assert.deepEqual(events, ['resource-guard', 'commit', 'release']);
  assert.ok(f.calls.find(call => call.type === 'mutate')?.args.input.expectedFingerprint);
  assert.equal(f.invalidations(), 0, 'data-only theme removal preserves host leases');
});

test('theme update requires frozen installed and candidate proof from the same recorded source', async t => {
  const f = await fixture(t);
  const oldRoot = join(f.root, 'plugins/theme'), newRoot = join(f.root, 'marketplaces/fixture/theme');
  const oldFingerprint = await f.theme(oldRoot), fingerprint = await f.theme(newRoot, '1.1.0');
  const descriptor = { id: 'theme', name: 'theme', marketplace: 'fixture', source: 'same-source', provenance: 'recorded' };
  f.setCatalog({
    plugins: [{ id: 'theme', name: 'Theme', version: '1.0.0', packageDescriptor: {
      ...descriptor, kind: 'installed', root: oldRoot, fingerprint: oldFingerprint, instance: 'fixture-instance',
    } }],
    available: [{ id: 'theme', name: 'theme', marketplace: 'fixture', version: '1.1.0', packageDescriptor: {
      ...descriptor, kind: 'available', root: newRoot, fingerprint,
    } }],
    mcp: [], skills: [], marketplaces: [], warnings: [],
  });
  const catalog = await f.service.catalog(), installed = catalog.plugins[0];
  assert.equal(installed.update?.status, 'available');
  const input = { action: 'plugin-update', id: 'theme', ref: installed.package!.ref, candidate: installed.update!.ref! } as const;
  await f.service.mutate(input, async policy => { assert.deepEqual(policy, { scope: 'theme', pluginId: 'theme' }); });
  const sent = f.calls.find(call => call.type === 'mutate')!.args.input;
  assert.equal(sent.expectedOldFingerprint, oldFingerprint);
  assert.equal(sent.expectedFingerprint, fingerprint);
  assert.equal(sent.preserveRuntime, true);
  assert.equal(f.invalidations(), 0);
});

test('unproven executable operations ignore renderer-supplied exemption flags', async t => {
  const f = await fixture(t);
  for (const input of [
    { action: 'plugin-install', name: 'theme', marketplace: 'fixture' },
    { action: 'plugin-toggle', id: 'theme', enabled: false },
    { action: 'mcp-toggle', name: 'theme__server', enabled: false },
    { action: 'skill-remove', id: 'fixture' },
  ]) {
    const sentinel = new Error('protected');
    await assert.rejects(f.service.mutate({ ...input, preserveRuntime: true, allowRemote: true } as any, async policy => {
      assert.equal(policy.scope, 'runtime'); throw sentinel;
    }), error => error === sentinel);
  }
  assert.equal(f.workers(), 0);
  assert.equal(f.invalidations(), 0, 'a refused guard cannot revoke a live lease');
});

test('admitted executable writes revoke host leases only after ownership checks and before mutation', async t => {
  const f = await fixture(t);
  await f.service.initialize();
  f.setRequest(async type => {
    if (type === 'mutate') assert.equal(f.invalidations(), 1);
  });
  await f.service.mutate({ action: 'mcp-toggle', name: 'example', enabled: false }, async policy => {
    assert.equal(policy.scope, 'runtime');
    assert.equal(f.invalidations(), 0);
  });
  assert.equal(f.invalidations(), 1);
  await f.service.catalog();
  assert.equal(f.invalidations(), 1, 'passive catalog reads do not revoke leases');
});

test('mutation input is frozen before queued discovery can await', async t => {
  const f = await fixture(t);
  const input = { action: 'marketplace-remove', name: 'original' } as const;
  const operation = f.service.mutate(input);
  (input as any).action = 'plugin-remove';
  (input as any).id = 'injected';
  await operation;
  assert.equal(f.calls.find(call => call.type === 'mutate')!.args.input.action, 'marketplace-remove');
});

test('a pending journal blocks mutation but catalog reads leave every recovery byte untouched', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'desktop-plugins'));
  const journal = join(f.root, 'desktop-plugins/update-transaction.json'), bytes = '{"invalid":"preserve evidence"}';
  await writeFile(journal, bytes);
  await assert.rejects(f.service.mutate({ action: 'marketplace-update', name: 'fixture' }), /update-recovery-required/);
  await f.service.catalog();
  assert.equal(await readFile(journal, 'utf8'), bytes);
  assert.deepEqual(f.calls.map(call => call.type), ['catalog']);
});

for (const committed of [true, false]) {
  test(`unconfirmed management exit quarantines queued writes (${committed ? 'committed' : 'unknown'} outcome)`, async t => {
    const f = await fixture(t);
    await f.service.initialize();
    f.setRequest(async type => { if (type === 'mutate' && !committed) throw new Error('timed out'); });
    f.setStop(async () => { throw new Error('child still running'); });
    const input = { action: 'marketplace-remove', name: 'fixture' } as const;
    const first = f.service.mutate(input), second = f.service.mutate(input);
    await assert.rejects(first, committed ? /management-committed/ : /management-uncertain/);
    await assert.rejects(second, /management-unavailable/);
    assert.equal(f.service.runtimeAvailable, true, 'uncertain discovery must not lock unrelated runtime I/O');
    assert.equal(f.calls.filter(call => call.type === 'mutate').length, 1);
    assert.equal(f.workers(), 2);
    f.setStop(async () => {});
    await f.service.stop();
  });
}

test('an unconfirmed executable writer quarantines runtime access as well as future management writes', async t => {
  const f = await fixture(t);
  await f.service.initialize();
  f.setRequest(async type => { if (type === 'mutate') throw new Error('timed out'); });
  f.setStop(async () => { throw new Error('child still running'); });
  await assert.rejects(f.service.mutate({
    action: 'skill-create', name: 'fixture', description: 'Fixture', instructions: 'Never execute.',
  }), /management-uncertain/);
  assert.equal(f.service.available, false);
  assert.equal(f.service.runtimeAvailable, false);
  f.setStop(async () => {});
  await f.service.stop();
  assert.equal(f.service.runtimeAvailable, false, 'cleanup alone cannot reconcile a partially written executable package');
});

for (const protectsRuntime of [false, true]) {
  test(`shutdown releases an exited management worker without lifting quarantine (runtime=${protectsRuntime})`, async t => {
    const f = await fixture(t);
    await f.service.initialize();
    const failure = new RpcManagementStopError('Management worker exited without shutdown acknowledgment', false, true);
    f.setStop(async () => { throw failure; });
    const input: CapabilityMutation = protectsRuntime
      ? { action: 'skill-create', name: 'fixture', description: 'Fixture', instructions: 'Never execute.' }
      : { action: 'marketplace-remove', name: 'fixture' };
    await assert.rejects(f.service.mutate(input), /management-committed/);
    const workers = f.workers(), stops = f.stops();
    await f.service.stop();
    assert.equal(f.stops(), stops + 1);
    await f.service.stop();
    assert.equal(f.stops(), stops + 1, 'an exited worker is released exactly once');
    assert.equal(f.service.available, false);
    assert.equal(f.service.runtimeAvailable, !protectsRuntime);
    await assert.rejects(f.service.mutate(input), /management-unavailable/);
    assert.equal(f.workers(), workers, 'shutdown cannot authorize a replacement management worker');
  });
}

for (const failure of [
  new RpcManagementStopError('Management worker is still running', true, false),
  Object.assign(new Error('Unverified exit claim'), { exitConfirmed: true }),
]) {
  test(`shutdown retains an unconfirmed management owner: ${failure.message}`, async t => {
    const f = await fixture(t);
    await f.service.initialize();
    f.setStop(async () => { throw failure; });
    await assert.rejects(f.service.mutate({ action: 'marketplace-remove', name: 'fixture' }), /management-committed/);
    const stops = f.stops();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await assert.rejects(f.service.stop(), error => error === failure);
      assert.equal(f.stops(), stops + attempt, 'failed shutdown keeps ownership available for retry');
    }
    assert.equal(f.service.available, false);
    f.setStop(async () => {});
    await f.service.stop();
    assert.equal(f.service.available, false);
  });
}

test('a rejected operation with confirmed cleanup does not poison later management writes', async t => {
  const f = await fixture(t);
  await f.service.initialize();
  f.setRequest(async type => { if (type === 'mutate') throw new Error('capability:stale'); });
  await assert.rejects(f.service.mutate({ action: 'marketplace-remove', name: 'fixture' }), /capability:stale/);
  f.setRequest(async () => undefined);
  await f.service.mutate({ action: 'marketplace-remove', name: 'fixture' });
  assert.equal(f.workers(), 3);
});

for (const succeeded of [true, false]) {
  test(`a runtime writer with an unfinished journal retains protection after clean exit (${succeeded ? 'success' : 'error'})`, async t => {
    const f = await fixture(t);
    await f.service.initialize();
    f.setRequest(async type => {
      if (type !== 'mutate') return;
      await mkdir(join(f.root, 'desktop-plugins'), { recursive: true });
      await writeFile(join(f.root, 'desktop-plugins/update-transaction.json'), '{"incomplete":"preserve"}');
      if (!succeeded) throw new Error('capability:update-recovery-required');
    });
    let protectedAtRelease = false;
    await assert.rejects(f.service.mutate({
      action: 'skill-create', name: 'fixture', description: 'Fixture', instructions: 'Never execute.',
    }, async () => () => { protectedAtRelease = !f.service.runtimeAvailable; }), /update-recovery-required/);
    assert.equal(protectedAtRelease, true);
    assert.equal(f.service.available, true, 'confirmed worker exit still permits read-only diagnostics');
    assert.equal(f.service.runtimeAvailable, false);
    await f.service.catalog();
  });
}

test('a pre-existing journal refusal does not claim that the runtime has been mutated', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'desktop-plugins'));
  await writeFile(join(f.root, 'desktop-plugins/update-transaction.json'), '{"incomplete":"preserve"}');
  await assert.rejects(f.service.mutate({
    action: 'skill-create', name: 'fixture', description: 'Fixture', instructions: 'Never execute.',
  }), /update-recovery-required/);
  assert.equal(f.service.runtimeAvailable, true);
  assert.equal(f.workers(), 0);
});

test('failed admitted recovery marks runtime unsafe before its guard releases', async t => {
  let protectedAtRelease = false;
  const f = await fixture(t, async id => {
    assert.equal(id, 'theme');
    return () => { protectedAtRelease = !f.service.runtimeAvailable; };
  });
  await mkdir(join(f.root, 'plugins'));
  await mkdir(join(f.root, 'desktop-plugins'));
  const previous = { instance: '00000000-0000-4000-8000-000000000001', id: 'theme', folder: 'theme',
    source: 'fixture', marketplace: 'fixture', state: 'installed', fingerprint: 'a'.repeat(64) };
  await writeFile(join(f.root, 'desktop-plugins/installations.json'), JSON.stringify({
    version: 1, installations: [previous],
  }));
  await writeFile(join(f.root, 'desktop-plugins/update-transaction.json'), JSON.stringify({
    version: 1, transaction: '00000000-0000-4000-8000-000000000002', phase: 'prepared',
    previous, next: { ...previous, fingerprint: 'b'.repeat(64) }, binding: null,
  }));
  await assert.rejects(f.service.recover(), /update-recovery-required/);
  assert.equal(protectedAtRelease, true);
  assert.equal(f.service.runtimeAvailable, false);
});
