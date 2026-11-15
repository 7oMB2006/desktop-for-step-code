import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CapabilityService } from '../electron/capability-service';
import { PluginLibrary } from '../electron/plugin-library.mjs';
import { packageFingerprint } from '../electron/plugin-files.mjs';
import type { RpcProcess } from '../electron/runtime';

const { createCapabilitySettings } = await import(pathToFileURL(resolve('electron/capability-settings.mjs')).href);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolveValue => { resolve = resolveValue; });
  return { promise, resolve };
}

async function within<T>(operation: Promise<T>, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-desktop-catalog-')));
  const previous = { HOME: process.env.HOME, STEPCODE_STORAGE_ROOT_DIR: process.env.STEPCODE_STORAGE_ROOT_DIR,
    STEP_CODING_AGENT_DIR: process.env.STEP_CODING_AGENT_DIR };
  Object.assign(process.env, { HOME: root, STEPCODE_STORAGE_ROOT_DIR: root, STEP_CODING_AGENT_DIR: join(root, 'agent') });
  await mkdir(join(root, 'desktop-plugins'));
  const manager = createCapabilitySettings({}, { root });
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const receipts: any[] = [];
  const save = () => writeFile(join(root, 'desktop-plugins/installations.json'),
    JSON.stringify({ version: 1, installations: receipts }));
  async function plugin(folder: string, id = folder, desktop = true) {
    const directory = join(root, 'plugins', folder);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'step.plugin.json'), JSON.stringify({
      id, name: folder, version: '1.0.0', skills: [], commands: [], agents: [], mcpServers: {},
    }));
    if (desktop) await writeFile(join(directory, 'dfsc.plugin.json'), JSON.stringify({
      schemaVersion: 1, desktop: { title: folder, surface: 'main-view',
        pages: [{ id: 'start', title: 'Start', document: 'README.md' }] },
    }));
    await writeFile(join(directory, 'README.md'), '# Initial content\n');
    const receipt = { instance: randomUUID(), folder, id, source: 'fixture', marketplace: 'fixture',
      fingerprint: await packageFingerprint(directory), state: 'installed' };
    receipts.push(receipt);
    await save();
    return { directory, receipt };
  }
  return { root, manager, receipts, save, plugin };
}

test('startup navigation never walks package dependencies or marketplace copies', async t => {
  const f = await fixture(t);
  const desktop = await f.plugin('desktop-tools');
  const irrelevant = await f.plugin('unrelated-tools', 'unrelated-tools', false);
  await mkdir(join(f.root, 'marketplaces'));
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  // A full fingerprint would reject these links. Menu discovery must not visit them.
  await symlink(outside, join(desktop.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(irrelevant.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(f.root, 'marketplaces', 'unused'), process.platform === 'win32' ? 'junction' : 'dir');
  const before = await readFile(join(f.root, 'desktop-plugins/installations.json'));
  const catalog = await f.manager.desktopCatalog();
  assert.deepEqual(catalog.plugins.map((value: any) => value.id), ['desktop-tools']);
  assert.equal(catalog.plugins[0].packageDescriptor.fingerprint, desktop.receipt.fingerprint);
  assert.deepEqual(catalog.available, []);
  assert.deepEqual(catalog.mcp, []);
  const projected = await new PluginLibrary(f.root).project(catalog, { partial: true });
  assert.equal(projected.plugins[0].package?.desktop?.surface, 'main-view');
  assert.doesNotMatch(JSON.stringify(projected), /packageDescriptor|fingerprint|rootPath|node_modules/);
  assert.deepEqual(await readFile(join(f.root, 'desktop-plugins/installations.json')), before);
});

test('navigation omits unknown, duplicate and incomplete installations', async t => {
  const f = await fixture(t);
  await f.plugin('recorded');
  await f.plugin('unknown');
  await f.plugin('duplicate-one', 'duplicate');
  await f.plugin('duplicate-two', 'duplicate');
  await f.plugin('pending');
  f.receipts.splice(f.receipts.findIndex(value => value.id === 'unknown'), 1);
  f.receipts.find(value => value.id === 'pending').state = 'pending';
  await f.save();
  assert.deepEqual((await f.manager.desktopCatalog()).plugins.map((value: any) => value.id), ['recorded']);
});

test('an inert menu entry never authorizes modified package documents', async t => {
  const f = await fixture(t);
  const plugin = await f.plugin('desktop-tools');
  const library = new PluginLibrary(f.root);
  const catalog = await f.manager.desktopCatalog();
  const initial = await library.project(catalog, { partial: true });
  const ref = initial.plugins[0].package!.ref;
  await assert.rejects(library.document({ ref, path: 'README.md' }), /invalid-path/);
  assert.equal(await packageFingerprint(plugin.directory), plugin.receipt.fingerprint);
  await library.project(catalog);
  assert.equal((await library.document({ ref, path: 'README.md' })).text, '# Initial content\n');
  await writeFile(join(plugin.directory, 'README.md'), '# Changed content\n');
  const menu = await library.project(await f.manager.desktopCatalog(), { partial: true });
  assert.equal(menu.plugins[0].package!.ref, ref);
  await assert.rejects(library.document({ ref, path: 'README.md' }), /stale/);
});

test('startup navigation uses only its narrow management RPC with a read timeout', async t => {
  const f = await fixture(t);
  await f.plugin('desktop-tools');
  const catalog = await f.manager.desktopCatalog();
  const calls: string[] = [];
  let stopped = 0;
  const service = new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => ({
      start() {},
      async request(type: string, _args: unknown, timeout: number) {
        calls.push(type);
        assert.equal(timeout, 30000);
        return catalog;
      },
      async stopManagement() { stopped++; },
    } as unknown as RpcProcess) });
  try {
    const result = await service.desktopCatalog();
    assert.equal(result.plugins[0].package?.desktop?.title, 'desktop-tools');
    assert.deepEqual(calls, ['desktop-catalog']);
    assert.equal(stopped, 1);
  } finally { await service.stop(); }
});

