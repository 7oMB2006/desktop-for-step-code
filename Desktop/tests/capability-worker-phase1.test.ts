import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

// Run only the adapter sources with fake upstream APIs and a disposable profile.
const harness = String.raw`
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const scenario = process.argv[2], repository = process.argv[3];
const { basename, dirname, join, relative, resolve, sep } = path;
const temporary = await fs.realpath(tmpdir());
const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'dfsc-worker-phase1-')));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const journalPath = join(root, 'desktop-plugins/update-transaction.json');
const mutations = [], hooks = {};
const writes = new Set(['mkdir', 'mkdtemp', 'rename', 'rm', 'cp', 'writeFile']);
const filesystem = Object.fromEntries(Object.entries(fs).map(([key, value]) => [key, async (...args) => {
  if (writes.has(key) || key === 'open' && args[1] !== 'r') {
    for (const target of key === 'rename' || key === 'cp' ? args.slice(0, 2) : args.slice(0, 1)) {
      const rel = relative(root, resolve(target));
      assert.ok(rel && rel !== '..' && !rel.startsWith('..' + sep) && !path.isAbsolute(rel),
        'product writes must stay inside the disposable profile');
    }
    mutations.push(key);
  }
  await hooks[key]?.(...args);
  return value(...args);
}]));
const context = createContext({ Buffer, URL, process: { env: {
  HOME: root, STEPCODE_STORAGE_ROOT_DIR: root, STEP_CODING_AGENT_DIR: join(root, 'agent'),
} } });
const cache = new Map();
async function load(key) {
  if (cache.has(key)) return cache.get(key);
  const builtins = { 'node:crypto': { createHash, randomUUID }, 'node:fs/promises': filesystem, 'node:path': path };
  let module;
  if (Object.hasOwn(builtins, key)) {
    const values = builtins[key];
    module = new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context, identifier: key });
  } else {
    assert.ok(['capability-settings.mjs', 'capability-failure.mjs', 'plugin-files.mjs', 'theme-composition.mjs', 'plugin-update.mjs', 'plugin-configuration.mjs', 'plugin-schema-update.mjs'].includes(key));
    module = new SourceTextModule(readFileSync(join(repository, 'Desktop/electron', key), 'utf8'),
      { context, identifier: key });
  }
  cache.set(key, module);
  await module.link(specifier => load(specifier.startsWith('./') ? specifier.slice(2) : specifier));
  return module;
}
async function namespace(key) {
  const module = await load(key);
  await module.evaluate();
  return module.namespace;
}
const files = await namespace('plugin-files.mjs'), update = await namespace('plugin-update.mjs');
const { createCapabilitySettings } = await namespace('capability-settings.mjs');
async function json(target, value) {
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(value));
}
async function tree(directory = root) {
  const result = [];
  async function visit(target) {
    for (const entry of (await fs.readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = join(target, entry.name), stat = await fs.lstat(next);
      result.push([relative(directory, next), stat.mode, stat.mtimeMs,
        entry.isDirectory() ? null : (await fs.readFile(next)).toString('base64')]);
      if (entry.isDirectory()) await visit(next);
    }
  }
  await visit(directory);
  return result;
}
const code = expected => error => error.code === expected;
const calls = { initialize: 0, builtin: 0, add: 0, refresh: 0, remove: 0, uninstall: 0 };
const documents = [];
function upstream(extra = {}) {
  return {
    createStepSettingsManager() {
      calls.initialize++;
      try { writeFileSync(join(root, 'config.toml'), '{}', { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      return { async flush() {}, drainErrors() { return []; } };
    },
    async ensureBuiltinMarketplace() {
      calls.builtin++;
      await json(join(root, 'marketplaces/builtin/.step-plugin/marketplace.json'), { plugins: [] });
      return { warnings: ['Initialized explicitly'] };
    },
    readGlobalStepConfig() { assert.fail('initializing config reader must not run'); },
    // The native TOML parser is mocked; these tests exercise adapter I/O routing.
    readStepConfig(target) { return JSON.parse(readFileSync(target, 'utf8')); },
    SettingsManager: { fromStorage(storage) {
      const scopes = {};
      for (const scope of ['global', 'project']) storage.withLock(scope, value => { scopes[scope] = JSON.parse(value); });
      documents.push(scopes);
      return { scopes };
    } },
    DefaultPackageManager: class {
      constructor(options) { this.settings = options.settingsManager; }
      async resolve(skip) { assert.equal(await skip(), 'skip'); return { skills: [] }; }
    },
    async listInstalledStepPlugins() { return { plugins: [], warnings: [] }; },
    async listMarketplaceSources() { return []; },
    async listMarketplacePlugins() { return { entries: [], warnings: [] }; },
    async discoverStepPluginResourcePaths() { return { skillPaths: [], warnings: [] }; },
    async addMarketplaceSource() { calls.add++; return { source: { name: 'community' }, warnings: [] }; },
    async updateMarketplaceSource({ name }) { calls.refresh++; return { source: { name }, warnings: [] }; },
    async removeMarketplaceSource({ name }) { calls.remove++; return { source: { name }, warnings: [] }; },
    async readStepPluginManifest(directory) {
      return { manifest: JSON.parse(await fs.readFile(join(directory, 'step.plugin.json'), 'utf8')), errors: [] };
    },
    ...extra,
  };
}
const themeManifest = version => ({
  id: 'theme-a', name: 'Theme A', version, skills: [], commands: [], agents: [], mcpServers: {},
});
const v2Theme = { schemaVersion: 2, ui: { renderer: 'stellar-v1' },
  background: { renderer: 'solid-v1', accepts: ['image-v1'] } };
async function packageAt(directory, manifest, theme = { schemaVersion: 1, renderer: 'stellar-v1' }) {
  await json(join(directory, 'step.plugin.json'), manifest);
  await json(join(directory, 'dfsc.theme.json'), theme);
}
async function fixture(old = themeManifest('1.0.0'), next = themeManifest('2.0.0'), nextTheme) {
  const target = join(root, 'plugins/example'), transaction = randomUUID();
  const staging = join(root, 'desktop-plugins/update-' + transaction), candidate = join(staging, 'candidate');
  await packageAt(target, old); await packageAt(candidate, next, nextTheme);
  const previous = { instance: randomUUID(), id: old.id, folder: 'example', source: 'source-generation',
    marketplace: 'community', state: 'installed', fingerprint: await files.packageFingerprint(target) };
  const journal = { version: 1, transaction, phase: 'prepared', previous,
    next: { ...previous, fingerprint: await files.packageFingerprint(candidate) }, binding: null };
  await json(join(root, 'desktop-plugins/installations.json'), { version: 1, installations: [previous] });
  return { target, staging, candidate, journal };
}
async function readPurity() {
  const api = upstream(), manager = createCapabilitySettings(api, { root });
  const before = await tree();
  const fresh = await manager.catalog();
  assert.equal(fresh.plugins.length, 0); assert.equal(fresh.marketplaces.length, 0);
  assert.equal(fresh.recovery, undefined);
  assert.deepEqual(await tree(), before);
  assert.deepEqual(mutations, []);
  assert.equal(calls.initialize, 0); assert.equal(calls.builtin, 0);
  await json(join(root, 'config.toml'), { skills: ['+skills'], mcp_servers: {
    echo: { command: 'not-executed', enabled: false },
  } });
  await json(join(root, '.stepcode/config.toml'), { skills: ['-project-only'] });
  await fs.mkdir(dirname(journalPath), { recursive: true });
  await fs.writeFile(journalPath, '{malformed pending journal');
  const pending = await tree();
  const catalog = await manager.catalog();
  assert.equal(catalog.mcp[0].enabled, false);
  assert.equal(catalog.recovery.required, true);
  assert.equal(catalog.recovery.pluginId, undefined);
  assert.ok(catalog.warnings.some(value => value.includes('Incomplete plugin update')));
  assert.deepEqual(documents.at(-1), { global: { skills: ['+skills'] }, project: { skills: ['-project-only'] } });
  assert.deepEqual(await tree(), pending, 'catalog must not recover even a malformed journal');
  for (const action of ['marketplace-add', 'marketplace-update', 'marketplace-remove', 'plugin-check-updates',
    'plugin-update', 'plugin-install', 'plugin-remove', 'plugin-toggle', 'mcp-toggle',
    'skill-create', 'skill-toggle', 'skill-remove']) {
    for (const preserveRuntime of [false, true])
      await assert.rejects(manager.mutate({ action, preserveRuntime }), code('update-recovery-required'));
  }
  await assert.rejects(manager.importSkill('unused'), code('update-recovery-required'));
  await assert.rejects(manager.initialize(), code('update-recovery-required'));
  assert.deepEqual(await tree(), pending); assert.deepEqual(mutations, []);
  assert.equal(calls.initialize, 0); assert.equal(calls.builtin, 0);
}
async function initialization() {
  const manager = createCapabilitySettings(upstream(), { root });
  await manager.catalog();
  const result = await manager.initialize();
  assert.equal(result.warnings[0], 'Initialized explicitly');
  assert.equal(calls.initialize, 0); assert.equal(calls.builtin, 1);
  await assert.rejects(fs.lstat(join(root, 'config.toml')), code('ENOENT'));
  const before = await tree();
  await manager.catalog();
  assert.deepEqual(await tree(), before);
  assert.equal(calls.initialize, 0); assert.equal(calls.builtin, 1);
}
async function inspection() {
  assert.equal(await update.inspectPluginUpdate(root), undefined);
  await update.recoverPluginUpdate(root);
  await assert.rejects(update.recoverPluginUpdate(root, { expectedJournal: 'a'.repeat(64) }),
    code('update-recovery-required'));
  const f = await fixture();
  await json(journalPath, f.journal);
  const before = await tree(), bytes = await fs.readFile(journalPath), pending = await update.inspectPluginUpdate(root);
  assert.equal(pending.id, 'theme-a'); assert.equal(pending.fingerprint, digest(bytes));
  assert.deepEqual(Object.keys(pending).sort(), ['fingerprint', 'id']);
  assert.deepEqual(await tree(), before); assert.deepEqual(mutations, []);
  await fs.writeFile(journalPath, Buffer.concat([bytes, Buffer.from('\n')]));
  const replaced = await tree();
  await assert.rejects(update.recoverPluginUpdate(root, { expectedJournal: pending.fingerprint }),
    code('update-recovery-required'));
  assert.deepEqual(await tree(), replaced); assert.deepEqual(mutations, []);
  await assert.rejects(update.applyPluginUpdate(root, f.journal), code('update-recovery-required'));
  assert.deepEqual(await tree(), replaced);
  const inspected = await update.inspectPluginUpdate(root);
  await update.recoverPluginUpdate(root, { expectedJournal: inspected.fingerprint });
  assert.equal(await update.inspectPluginUpdate(root), undefined);
  assert.equal(await files.packageFingerprint(f.target), f.journal.previous.fingerprint);
  await json(journalPath, { ...f.journal, next: { ...f.journal.next, id: 'another-plugin' } });
  const invalid = await tree(); mutations.length = 0;
  await assert.rejects(update.inspectPluginUpdate(root), code('update-recovery-required'));
  assert.deepEqual(await tree(), invalid); assert.deepEqual(mutations, []);
}
async function recoveryCatalog() {
  const f = await fixture();
  const other = join(root, 'plugins/other');
  await packageAt(other, { ...themeManifest('1.0.0'), id: 'other' });
  const otherReceipt = { ...f.journal.previous, instance: randomUUID(), id: 'other', folder: 'other',
    fingerprint: await files.packageFingerprint(other) };
  await json(join(root, 'desktop-plugins/installations.json'),
    { version: 1, installations: [f.journal.previous, otherReceipt] });
  const manager = createCapabilitySettings(upstream({
    async listInstalledStepPlugins() {
      return { plugins: [
        { id: 'theme-a', name: 'Theme A', rootPath: f.target, version: '1.0.0', mcpServers: [], warnings: [] },
        { id: 'other', name: 'Other', rootPath: other, mcpServers: [], warnings: [] },
      ], warnings: [] };
    },
  }), { root });
  await json(journalPath, f.journal);
  const before = await tree(), catalog = await manager.catalog();
  assert.equal(catalog.recovery.required, true); assert.equal(catalog.recovery.pluginId, 'theme-a');
  assert.equal(catalog.plugins[0].packageDescriptor.provenance, 'unknown');
  assert.equal(catalog.plugins[0].packageDescriptor.instance, undefined);
  assert.equal(catalog.plugins[1].packageDescriptor.provenance, 'recorded');
  assert.ok(catalog.warnings.some(value => value.includes('Incomplete plugin update')));
  assert.deepEqual(await tree(), before); assert.deepEqual(mutations, []);
  await fs.writeFile(journalPath, '{"previous":{"id":"../../not-safe"}}');
  const invalid = await tree(), blocked = await manager.catalog();
  assert.equal(blocked.recovery.required, true); assert.equal(blocked.recovery.pluginId, undefined);
  assert.ok(blocked.plugins.every(plugin => plugin.packageDescriptor.provenance === 'unknown'));
  assert.deepEqual(await tree(), invalid); assert.deepEqual(mutations, []);
}
async function recoveryRace() {
  const f = await fixture();
  await json(journalPath, f.journal);
  const pending = await update.inspectPluginUpdate(root);
  let replaced = false;
  hooks.readdir = async target => {
    if (!replaced && target === f.target) {
      replaced = true;
      await json(journalPath, { ...f.journal, phase: 'committed' });
    }
  };
  const receipt = await fs.readFile(join(root, 'desktop-plugins/installations.json'));
  mutations.length = 0;
  await assert.rejects(update.recoverPluginUpdate(root, { expectedJournal: pending.fingerprint }),
    code('update-recovery-required'));
  assert.equal(replaced, true); assert.deepEqual(mutations, []);
  assert.ok((await fs.readFile(join(root, 'desktop-plugins/installations.json'))).equals(receipt));
  assert.equal((await update.inspectPluginUpdate(root)).fingerprint, digest(await fs.readFile(journalPath)));
}
async function discovery() {
  const market = join(root, 'marketplaces/community');
  await fs.mkdir(market, { recursive: true });
  const api = upstream({ async listMarketplaceSources() {
    return [{ name: 'community', kind: 'git', path: market, origin: 'https://example.invalid/community.git' }];
  } });
  const manager = createCapabilitySettings(api, { root });
  await manager.mutate({ action: 'marketplace-add', source: 'https://example.invalid/community.git', preserveRuntime: true });
  await manager.mutate({ action: 'plugin-check-updates', preserveRuntime: true });
  await manager.mutate({ action: 'marketplace-update', name: 'community', preserveRuntime: true });
  await manager.mutate({ action: 'marketplace-remove', name: 'community', preserveRuntime: true });
  assert.equal(calls.add, 1); assert.equal(calls.refresh, 2); assert.equal(calls.remove, 1);
  assert.equal(calls.initialize, 0); assert.equal(calls.builtin, 0);
  await assert.rejects(fs.lstat(join(root, 'config.toml')), code('ENOENT'));
}
async function refreshFailures() {
  const markets = ['alpha', 'beta', 'local'].map(name => ({
    name, kind: name === 'local' ? 'local' : 'git', path: join(root, 'marketplaces', name), origin: null,
  }));
  for (const market of markets) await fs.mkdir(market.path, { recursive: true });
  const refreshed = [];
  const manager = createCapabilitySettings(upstream({ async listMarketplaceSources() { return markets; } }), {
    root,
    async refreshMarketplace(target) {
      refreshed.push(basename(target));
      if (basename(target) === 'alpha') throw Object.assign(new Error('private-password'), {
        code: 'marketplace-dns', details: {
          operation: 'marketplace-refresh', elapsedMs: 12, gitExitCode: 128,
          gitSignal: null, gitSystemCode: null, stderr: 'private-stderr', source: 'private-source',
        },
      });
    },
  });
  await assert.rejects(manager.mutate({ action: 'marketplace-update', name: 'alpha' }), code('marketplace-dns'));
  const result = await manager.mutate({ action: 'plugin-check-updates' });
  assert.deepEqual(refreshed, ['alpha', 'alpha', 'beta']);
  assert.equal(calls.refresh, 0, 'the injected native refresher must own Git execution');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].code, 'marketplace-dns');
  assert.equal(result.failures[0].details.gitExitCode, 128);
  assert.doesNotMatch(JSON.stringify(result), /private|stderr|source/);
  assert.deepEqual(mutations, []);
}
async function themeUpdate() {
  const cases = ['theme-update-valid', 'theme-update-v2'].includes(scenario) ? ['valid'] : ['old', 'candidate'];
  for (const invalid of cases) {
    const old = themeManifest('1.0.0'), next = themeManifest('2.0.0');
    if (invalid === 'old') old.commands = ['commands'];
    if (invalid === 'candidate') delete next.skills;
    const f = await fixture(old, next, scenario === 'theme-update-v2' ? v2Theme : undefined), before = await tree();
    if (invalid === 'valid') {
      await update.applyPluginUpdate(root, f.journal, { preserveRuntime: true });
      assert.equal(await files.packageFingerprint(f.target), f.journal.next.fingerprint);
      assert.equal(await update.inspectPluginUpdate(root), undefined);
    } else {
      mutations.length = 0;
      await assert.rejects(update.applyPluginUpdate(root, f.journal, { preserveRuntime: true }), code('stale'));
      assert.deepEqual(await tree(), before, invalid + ' must be proved before writing any journal');
      assert.deepEqual(mutations, []);
    }
  }
}
async function workerUpdate() {
  const old = themeManifest('1.0.0'), next = themeManifest('2.0.0');
  if (scenario === 'worker-update-old') old.commands = ['commands'];
  if (scenario === 'worker-update-candidate') delete next.skills;
  const f = await fixture(old, next, scenario === 'worker-update-v2' ? v2Theme : undefined),
    market = join(root, 'marketplaces/community'), source = join(market, 'plugins/example');
  await fs.mkdir(source, { recursive: true });
  await fs.cp(f.candidate, source, { recursive: true });
  await json(join(market, '.step-plugin/marketplace.json'), { plugins: [{ name: 'example' }] });
  await fs.rm(f.staging, { recursive: true });
  const stat = await fs.lstat(market);
  const sourceId = digest(JSON.stringify(['git', 'https://example.invalid/community.git', resolve(market),
    stat.dev, stat.ino, stat.birthtimeMs]));
  f.journal.previous.source = sourceId;
  await json(join(root, 'desktop-plugins/installations.json'), { version: 1, installations: [f.journal.previous] });
  const entry = { name: 'example', marketplace: 'community', sourcePath: source };
  let copied = 0, finalizedCandidate;
  const manager = createCapabilitySettings(upstream({
    async listMarketplaceSources() {
      return [{ name: 'community', kind: 'git', path: market, origin: 'https://example.invalid/community.git' }];
    },
    async listMarketplacePlugins() { return { entries: [entry], warnings: [] }; },
    async installMarketplacePlugin(_entry, directory, options) {
      assert.equal(options.provision, false); copied++;
      await fs.cp(source, join(directory, 'example'), { recursive: true });
      return { warnings: [] };
    },
  }), { root });
  hooks.rename = async (_source, destination) => {
    if (basename(destination) === 'candidate') finalizedCandidate = destination;
  };
  const input = { action: 'plugin-update', preserveRuntime: true, id: 'theme-a', name: 'example',
    marketplace: 'community', expectedInstance: f.journal.previous.instance, expectedSource: sourceId,
    expectedOldFingerprint: f.journal.previous.fingerprint, expectedFingerprint: f.journal.next.fingerprint,
    expectedOldVersion: '1.0.0', expectedVersion: '2.0.0' };
  const invalid = !['worker-update', 'worker-update-v2'].includes(scenario);
  if (invalid) await assert.rejects(manager.mutate(input), code('stale'));
  else await manager.mutate(input);
  assert.equal(copied, 1); assert.ok(finalizedCandidate);
  assert.equal(await files.packageFingerprint(f.target),
    invalid ? f.journal.previous.fingerprint : f.journal.next.fingerprint);
  assert.equal(await update.inspectPluginUpdate(root), undefined);
  assert.equal((await files.readReceipts(root)).installations[0].fingerprint,
    invalid ? f.journal.previous.fingerprint : f.journal.next.fingerprint);
  assert.equal(calls.initialize, 0); assert.equal(calls.builtin, 0);
}
async function themeRemoval() {
  const invalid = scenario === 'theme-remove-invalid', raced = scenario === 'theme-remove-race';
  const manifest = themeManifest('1.0.0');
  if (invalid) manifest.agents = ['agents'];
  const f = await fixture(manifest);
  const manager = createCapabilitySettings(upstream({
    async listInstalledStepPlugins() {
      return { plugins: [{ id: 'theme-a', rootPath: f.target }], warnings: [] };
    },
    async uninstallPlugin(directory, folder) {
      calls.uninstall++; await fs.rm(join(directory, folder), { recursive: true });
    },
  }), { root });
  let altered = false;
  if (raced) hooks.open = async target => {
    if (!altered && target === join(root, 'desktop-plugins/installations.json')) {
      altered = true;
      await json(join(f.target, 'step.plugin.json'), { ...manifest, commands: ['commands'] });
    }
  };
  const before = await tree();
  if (invalid || raced) {
    await assert.rejects(manager.mutate({ action: 'plugin-remove', id: 'theme-a', preserveRuntime: true,
      expectedFingerprint: f.journal.previous.fingerprint }), code('stale'));
    assert.equal(calls.uninstall, 0); assert.deepEqual(mutations, []);
    if (invalid) assert.deepEqual(await tree(), before);
    if (raced) assert.equal(altered, true);
    const receipt = JSON.parse(await fs.readFile(join(root, 'desktop-plugins/installations.json'), 'utf8')).installations[0];
    assert.equal(receipt.state, 'installed');
  } else {
    await manager.mutate({ action: 'plugin-remove', id: 'theme-a', preserveRuntime: true,
      expectedFingerprint: f.journal.previous.fingerprint });
    assert.equal(calls.uninstall, 1);
    assert.equal((await files.readReceipts(root)).installations.length, 0);
  }
}
try {
  if (scenario === 'read-purity') await readPurity();
  else if (scenario === 'initialization') await initialization();
  else if (scenario === 'inspection') await inspection();
  else if (scenario === 'recovery-catalog') await recoveryCatalog();
  else if (scenario === 'recovery-race') await recoveryRace();
  else if (scenario === 'discovery') await discovery();
  else if (scenario === 'refresh-failures') await refreshFailures();
  else if (scenario.startsWith('theme-update-')) await themeUpdate();
  else if (scenario.startsWith('worker-update')) await workerUpdate();
  else if (scenario.startsWith('theme-remove-')) await themeRemoval();
  else assert.fail('unknown scenario');
} finally {
  assert.equal(dirname(root), temporary);
  assert.ok(basename(root).startsWith('dfsc-worker-phase1-'));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
}
`;

