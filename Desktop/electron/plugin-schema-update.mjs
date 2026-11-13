import { randomUUID } from 'node:crypto';
import { parseConfigurationSchema, validateValue } from './plugin-configuration.mjs';
import { digest, object, PluginFileError } from './plugin-files.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value, allowed) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new PluginFileError('invalid-configuration');
};
export function parseConfigurationJson(bytes) {
  const text = bytes.toString('utf8'), value = JSON.parse(text);
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]/gu) ?? [];
  const stack = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const key = JSON.parse(token), names = stack.at(-1);
      if (!names || names.has(key)) throw new PluginFileError('invalid-configuration');
      names.add(key);
    }
  }
  return value;
}
export function strictConfigurationSchema(raw) {
  keys(raw, ['schemaVersion', 'consumer', 'groups']);
  keys(raw.consumer, ['kind', 'server']);
  if (!Array.isArray(raw.groups)) throw new PluginFileError('invalid-configuration');
  for (const group of raw.groups) {
    keys(group, ['id', 'title', 'fields']);
    if (!Array.isArray(group.fields)) throw new PluginFileError('invalid-configuration');
    for (const field of group.fields) {
      const extra = field?.type === 'number' ? ['min', 'max'] : field?.type === 'enum' ? ['options']
        : field?.type === 'path' ? ['selection'] : [];
      keys(field, ['id', 'type', 'label', 'help', 'required', 'maxLength', 'default', ...extra]);
      if (Object.hasOwn(field, 'default') && typeof field.default !== (field.type === 'number' ? 'number'
        : field.type === 'boolean' ? 'boolean' : 'string')) throw new PluginFileError('invalid-configuration');
      if (field.type === 'enum') {
        if (!Array.isArray(field.options)) throw new PluginFileError('invalid-configuration');
        for (const option of field.options) keys(option, ['value', 'label']);
      }
    }
  }
  return parseConfigurationSchema(raw);
}

// Compare every field before deciding. Byte hashes continue to bind exact files.
export function compareConfigurationSchemas(previous, next) {
  let old, candidate;
  try { old = strictConfigurationSchema(previous); candidate = strictConfigurationSchema(next); }
  catch { return { status: 'unsupported', changes: [{ code: 'invalid-schema' }] }; }
  const changes = [];
  const add = (code, field) => changes.push({ code, ...(field ? { field } : {}) });
  if (!equal(old.consumer, candidate.consumer)) add('consumer-changed');
  const fields = schema => new Map(schema.groups.flatMap(group => group.fields).map(field => [field.id, field]));
  const before = fields(old), after = fields(candidate);
  for (const [id, field] of before) {
    const target = after.get(id);
    if (!target) { add('field-removed', id); continue; }
    if (field.type !== target.type) { add('type-changed', id); continue; }
    if (Object.hasOwn(field, 'default') !== Object.hasOwn(target, 'default')
      || !equal(field.default, target.default)) add('default-changed', id);
    for (const constraint of ['required', 'maxLength', 'min', 'max', 'selection']) {
      if (!equal(field[constraint], target[constraint])) add('constraint-changed', id);
    }
    if (field.type === 'enum') {
      if (field.options.some(option => !target.options.some(item => item.value === option.value)))
        add('option-removed', id);
      else if (!equal(field.options, target.options)) add('options-extended', id);
    }
    if (field.label !== target.label || field.help !== target.help) add('presentation', id);
  }
  for (const [id, field] of after) {
    if (before.has(id)) continue;
    if (field.type === 'secret') add('secret-added', id);
    if (Object.hasOwn(field, 'default')) add('default-changed', id);
    if (field.required) add('input-required', id);
    if (field.type !== 'secret' && !field.required && !Object.hasOwn(field, 'default')) add('optional-added', id);
  }
  if (!changes.length) add('presentation');
  const compatible = new Set(['presentation', 'options-extended', 'optional-added']);
  return { status: changes.every(change => compatible.has(change.code)) ? 'compatible'
    : changes.some(change => !compatible.has(change.code) && change.code !== 'input-required')
      ? 'unsupported' : 'needs-input', changes };
}

export function validateConfigurationSnapshot(context, nextSchema) {
  const { saved, receipt, schema } = context;
  if (!saved || !context.committed) throw new PluginFileError('stale-configuration');
  keys(saved, ['version', 'instance', 'id', 'schemaHash', 'revision', 'values', 'secrets']);
  const fields = schema.groups.flatMap(group => group.fields);
  if (Object.keys(saved.values).some(id => !fields.some(field => field.id === id && field.type !== 'secret'))
    || Object.keys(saved.secrets).some(id => !fields.some(field => field.id === id && field.type === 'secret')))
    throw new PluginFileError('stale-configuration');
  for (const field of nextSchema.groups.flatMap(group => group.fields)) {
    const value = field.type === 'secret' ? saved.secrets[field.id] : saved.values[field.id];
    if (value === undefined && field.default !== undefined) validateValue(field, field.default);
    else validateValue(field, value);
  }
}
export function migrateConfigurationSnapshot(context, nextSchemaHash, nextSchema) {
  validateConfigurationSnapshot(context, nextSchema);
  const { saved, receipt } = context;
  const snapshot = { version: 1, instance: receipt.instance, id: receipt.id, schemaHash: nextSchemaHash,
    revision: digest(randomUUID()), values: { ...saved.values }, secrets: { ...saved.secrets } };
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') + 1 > 256 * 1024)
    throw new PluginFileError('too-large');
  return snapshot;
}