test('a pending navigation read does not queue session recovery or target host discovery', async t => {
  const f = await fixture(t);
  const plugin = await f.plugin('desktop-tools');
  const catalog = await f.manager.desktopCatalog();
  const descriptor = catalog.plugins[0].packageDescriptor;
  const started = deferred<void>();
  const response = deferred<typeof catalog>();
  const calls: string[] = [];
  const service = new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => ({
      start() {},
      async request(type: string) {
        calls.push(type);
        if (type === 'desktop-catalog') {
          started.resolve();
          return response.promise;
        }
        assert.equal(type, 'host-descriptor');
        return descriptor;
      },
      async stopManagement() {},
    } as unknown as RpcProcess) });
  const menu = service.desktopCatalog();
  try {
    await within(started.promise, 'The navigation worker did not start');
    const host = service.withHostDescriptor('desktop-tools', plugin.directory, 'example', async value => value.id);
    await within(Promise.all([service.recover(), host]),
      'An optional navigation read must not hold session recovery or target host discovery');
    assert.deepEqual(calls, ['desktop-catalog', 'host-descriptor']);
  } finally {
    response.resolve(catalog);
    await menu.catch(() => {});
    await service.stop();
  }
});

test('an unconfirmed navigation worker exit preserves cleanup ownership without quarantining sessions', async t => {
  const f = await fixture(t);
  const plugin = await f.plugin('desktop-tools');
  const catalog = await f.manager.desktopCatalog();
  const descriptor = catalog.plugins[0].packageDescriptor;
  const stops: number[] = [];
  const calls: string[] = [];
  const service = new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => {
      const index = stops.length;
      stops.push(0);
      return {
        start() {},
        async request(type: string) {
          calls.push(type);
          assert.equal(type, index === 0 ? 'desktop-catalog' : 'host-descriptor');
          return index === 0 ? catalog : descriptor;
        },
        async stopManagement() {
          stops[index]++;
          if (index === 0 && stops[index] === 1) throw new Error('The navigation worker has not exited');
        },
      } as unknown as RpcProcess;
    } });
  try {
    await assert.rejects(service.desktopCatalog(), /capability:management-unavailable/);
    assert.equal(stops[0], 1);
    await service.recover();
    assert.equal(await service.withHostDescriptor('desktop-tools', plugin.directory, 'example', async value => value.id),
      'desktop-tools');
    assert.deepEqual(calls, ['desktop-catalog', 'host-descriptor']);
    await service.stop();
    assert.equal(stops[0], 2, 'Shutdown retries the still-owned navigation worker');
  } finally { await service.stop(); }
});

test('concurrent navigation refreshes share one worker and a completed read can refresh again', async t => {
  const f = await fixture(t);
  await f.plugin('desktop-tools');
  const catalog = await f.manager.desktopCatalog();
  const started = deferred<void>();
  const response = deferred<typeof catalog>();
  let workers = 0;
  const service = new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => {
      workers++;
      return {
        start() {},
        async request(type: string) {
          assert.equal(type, 'desktop-catalog');
          started.resolve();
          return response.promise;
        },
        async stopManagement() {},
      } as unknown as RpcProcess;
    } });
  const reads = [service.desktopCatalog(), service.desktopCatalog()];
  try {
    await within(started.promise, 'The shared navigation worker did not start');
    reads.push(service.desktopCatalog());
    assert.equal(workers, 1);
    response.resolve(catalog);
    const results = await within(Promise.all(reads), 'Shared navigation callers did not finish');
    assert.equal(workers, 1, 'In-flight refreshes must not queue replacement workers');
    for (const result of results) assert.equal(result.plugins[0].package?.desktop?.title, 'desktop-tools');
    await service.desktopCatalog();
    assert.equal(workers, 2, 'A settled navigation read does not cache the menu permanently');
  } finally {
    response.resolve(catalog);
    await Promise.allSettled(reads);
    await service.stop();
  }
});

