import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { PluginConfigurationStore, parseConfigurationSchema } from '../electron/plugin-configuration.mjs';
import type { PluginConfigurationInput } from '../src/capabilities';

const helpers = await import(pathToFileURL(resolve('electron/plugin-files.mjs')).href);
const source = resolve('../examples/plugins/config-starter/plugins/dfsc-config-example');
async function fixture(t: test.TestContext, groups?: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-config-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const directory = join(root, 'plugins', 'example');
  await mkdir(join(root, 'plugins'), { recursive: true }); await cp(source, directory, { recursive: true });
  if (groups) await writeFile(join(directory, 'dfsc.settings.json'), JSON.stringify({ schemaVersion: 1,
    consumer: { kind: 'json-file-v1', server: 'notes' }, groups }));
  const fingerprint = await helpers.packageFingerprint(directory);
  const receipt = helpers.installationReceipt({ name: 'example' }, { name: 'local', kind: 'local', path: root },
    { id: 'dfsc-config-example' }, fingerprint);
  receipt.state = 'installed';
  await helpers.writeReceipts(root, { version: 1, installations: [receipt] });
  const descriptor = { root: directory, kind: 'installed', name: 'example', id: receipt.id, fingerprint,
    instance: receipt.instance, provenance: 'recorded', ref: 'fixture' };
  return { root, directory, descriptor, store: new PluginConfigurationStore(root) };
}
test('a zero-connection plugin saves real values and its installed reader refuses stale revisions and revocation', async t => {
  const { directory, descriptor, store } = await fixture(t);
  const first = await store.read(descriptor);
  assert.equal(first.configured, false); assert.equal(first.values.limit, 160);
  const saved = await store.save(descriptor, { ref: 'fixture', revision: first.revision,
    values: { prefix: 'QA ', uppercase: true, limit: 40 }, secrets: {} });
  assert.equal(saved.configured, true);
  const { ConfigurationReader } = await import(pathToFileURL(join(directory, 'server/configuration.mjs')).href);
  const reader = new ConfigurationReader(pathToFileURL(`${directory}/`));
  assert.equal((await reader.current()).values.prefix, 'QA ');
  await assert.rejects(store.save(descriptor, { ref: 'fixture', revision: first.revision, values: {}, secrets: {} }), /stale-configuration/);
  await store.save(descriptor, { ref: 'fixture', revision: saved.revision, values: { prefix: 'New ', limit: 30 }, secrets: {} });
  await assert.rejects(reader.current(), /restart/);
  const fresh = new ConfigurationReader(pathToFileURL(`${directory}/`));
  assert.equal((await fresh.current()).values.prefix, 'New ');
  await store.revoke(descriptor.id);
  await assert.rejects(fresh.current(), /restart/);
});
test('one and multiple independent connections retain, replace and delete secrets without renderer readback', async t => {
  for (const count of [1, 2]) {
    const groups = Array.from({ length: count }, (_, index) => ({ id: `connection${index}`, title: `Connection ${index}`, fields: [
      { id: `model${index}`, type: 'text', label: 'Model', default: 'local-mock' },
      { id: `key${index}`, type: 'secret', label: 'API key' },
    ] }));
    const { descriptor, store } = await fixture(t, groups);
    const first = await store.read(descriptor);
    const input: PluginConfigurationInput = { ref: 'fixture', revision: first.revision, values: { ...first.values },
      secrets: Object.fromEntries(Array.from({ length: count }, (_, index) => [`key${index}`, { action: 'replace', value: `private-${index}` }])) };
    const saved = await store.save(descriptor, input);
    assert.doesNotMatch(JSON.stringify(saved), /private-/);
    for (let index = 0; index < count; index++) assert.equal(saved.hasSecret[`key${index}`], true);
    const kept = await store.save(descriptor, { ...input, revision: saved.revision,
      secrets: Object.fromEntries(Array.from({ length: count }, (_, index) => [`key${index}`, { action: 'keep' }])) });
    const deleted = await store.save(descriptor, { ...input, revision: kept.revision,
      secrets: Object.fromEntries(Array.from({ length: count }, (_, index) => [`key${index}`, { action: 'delete' }])) });
    assert.equal(Object.values(deleted.hasSecret).some(Boolean), false);
  }
});
test('unknown sources, schema changes, forged fields and missing injection sentinel fail closed', async t => {
  const { descriptor, directory, store } = await fixture(t);
  await assert.rejects(store.read({ ...descriptor, provenance: 'unknown' }), /invalid-configuration/);
  const first = await store.read(descriptor);
  await assert.rejects(store.save(descriptor, { ref: 'fixture', revision: first.revision, values: { unexpected: true }, secrets: {} }), /invalid-configuration/);
  const manifestPath = join(directory, 'step.plugin.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete manifest.mcpServers.notes.env;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(store.read(descriptor), /stale|invalid-configuration/);
  for (const value of [{ schemaVersion: 2 }, { schemaVersion: 1, consumer: { kind: 'run-command' }, groups: [] }])
    assert.throws(() => parseConfigurationSchema(value), /invalid-configuration/);
});
test('configuration content cannot be changed under a committed revision or transferred to a new installation', async t => {
  const { root, directory, descriptor, store } = await fixture(t);
  const initial = await store.read(descriptor);
  const saved = await store.save(descriptor, { ref: 'fixture', revision: initial.revision,
    values: { prefix: 'Original ', limit: 100 }, secrets: {} });
  const path = join(root, 'desktop-plugins/settings', descriptor.instance!, `${saved.revision}.json`);
  const bytes = await readFile(path, 'utf8'), changed = JSON.parse(bytes);
  changed.values.prefix = 'Modified without revision';
  await writeFile(path, JSON.stringify(changed));
  await assert.rejects(store.read(descriptor), /stale-configuration/);
  const { ConfigurationReader } = await import(pathToFileURL(join(directory, 'server/configuration.mjs')).href);
  await assert.rejects(new ConfigurationReader(pathToFileURL(`${directory}/`)).current(), /restart/);
  await writeFile(path, bytes);
  assert.equal((await store.read(descriptor)).values.prefix, 'Original ');
  const receipts = await helpers.readReceipts(root);
  receipts.installations[0].instance = '00000000-0000-4000-8000-000000000000';
  await helpers.writeReceipts(root, receipts);
  await assert.rejects(store.read(descriptor), /stale/);
  await assert.rejects(store.read({ ...descriptor, instance: receipts.installations[0].instance }), /stale-configuration/);
});
test('path, enum and bounded schema fields use only supported declarative controls', () => {
  const schema = { schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'notes' }, groups: [
    { id: 'controls', title: 'Controls', fields: [
      { id: 'folder', label: 'Folder', type: 'path' },
      { id: 'file', label: 'File', type: 'path', selection: 'file' },
      { id: 'style', label: 'Style', type: 'enum', options: [{ value: 'plain', label: 'Plain' }], default: 'plain' },
    ] },
  ] };
  assert.equal(parseConfigurationSchema(schema).groups[0].fields[0].selection, 'directory');
  for (const field of [
    { id: 'file', label: 'File', type: 'path', selection: 'execute' },
    { id: 'secret', label: 'Secret', type: 'secret', default: 'must-not-publish' },
    { id: 'count', label: 'Count', type: 'number', min: 3, max: 1 },
    { id: 'style', label: 'Style', type: 'enum', options: Array(33).fill({ value: 'x', label: 'X' }) },
  ]) assert.throws(() => parseConfigurationSchema({ ...schema, groups: [{ id: 'bad', title: 'Bad', fields: [field] }] }));
});
test('schema changes do not migrate an existing revision or expose its saved secret', async t => {
  const { root, directory, descriptor, store } = await fixture(t, [
    { id: 'connection', title: 'Connection', fields: [{ id: 'key', label: 'Key', type: 'secret' }] },
  ]);
  const first = await store.read(descriptor);
  await store.save(descriptor, { ref: descriptor.ref, revision: first.revision, values: {},
    secrets: { key: { action: 'replace', value: 'schema-change-private-key' } } });
  const path = join(directory, 'dfsc.settings.json'), schema = JSON.parse(await readFile(path, 'utf8'));
  schema.groups[0].fields[0].type = 'text';
  await writeFile(path, JSON.stringify(schema));
  const fingerprint = await helpers.packageFingerprint(directory);
  const receipts = await helpers.readReceipts(root);
  receipts.installations[0].fingerprint = fingerprint;
  await helpers.writeReceipts(root, receipts);
  await assert.rejects(store.read({ ...descriptor, fingerprint }), /stale-configuration|configuration-schema-changed/);
  const { ConfigurationReader } = await import(pathToFileURL(join(directory, 'server/configuration.mjs')).href);
  await assert.rejects(new ConfigurationReader(pathToFileURL(`${directory}/`)).current(), /restart/);
});
