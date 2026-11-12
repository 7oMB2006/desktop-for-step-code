import { digest, object, optionalFile, packageFingerprint, plainFile, readReceipts, writePrivateData, PluginFileError } from './plugin-files.mjs';

const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,47}$/u.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
const label = value => typeof value === 'string' && value.trim() && value.length <= 160 && !/[\u0000-\u001f]/u.test(value);
const fail = () => { throw new PluginFileError('invalid-configuration'); };
const snapshotLimit = 256 * 1024;
export function parseConfigurationSchema(value) {
  if (!object(value) || value.schemaVersion !== 1 || value.consumer?.kind !== 'json-file-v1'
    || !identifier(value.consumer.server) || !Array.isArray(value.groups) || value.groups.length > 8) fail();
  const names = new Set(), groups = [];
  for (const group of value.groups) {
    if (!object(group) || !identifier(group.id) || !label(group.title) || !Array.isArray(group.fields)
      || group.fields.length > 16 || groups.some(item => item.id === group.id)) fail();
    const fields = [];
    for (const field of group.fields) {
      if (!object(field) || !identifier(field.id) || !label(field.label) || names.has(field.id)
        || !['text', 'number', 'enum', 'boolean', 'secret', 'path'].includes(field.type)
        || names.size >= 64 || field.help !== undefined && !label(field.help)
        || field.required !== undefined && typeof field.required !== 'boolean') fail();
      names.add(field.id);
      const result = { id: field.id, label: field.label, type: field.type, help: field.help,
        required: field.required === true, maxLength: field.maxLength ?? 2048 };
      if (!Number.isSafeInteger(result.maxLength) || result.maxLength < 1 || result.maxLength > 8192) fail();
      if (field.type === 'path') {
        if (field.selection !== undefined && !['file', 'directory'].includes(field.selection)) fail();
        result.selection = field.selection ?? 'directory';
      }
      if (field.type === 'number') {
        if (field.min !== undefined && !Number.isFinite(field.min) || field.max !== undefined && !Number.isFinite(field.max)
          || field.min !== undefined && field.max !== undefined && field.min > field.max) fail();
        result.min = field.min; result.max = field.max;
      }
      if (field.type === 'enum') {
        if (!Array.isArray(field.options) || !field.options.length || field.options.length > 32
          || field.options.some(item => !object(item) || !label(item.value) || !label(item.label))
          || new Set(field.options.map(item => item.value)).size !== field.options.length) fail();
        result.options = field.options.map(item => ({ value: item.value, label: item.label }));
      }
      if (field.default !== undefined) {
        if (field.type === 'secret') fail();
        validateValue(result, field.default);
        result.default = field.default;
      }
      fields.push(result);
    }
    groups.push({ id: group.id, title: group.title, fields });
  }
  return { schemaVersion: 1, consumer: { kind: 'json-file-v1', server: value.consumer.server }, groups };
}
export function validateValue(field, value) {
  if (value === undefined || value === '') { if (field.required) fail(); return; }
  if (field.type === 'boolean') { if (typeof value !== 'boolean') fail(); }
  else if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)
      || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) fail();
  } else if (typeof value !== 'string' || value.length > field.maxLength || /[\0]/u.test(value)
    || field.type === 'enum' && !field.options.some(item => item.value === value)) fail();
}
export class PluginConfigurationStore {
  queue = Promise.resolve();
  constructor(root) { this.root = root; }
  async context(descriptor) {
    if (descriptor.kind !== 'installed' || descriptor.provenance !== 'recorded' || !descriptor.instance) fail();
    const receipts = await readReceipts(this.root);
    const receipt = receipts.installations.find(item => item.instance === descriptor.instance
      && item.id === descriptor.id && item.folder === descriptor.name
      && item.state === 'installed' && item.fingerprint === descriptor.fingerprint);
    if (!receipt) throw new PluginFileError('stale');
    if (await packageFingerprint(descriptor.root) !== descriptor.fingerprint) throw new PluginFileError('stale');
    const bytes = await plainFile(descriptor.root, 'dfsc.settings.json', 65536);
    const schema = parseConfigurationSchema(JSON.parse(bytes.toString('utf8')));
    const manifest = JSON.parse((await plainFile(descriptor.root, 'step.plugin.json', 512 * 1024)).toString('utf8'));
    let servers = manifest.mcpServers;
    if (typeof servers === 'string') {
      const parsed = JSON.parse((await plainFile(descriptor.root, servers, 256 * 1024)).toString('utf8'));
      servers = parsed.mcpServers ?? parsed;
    }
    const server = servers?.[schema.consumer.server];
    if (!object(server) || typeof server.command !== 'string' || server.url
      || server.env?.STEPFUN_API_KEY !== 'DFSC_INDEPENDENT_PLUGIN') fail();
    const schemaHash = digest(bytes);
    const bindingBytes = await optionalFile(this.root, `desktop-plugins/bindings/${receipt.folder}.json`, 65536);
    const binding = bindingBytes ? JSON.parse(bindingBytes.toString('utf8')) : undefined;
    const bound = binding && !binding.revoked;
    if (bound && (binding.version !== 1 || binding.instance !== receipt.instance || binding.id !== receipt.id
      || binding.fingerprint !== receipt.fingerprint || !/^[a-f0-9]{64}$/u.test(binding.revision)))
      throw new PluginFileError('stale-configuration');
    if (bound && binding.schemaHash !== schemaHash) throw new PluginFileError('configuration-schema-changed');
    const data = bound ? await plainFile(this.root, `desktop-plugins/settings/${receipt.instance}/${binding.revision}.json`, snapshotLimit) : undefined;
    const saved = data ? JSON.parse(data.toString('utf8')) : undefined;
    if (saved && (!object(saved) || saved.version !== 1 || saved.instance !== receipt.instance
      || saved.id !== receipt.id || !object(saved.values) || !object(saved.secrets) || typeof saved.revision !== 'string')) fail();
    if (saved && saved.schemaHash !== schemaHash) throw new PluginFileError('configuration-schema-changed');
    const contentHash = saved ? digest(JSON.stringify(saved)) : undefined;
    const committed = binding && !binding.revoked && binding.instance === receipt.instance && binding.id === receipt.id
      && binding.fingerprint === receipt.fingerprint && binding.schemaHash === schemaHash && binding.revision === saved?.revision
      && binding.contentHash === contentHash;
    if (saved && binding && !binding.revoked && !committed) throw new PluginFileError('stale-configuration');
    return { descriptor, receipt, schema, schemaHash, saved, committed };
  }
  project(context) {
    const { saved, schema, descriptor } = context, values = {}, hasSecret = {};
    for (const field of schema.groups.flatMap(group => group.fields)) {
      if (field.type === 'secret') hasSecret[field.id] = Boolean(saved?.secrets[field.id]);
      else if (saved?.values[field.id] !== undefined) values[field.id] = saved.values[field.id];
      else if (field.default !== undefined) values[field.id] = field.default;
    }
    return { ref: descriptor.ref, revision: saved?.revision ?? 'unconfigured', configured: Boolean(context.committed), schema, values, hasSecret };
  }
  async read(descriptor) { return this.project(await this.context(descriptor)); }
  save(descriptor, input) {
    const operation = this.queue.then(() => this.write(descriptor, input));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async write(descriptor, input) {
    if (!object(input) || typeof input.revision !== 'string' || !object(input.values) || !object(input.secrets)) fail();
    const context = await this.context(descriptor), { receipt, schema, schemaHash, saved } = context;
    if (input.revision !== (saved?.revision ?? 'unconfigured')) throw new PluginFileError('stale-configuration');
    const fields = schema.groups.flatMap(group => group.fields), values = {}, secrets = {};
    if (Object.keys(input.values).some(key => !fields.some(field => field.id === key && field.type !== 'secret'))
      || Object.keys(input.secrets).some(key => !fields.some(field => field.id === key && field.type === 'secret'))) fail();
    for (const field of fields) {
      if (field.type !== 'secret') {
        const value = input.values[field.id] ?? field.default;
        validateValue(field, value);
        if (value !== undefined) values[field.id] = value;
      } else {
        const intent = input.secrets[field.id];
        if (!object(intent) || !['keep', 'replace', 'delete'].includes(intent.action)) fail();
        const value = intent.action === 'keep' ? saved?.secrets[field.id] : intent.action === 'replace' ? intent.value : undefined;
        validateValue(field, value);
        if (value) secrets[field.id] = value;
      }
    }
    const revision = digest(JSON.stringify([schemaHash, saved?.revision, values, secrets, Date.now(), Math.random()]));
    const data = { version: 1, instance: receipt.instance, id: receipt.id, schemaHash, revision, values, secrets };
    const content = JSON.stringify(data);
    if (Buffer.byteLength(content, 'utf8') + 1 > snapshotLimit) throw new PluginFileError('too-large');
    await writePrivateData(this.root, `desktop-plugins/settings/${receipt.instance}/${revision}.json`, data);
    const rechecked = await this.context(descriptor);
    if (rechecked.saved?.revision !== saved?.revision) throw new PluginFileError('stale-configuration');
    // The binding is a commit marker: an interrupted save cannot authorize an unmatched snapshot.
    await writePrivateData(this.root, `desktop-plugins/bindings/${receipt.folder}.json`, {
      version: 1, instance: receipt.instance, id: receipt.id, fingerprint: receipt.fingerprint, schemaHash, revision,
      contentHash: digest(content),
    });
    return this.project({ ...context, saved: data, committed: true });
  }
  async revoke(id) {
    const receipts = await readReceipts(this.root);
    const matches = receipts.installations.filter(item => item.id === id);
    if (matches.length > 1) throw new PluginFileError('plugin-conflict');
    if (matches.length) await writePrivateData(this.root, `desktop-plugins/bindings/${matches[0].folder}.json`, { version: 1, revoked: true });
  }
}
