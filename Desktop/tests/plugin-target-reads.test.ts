import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Session } from 'node:inspector';
import { lstat, mkdir, readFile, readdir, realpath, rename, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CapabilityService } from '../electron/capability-service';
import { PluginConfigurationStore, type ConfigurationDescriptor } from '../electron/plugin-configuration.mjs';
import { packageFingerprint, PluginFileError, writeReceipts } from '../electron/plugin-files.mjs';
import { PluginHostBindingStore } from '../electron/plugin-host-contract.mjs';
import { PluginLibrary, type PluginReferenceSnapshot } from '../electron/plugin-library.mjs';
import { verifyPackage, withVerifiedPackage, type PackageReadScope } from '../electron/plugin-read-scope.mjs';
import type { RpcProcess } from '../electron/runtime';
import type { CapabilityCatalog } from '../src/capabilities';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

type Receipt = {
  id: string; folder: string; instance: string; source: string; marketplace: string;
  fingerprint: string; state: 'installed' | 'pending' | 'removing';
};
type Target = { directory: string; receipt: Receipt };
type TargetInput = { descriptor: PluginReferenceSnapshot['descriptor']; mcp: boolean };

async function fingerprintCalls<T>(action: () => Promise<T>) {
  const session = new Session();
  session.connect();
  const name = `dfsc-fingerprint-${randomUUID()}`, probe = { target: packageFingerprint, calls: 0 };
  Object.defineProperty(globalThis, name, { configurable: true, value: probe });
  const post = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
  try {
    await post('Debugger.enable');
    const target = await post('Runtime.evaluate', {
      expression: `globalThis[${JSON.stringify(name)}].target`,
    }) as { result: { objectId: string } };
    // Count actual function entries instead of V8's async coverage ranges.
    await post('Debugger.setBreakpointOnFunctionCall', { objectId: target.result.objectId,
      condition: `(globalThis[${JSON.stringify(name)}].calls++, false)` });
    const value = await action();
    return { value, calls: probe.calls };
  } finally {
    try { await post('Debugger.disable'); }
    finally {
      Reflect.deleteProperty(globalThis, name);
      session.disconnect();
    }
  }
}

async function json(root: string, path: string, value: unknown) {
  await writeFile(join(root, path), JSON.stringify(value));
}

