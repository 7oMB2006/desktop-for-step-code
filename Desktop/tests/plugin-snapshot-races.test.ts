import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

// Only the child needs VM modules; the normal tsx test runner needs no extra flags.
// Product sources run against a synthetic filesystem, never a real user profile.
const harness = String.raw`
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const scenario = process.argv[2], repository = process.argv[3];
const { basename, dirname, join, relative, resolve, sep } = path;
const hash = value => createHash('sha256').update(value).digest('hex');
const unavailable = /Plugin configuration unavailable or changed/;
const root = resolve('virtual-plugin-snapshot-profile');

function memoryFilesystem() {
  const nodes = new Map();
  const openedPaths = [];
  let serial = 0, temporary = 0, opened = 0, closed = 0;
  const hooks = {};
  const error = code => Object.assign(new Error(code), { code });
  const make = (kind, bytes = Buffer.alloc(0)) => ({
    kind, bytes: Buffer.from(bytes), ino: ++serial, dev: 1,
    mtimeMs: serial, birthtimeMs: serial,
  });
  function directory(target) {
    target = resolve(target);
    if (nodes.has(target)) return;
    if (dirname(target) !== target) directory(dirname(target));
    nodes.set(target, make('directory'));
  }
  function put(target, value) {
    target = resolve(target);
    directory(dirname(target));
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const existing = nodes.get(target);
    if (existing) {
      assert.equal(existing.kind, 'file');
      existing.bytes = Buffer.from(bytes);
      existing.mtimeMs = ++serial;
    } else nodes.set(target, make('file', bytes));
  }
  function ancestors(target) {
    const result = [];
    for (;;) {
      result.unshift(target);
      const parent = dirname(target);
      if (parent === target) return result;
      target = parent;
    }
  }
  function canonical(target, followLast = true, depth = 0) {
    assert.ok(depth < 32, 'virtual link loop');
    target = resolve(target);
    for (const part of ancestors(target)) {
      const node = nodes.get(part);
      if (node?.kind === 'link' && (part !== target || followLast))
        return canonical(resolve(node.target, relative(part, target)), followLast, depth + 1);
    }
    return target;
  }
  function lookup(target, followLast = true) {
    const key = canonical(target, followLast);
    const node = nodes.get(key);
    if (!node) throw error('ENOENT');
    return node;
  }
  const info = node => ({
    ino: node.ino, dev: node.dev, size: node.bytes.length,
    mtimeMs: node.mtimeMs, birthtimeMs: node.birthtimeMs,
    isFile: () => node.kind === 'file',
    isDirectory: () => node.kind === 'directory',
    isSymbolicLink: () => node.kind === 'link',
  });
  function copyTree(source, destination) {
    source = resolve(source); destination = resolve(destination);
    const entries = [...nodes.entries()].filter(([key]) => key === source || key.startsWith(source + sep));
    assert.ok(entries.length, 'virtual copy must have a source');
    for (const [key, node] of entries) {
      assert.notEqual(node.kind, 'link');
      const target = join(destination, relative(source, key));
      if (node.kind === 'directory') directory(target);
      else put(target, node.bytes);
    }
  }
  const api = {
    async lstat(target) {
      target = resolve(target);
      hooks.beforeLstat?.(target);
      return info(lookup(target, false));
    },
    async realpath(target) {
      target = resolve(target);
      const result = canonical(target);
      lookup(result);
      hooks.afterRealpath?.(target, result);
      return result;
    },
    async readdir(target, options) {
      target = resolve(target);
      hooks.beforeReaddir?.(target);
      const actual = canonical(target);
      assert.equal(lookup(actual).kind, 'directory');
      const children = [...nodes.entries()].filter(([key]) => key !== actual && dirname(key) === actual);
      return children.map(([key, node]) => options?.withFileTypes
        ? { name: basename(key), ...info(node) } : basename(key));
    },
    async open(target, flags) {
      target = resolve(target);
      hooks.beforeOpen?.(target, flags);
      if (flags === 'wx') {
        const actual = canonical(target);
        if (nodes.has(actual)) throw error('EEXIST');
        put(actual, '');
      } else assert.equal(flags, 'r', 'unexpected open mode');
      const node = lookup(target);
      assert.equal(node.kind, 'file');
      openedPaths.push(canonical(target));
      opened++;
      let isClosed = false;
      return {
        async stat() { assert.ok(!isClosed); return info(node); },
        async read(buffer, offset, length, position) {
          assert.ok(!isClosed);
          hooks.beforeRead?.(target);
          const bytesRead = Math.min(length, Math.max(0, node.bytes.length - position));
          node.bytes.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead, buffer };
        },
        async writeFile(value) {
          assert.ok(!isClosed);
          hooks.beforeWrite?.(target);
          node.bytes = Buffer.from(value); node.mtimeMs = ++serial;
        },
        async truncate(length) {
          assert.ok(!isClosed);
          node.bytes = node.bytes.subarray(0, length); node.mtimeMs = ++serial;
        },
        async sync() { assert.ok(!isClosed); },
        async close() { assert.ok(!isClosed); hooks.beforeClose?.(target); isClosed = true; closed++; },
      };
    },
    async mkdir(target, options) {
      target = resolve(target);
      if (nodes.has(target) && !options?.recursive) throw error('EEXIST');
      if (!options?.recursive && !nodes.has(dirname(target))) throw error('ENOENT');
      directory(target);
    },
    async mkdtemp(prefix) {
      const target = prefix + String(++temporary).padStart(6, '0');
      assert.ok(!nodes.has(target));
      directory(target);
      return target;
    },
    async readFile(target, encoding) {
      const bytes = Buffer.from(lookup(target).bytes);
      return encoding ? bytes.toString(encoding) : bytes;
    },
    async writeFile(target, value) { put(target, value); },
    async cp(source, destination) { copyTree(source, destination); },
    async rename(source, destination) {
      source = resolve(source); destination = resolve(destination);
      hooks.beforeRename?.(source, destination);
      const entries = [...nodes.entries()].filter(([key]) => key === source || key.startsWith(source + sep));
      if (!entries.length) throw error('ENOENT');
      for (const [key] of entries) nodes.delete(key);
      for (const [key, node] of entries) nodes.set(join(destination, relative(source, key)), node);
      hooks.afterRename?.(source, destination);
    },
    async rm(target) {
      target = resolve(target);
      hooks.beforeRm?.(target);
      for (const key of nodes.keys()) if (key === target || key.startsWith(target + sep)) nodes.delete(key);
    },
  };
  return {
    api, nodes, hooks, put, directory, copyTree, openedPaths,
    json(target, value) { put(target, JSON.stringify(value)); },
    bytes(target) { return Buffer.from(lookup(target).bytes); },
    link(target, destination) {
      assert.equal(lookup(target, false).kind, 'directory');
      nodes.set(resolve(target), { ...make('link'), target: resolve(destination) });
    },
    assertClosed() { assert.equal(closed, opened, 'every opened handle must close on rejection'); },
  };
}

async function modules(fs) {
  const context = createContext({ Buffer, URL, process: { env: {
    HOME: root, STEPCODE_STORAGE_ROOT_DIR: root, STEP_CODING_AGENT_DIR: join(root, 'agent'),
  } } });
  const sources = {
    settings: join(repository, 'Desktop/electron/capability-settings.mjs'),
    failure: join(repository, 'Desktop/electron/capability-failure.mjs'),
    files: join(repository, 'Desktop/electron/plugin-files.mjs'),
    update: join(repository, 'Desktop/electron/plugin-update.mjs'),
    configuration: join(repository, 'Desktop/electron/plugin-configuration.mjs'),
    reader: join(repository, 'examples/plugins/config-starter/plugins/dfsc-config-example/server/configuration.mjs'),
  };
  const builtins = {
    'node:crypto': { createHash, randomUUID }, 'node:fs/promises': fs.api,
    'node:path': path, 'node:url': url,
  };
  const cache = new Map();
  async function load(key) {
    if (cache.has(key)) return cache.get(key);
    let module;
    if (Object.hasOwn(builtins, key)) {
      const values = builtins[key];
      module = new SyntheticModule(Object.keys(values), function () {
        for (const [name, value] of Object.entries(values)) this.setExport(name, value);
      }, { context, identifier: key });
    } else {
      assert.ok(Object.hasOwn(sources, key), 'unexpected product source: ' + key);
      // Expose only the private read primitive in memory, without editing its source file.
      const source = readFileSync(sources[key], 'utf8') + (key === 'reader' ? '\nexport { read as snapshotRead };\n' : '');
      module = new SourceTextModule(source, { context, identifier: key });
    }
    cache.set(key, module);
    await module.link(specifier => {
      if (Object.hasOwn(builtins, specifier)) return load(specifier);
      if (specifier === './capability-failure.mjs') return load('failure');
      if (specifier === './plugin-files.mjs') return load('files');
      if (specifier === './plugin-update.mjs') return load('update');
      if (specifier === './plugin-configuration.mjs') return load('configuration');
      throw new Error('Unexpected import: ' + specifier);
    });
    return module;
  }
  return async key => {
    const module = await load(key);
    await module.evaluate();
    return module.namespace;
  };
}

async function installationFixture(change, theme = false, declarations = {}) {
  const fs = memoryFilesystem();
  const market = join(root, 'marketplaces/community');
  const source = join(market, 'plugins/example');
  const target = join(root, 'plugins/example');
  const existing = join(root, 'plugins/existing');
  fs.directory(root);
  fs.json(join(source, 'step.plugin.json'), { id: 'id-a', name: 'Example',
    ...(theme ? { skills: [], commands: [], agents: [] } : {}), ...declarations });
  if (theme) fs.json(join(source, 'dfsc.theme.json'), { schemaVersion: 1, renderer: 'stellar-v1' });
  fs.put(join(source, 'README.md'), 'Original package');
  fs.json(join(market, '.step-plugin/marketplace.json'), { plugins: [{ name: 'example' }] });
  fs.json(join(existing, 'step.plugin.json'), { id: 'id-b' });
  const existingBytes = fs.bytes(join(existing, 'step.plugin.json'));
  let copied = 0, staged;
  const manifestReads = [];
  const upstream = {
    async listInstalledStepPlugins() {
      return { plugins: fs.nodes.has(target) ? [{ id: 'id-a', rootPath: target }] : [], warnings: [] };
    },
    async uninstallPlugin() { throw Object.assign(new Error('Simulated locked package'), { code: 'EACCES' }); },
    async ensureBuiltinMarketplace() { return { warnings: [] }; },
    async listMarketplaceSources() { return [{ name: 'community', kind: 'local', path: market }]; },
    async listMarketplacePlugins() {
      return { entries: [{ name: 'example', marketplace: 'community', sourcePath: source }], warnings: [] };
    },
    async readStepPluginManifest(directory) {
      manifestReads.push(directory);
      return { manifest: JSON.parse(fs.bytes(join(directory, 'step.plugin.json'))), errors: [] };
    },
    async installMarketplacePlugin(entry, destination, options) {
      copied++;
      assert.equal(entry.sourcePath, source);
      assert.equal(dirname(destination), join(root, 'desktop-plugins'));
      assert.match(basename(destination), /^install-/);
      assert.equal(options.provision, false);
      staged = join(destination, entry.name);
      change?.(fs, source);
      fs.copyTree(source, staged);
      return { warnings: [] };
    },
  };
  const load = await modules(fs);
  const helpers = await load('files');
  const expectedFingerprint = await helpers.packageFingerprint(source);
  const info = await fs.api.lstat(market);
  const expectedSource = hash(JSON.stringify(['local', null, resolve(market), info.dev, info.ino, info.birthtimeMs]));
  const settings = (await load('settings')).createCapabilitySettings(upstream, { root });
  return {
    fs, target, expectedFingerprint, expectedSource,
    remove() { return settings.mutate({ action: 'plugin-remove', id: 'id-a' }); },
    install(extra = {}) {
      return settings.mutate({ action: 'plugin-install', name: 'example', marketplace: 'community', ...extra });
    },
    assertStaged() {
      assert.equal(copied, 1, 'the native copy must actually run');
      assert.deepEqual(manifestReads, [staged], 'identity must be read from the copied snapshot');
      assert.ok(![...fs.nodes.keys()].some(key => key.startsWith(join(root, 'desktop-plugins/install-'))),
        'temporary installation must be removed');
      assert.ok(fs.bytes(join(existing, 'step.plugin.json')).equals(existingBytes), 'existing plugin is unchanged');
      fs.assertClosed();
    },
    assertUnpublished() {
      this.assertStaged();
      assert.ok(!fs.nodes.has(target), 'conflicting or stale snapshot must not be published');
      assert.ok(!fs.nodes.has(join(root, 'desktop-plugins/installations.json')), 'rejected snapshot must not acquire a receipt');
    },
  };
}

async function configurationFixture() {
  const fs = memoryFilesystem(), directory = join(root, 'plugins/example');
  const instance = '11111111-1111-4111-8111-111111111111', revision = hash('revision-one');
  const schema = JSON.stringify({ schemaVersion: 1, groups: [] });
  fs.json(join(directory, 'step.plugin.json'), { id: 'example' });
  fs.put(join(directory, 'dfsc.settings.json'), schema);
  const load = await modules(fs), helpers = await load('files');
  const fingerprint = await helpers.packageFingerprint(directory), schemaHash = hash(schema);
  const config = { version: 1, instance, id: 'example', schemaHash, revision,
    values: { prefix: 'GOOD' }, secrets: { key: 'fixture-only-secret' } };
  const binding = { version: 1, instance, id: 'example', fingerprint, schemaHash, revision,
    contentHash: hash(JSON.stringify(config)) };
  const bindingPath = join(root, 'desktop-plugins/bindings/example.json');
  const configPath = join(root, 'desktop-plugins/settings', instance, revision + '.json');
  const receiptPath = join(root, 'desktop-plugins/installations.json');
  fs.json(bindingPath, binding); fs.json(configPath, config);
  fs.json(receiptPath, { version: 1, installations: [
    { instance, folder: 'example', id: 'example', state: 'installed', fingerprint,
      source: hash('fixture-community'), marketplace: 'community' },
  ] });
  const reader = await load('reader');
  return {
    fs, directory, bindingPath, configPath, receiptPath, config, binding,
    reader: () => new reader.ConfigurationReader(url.pathToFileURL(directory + sep)),
    async assertValid(current) {
      const snapshot = await current.current();
      assert.equal(snapshot.values.prefix, 'GOOD');
      assert.equal(snapshot.secrets.key, 'fixture-only-secret');
      assert.equal(snapshot.revision, revision);
    },
  };
}

async function installRace() {
  const control = await installationFixture();
  await control.install({ expectedFingerprint: control.expectedFingerprint });
  control.assertStaged();
  const receipts = JSON.parse(control.fs.bytes(join(root, 'desktop-plugins/installations.json')));
  assert.equal(receipts.installations.length, 1);
  assert.equal(receipts.installations[0].id, 'id-a');
  assert.equal(receipts.installations[0].state, 'installed');
  assert.equal(receipts.installations[0].fingerprint, control.expectedFingerprint);
  assert.equal(JSON.parse(control.fs.bytes(join(control.target, 'step.plugin.json'))).id, 'id-a');

  const identity = await installationFixture((fs, source) => {
    fs.json(join(source, 'step.plugin.json'), { id: 'id-b', name: 'Replaced while copying' });
  });
  await assert.rejects(identity.install(), error => error.code === 'already-exists');
  identity.assertUnpublished();

  const fingerprint = await installationFixture((fs, source) => {
    fs.put(join(source, 'README.md'), 'Changed after the renderer selected this package');
  });
  await assert.rejects(fingerprint.install({ expectedFingerprint: fingerprint.expectedFingerprint }),
    error => error.code === 'stale');
  fingerprint.assertUnpublished();

  const theme = await installationFixture(undefined, true);
  await theme.install({ preserveRuntime: true, expectedFingerprint: theme.expectedFingerprint, expectedSource: theme.expectedSource });
  theme.assertStaged();
  assert.ok(theme.fs.nodes.has(theme.target), 'a proven pure theme may be installed while retaining the runtime');
  for (const [isTheme, declarations] of [[false, {}], [true, { entry: 'executable.js' }], [true, { skills: ['skills'] }]]) {
    const candidate = await installationFixture(undefined, isTheme, declarations);
    await assert.rejects(candidate.install({
      preserveRuntime: true, expectedFingerprint: candidate.expectedFingerprint, expectedSource: candidate.expectedSource,
    }), error => error.code === 'stale');
    candidate.assertUnpublished();
  }
  const replaced = await installationFixture((fs, source) => {
    fs.json(join(source, 'step.plugin.json'), { id: 'id-a', name: 'Changed', entry: 'executable.js' });
  }, true);
  await assert.rejects(replaced.install({
    preserveRuntime: true, expectedFingerprint: replaced.expectedFingerprint, expectedSource: replaced.expectedSource,
  }), error => error.code === 'stale');
  replaced.assertUnpublished();
}

async function payloadRace() {
  for (const field of ['values', 'secrets']) {
    const fixture = await configurationFixture(), reader = fixture.reader();
    await fixture.assertValid(reader);
    const unchangedBinding = fixture.fs.bytes(fixture.bindingPath);
    const changed = structuredClone(fixture.config);
    if (field === 'values') changed.values.prefix = 'EVIL';
    else changed.secrets.key = 'fixture-only-tampered-secret';
    fixture.fs.json(fixture.configPath, changed);
    assert.equal(changed.revision, fixture.binding.revision);
    assert.ok(fixture.fs.bytes(fixture.bindingPath).equals(unchangedBinding));
    await assert.rejects(reader.current(), unavailable);
    await assert.rejects(fixture.reader().current(), unavailable);
    fixture.fs.assertClosed();
  }
}

async function revocationRace() {
  for (const resource of ['binding', 'receipt', 'config']) {
    const fixture = await configurationFixture(), reader = fixture.reader();
    await fixture.assertValid(reader);
    let fired = false;
    fixture.fs.hooks.beforeReaddir = target => {
      if (target !== fixture.directory || fired) return;
      fired = true;
      if (resource === 'binding') fixture.fs.json(fixture.bindingPath, { version: 1, revoked: true });
      if (resource === 'receipt') fixture.fs.json(fixture.receiptPath, { version: 1, installations: [] });
      if (resource === 'config') fixture.fs.json(fixture.configPath, {
        ...fixture.config, values: { prefix: 'EVIL' },
      });
    };
    await assert.rejects(reader.current(), unavailable);
    assert.equal(fired, true, resource + ' must change during the package fingerprint traversal');
    fixture.fs.assertClosed();
  }
}

async function junctionRace() {
  for (const implementation of ['files', 'reader']) {
    for (const timing of ['before-open', 'after-canonical-recheck']) {
      const fs = memoryFilesystem(), load = await modules(fs);
      const directory = join(root, 'documents'), target = join(directory, 'guide.md');
      const outside = resolve('virtual-outside-plugin-profile');
      fs.put(target, 'Inside document');
      fs.put(join(outside, 'guide.md'), 'Outside document must never be returned');
      const module = await load(implementation);
      const read = () => implementation === 'files'
        ? module.plainFile(root, 'documents/guide.md')
        : module.snapshotRead(root, 'documents/guide.md');
      assert.equal((await read()).toString(), 'Inside document');
      let fired = false, calls = 0, reads = 0;
      fs.hooks.beforeRead = file => { if (file === target) reads++; };
      if (timing === 'before-open') {
        fs.hooks.beforeLstat = file => {
          if (file === target && ++calls === 2) { fired = true; fs.link(directory, outside); }
        };
      } else {
        // Swap after the final realpath(root), so only the post-read ancestor walk can detect it.
        fs.hooks.afterRealpath = file => {
          if (file === root && ++calls === 2) { fired = true; fs.link(directory, outside); }
        };
      }
      await assert.rejects(read(), error => implementation === 'files'
        ? ['invalid-path', 'too-large', 'stale'].includes(error.code) : unavailable.test(error.message));
      assert.equal(fired, true, implementation + ': ' + timing + ' hook must run');
      assert.equal(reads, timing === 'before-open' ? 0 : 1);
      fs.assertClosed();
    }
  }
}

async function interruptedOperations() {
  const receiptPath = join(root, 'desktop-plugins/installations.json');
  for (const timing of ['beforeRename', 'afterRename']) {
    const fixture = await installationFixture();
    let fired = false;
    fixture.fs.hooks[timing] = (_source, destination) => {
      if (destination === fixture.target) {
        fired = true;
        throw Object.assign(new Error('Simulated installation interruption'), { code: 'EACCES' });
      }
    };
    await assert.rejects(fixture.install(), error => error.code === 'EACCES');
    assert.equal(fired, true);
    const receipts = JSON.parse(fixture.fs.bytes(receiptPath));
    assert.equal(receipts.installations.length, 1);
    assert.equal(receipts.installations[0].state, 'pending', 'incomplete installation cannot acquire an installed receipt');
    assert.equal(fixture.fs.nodes.has(fixture.target), timing === 'afterRename');
    fixture.assertStaged();
  }
  const fixture = await installationFixture();
  await fixture.install();
  const original = JSON.parse(fixture.fs.bytes(receiptPath)).installations[0];
  const bindingPath = join(root, 'desktop-plugins/bindings/example.json');
  fixture.fs.json(bindingPath, { version: 1, instance: original.instance, id: original.id, revoked: false });
  const manifest = fixture.fs.bytes(join(fixture.target, 'step.plugin.json'));
  await assert.rejects(fixture.remove(), error => error.code === 'EACCES');
  const receipts = JSON.parse(fixture.fs.bytes(receiptPath));
  assert.equal(receipts.installations.length, 1, 'failed uninstall must retain its provenance');
  assert.equal(receipts.installations[0].instance, original.instance);
  assert.equal(receipts.installations[0].state, 'removing', 'failed removal cannot remain authorized');
  const binding = JSON.parse(fixture.fs.bytes(bindingPath));
  assert.equal(binding.revoked, true, 'actual uninstall failure must revoke the selected binding');
  assert.equal(binding.instance, original.instance);
  assert.equal(binding.id, original.id);
  assert.ok(fixture.fs.bytes(join(fixture.target, 'step.plugin.json')).equals(manifest));
  fixture.fs.assertClosed();
}

async function removalPreflight() {
  const receiptPath = join(root, 'desktop-plugins/installations.json');
  const bindingPath = join(root, 'desktop-plugins/bindings/example.json');
  for (const scenario of ['foreign-binding', 'foreign-receipt', 'replaced-receipt']) {
    const fixture = await installationFixture();
    await fixture.install();
    const receipts = JSON.parse(fixture.fs.bytes(receiptPath)), selected = receipts.installations[0];
    fixture.fs.json(bindingPath, { version: 1, instance: selected.instance, id: selected.id, revoked: false });
    let expectedCode = 'stale', replacement;
    if (scenario === 'foreign-binding') {
      fixture.fs.json(bindingPath, { version: 1, instance: '00000000-0000-4000-8000-000000000000',
        id: selected.id, revoked: false });
      expectedCode = 'stale-configuration';
    } else if (scenario === 'foreign-receipt') {
      receipts.installations[0].id = 'unrelated-id';
      fixture.fs.json(receiptPath, receipts);
    } else {
      replacement = { ...selected, instance: '00000000-0000-4000-8000-000000000000' };
      let fired = false;
      fixture.fs.hooks.beforeRead = target => {
        if (target !== bindingPath || fired) return;
        fired = true;
        fixture.fs.json(receiptPath, { version: 1, installations: [replacement] });
      };
    }
    const before = fixture.fs.bytes(bindingPath);
    const receiptBefore = fixture.fs.bytes(receiptPath);
    await assert.rejects(fixture.remove(), error => error.code === expectedCode);
    assert.ok(fixture.fs.bytes(bindingPath).equals(before), scenario + ' must not revoke another instance');
    if (replacement) {
      assert.deepEqual(JSON.parse(fixture.fs.bytes(receiptPath)).installations, [replacement],
        'preflight must not restore a superseded receipt');
    } else assert.ok(fixture.fs.bytes(receiptPath).equals(receiptBefore));
    assert.ok(fixture.fs.nodes.has(fixture.target), 'preflight rejection must not delete the package');
    fixture.fs.assertClosed();
  }
}

async function writeJunctionRace() {
  const outside = resolve('virtual-outside-private-write');
  for (const timing of ['before-open', 'after-write']) {
    const fs = memoryFilesystem(), load = await modules(fs);
    const files = await load('files'), directory = join(root, 'desktop-plugins');
    fs.directory(directory); fs.directory(outside);
    const original = fs.nodes.get(directory);
    let fired = false, wrote = false;
    fs.hooks.beforeOpen = (_target, flags) => {
      if (flags === 'wx' && timing === 'before-open') {
        fired = true;
        fs.link(directory, outside);
      }
    };
    fs.hooks.beforeWrite = () => {
      wrote = true;
      if (timing === 'after-write') { fired = true; fs.link(directory, outside); }
    };
    fs.hooks.beforeClose = () => { fs.nodes.set(directory, original); };
    await assert.rejects(files.writePrivateData(root, 'desktop-plugins/secret.json', { key: 'must-not-leak' }));
    assert.equal(fired, true);
    assert.equal(wrote, timing === 'after-write', 'parent substitution before open must be caught before writing');
    assert.equal(fs.openedPaths.length, 1, 'the substituted operation must actually obtain a handle');
    assert.equal(dirname(fs.openedPaths[0]), timing === 'before-open' ? outside : directory);
    for (const node of fs.nodes.values()) assert.ok(!node.bytes.includes(Buffer.from('must-not-leak')),
      'failed write must erase secrets through the actual opened handle');
    assert.ok(!fs.nodes.has(join(root, 'desktop-plugins/secret.json')));
    fs.assertClosed();
  }
  const fs = memoryFilesystem(), load = await modules(fs), files = await load('files');
  fs.directory(root);
  fs.hooks.beforeWrite = () => { throw new Error('Simulated write failure'); };
  fs.hooks.beforeClose = () => { throw new Error('Simulated close failure'); };
  await assert.rejects(files.writePrivateData(root, 'desktop-plugins/secret.json', { key: 'must-not-leak' }));
  assert.ok(![...fs.nodes.keys()].some(key => key.endsWith('.tmp')), 'close rejection cannot skip temporary cleanup');
}

async function updateTransactions() {
  async function fixture() {
    const fs = memoryFilesystem(), load = await modules(fs), files = await load('files'), update = await load('update');
    const transaction = '00000000-0000-4000-8000-000000000000', instance = '11111111-1111-4111-8111-111111111111';
    const staging = join(root, 'desktop-plugins/update-' + transaction), target = join(root, 'plugins/example');
    const candidate = join(staging, 'candidate'), backup = join(staging, 'previous');
    fs.json(join(target, 'step.plugin.json'), { id: 'example', version: '1.0.0' });
    fs.json(join(candidate, 'step.plugin.json'), { id: 'example', version: '2.0.0' });
    const previous = { instance, folder: 'example', id: 'example', source: 'source-generation',
      marketplace: 'community', fingerprint: await files.packageFingerprint(target), state: 'installed' };
    const next = { ...previous, fingerprint: await files.packageFingerprint(candidate) };
    const binding = { version: 1, instance, id: 'example', fingerprint: previous.fingerprint,
      schemaHash: hash('schema'), revision: hash('revision'), contentHash: hash('payload') };
    const receipts = join(root, 'desktop-plugins/installations.json'), bindingPath = join(root, 'desktop-plugins/bindings/example.json');
    fs.json(receipts, { version: 1, installations: [previous] }); fs.json(bindingPath, binding);
    const snapshot = join(root, 'desktop-plugins/settings/' + instance + '/' + binding.revision + '.json');
    fs.put(snapshot, 'private snapshot must remain byte-identical');
    const journal = { version: 1, transaction, previous, next, binding, phase: 'prepared' };
    return { fs, files, update, target, candidate, backup, staging, receipts, bindingPath, snapshot, journal };
  }
  for (const checkpoint of ['prepared', 'backup', 'replacement', 'binding', 'receipt', 'committed']) {
    const f = await fixture(), { fs, journal } = f;
    if (checkpoint !== 'prepared') await fs.api.rename(f.target, f.backup);
    if (['replacement', 'binding', 'receipt', 'committed'].includes(checkpoint)) await fs.api.rename(f.candidate, f.target);
    if (['binding', 'receipt', 'committed'].includes(checkpoint)) fs.json(f.bindingPath, { ...journal.binding, fingerprint: journal.next.fingerprint });
    if (['receipt', 'committed'].includes(checkpoint)) fs.json(f.receipts, { version: 1, installations: [journal.next] });
    if (checkpoint === 'committed') journal.phase = 'committed';
    fs.json(join(root, 'desktop-plugins/update-transaction.json'), journal);
    const privateBytes = fs.bytes(f.snapshot);
    await f.update.recoverPluginUpdate(root);
    const expected = checkpoint === 'committed' ? journal.next : journal.previous;
    assert.equal(await f.files.packageFingerprint(f.target), expected.fingerprint, checkpoint);
    assert.deepEqual(JSON.parse(fs.bytes(f.receipts)).installations, [expected], checkpoint);
    assert.equal(JSON.parse(fs.bytes(f.bindingPath)).fingerprint, expected.fingerprint, checkpoint);
    assert.ok(fs.bytes(f.snapshot).equals(privateBytes));
    assert.ok(!fs.nodes.has(f.staging));
    assert.ok(!fs.nodes.has(join(root, 'desktop-plugins/update-transaction.json')));
    await f.update.recoverPluginUpdate(root);
    fs.assertClosed();
  }
  for (const failure of ['locked-target', 'publish', 'binding', 'receipt']) {
    const f = await fixture();
    let fired = false;
    f.fs.hooks.beforeRename = (source, destination) => {
      if (fired) return;
      if (failure === 'locked-target' && source === f.target
        || failure === 'publish' && source === f.candidate
        || failure === 'binding' && destination === f.bindingPath
        || failure === 'receipt' && destination === f.receipts) {
        fired = true; throw Object.assign(new Error('Simulated locked update'), { code: 'EACCES' });
      }
    };
    await assert.rejects(f.update.applyPluginUpdate(root, f.journal), error => error.code === 'EACCES');
    assert.equal(fired, true, failure);
    assert.equal(await f.files.packageFingerprint(f.target), f.journal.previous.fingerprint, failure);
    assert.deepEqual(JSON.parse(f.fs.bytes(f.receipts)).installations, [f.journal.previous]);
    assert.deepEqual(JSON.parse(f.fs.bytes(f.bindingPath)), f.journal.binding);
    f.fs.assertClosed();
  }
  const f = await fixture();
  await f.fs.api.rename(f.target, f.backup);
  await f.fs.api.rename(f.candidate, f.target);
  f.fs.json(join(root, 'desktop-plugins/update-transaction.json'), f.journal);
  f.fs.json(f.receipts, { version: 1, installations: [{ ...f.journal.previous, instance: '22222222-2222-4222-8222-222222222222' }] });
  const bytes = f.fs.bytes(f.receipts);
  await assert.rejects(f.update.recoverPluginUpdate(root), error => error.code === 'update-recovery-required');
  assert.ok(f.fs.bytes(f.receipts).equals(bytes), 'recovery cannot overwrite another installation instance');
  assert.ok(f.fs.nodes.has(f.backup), 'failed recovery must preserve the old package');
  for (const changed of ['target', 'candidate']) {
    const altered = await fixture();
    altered.fs.put(join(altered[changed], 'changed.txt'), 'externally changed package');
    await assert.rejects(altered.update.applyPluginUpdate(root, altered.journal), error => error.code === 'stale');
    assert.deepEqual(JSON.parse(altered.fs.bytes(altered.receipts)).installations, [altered.journal.previous]);
    assert.ok(!altered.fs.nodes.has(join(root, 'desktop-plugins/update-transaction.json')));
  }
  const leftover = await fixture();
  leftover.fs.hooks.beforeRm = target => {
    if (target === leftover.staging) throw Object.assign(new Error('Temporary files locked'), { code: 'EACCES' });
  };
  const notes = await leftover.update.applyPluginUpdate(root, leftover.journal);
  assert.equal(notes.length, 1);
  assert.equal(await leftover.files.packageFingerprint(leftover.target), leftover.journal.next.fingerprint);
  assert.ok(!leftover.fs.nodes.has(join(root, 'desktop-plugins/update-transaction.json')));
  await leftover.update.recoverPluginUpdate(root);
  assert.equal(await leftover.files.packageFingerprint(leftover.target), leftover.journal.next.fingerprint,
    'cleanup failure cannot roll back an already committed update or hide it from a later catalog');
}

const scenarios = { install: installRace, payload: payloadRace, revocation: revocationRace, junction: junctionRace,
  interrupted: interruptedOperations, removal: removalPreflight, writeJunction: writeJunctionRace, update: updateTransactions };
assert.ok(Object.hasOwn(scenarios, scenario), 'unknown regression scenario');
await scenarios[scenario]();
`;

function verify(scenario: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP'])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  const result = spawnSync(process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-', scenario, repository],
    { cwd: repository, env, input: harness, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, `${scenario}\n${result.stdout}\n${result.stderr}`);
}

test('installation checks identity and expected fingerprint on the staged native copy', () => verify('install'));
test('configuration values and secrets cannot change under an unchanged committed revision', () => verify('payload'));
test('current rejects binding revocation, receipt removal and payload changes during fingerprinting', () => verify('revocation'));
test('host and reference readers reject parent junction swaps before open and after canonical recheck', () => verify('junction'));
test('interrupted publication and failed uninstall retain incomplete, unauthorized receipts', () => verify('interrupted'));
test('uninstall preflight rejects foreign bindings, mismatched receipts and replaced installation instances', () => verify('removal'));
test('private writes reject parent substitution before secrets and erase failed snapshots through the open handle', () => verify('writeJunction'));
test('plugin replacement rolls back locked writes and recovers every journal checkpoint without losing private settings', () => verify('update'));
