import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CapabilityService } from '../electron/capability-service';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import { PluginHostBindingStore } from '../electron/plugin-host-contract.mjs';
import { mockHost } from '../../examples/plugins/host-client/testing.mjs';
import type { RuntimeEvent } from '../src/contracts';

async function fixture(hostAvailable = false) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-skeleton-native-'))), root = join(folder, 'profile');
  await mkdir(join(root, 'agent'), { recursive: true });
  const runtime = join(folder, 'runtime'), cached = resolve(process.env.DESKTOP_TEST_RUNTIME ?? 'runtime');
  await mkdir(runtime);
  for (const name of ['step', 'node']) await symlink(join(cached, name), join(runtime, name), process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of ['capability-admin.mjs', 'capability-failure.mjs', 'marketplace-refresh.mjs', 'capability-settings.mjs', 'plugin-files.mjs', 'theme-composition.mjs', 'plugin-update.mjs', 'plugin-configuration.mjs'])
    await copyFile(resolve('electron', name), join(runtime, name));
  const service = new CapabilityService({ root, runtime, node: join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
    environment: () => isolatedEnvironment(root), hostAvailable: () => hostAvailable });
  const market = join(folder, 'market');
  await cp(resolve('../examples/plugins/config-starter'), market, { recursive: true });
  return { folder, root, runtime, service, market };
}
test('explicit update check refreshes a real Git marketplace before installing its new pinned package', { timeout: 90000 }, async () => {
  const { folder, service, market } = await fixture();
  const git = (...args: string[]) => execFileSync('git', ['-C', market, ...args], { encoding: 'utf8', windowsHide: true });
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture package');
  };
  try {
    git('init', '--initial-branch=main'); commit();
    await service.mutate({ action: 'marketplace-add', source: pathToFileURL(market).href });
    const entry = (await service.catalog()).available.find(item => item.name === 'dfsc-config-example')!;
    await service.mutate({ action: 'plugin-install', name: entry.name, marketplace: entry.marketplace, ref: entry.package!.ref });
    const manifestPath = join(market, 'plugins/dfsc-config-example/step.plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: '0.2.0' })); commit();
    assert.equal((await service.catalog()).plugins[0].update?.status, 'current', 'Opening a catalog does not pull a remote market');
    assert.deepEqual(await service.mutate({ action: 'plugin-check-updates' }), { warnings: [] });
    const plugin = (await service.catalog()).plugins[0];
    assert.equal(plugin.update?.status, 'available');
    assert.equal(plugin.update?.version, '0.2.0');
    assert.equal(plugin.version, manifest.version, 'Checking does not install');
    await service.mutate({ action: 'plugin-update', id: plugin.id, ref: plugin.package!.ref, candidate: plugin.update!.ref! });
    assert.equal((await service.catalog()).plugins[0].version, '0.2.0');
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native update keeps the installation, settings revision, secrets and disabled service overrides', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const schemaPath = join(market, 'plugins/dfsc-config-example/dfsc.settings.json');
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    schema.groups[0].fields.push({ id: 'key', label: 'Key', type: 'secret' });
    await writeFile(schemaPath, JSON.stringify(schema));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const plugin = (await service.catalog()).plugins[0], ref = plugin.package!.ref;
    const initial = await service.configuration({ ref });
    const configured = await service.configuration({ ref }, { ref, revision: initial.revision,
      values: { ...initial.values, prefix: 'Keep this ' }, secrets: { key: { action: 'replace', value: 'private-update-test' } } });
    await service.mutate({ action: 'plugin-toggle', id: plugin.id, enabled: false });
    const switches = await readFile(join(root, 'config.toml'));
    const receiptPath = join(root, 'desktop-plugins/installations.json');
    const previous = JSON.parse(await readFile(receiptPath, 'utf8')).installations[0];
    const snapshot = join(root, 'desktop-plugins/settings', previous.instance, `${configured.revision}.json`);
    const privateBytes = await readFile(snapshot);
    const sourceName = (await service.catalog()).marketplaces.find(item => item.kind === 'local')!.name;
    const source = join(root, 'marketplaces', sourceName, 'plugins/dfsc-config-example');
    const manifest = JSON.parse(await readFile(join(source, 'step.plugin.json'), 'utf8'));
    const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCj0AAAAASUVORK5CYII=', 'base64');
    await writeFile(join(source, 'step.plugin.json'), JSON.stringify({ ...manifest, version: '0.2.0', icon: 'update.png' }));
    await writeFile(join(source, 'update.png'), icon);
    await writeFile(join(source, 'README.md'), '# Updated example\n');
    const catalog = await service.catalog(), candidate = catalog.plugins[0];
    assert.equal(candidate.update?.status, 'available');
    assert.equal(candidate.update?.version, '0.2.0');
    const update = service.mutate({ action: 'plugin-update', id: plugin.id,
      ref: candidate.package!.ref, candidate: candidate.update!.ref! });
    const concurrentRead = service.catalog();
    assert.ok((await update).warnings.every(warning => warning.startsWith('MCP declarations saved for ')));
    const after = (await concurrentRead).plugins[0];
    assert.equal(after.version, '0.2.0');
    assert.deepEqual(after.icon, { kind: 'png', dataUrl: `data:image/png;base64,${icon.toString('base64')}` });
    assert.equal(after.update?.status, 'current');
    assert.equal(after.package?.provenance, 'recorded');
    assert.equal(after.package?.configurationAvailable, true);
    const current = JSON.parse(await readFile(receiptPath, 'utf8')).installations[0];
    assert.equal(current.instance, previous.instance);
    assert.equal(current.source, previous.source);
    assert.notEqual(current.fingerprint, previous.fingerprint);
    const saved = await service.configuration({ ref: after.package!.ref });
    assert.equal(saved.configured, true);
    assert.equal(saved.revision, configured.revision);
    assert.equal(saved.values.prefix, 'Keep this ');
    assert.equal(saved.hasSecret.key, true);
    assert.ok((await readFile(snapshot)).equals(privateBytes), 'private snapshot remains byte-identical');
    assert.ok((await readFile(join(root, 'config.toml'))).equals(switches));
    assert.doesNotMatch(JSON.stringify(await concurrentRead), /private-update-test|expectedFingerprint|desktop-plugins|sourcePath/);
    await assert.rejects(service.document({ ref, path: 'README.md' }), /stale/);
    assert.equal((await service.document({ ref: after.package!.ref, path: 'README.md' })).text, '# Updated example\n');
    await assert.rejects(readFile(join(root, 'desktop-plugins/update-transaction.json')), { code: 'ENOENT' });
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native update can introduce a first configuration without adopting legacy files or authorizing its host', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture(true);
  try {
    const packageRoot = join(market, 'plugins/dfsc-config-example');
    const schema = await readFile(join(packageRoot, 'dfsc.settings.json'));
    await rm(join(packageRoot, 'dfsc.settings.json'));
    const original = JSON.parse(await readFile(join(packageRoot, 'step.plugin.json'), 'utf8'));
    const legacy = { ...original, mcpServers: { notes: { ...original.mcpServers.notes,
      env: { STEPFUN_API_KEY: 'legacy-managed-context' } } } };
    await writeFile(join(packageRoot, 'step.plugin.json'), JSON.stringify(legacy));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: original.id, marketplace: 'dfsc-config-example-local' });
    const installed = (await service.catalog()).plugins[0];
    assert.equal(installed.package!.configurationAvailable, false);
    await service.mutate({ action: 'plugin-toggle', id: installed.id, enabled: false });
    const switches = await readFile(join(root, 'config.toml'));
    const receiptPath = join(root, 'desktop-plugins/installations.json');
    const previous = JSON.parse(await readFile(receiptPath, 'utf8')).installations[0];
    const legacyDirectory = join(root, 'legacy-plugin');
    await mkdir(legacyDirectory);
    const legacyFiles = [
      ['config.json', JSON.stringify({ mode: 'follow', hostAccess: 'confirm', envFile: join(legacyDirectory, 'private.env') })],
      ['private.env', 'MAIN_KEY=old-main-secret\nASR_KEY=old-asr-secret\n'],
    ];
    for (const [name, bytes] of legacyFiles) await writeFile(join(legacyDirectory, name), bytes);
    const sourceName = (await service.catalog()).marketplaces.find(item => item.kind === 'local')!.name;
    const source = join(root, 'marketplaces', sourceName, 'plugins/dfsc-config-example');
    await writeFile(join(source, 'step.plugin.json'), JSON.stringify({ ...original, version: '0.2.0' }));
    await writeFile(join(source, 'dfsc.settings.json'), schema);
    await writeFile(join(source, 'dfsc.host.json'), JSON.stringify({ schemaVersion: 1, hostApiVersion: 1,
      consumer: { kind: 'mcp-stdio', server: 'notes' }, capabilities: ['model.text'] }));
    const candidate = (await service.catalog()).plugins[0];
    await service.mutate({ action: 'plugin-update', id: installed.id, ref: candidate.package!.ref, candidate: candidate.update!.ref! });
    const after = (await service.catalog()).plugins[0];
    assert.equal(after.version, '0.2.0');
    const current = JSON.parse(await readFile(receiptPath, 'utf8')).installations[0];
    assert.equal(current.instance, previous.instance);
    assert.equal(current.source, previous.source);
    assert.deepEqual(await readFile(join(root, 'config.toml')), switches);
    for (const [name, bytes] of legacyFiles) assert.equal(await readFile(join(legacyDirectory, name), 'utf8'), bytes);
    const settings = await service.hostSettings({ ref: after.package!.ref });
    assert.equal(settings.mode, null);
    assert.equal(settings.revision, 'unconfigured');
    assert.equal(settings.independent!.configured, false);
    await assert.rejects(readFile(join(root, 'desktop-plugins/host/bindings', `${current.instance}.json`)), { code: 'ENOENT' });
    await assert.rejects(readFile(join(root, 'desktop-plugins/bindings', `${current.folder}.json`)), { code: 'ENOENT' });
    await assert.rejects(service.hostSettings({ ref: candidate.package!.ref }), /host-unavailable/);
    assert.doesNotMatch(JSON.stringify(settings), /old-main-secret|old-asr-secret/);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('first configuration upgrades reject invalid schemas, foreign consumers and relaxed service boundaries', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const packageRoot = join(market, 'plugins/dfsc-config-example');
    const schema = JSON.parse(await readFile(join(packageRoot, 'dfsc.settings.json'), 'utf8'));
    await rm(join(packageRoot, 'dfsc.settings.json'));
    const original = JSON.parse(await readFile(join(packageRoot, 'step.plugin.json'), 'utf8'));
    const legacy = { ...original, mcpServers: { notes: { ...original.mcpServers.notes,
      env: { STEPFUN_API_KEY: 'legacy-managed-context' } } } };
    await writeFile(join(packageRoot, 'step.plugin.json'), JSON.stringify(legacy));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: original.id, marketplace: 'dfsc-config-example-local' });
    const sourceName = (await service.catalog()).marketplaces.find(item => item.kind === 'local')!.name;
    const source = join(root, 'marketplaces', sourceName, 'plugins/dfsc-config-example');
    const receipts = await readFile(join(root, 'desktop-plugins/installations.json'));
    const next = { ...original, version: '0.2.0' };
    for (const [settings, manifest, error] of [
      [{ ...schema, schemaVersion: 99 }, next, /configuration-schema-changed/],
      [{ ...schema, consumer: { kind: 'json-file-v1', server: 'foreign' } }, next, /configuration-schema-changed/],
      [schema, { ...next, mcpServers: { notes: { url: 'https://example.invalid/mcp' } } }, /configuration-schema-changed/],
      [schema, { ...legacy, version: '0.2.0' }, /configuration-schema-changed/],
      [schema, { ...next, mcpServers: { notes: { ...original.mcpServers.notes, enabled: false } } }, /update-capabilities-changed/],
      [schema, { ...next, mcpServers: { ...original.mcpServers, extra: { command: 'node' } } }, /update-capabilities-changed/],
    ] as const) {
      await writeFile(join(source, 'dfsc.settings.json'), JSON.stringify(settings));
      await writeFile(join(source, 'step.plugin.json'), JSON.stringify(manifest));
      const candidate = (await service.catalog()).plugins[0];
      await assert.rejects(service.mutate({ action: 'plugin-update', id: candidate.id,
        ref: candidate.package!.ref, candidate: candidate.update!.ref! }), error);
      assert.deepEqual(await readFile(join(root, 'desktop-plugins/installations.json')), receipts);
    }
    await writeFile(join(source, 'dfsc.settings.json'), JSON.stringify(schema));
    await writeFile(join(source, 'step.plugin.json'), JSON.stringify(next));
    const receipt = JSON.parse(receipts.toString('utf8')).installations[0];
    await mkdir(join(root, 'desktop-plugins/bindings'), { recursive: true });
    const bindingPath = join(root, 'desktop-plugins/bindings', `${receipt.folder}.json`);
    const revoked = JSON.stringify({ version: 1, instance: receipt.instance, id: receipt.id, revoked: true });
    await writeFile(bindingPath, revoked);
    const candidate = (await service.catalog()).plugins[0];
    await assert.rejects(service.mutate({ action: 'plugin-update', id: candidate.id,
      ref: candidate.package!.ref, candidate: candidate.update!.ref! }), /configuration-schema-changed/);
    assert.equal(await readFile(bindingPath, 'utf8'), revoked);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
for (const mode of ['follow', 'independent'] as const) test(`native update preserves configuration but requires host reselection (${mode})`, { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture(true);
  const broker = await mockHost();
  try {
    const packageRoot = join(market, 'plugins/dfsc-config-example');
    const schema = JSON.parse(await readFile(join(packageRoot, 'dfsc.settings.json'), 'utf8'));
    schema.groups[0].fields.push({ id: 'key', label: 'Main key', type: 'secret', required: true },
      { id: 'asr_key', label: 'ASR key', type: 'secret' });
    await writeFile(join(packageRoot, 'dfsc.settings.json'), JSON.stringify(schema));
    await writeFile(join(packageRoot, 'dfsc.host.json'), JSON.stringify({ schemaVersion: 1, hostApiVersion: 1,
      consumer: { kind: 'mcp-stdio', server: 'notes' }, capabilities: ['model.text', 'model.asr'] }));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const plugin = (await service.catalog()).plugins[0], ref = plugin.package!.ref;
    const initial = await service.configuration({ ref });
    const configured = await service.configuration({ ref }, { ref, revision: initial.revision,
      values: { ...initial.values, prefix: 'Preserved ' }, secrets: {
        key: { action: 'replace', value: 'retained-main-secret' }, asr_key: { action: 'replace', value: 'retained-asr-secret' },
      } });
    const selected = await service.hostSettings({ ref }, { ref, revision: 'unconfigured', mode,
      ...(mode === 'follow' ? { models: { 'model.asr': 'old-asr' } } : {
        configuration: { ref, revision: configured.revision, values: configured.values,
          secrets: { key: { action: 'keep' }, asr_key: { action: 'keep' } } },
      }) });
    const receiptPath = join(root, 'desktop-plugins/installations.json');
    const previous = JSON.parse(await readFile(receiptPath, 'utf8')).installations[0];
    const pointerPath = join(root, 'desktop-plugins/host/bindings', `${previous.instance}.json`);
    const pointer = await readFile(pointerPath);
    const configurationPath = join(root, 'desktop-plugins/settings', previous.instance, `${selected.independent!.revision}.json`);
    const configuration = await readFile(configurationPath);
    const sourceName = (await service.catalog()).marketplaces.find(item => item.kind === 'local')!.name;
    const manifestPath = join(root, 'marketplaces', sourceName, 'plugins/dfsc-config-example/step.plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, version: '0.2.0' }));
    const candidate = (await service.catalog()).plugins[0];
    await service.mutate({ action: 'plugin-update', id: plugin.id, ref: candidate.package!.ref, candidate: candidate.update!.ref! });
    const after = (await service.catalog()).plugins[0], nextRef = after.package!.ref;
    const reset = await service.hostSettings({ ref: nextRef });
    assert.equal(reset.mode, null);
    assert.deepEqual(reset.models, {});
    assert.equal(reset.configurationCurrent, false);
    assert.equal(reset.independent!.revision, selected.independent!.revision);
    assert.equal(reset.independent!.values.prefix, 'Preserved ');
    assert.deepEqual(reset.independent!.hasSecret, { key: true, asr_key: true });
    assert.deepEqual(await readFile(configurationPath), configuration);
    assert.deepEqual(await readFile(pointerPath), pointer);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')).installations[0];
    const descriptor = { kind: 'installed' as const, provenance: 'recorded' as const, name: receipt.folder, id: receipt.id,
      instance: receipt.instance, fingerprint: receipt.fingerprint, root: join(root, 'plugins', receipt.folder), ref: nextRef };
    await assert.rejects(new PluginHostBindingStore(root).launch(descriptor, broker.launch()), /invalid-configuration/);
    await assert.rejects(service.hostSettings({ ref: nextRef },
      { ref: nextRef, revision: selected.revision, mode: 'follow' }), /stale-configuration/);
    const saved = await service.hostSettings({ ref: nextRef },
      { ref: nextRef, revision: 'unconfigured', mode, ...(mode === 'independent' ? {
        configuration: { ref: nextRef, revision: reset.independent!.revision, values: reset.independent!.values,
          secrets: { key: { action: 'keep' }, asr_key: { action: 'keep' } } },
      } : {}) });
    assert.equal(saved.mode, mode);
    assert.equal(saved.configurationCurrent, true);
    assert.deepEqual(saved.independent!.hasSecret, { key: true, asr_key: true });
    assert.notEqual(saved.revision, selected.revision);
    assert.equal(saved.runtime.status, 'restart-required');
    assert.doesNotMatch(JSON.stringify([reset, saved]), /retained-main-secret|retained-asr-secret/);
  } finally { await broker.close(); await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native update rejects incompatible settings, service changes, stale candidates and non-upgrades', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const sourceName = (await service.catalog()).marketplaces.find(item => item.kind === 'local')!.name;
    const source = join(root, 'marketplaces', sourceName, 'plugins/dfsc-config-example');
    const manifestPath = join(source, 'step.plugin.json');
    const original = JSON.parse(await readFile(manifestPath, 'utf8'));
    const receipts = await readFile(join(root, 'desktop-plugins/installations.json'));
    const updateInput = async () => {
      const plugin = (await service.catalog()).plugins[0];
      return { action: 'plugin-update' as const, id: plugin.id, ref: plugin.package!.ref, candidate: plugin.update?.ref ?? 'missing' };
    };
    for (const version of [original.version, '0.0.1', 'not-semver']) {
      await writeFile(manifestPath, JSON.stringify({ ...original, version }));
      const plugin = (await service.catalog()).plugins[0];
      assert.notEqual(plugin.update?.status, 'available');
      await assert.rejects(service.mutate(await updateInput()), /stale/);
    }
    await writeFile(manifestPath, JSON.stringify({ ...original, version: '0.2.0' }));
    const schemaPath = join(source, 'dfsc.settings.json'), schemaBytes = await readFile(schemaPath);
    await writeFile(schemaPath, Buffer.concat([schemaBytes, Buffer.from('\n')]));
    await assert.rejects(service.mutate(await updateInput()), /configuration-schema-changed/);
    await rm(schemaPath);
    await assert.rejects(service.mutate(await updateInput()), /configuration-schema-changed/);
    await writeFile(schemaPath, schemaBytes);
    for (const notes of [
      { ...original.mcpServers.notes, env: { STEPFUN_API_KEY: 'legacy-managed-context' } },
      { ...original.mcpServers.notes, enabled: false },
      { url: 'https://example.invalid/mcp' },
    ]) {
      await writeFile(manifestPath, JSON.stringify({ ...original, version: '0.2.0', mcpServers: { notes } }));
      await assert.rejects(service.mutate(await updateInput()), /update-capabilities-changed/);
    }
    await writeFile(manifestPath, JSON.stringify({ ...original, version: '0.2.0', mcpServers: { ...original.mcpServers,
      additional: { command: 'node', args: ['new.mjs'] } } }));
    await assert.rejects(service.mutate(await updateInput()), /update-capabilities-changed/);
    await writeFile(manifestPath, JSON.stringify({ ...original, version: '0.2.0' }));
    const stale = await updateInput();
    await writeFile(join(source, 'README.md'), 'Changed after confirmation');
    await assert.rejects(service.mutate(stale), /stale/);
    assert.ok((await readFile(join(root, 'desktop-plugins/installations.json'))).equals(receipts));
    assert.equal(JSON.parse(await readFile(join(root, 'plugins/dfsc-config-example/step.plugin.json'), 'utf8')).version, original.version);
    await service.mutate({ action: 'marketplace-remove', name: sourceName });
    await service.mutate({ action: 'marketplace-add', source: market });
    const otherSource = join(root, 'marketplaces', sourceName, 'plugins/dfsc-config-example/step.plugin.json');
    await writeFile(otherSource, JSON.stringify({ ...original, version: '0.3.0' }));
    assert.equal((await service.catalog()).plugins[0].update?.status, 'unavailable');
    await assert.rejects(service.mutate(await updateInput()), /stale/);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native installation preserves provenance and blocks two package names declaring the same runtime ID', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    await service.mutate({ action: 'marketplace-add', source: market });
    const available = (await service.catalog()).available.find(plugin => plugin.name === 'dfsc-config-example');
    assert.deepEqual(available?.package?.categories, ['text-documents']);
    assert.deepEqual(available?.package?.keywords, ['notes', 'formatting']);
    const installs = await Promise.allSettled(Array.from({ length: 2 }, () =>
      service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' })));
    assert.equal(installs.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(String(installs.find(result => result.status === 'rejected')!.reason), /already-exists/);
    let catalog = await service.catalog();
    const plugin = catalog.plugins[0], ref = plugin.package!.ref;
    assert.equal(plugin.package?.provenance, 'recorded');
    assert.equal(plugin.package?.configurationAvailable, true);
    assert.deepEqual(plugin.package?.categories, ['text-documents']);
    assert.deepEqual(plugin.package?.keywords, ['notes', 'formatting']);
    assert.deepEqual(plugin.installationSource, { status: 'recorded', marketplaces: ['dfsc-config-example-local'] });
    assert.doesNotMatch(JSON.stringify(catalog), /packageDescriptor|installations\.json/);
    assert.match((await service.document({ ref, path: 'README.md' })).text, /DFSC Configuration Example/);
    const settings = await service.configuration({ ref });
    await service.configuration({ ref }, { ref, revision: settings.revision, values: settings.values, secrets: {} });
    const sourceName = catalog.marketplaces.find(source => source.kind !== 'builtin')!.name;
    await service.mutate({ action: 'marketplace-remove', name: sourceName });
    catalog = await service.catalog();
    assert.equal(catalog.plugins[0].package?.provenance, 'recorded');
    assert.equal(catalog.plugins[0].marketplace, 'dfsc-config-example-local');
    assert.deepEqual(catalog.plugins[0].installationSource, { status: 'recorded', marketplaces: ['dfsc-config-example-local'] });
    // Reusing the same marketplace folder must not claim an earlier installation.
    await service.mutate({ action: 'marketplace-add', source: market });
    catalog = await service.catalog();
    const replacement = catalog.available.find(item => item.name === 'dfsc-config-example')!;
    assert.equal(replacement.installed, false);
    assert.equal(replacement.blocked, true);
    assert.equal(catalog.plugins[0].package?.provenance, 'recorded');
    const other = join(folder, 'other');
    await cp(market, other, { recursive: true });
    await writeFile(join(other, '.step-plugin/marketplace.json'), JSON.stringify({ name: 'other-market',
      plugins: [{ name: 'different-folder', source: './plugins/dfsc-config-example' }] }));
    await service.mutate({ action: 'marketplace-add', source: other });
    await assert.rejects(service.mutate({ action: 'plugin-install', name: 'different-folder', marketplace: 'other-market' }), /already-exists/);
    await service.mutate({ action: 'plugin-remove', id: plugin.id });
    const binding = JSON.parse(await readFile(join(root, 'desktop-plugins/bindings/dfsc-config-example.json'), 'utf8'));
    assert.equal(binding.revoked, true);
    await assert.rejects(service.document({ ref, path: 'README.md' }), /stale/);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('raw marketplace duplicates and legacy installations remain unambiguous', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const manifest = { name: 'duplicates', plugins: [
      { name: 'same-package', source: './plugins/dfsc-config-example' },
      { name: 'same-package', source: './plugins/dfsc-config-example' },
    ] };
    await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify(manifest));
    await service.mutate({ action: 'marketplace-add', source: market });
    let catalog = await service.catalog();
    assert.equal(catalog.available.find(item => item.name === 'same-package')?.blocked, true);
    await assert.rejects(service.mutate({ action: 'plugin-install', name: 'same-package', marketplace: 'duplicates' }), /plugin-conflict/);
    await mkdir(join(root, 'plugins'), { recursive: true });
    await cp(join(market, 'plugins/dfsc-config-example'), join(root, 'plugins/legacy'), { recursive: true });
    catalog = await service.catalog();
    const legacy = catalog.plugins.find(item => item.id === 'dfsc-config-example')!;
    assert.equal(legacy.package?.provenance, 'unknown');
    assert.equal(legacy.package?.configurationAvailable, false);
    assert.equal(legacy.marketplace, undefined, 'A matching copy does not mint an installation receipt');
    assert.deepEqual(legacy.installationSource, { status: 'matched', marketplaces: ['duplicates'] });
    await assert.rejects(service.configuration({ ref: legacy.package!.ref }), /invalid-configuration/);
    const secondMarket = join(folder, 'second-market');
    await cp(market, secondMarket, { recursive: true });
    await writeFile(join(secondMarket, '.step-plugin/marketplace.json'), JSON.stringify({
      name: 'second-market', plugins: [{ name: 'another-package', source: './plugins/dfsc-config-example' }],
    }));
    await service.mutate({ action: 'marketplace-add', source: secondMarket });
    catalog = await service.catalog();
    assert.deepEqual(catalog.plugins.find(item => item.id === legacy.id)?.installationSource,
      { status: 'matched', marketplaces: ['duplicates', 'second-market'] });
    const readme = join(root, 'plugins/legacy/README.md'), original = await readFile(readme);
    await writeFile(readme, Buffer.concat([original, Buffer.from('\nLocal modification\n')]));
    catalog = await service.catalog();
    const modified = catalog.plugins.find(item => item.id === legacy.id)!;
    assert.deepEqual(modified.installationSource, { status: 'unknown', marketplaces: [] });
    assert.equal(modified.package?.configurationAvailable, false);
    await assert.rejects(readFile(join(root, 'desktop-plugins/installations.json')), { code: 'ENOENT' });
    await writeFile(readme, original);
    await cp(join(root, 'plugins/legacy'), join(root, 'plugins/duplicate'), { recursive: true });
    catalog = await service.catalog();
    assert.equal(catalog.plugins.find(item => item.id === legacy.id)?.package?.provenance, 'conflict');
    assert.equal(catalog.plugins.find(item => item.id === legacy.id)?.installationSource?.status, 'conflict');
    await assert.rejects(service.mutate({ action: 'plugin-remove', id: legacy.id }), /plugin-conflict/);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native normalized IDs block a second installation and restrict existing conflicting copies', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const source = join(market, 'plugins/dfsc-config-example'), manifestPath = join(source, 'step.plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, id: ' dfsc-config-example ' }));
    const other = join(market, 'plugins/other-folder');
    await cp(source, other, { recursive: true });
    await writeFile(join(other, 'step.plugin.json'), JSON.stringify(manifest));
    await writeFile(join(market, '.step-plugin/marketplace.json'), JSON.stringify({ name: 'normalized-ids', plugins: [
      { name: 'first-folder', source: './plugins/dfsc-config-example' },
      { name: 'other-folder', source: './plugins/other-folder' },
    ] }));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'first-folder', marketplace: 'normalized-ids' });
    const before = await readFile(join(root, 'desktop-plugins/installations.json'));
    const candidate = (await service.catalog()).available.find(item => item.name === 'other-folder')!;
    await assert.rejects(service.mutate({ action: 'plugin-install', name: candidate.name,
      marketplace: candidate.marketplace, ref: candidate.package!.ref }), /already-exists/);
    assert.ok((await readFile(join(root, 'desktop-plugins/installations.json'))).equals(before));
    await assert.rejects(readFile(join(root, 'plugins/other-folder/step.plugin.json')), { code: 'ENOENT' });
    await cp(other, join(root, 'plugins/external-copy'), { recursive: true });
    const catalog = await service.catalog(), plugin = catalog.plugins[0];
    assert.equal(plugin.package?.provenance, 'conflict');
    assert.ok(catalog.warnings.some(warning => warning.includes('Conflicting installed plugin ID')));
    await assert.rejects(service.configuration({ ref: plugin.package!.ref }), /invalid-configuration/);
    await assert.rejects(service.mutate({ action: 'plugin-toggle', id: plugin.id, enabled: false }), /plugin-conflict/);
    await assert.rejects(service.mutate({ action: 'plugin-remove', id: plugin.id }), /plugin-conflict/);
    assert.ok((await readFile(join(root, 'desktop-plugins/installations.json'))).equals(before));
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('rejected uninstall preserves configuration and successful uninstall revokes only the selected instance', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    const schemaPath = join(market, 'plugins/dfsc-config-example/dfsc.settings.json');
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    schema.groups[0].fields.push({ id: 'key', label: 'Key', type: 'secret' });
    await writeFile(schemaPath, JSON.stringify(schema));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const plugin = (await service.catalog()).plugins[0], ref = plugin.package!.ref;
    const initial = await service.configuration({ ref });
    const saved = await service.configuration({ ref }, { ref, revision: initial.revision,
      values: { ...initial.values, prefix: 'Preserved ' }, secrets: { key: { action: 'replace', value: 'fixture-private-key' } } });
    const receiptPath = join(root, 'desktop-plugins/installations.json');
    const bindingPath = join(root, 'desktop-plugins/bindings/dfsc-config-example.json');
    const receiptBytes = await readFile(receiptPath), bindingBytes = await readFile(bindingPath);
    const duplicate = join(root, 'plugins/duplicate');
    await cp(join(root, 'plugins/dfsc-config-example'), duplicate, { recursive: true });
    await assert.rejects(service.mutate({ action: 'plugin-remove', id: plugin.id }), /plugin-conflict/);
    assert.ok((await readFile(bindingPath)).equals(bindingBytes), 'preflight rejection must not revoke configuration');
    assert.ok((await readFile(receiptPath)).equals(receiptBytes));
    await rm(duplicate, { recursive: true });
    const restored = (await service.catalog()).plugins[0].package!.ref;
    const current = await service.configuration({ ref: restored });
    assert.equal(current.configured, true);
    assert.equal(current.revision, saved.revision);
    assert.equal(current.values.prefix, 'Preserved ');
    const kept = await service.configuration({ ref: restored }, { ref: restored, revision: current.revision,
      values: current.values, secrets: { key: { action: 'keep' } } });
    assert.equal(kept.hasSecret.key, true);
    const receipts = JSON.parse(receiptBytes.toString('utf8')), selected = receipts.installations[0];
    const other = { ...selected, folder: 'unpublished-copy', instance: '00000000-0000-4000-8000-000000000000', state: 'pending' };
    receipts.installations.push(other);
    await writeFile(receiptPath, JSON.stringify(receipts));
    const otherBinding = join(root, 'desktop-plugins/bindings/unpublished-copy.json');
    const otherBytes = JSON.stringify({ version: 1, instance: other.instance, id: other.id, revoked: false });
    await writeFile(otherBinding, otherBytes);
    await service.mutate({ action: 'plugin-remove', id: plugin.id });
    const revoked = JSON.parse(await readFile(bindingPath, 'utf8'));
    assert.equal(revoked.revoked, true);
    assert.equal(revoked.instance, selected.instance);
    assert.equal(revoked.id, selected.id);
    assert.equal(await readFile(otherBinding, 'utf8'), otherBytes);
    assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')).installations, [other]);
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('native catalog reports interrupted installation and removal without granting a configuration identity', { timeout: 90000 }, async () => {
  const { folder, service, market, root } = await fixture();
  try {
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const receiptPath = join(root, 'desktop-plugins/installations.json');
    const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
    for (const state of ['pending', 'removing']) {
      receipts.installations[0].state = state;
      await writeFile(receiptPath, JSON.stringify(receipts));
      const catalog = await service.catalog(), plugin = catalog.plugins[0];
      assert.ok(catalog.warnings.some(warning => warning.includes('Incomplete plugin operation')));
      assert.equal(plugin.package?.provenance, 'unknown');
      assert.equal(plugin.package?.configurationAvailable, false);
      await assert.rejects(service.configuration({ ref: plugin.package!.ref }), /invalid-configuration/);
      assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).installations[0].state, state);
    }
  } finally { await service.stop(); await rm(folder, { recursive: true, force: true, maxRetries: 5 }); }
});
test('real native runtime discovers and calls the configured MCP without inheriting account credentials', { timeout: 90000 }, async () => {
  const { folder, root, runtime, service, market } = await fixture();
  const events: RuntimeEvent[] = [];
  const pool = new SessionRuntimes(event => {
    events.push(event);
    if (event.type === 'extension_ui_request' && event.method === 'confirm') {
      const worker = pool.workers.get(event.runtimeId);
      if (worker) queueMicrotask(() => pool.respondToRequest(worker, { id: event.id, confirmed: true }));
    }
  });
  let calls = 0, providerError: unknown;
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end('{"data":[]}'); return; }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({
        id: 'local', object: 'chat.completion.chunk', model: 'local', created: 1, choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`;
      if (calls++ === 0) {
        const tool = body.tools?.find((item: { function: { name: string } }) => item.function.name === 'dfsc-config-example__notes__format_note');
        assert.ok(tool, 'native runtime must expose the installed plugin tool');
        response.write(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 'note-call', type: 'function',
          function: { name: tool.function.name, arguments: '{"text":"hello"}' } }] }));
        response.end(`${frame({}, 'tool_calls')}data: [DONE]\n\n`);
      } else {
        assert.match(JSON.stringify(body.messages), /QA HELLO/);
        response.end(`${frame({ role: 'assistant', content: 'Native configurable plugin verified.' })}${frame({}, 'stop')}data: [DONE]\n\n`);
      }
    } catch (error) { providerError = error; response.end(); }
  });
  try {
    const packageRoot = join(market, 'plugins/dfsc-config-example');
    const script = join(packageRoot, 'server/stdio.mjs');
    const original = await readFile(script, 'utf8');
    await writeFile(script, original.replace('clearInheritedCredentials();',
      `if (process.env.STEPFUN_API_KEY !== 'DFSC_INDEPENDENT_PLUGIN') throw new Error('Credential isolation failed');\nclearInheritedCredentials();`));
    const manifestPath = join(packageRoot, 'step.plugin.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.mcpServers.notes.command = process.execPath;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await service.mutate({ action: 'marketplace-add', source: market });
    await service.mutate({ action: 'plugin-install', name: 'dfsc-config-example', marketplace: 'dfsc-config-example-local' });
    const plugin = (await service.catalog()).plugins[0], ref = plugin.package!.ref;
    const config = await service.configuration({ ref });
    await service.configuration({ ref }, { ref, revision: config.revision, values: { prefix: 'QA ', uppercase: true, limit: 100 }, secrets: {} });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`, models = join(root, 'local-models.json');
    await writeFile(join(root, 'auth.json'), JSON.stringify({ step: { type: 'api_key', key: 'fixture-account-must-not-inherit' } }));
    await writeFile(join(root, 'config.toml'), '[telemetry]\nenabled = false\n');
    await writeFile(models, JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'local', providers: { fixture: {
      baseUrl, api: 'openai-completions', apiKey: 'local-fixture', models: [
        { id: 'local', name: 'Local fixture', input: ['text'], contextWindow: 32768, maxTokens: 1024 },
      ],
    } } }));
    const worker = await pool.open(join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node'),
      join(runtime, 'step/dist/bundle/step.js'), folder, { ...isolatedEnvironment(root),
        STEPCODE_CONFIG_PATH: models });
    await worker.rpc.request('prompt', { message: 'Use the local note formatter for hello.' });
    const deadline = Date.now() + 30000;
    while (!events.some(event => event.type === 'agent_end') && !providerError && Date.now() < deadline)
      await new Promise(done => setTimeout(done, 25));
    if (providerError) throw providerError;
    assert.match(JSON.stringify(await worker.rpc.request('get_messages')), /Native configurable plugin verified/);
    assert.equal(calls, 2);
    const summary = await worker.rpc.request('get_desktop_summary');
    assert.ok(summary.mcp.some((server: { name: string; status: string }) => server.name === 'dfsc-config-example__notes' && server.status === 'connected'));
    assert.doesNotMatch(JSON.stringify([events, summary]), /fixture-account-must-not-inherit/);
  } finally {
    await pool.stopAll(); await service.stop();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(done => server.close(() => done()));
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});