async function fixture(t: test.TestContext) {
  const created = await mkdtemp(join(tmpdir(), 'dfsc-target-reads-'));
  const root = await realpath(created);
  const targets = new Map<string, Target>();
  await mkdir(join(root, 'desktop-plugins'));
  const saveReceipts = () => writeReceipts(root, {
    version: 1, installations: [...targets.values()].map(target => target.receipt),
  });
  for (const folder of ['example', 'other']) {
    const directory = join(root, 'plugins', folder);
    await mkdir(join(directory, 'docs'), { recursive: true });
    await json(directory, 'step.plugin.json', {
      id: folder, name: folder, version: '1.0.0', repository: 'https://github.com/example/verified',
      skills: [], commands: [], agents: [],
      mcpServers: { notes: { command: 'node', args: ['server.mjs'],
        env: { STEPFUN_API_KEY: 'DFSC_INDEPENDENT_PLUGIN' } } },
    });
    await json(directory, 'dfsc.plugin.json', {
      schemaVersion: 1, desktop: { title: folder, surface: 'main-view',
        pages: [{ id: 'start', title: 'Start', document: 'README.md' }],
        connection: { protocol: 'agent-bridge-v1' } },
    });
    await json(directory, 'dfsc.settings.json', {
      schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'notes' },
      groups: [{ id: 'connection', title: 'Connection', fields: [
        { id: 'prefix', label: 'Prefix', type: 'text', default: 'Original' },
        { id: 'key', label: 'Key', type: 'secret' },
      ] }],
    });
    await json(directory, 'dfsc.host.json', {
      schemaVersion: 1, hostApiVersion: 1, consumer: { kind: 'mcp-stdio', server: 'notes' },
      capabilities: ['model.text'],
    });
    await writeFile(join(directory, 'README.md'), '# Guide A\n[Next](docs/NEXT.md)');
    await writeFile(join(directory, 'docs/NEXT.md'), '# Next');
    await writeFile(join(directory, 'PRIVATE.md'), '# Private');
    await writeFile(join(directory, 'SECRET.md'), '# Secret');
    targets.set(folder, { directory, receipt: { id: folder, folder, instance: randomUUID(),
      source: 'fixture-source', marketplace: 'fixture', state: 'installed',
      fingerprint: await packageFingerprint(directory) } });
  }
  await saveReceipts();
  const state = {
    mcp: undefined as CapabilityCatalog['mcp'] | undefined,
    navigationRepository: undefined as string | undefined,
    onTarget: undefined as ((input: TargetInput, count: number) => Promise<void>) | undefined,
    onHostStatus: undefined as (() => Promise<void>) | undefined,
    onStop: undefined as (() => Promise<void>) | undefined,
    invalidations: 0, statusReads: 0, stopped: 0, targetReads: 0,
  };
  const calls: { type: string; input?: TargetInput }[] = [];
  const descriptor = (target: Target): PluginReferenceSnapshot['descriptor'] => ({
    root: target.directory, kind: 'installed', name: target.receipt.folder, id: target.receipt.id,
    fingerprint: target.receipt.fingerprint, instance: target.receipt.instance,
    provenance: target.receipt.state === 'installed' ? 'recorded' : 'unknown',
    source: target.receipt.source, marketplace: target.receipt.marketplace,
  });
  const entry = async (target: Target, navigation = false) => {
    const manifest = JSON.parse(await readFile(join(target.directory, 'step.plugin.json'), 'utf8'));
    return { id: target.receipt.id, name: target.receipt.folder, version: manifest.version,
      mcpServers: ['notes'], warnings: [],
      repository: navigation && state.navigationRepository ? state.navigationRepository : manifest.repository,
      packageDescriptor: descriptor(target) };
  };
  const raw = async (selected: Target[], mcp = false, navigation = false) => ({
    plugins: await Promise.all(selected.map(target => entry(target, navigation))),
    available: [], marketplaces: [], skills: [], warnings: [],
    mcp: mcp ? state.mcp ?? selected.map(target => ({
      name: `${target.receipt.id}__notes`, source: 'plugin', pluginId: target.receipt.id,
      transport: 'stdio', enabled: true, configurable: true,
    })) : [],
  }) as unknown as CapabilityCatalog;
  const service = new CapabilityService({ root, node: 'unused', runtime: 'unused', environment: () => ({}),
    hostAvailable: () => true,
    hostStatus: async () => { state.statusReads++; await state.onHostStatus?.(); return { status: 'no-session' }; },
    beforePluginMutation: () => { state.invalidations++; },
    fetchRepository: async () => assert.fail('Target reads must not fetch repository statistics'),
    createWorker: () => ({
      start() {},
      async stopManagement() { state.stopped++; await state.onStop?.(); },
      async request(type: string, args: { input?: TargetInput }, timeout: number) {
        assert.equal(timeout, 30000);
        calls.push({ type, ...(args.input ? { input: structuredClone(args.input) } : {}) });
        if (type === 'desktop-catalog') return raw([...targets.values()], false, true);
        assert.equal(type, 'target-catalog', 'Target actions must never request the full catalog');
        const input = args.input!;
        assert.deepEqual(Object.keys(input).sort(), ['descriptor', 'mcp']);
        const count = ++state.targetReads;
        await state.onTarget?.(input, count);
        const target = targets.get(input.descriptor.name);
        assert.ok(target);
        return raw([target], input.mcp);
      },
    } as unknown as RpcProcess),
  });
  t.after(async () => { try { await service.stop(); } finally { await removeTestProfile(created); } });
  const library = (service as unknown as { library: PluginLibrary }).library;
  const menu = async () => {
    const catalog = await service.desktopCatalog();
    return new Map(catalog.plugins.map(plugin => [plugin.id, plugin.package!.ref]));
  };
  return { root, service, library, targets, state, calls, menu, saveReceipts, descriptor };
}