function verify(scenario: string, temporaryDirectory?: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'TMPDIR'])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  if (temporaryDirectory)
    for (const key of ['TEMP', 'TMP', 'TMPDIR']) env[key] = temporaryDirectory;
  const result = spawnSync(process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-', scenario, repository],
    { cwd: repository, env, input: harness, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, `${scenario}\n${result.stdout}\n${result.stderr}`);
}

test('fresh and pending-journal catalogs stay read-only; every mutation rejects pending recovery', () => verify('read-purity'));
test('explicit initialization creates only the builtin marketplace without runtime settings', () => verify('initialization'));
test('journal inspection is read-only and recovery is bound to the guarded journal digest', () => verify('inspection'));
test('pending recovery marks only its safe plugin unknown; invalid journals block configuration conservatively', () => verify('recovery-catalog'));
test('recovery rechecks its journal after asynchronous preflight and before any writes', () => verify('recovery-race'));
test('discovery mutations never initialize settings, builtin markets or runtime provisioning', () => verify('discovery'));
test('refresh diagnostics preserve partial failure without skipping healthy markets or writing settings', () => verify('refresh-failures'));
test('theme update revalidates both old and candidate declarations before journaling', () => verify('theme-update-invalid'));
test('theme update accepts two proven data-only packages', () => verify('theme-update-valid'));
test('theme replacement accepts a version one to version two composition update', () => verify('theme-update-v2'));
test('worker forwards theme preservation to replacement and disables provisioning', () => verify('worker-update'));
test('worker preserves the runtime when upgrading a theme to version two composition', () => verify('worker-update-v2'));
test('worker rejects a non-theme old package even when update hashes match', () => verify('worker-update-old'));
test('worker rejects a non-theme staged candidate even when update hashes match', () => verify('worker-update-candidate'));
test('theme remove rejects executable declarations even with a matching ordinary hash', () => verify('theme-remove-invalid'));
test('theme remove rechecks proof after a package changes during receipt preflight', () => verify('theme-remove-race'));
test('theme remove accepts a proven data-only package', () => verify('theme-remove-valid'));

test('worker fixtures canonicalize aliased temporary directories and clean up their owned profiles', async t => {
  const temporary = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temporary, 'dfsc-worker-temp-alias-')));
  t.after(async () => {
    assert.equal(dirname(root), temporary);
    assert.ok(basename(root).startsWith('dfsc-worker-temp-alias-'));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const physical = join(root, 'physical'), alias = join(root, 'alias');
  await mkdir(physical);
  await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(alias, await realpath(alias));
  for (const scenario of ['read-purity', 'initialization', 'worker-update'])
    verify(scenario, alias);
  assert.deepEqual(await readdir(physical), []);
});