for (const snapshotOutcome of ['old', 'rejected', 'unconfirmed-exit']) {
test(`a mutation refresh handles an in-flight ${snapshotOutcome} catalog without losing reader ownership`, async t => {
  const f = await fixture(t);
  const plugin = await f.plugin('desktop-tools');
  const previous = await f.manager.desktopCatalog();
  let current = previous;
  const stopping = deferred<void>();
  const release = deferred<void>();
  let readers = 0, activeReaders = 0, peakReaders = 0, allowExit = false;
  const service = new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => {
      let requestType = '', reader = 0, stopped = false;
      return {
        start() {},
        async request(type: string) {
          requestType = type;
          if (type === 'desktop-catalog') {
            reader = ++readers;
            peakReaders = Math.max(peakReaders, ++activeReaders);
            if (reader === 1 && snapshotOutcome === 'rejected') throw new Error('capability:update-recovery-required');
            return reader === 1 ? previous : current;
          }
          if (type === 'mutate') {
            await writeFile(join(plugin.directory, 'step.plugin.json'), JSON.stringify({
              id: 'desktop-tools', name: 'desktop-tools', version: '2.0.0',
              skills: [], commands: [], agents: [], mcpServers: {},
            }));
            plugin.receipt.fingerprint = await packageFingerprint(plugin.directory);
            await f.save();
            current = await f.manager.desktopCatalog();
          } else assert.equal(type, 'initialize');
          return {};
        },
        async stopManagement() {
          if (requestType === 'desktop-catalog' && !stopped) {
            if (reader === 1) {
              stopping.resolve();
              await release.promise;
              if (snapshotOutcome === 'unconfirmed-exit' && !allowExit)
                throw new Error('The old navigation worker has not exited');
            }
            stopped = true;
            activeReaders--;
          }
        },
      } as unknown as RpcProcess;
    } });
  await service.initialize();
  const initial = service.desktopCatalog();
  let refresh: ReturnType<typeof service.desktopCatalog> | undefined;
  try {
    await within(stopping.promise, 'The old navigation snapshot did not reach shutdown');
    await within(service.mutate({ action: 'marketplace-remove', name: 'fixture' }),
      'A held read must not prevent the catalog mutation');
    refresh = service.desktopCatalog();
    assert.equal(readers, 1, 'The post-mutation caller still shares the single in-flight read');
    release.resolve();
    if (snapshotOutcome === 'unconfirmed-exit') {
      await Promise.all([initial, refresh].map(read => assert.rejects(read, /capability:management-unavailable/)));
      assert.equal(readers, 1, 'An epoch change cannot replace a reader whose exit is still unconfirmed');
      await service.recover();
      return;
    }
    const results = await within(Promise.all([initial, refresh]), 'The post-mutation catalog did not settle');
    for (const result of results) assert.equal(result.plugins[0].version, '2.0.0',
      'An old snapshot must not satisfy the only refresh emitted after a mutation');
    assert.equal(results[0].plugins[0].package?.ref, results[1].plugins[0].package?.ref);
    assert.equal(readers, 2, 'An invalidated in-flight snapshot is replaced once without another external refresh');
    assert.equal(peakReaders, 1, 'Replacement readers never overlap the old reader');
  } finally {
    allowExit = true;
    release.resolve();
    await Promise.allSettled([initial, ...(refresh ? [refresh] : [])]);
    await service.stop();
  }
});
}

test('navigation exit uncertainty prevents replacement readers until shutdown confirms cleanup', async t => {
  const f = await fixture(t);
  await f.plugin('desktop-tools');
  const catalog = await f.manager.desktopCatalog();
  let workers = 0, stops = 0, allowExit = false;
  const service = new CapabilityService({ root: f.root, runtime: 'unused', node: 'unused', environment: () => ({}),
    createWorker: () => {
      workers++;
      return {
        start() {},
        async request(type: string) {
          assert.equal(type, 'desktop-catalog');
          return catalog;
        },
        async stopManagement() {
          stops++;
          if (!allowExit) throw new Error('The navigation worker has not exited');
        },
      } as unknown as RpcProcess;
    } });
  try {
    await assert.rejects(service.desktopCatalog(), /capability:management-unavailable/);
    for (let attempt = 0; attempt < 3; attempt++)
      await assert.rejects(service.desktopCatalog(), /capability:management-unavailable/);
    assert.equal(workers, 1, 'An unconfirmed reader must not create an unbounded replacement chain');
    await service.recover();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await assert.rejects(service.stop(), /The navigation worker has not exited/);
      assert.equal(stops, 1 + attempt, 'Failed shutdown keeps the reader available for another cleanup attempt');
    }
    allowExit = true;
    await service.stop();
    const confirmedStops = stops;
    await service.stop();
    assert.equal(stops, confirmedStops, 'Confirmed cleanup releases the old reader exactly once');
    const refreshed = await service.desktopCatalog();
    assert.equal(refreshed.plugins[0].package?.desktop?.title, 'desktop-tools');
    assert.equal(workers, 2, 'Confirmed cleanup permits an explicit navigation retry');
  } finally {
    allowExit = true;
    await service.stop();
  }
});