test('a partial menu grants no documents and verified target upgrades ignore transient metadata pollution', async t => {
  const f = await fixture(t), target = f.targets.get('example')!;
  f.state.navigationRepository = 'https://github.com/example/unverified';
  const ref = (await f.menu()).get('example')!;
  await assert.rejects(f.library.document({ ref, path: 'README.md' }), /invalid-path/);
  const metadata = await readFile(join(target.directory, 'dfsc.plugin.json'));
  await json(target.directory, 'dfsc.plugin.json', {
    schemaVersion: 1, documentation: { readme: 'PRIVATE.md' },
    desktop: { title: 'Unverified', surface: 'main-view',
      pages: [{ id: 'private', title: 'Private', document: 'SECRET.md' }] },
  });
  assert.equal((await f.menu()).get('example'), ref);
  await writeFile(join(target.directory, 'dfsc.plugin.json'), metadata);
  for (const path of ['PRIVATE.md', 'SECRET.md'])
    await assert.rejects(f.service.document({ ref, path }), /invalid-path/);
  assert.equal((await f.service.desktop(ref)).package!.ref, ref);
  assert.equal((await f.service.document({ ref, path: 'README.md' })).text, '# Guide A\n[Next](docs/NEXT.md)');
  assert.equal((await f.service.document({ ref, path: 'docs/NEXT.md' })).text, '# Next');
  assert.deepEqual(await f.service.repositoryInfo({ ref, refresh: false }), { status: 'unknown' });
  assert.equal(f.library.referenceSnapshot(ref).descriptor.repository, 'https://github.com/example/verified');
  assert.ok(f.calls.filter(call => call.type === 'target-catalog').every(call => call.input!.mcp === false));
});

test('verified target projections retain other references and stable connection identities', async t => {
  const f = await fixture(t), refs = await f.menu();
  const first = refs.get('example')!, second = refs.get('other')!;
  for (const ref of [first, second, first]) {
    assert.equal((await f.service.desktop(ref)).package!.ref, ref);
    assert.equal((await f.service.document({ ref, path: 'README.md' })).path, 'README.md');
  }
  assert.ok(f.library.referenceSnapshot(first));
  assert.ok(f.library.referenceSnapshot(second));
  const key = await f.service.connection(first);
  assert.match(key, /^[a-f0-9]{64}$/u);
  assert.equal(await f.service.connection(first), key);
  assert.notEqual(await f.service.connection(second), key);
});

for (const change of ['instance', 'source', 'marketplace', 'state'] as const) {
  test(`a changed ${change} identity revokes the old reference even after identity restoration`, async t => {
    const f = await fixture(t), target = f.targets.get('example')!;
    const ref = (await f.menu()).get('example')!, original = { ...target.receipt };
    if (change === 'instance') target.receipt.instance = randomUUID();
    else if (change === 'state') target.receipt.state = 'pending';
    else target.receipt[change] = 'replacement';
    await f.saveReceipts();
    await assert.rejects(f.service.desktop(ref), /stale/);
    Object.assign(target.receipt, original);
    await f.saveReceipts();
    const reads = f.state.targetReads;
    await assert.rejects(f.service.document({ ref, path: 'README.md' }), /stale/);
    assert.equal(f.state.targetReads, reads, 'A revoked reference cannot issue another management read');
    const fresh = (await f.menu()).get('example')!;
    assert.notEqual(fresh, ref);
    assert.equal((await f.service.desktop(fresh)).package!.ref, fresh);
  });
}

test('same-size tampering is rechecked after a successful operation and restoring bytes cannot resurrect its reference', async t => {
  const f = await fixture(t), target = f.targets.get('example')!;
  const ref = (await f.menu()).get('example')!, path = join(target.directory, 'README.md');
  assert.ok(await f.service.document({ ref, path: 'README.md' }));
  const original = await readFile(path), stat = await lstat(path);
  await writeFile(path, original.toString('utf8').replace('Guide A', 'Guide B'));
  await utimes(path, stat.atime, stat.mtime);
  assert.equal((await lstat(path)).size, stat.size);
  await assert.rejects(f.service.document({ ref, path: 'README.md' }), /stale/);
  await writeFile(path, original);
  await assert.rejects(f.service.desktop(ref), /stale/);
});

test('disabled configuration and host reads remain inert while consumer conflicts cannot write or revoke valid references', async t => {
  const f = await fixture(t), ref = (await f.menu()).get('example')!;
  const server: CapabilityCatalog['mcp'][number] = { name: 'example__notes', source: 'plugin',
    pluginId: 'example', transport: 'stdio', enabled: false, configurable: true };
  f.state.mcp = [server];
  const before = await readdir(join(f.root, 'desktop-plugins'), { recursive: true });
  assert.equal((await f.service.configuration({ ref })).configured, false);
  assert.equal((await f.service.hostSettings({ ref })).runtime.status, 'disabled');
  assert.equal(f.state.statusReads, 0);
  for (const conflict of [
    [{ ...server, source: 'user' as const }],
    [server, { ...server, pluginId: 'other' }],
    [{ ...server, transport: 'http' as const }],
  ]) {
    f.state.mcp = conflict;
    await assert.rejects(f.service.configuration({ ref }), /configuration-consumer-conflict/);
    await assert.rejects(f.service.hostSettings({ ref }, { ref, revision: 'unconfigured', mode: 'follow' }),
      /configuration-consumer-conflict/);
    assert.ok(f.library.referenceSnapshot(ref), 'A consumer validation failure does not revoke an unchanged package');
  }
  f.state.mcp = [server];
  await assert.rejects(f.service.hostSettings({ ref }, { ref, revision: 'outdated', mode: 'follow' }), /stale-configuration/);
  assert.equal((await f.service.hostSettings({ ref })).runtime.status, 'disabled');
  assert.deepEqual(await readdir(join(f.root, 'desktop-plugins'), { recursive: true }), before);
  assert.equal(f.state.invalidations, 0);
});

for (const mode of ['configuration', 'follow', 'independent'] as const) {
  test(`${mode} saves return their committed revision without a post-commit target worker`, async t => {
    const f = await fixture(t), target = f.targets.get('example')!;
    const ref = (await f.menu()).get('example')!;
    let unexpectedWorker = 0;
    f.state.onTarget = async (_input, count) => {
      if (count > 1) {
        unexpectedWorker++;
        throw new Error('A committed save must not start another target read');
      }
    };
    f.state.onStop = async () => {
      if (f.state.targetReads > 1) throw new Error('The unexpected post-commit worker cannot confirm exit');
    };
    const configuration = { ref, revision: 'unconfigured', values: { prefix: 'Saved' },
      secrets: { key: { action: 'replace' as const, value: 'fixture-secret' } } };
    const saved = mode === 'configuration' ? await f.service.configuration({ ref }, configuration)
      : await f.service.hostSettings({ ref }, { ref, revision: 'unconfigured', mode,
        ...(mode === 'independent' ? { configuration } : { models: {} }) });
    assert.notEqual(saved.revision, 'unconfigured');
    assert.equal(unexpectedWorker, 0);
    assert.equal(f.state.targetReads, 1);
    assert.equal(f.calls.filter(call => call.type === 'target-catalog').length, 1);
    assert.equal(f.state.stopped, 2, 'Only the menu and pre-commit target worker are stopped');
    assert.equal(f.state.invalidations, 1);
    assert.ok(f.library.referenceSnapshot(ref));
    if (mode !== 'follow') {
      const binding = JSON.parse(await readFile(join(f.root, 'desktop-plugins/bindings/example.json'), 'utf8'));
      const snapshot = JSON.parse(await readFile(join(f.root,
        `desktop-plugins/settings/${target.receipt.instance}/${binding.revision}.json`), 'utf8'));
      assert.equal(snapshot.values.prefix, 'Saved');
      assert.equal(snapshot.secrets.key, 'fixture-secret');
      assert.equal(binding.revision, mode === 'configuration' ? saved.revision
        : 'independent' in saved ? saved.independent!.revision : undefined);
    }
    if (mode !== 'configuration') {
      const pointer = JSON.parse(await readFile(join(f.root,
        `desktop-plugins/host/bindings/${target.receipt.instance}.json`), 'utf8'));
      const selection = JSON.parse(await readFile(join(f.root,
        `desktop-plugins/host/selections/${target.receipt.instance}/${pointer.revision}.json`), 'utf8'));
      assert.equal(pointer.revision, saved.revision);
      assert.equal(selection.mode, mode);
      assert.equal('configurationCurrent' in saved && saved.configurationCurrent, true);
      assert.deepEqual(selection.models, {});
      assert.equal(selection.configurationRevision, mode === 'independent'
        && 'independent' in saved ? saved.independent!.revision : null);
    }
    assert.doesNotMatch(JSON.stringify(saved), /fixture-secret/);
  });
}

for (const mode of ['configuration', 'follow', 'independent'] as const) {
  test(`${mode} saves distinguish a confirmed commit from a failed final integrity check`, async t => {
    const f = await fixture(t), target = f.targets.get('example')!;
    const ref = (await f.menu()).get('example')!, path = join(target.directory, 'README.md');
    const original = await readFile(path);
    const stores = f.service as unknown as {
      configurations: PluginConfigurationStore; hostBindings: PluginHostBindingStore;
    };
    let committedRevision = '';
    if (mode === 'configuration') {
      const save = stores.configurations.save.bind(stores.configurations);
      stores.configurations.save = async (descriptor, input) => {
        const result = await save(descriptor, input);
        committedRevision = result.revision;
        await writeFile(path, '# Changed after confirmed configuration commit');
        return result;
      };
    } else {
      const select = stores.hostBindings.select.bind(stores.hostBindings);
      stores.hostBindings.select = async (descriptor, input) => {
        const result = await select(descriptor, input);
        committedRevision = result.revision;
        await writeFile(path, '# Changed after confirmed host selection commit');
        return result;
      };
    }
    const configuration = { ref, revision: 'unconfigured', values: { prefix: 'Committed' },
      secrets: { key: { action: 'replace' as const, value: 'fixture-committed-secret' } } };
    const checked = await fingerprintCalls(async () => {
      await assert.rejects(mode === 'configuration' ? f.service.configuration({ ref }, configuration)
        : f.service.hostSettings({ ref }, { ref, revision: 'unconfigured', mode,
          ...(mode === 'independent' ? { configuration } : { models: {} }) }),
      { message: 'capability:settings-committed-unverified' });
    });
    assert.notEqual(committedRevision, '', 'Only a successful store return can confirm the commit');
    assert.ok(checked.calls >= 2, 'The final package hash must not be skipped after a commit');
    assert.equal(f.state.targetReads, 1, 'Saving still creates no post-commit target worker');
    assert.throws(() => f.library.referenceSnapshot(ref), /stale/);
    const pointerPath = mode === 'configuration' ? 'desktop-plugins/bindings/example.json'
      : `desktop-plugins/host/bindings/${target.receipt.instance}.json`;
    const committedPointer = await readFile(join(f.root, pointerPath));
    assert.equal(JSON.parse(committedPointer.toString('utf8')).revision, committedRevision);
    await writeFile(path, original);
    await assert.rejects(f.service.configuration({ ref }), /stale/);
    const fresh = (await f.menu()).get('example')!;
    assert.notEqual(fresh, ref, 'Restoring package bytes must not resurrect a revoked reference');
    const saved = mode === 'configuration' ? await f.service.configuration({ ref: fresh })
      : await f.service.hostSettings({ ref: fresh });
    assert.equal(saved.revision, committedRevision, 'A fresh read confirms the already-saved revision without resubmission');
    if ('values' in saved) assert.equal(saved.values.prefix, 'Committed');
    else assert.equal(saved.mode, mode);
    assert.deepEqual(await readFile(join(f.root, pointerPath)), committedPointer);
    assert.doesNotMatch(JSON.stringify(saved), /fixture-committed-secret/);
  });
}

for (const tampered of [false, true]) {
  test(`a failed save action ${tampered ? 'with changed bytes' : 'before commit'} cannot claim a confirmed commit`, async t => {
    const f = await fixture(t), target = f.targets.get('example')!, ref = (await f.menu()).get('example')!;
    const path = join(target.directory, 'README.md'), original = await readFile(path);
    const configurations = (f.service as unknown as { configurations: PluginConfigurationStore }).configurations;
    configurations.save = async () => {
      if (tampered) await writeFile(path, '# Changed before an action failure');
      throw new Error('capability:invalid-configuration');
    };
    const checked = await fingerprintCalls(async () => {
      await assert.rejects(f.service.configuration({ ref }, {
        ref, revision: 'unconfigured', values: { prefix: 'Never committed' }, secrets: { key: { action: 'keep' } },
      }), { message: `capability:${tampered ? 'stale' : 'invalid-configuration'}` });
    });
    assert.equal(checked.calls, 2, 'An action error still runs both scope hashes');
    await assert.rejects(readFile(join(f.root, 'desktop-plugins/bindings/example.json')), { code: 'ENOENT' });
    if (tampered) {
      await writeFile(path, original);
      assert.throws(() => f.library.referenceSnapshot(ref), /stale/);
    } else assert.ok(f.library.referenceSnapshot(ref));
  });
}

for (const operation of ['configuration', 'hostSettings', 'document', 'desktop', 'connection', 'repositoryInfo'] as const) {
  test(`each ${operation} read hashes its target twice and does not cache the next operation`, async t => {
    const f = await fixture(t), ref = (await f.menu()).get('example')!;
    const read = async (): Promise<unknown> => operation === 'configuration' ? f.service.configuration({ ref })
      : operation === 'hostSettings' ? f.service.hostSettings({ ref })
        : operation === 'document' ? f.service.document({ ref, path: 'README.md' })
          : operation === 'repositoryInfo' ? f.service.repositoryInfo({ ref, refresh: false })
            : f.service[operation](ref);
    for (let index = 0; index < 2; index++) {
      const current = await fingerprintCalls(read);
      assert.equal(current.calls, 2);
    }
    const targets = f.calls.filter(call => call.type === 'target-catalog');
    assert.equal(targets.length, 4, 'Each operation revalidates target identity on entry and exit');
    assert.ok(targets.every(call => call.input!.mcp === ['configuration', 'hostSettings'].includes(operation)));
    assert.equal(f.state.invalidations, 0);
  });
}

test('read scopes cannot be forged, transferred to another descriptor or reused after their awaited operation', async t => {
  const f = await fixture(t), refs = await f.menu(), ref = refs.get('example')!;
  await f.service.desktop(ref);
  const descriptor = { ...f.descriptor(f.targets.get('example')!), ref } as ConfigurationDescriptor;
  const other = { ...f.descriptor(f.targets.get('other')!), ref: refs.get('other')! } as ConfigurationDescriptor;
  const configurations = new PluginConfigurationStore(f.root), bindings = new PluginHostBindingStore(f.root);
  const forged = Object.freeze({}) as PackageReadScope;
  await assert.rejects(verifyPackage(descriptor, forged), /stale/);
  await assert.rejects(configurations.read(descriptor, forged), /stale/);
  await assert.rejects(bindings.current(descriptor, forged), /stale/);
  let leaked!: PackageReadScope;
  await withVerifiedPackage(descriptor, async scope => {
    leaked = scope;
    assert.equal((await configurations.read(descriptor, scope)).configured, false);
    assert.equal((await bindings.current(descriptor, scope)).revision, 'unconfigured');
    assert.equal((await f.library.document({ ref, path: 'README.md' }, scope)).path, 'README.md');
    await assert.rejects(verifyPackage(other, scope), /stale/);
    for (const changed of [
      { ...descriptor, source: 'other-source' }, { ...descriptor, marketplace: 'other-market' },
      { ...descriptor, instance: randomUUID() }, { ...descriptor, provenance: 'unknown' },
      { ...descriptor, fingerprint: '0'.repeat(64) },
    ]) await assert.rejects(verifyPackage(changed, scope), /stale/);
  });
  await assert.rejects(verifyPackage(descriptor, leaked), /stale/);
  await assert.rejects(configurations.read(descriptor, leaked), /stale/);
  await assert.rejects(bindings.current(descriptor, leaked), /stale/);
  await withVerifiedPackage(descriptor, async scope => {
    assert.notEqual(scope, leaked);
    await assert.rejects(verifyPackage(descriptor, leaked), /stale/);
    await verifyPackage(descriptor, scope);
  });
  await assert.rejects(f.library.document({ ref, path: 'README.md' }, forged), /stale/);
});

test('read scopes reject descriptor mutation and package changes before exporting an operation result', async t => {
  const f = await fixture(t), target = f.targets.get('example')!;
  const descriptor = { ...f.descriptor(target), ref: 'scope-fixture' } as ConfigurationDescriptor;
  const changed = { ...descriptor };
  await assert.rejects(withVerifiedPackage(changed, async () => {
    changed.name = 'replacement';
    return 'must-not-escape';
  }), /stale/);
  const path = join(target.directory, 'README.md'), original = await readFile(path);
  let leaked!: PackageReadScope;
  await assert.rejects(withVerifiedPackage(descriptor, async scope => {
    leaked = scope;
    await writeFile(path, '# Changed before export');
    return 'must-not-escape';
  }), /stale/);
  await writeFile(path, original);
  await assert.rejects(verifyPackage(descriptor, leaked), /stale/);
  await assert.rejects(withVerifiedPackage(descriptor, async scope => {
    leaked = scope;
    await writeFile(path, '# Changed before an action error');
    throw new Error('capability:invalid-input');
  }), /stale/);
  await writeFile(path, original);
  await assert.rejects(verifyPackage(descriptor, leaked), /stale/);
});

test('an action validation error still checks changed metadata and revokes the service reference', async t => {
  const f = await fixture(t), target = f.targets.get('example')!;
  const ref = (await f.menu()).get('example')!;
  const path = join(target.directory, 'dfsc.plugin.json'), original = await readFile(path);
  const document = f.library.document.bind(f.library);
  f.library.document = async (input, scope) => {
    await json(target.directory, 'dfsc.plugin.json', {
      schemaVersion: 1, documentation: { readme: 'PRIVATE.md' },
    });
    return document(input, scope);
  };
  await assert.rejects(f.service.document({ ref, path: 'NOT-DECLARED.md' }), /stale/);
  assert.equal(f.state.targetReads, 1, 'The action error exits through the scope check, not another target worker');
  await writeFile(path, original);
  assert.throws(() => f.library.referenceSnapshot(ref), /stale/);
  await assert.rejects(f.service.document({ ref, path: 'README.md' }), /stale/);
});

for (const failure of ['ENOENT', 'invalid-path'] as const) {
  test(`an exit-time ${failure} failure overrides an action error and revokes the old reference`, async t => {
    const f = await fixture(t), target = f.targets.get('example')!, ref = (await f.menu()).get('example')!;
    const moved = join(f.root, 'moved-example'), actionError = new Error('capability:invalid-input');
    f.library.document = async () => {
      await rename(target.directory, moved);
      if (failure === 'invalid-path') await symlink(moved, target.directory, 'junction');
      throw actionError;
    };
    try {
      const checked = await fingerprintCalls(async () => {
        await assert.rejects(f.service.document({ ref, path: 'README.md' }), (error: unknown) => {
          assert.notEqual(error, actionError, 'The final scope check must replace the action error');
          assert.equal((error as NodeJS.ErrnoException).code, failure);
          return true;
        });
      });
      assert.equal(checked.calls, 2, 'Both scope hashes still run when the action fails');
      assert.equal(f.state.targetReads, 1, 'An action failure does not add another target worker');
      assert.throws(() => f.library.referenceSnapshot(ref), /stale/);
    } finally {
      if (failure === 'invalid-path') await unlink(target.directory);
      await rename(moved, target.directory);
    }
    assert.throws(() => f.library.referenceSnapshot(ref), /stale/, 'Restoring the package cannot resurrect its old reference');
    assert.notEqual((await f.menu()).get('example'), ref);
  });

  test(`an unchanged-package action's original ${failure} error does not revoke its reference`, async t => {
    const f = await fixture(t), ref = (await f.menu()).get('example')!;
    const actionError = failure === 'ENOENT'
      ? Object.assign(new Error('Action resource is missing'), { code: 'ENOENT' }) : new PluginFileError('invalid-path');
    f.library.document = async () => { throw actionError; };
    const checked = await fingerprintCalls(async () => {
      await assert.rejects(f.service.document({ ref, path: 'README.md' }), (error: unknown) => error === actionError);
    });
    assert.equal(checked.calls, 2);
    assert.ok(f.library.referenceSnapshot(ref), 'A normal action failure leaves the verified reference usable');
  });
}

for (const change of ['identity', 'bytes'] as const) {
  test(`the service rejects an exit-time ${change} change and permanently revokes the old reference`, async t => {
    const f = await fixture(t), target = f.targets.get('example')!;
    const ref = (await f.menu()).get('example')!, receipt = { ...target.receipt };
    const path = join(target.directory, 'README.md'), original = await readFile(path);
    if (change === 'identity') f.state.onTarget = async (_input, count) => {
      if (count === 2) {
        target.receipt.instance = randomUUID();
        await f.saveReceipts();
      }
    };
    else f.state.onHostStatus = async () => { await writeFile(path, '# Changed before export'); };
    await assert.rejects(f.service.hostSettings({ ref }), /stale/);
    Object.assign(target.receipt, receipt);
    await f.saveReceipts();
    await writeFile(path, original);
    f.state.onTarget = undefined;
    f.state.onHostStatus = undefined;
    await assert.rejects(f.service.hostSettings({ ref }), /stale/);
    assert.equal(f.state.invalidations, 0);
  });
}
