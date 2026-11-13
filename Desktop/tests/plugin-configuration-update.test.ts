import assert from 'node:assert/strict';
import test from 'node:test';
import { compareConfigurationSchemas, migrateConfigurationSnapshot, parseConfigurationJson,
  strictConfigurationSchema } from '../electron/plugin-schema-update.mjs';
import { digest } from '../electron/plugin-files.mjs';

const schema = () => ({ schemaVersion: 1, consumer: { kind: 'json-file-v1', server: 'example' }, groups: [
  { id: 'general', title: 'General', fields: [
    { id: 'title', label: 'Title', type: 'text' },
    { id: 'enabled', label: 'Enabled', type: 'boolean', default: false },
    { id: 'count', label: 'Count', type: 'number', default: 0 },
    { id: 'format', label: 'Format', type: 'enum', options: [{ value: 'plain', label: 'Plain' }] },
    { id: 'key', label: 'Key', type: 'secret' },
  ] },
] });
function changed(edit: (value: any) => void) {
  const value = schema(); edit(value); return value;
}
test('strict comparison permits presentation, ordering, option additions and missing optional values', () => {
  for (const candidate of [
    changed(value => { value.groups[0].title = 'New'; value.groups[0].fields.reverse(); }),
    changed(value => { value.groups[0].fields[0].help = 'Details'; }),
    changed(value => { value.groups[0].fields[3].options.push({ value: 'new', label: 'New' }); }),
    changed(value => { value.groups[0].fields.push({ id: 'optional', label: 'Optional', type: 'text' }); }),
  ]) assert.equal(compareConfigurationSchemas(schema(), candidate).status, 'compatible');
});
test('all unsupported differences are aggregated, including false, zero and empty defaults', () => {
  const candidate = changed(value => {
    value.groups[0].fields[0].default = '';
    value.groups[0].fields[1].default = true;
    delete value.groups[0].fields[2].default;
    value.groups[0].fields[3].options = [{ value: 'new', label: 'New' }];
    value.groups[0].fields.push({ id: 'required', type: 'text', label: 'Required', required: true });
    value.groups[0].fields.push({ id: 'secret', type: 'secret', label: 'Secret' });
  });
  const report = compareConfigurationSchemas(schema(), candidate);
  assert.equal(report.status, 'unsupported');
  assert.equal(report.changes.filter((item: { code: string }) => item.code === 'default-changed').length, 3);
  for (const code of ['option-removed', 'input-required', 'secret-added'])
    assert.ok(report.changes.some((item: { code: string }) => item.code === code));
  assert.equal(compareConfigurationSchemas(schema(), changed(value => {
    value.groups[0].fields.push({ id: 'required', type: 'text', label: 'Required', required: true });
  })).status, 'needs-input');
});
test('strict schemas reject unknown and duplicate properties at each level, even escaped keys', () => {
  for (const candidate of [
    changed(value => { value.future = true; }),
    changed(value => { value.consumer.future = true; }),
    changed(value => { value.groups[0].future = true; }),
    changed(value => { value.groups[0].fields[0].min = 1; }),
    changed(value => { value.groups[0].fields[3].options[0].future = true; }),
    changed(value => { value.groups[0].fields.push(value.groups[0].fields[0]); }),
    changed(value => { value.groups.push(value.groups[0]); }),
    changed(value => { value.groups[0].fields[2].default = ''; }),
  ]) assert.equal(compareConfigurationSchemas(schema(), candidate).status, 'unsupported');
  for (const text of ['{"a":1,"a":2}', '{"a":{"x":1,"\\u0078":2}}', '[{"a":1,"a":2}]'])
    assert.throws(() => parseConfigurationJson(Buffer.from(text)), /invalid-configuration/);
  const value = '{"a":"text with braces {} and quotes \\"x\\"","b":[{"x":1},{"x":2}]}';
  assert.deepEqual(parseConfigurationJson(Buffer.from(value)), JSON.parse(value));
});
test('migration copies only the verified active snapshot, keeps missing values missing and validates secrets', () => {
  const before = strictConfigurationSchema(schema());
  const after = strictConfigurationSchema(changed(value => {
    value.groups[0].fields.push({ id: 'optional', label: 'Optional', type: 'number' });
  }));
  const saved = { version: 1, instance: 'fixture', id: 'example', schemaHash: digest('before'), revision: digest('old'),
    values: { title: '', enabled: false, count: 0, format: 'plain' }, secrets: { key: 'fixture-private' } };
  const context = { saved, receipt: { instance: 'fixture', id: 'example' }, schema: before, committed: true };
  const migrated = migrateConfigurationSnapshot(context, digest('after'), after);
  assert.deepEqual(migrated.values, saved.values);
  assert.deepEqual(migrated.secrets, saved.secrets);
  assert.equal(Object.hasOwn(migrated.values, 'optional'), false);
  assert.notEqual(migrated.revision, saved.revision);
  assert.deepEqual(saved.values, context.saved.values);
  assert.throws(() => migrateConfigurationSnapshot({ ...context, committed: false }, digest('after'), after));
  assert.throws(() => migrateConfigurationSnapshot({ ...context, saved: { ...saved, secrets: { key: true } } }, digest('after'), after));
  assert.throws(() => migrateConfigurationSnapshot({ ...context, saved: { ...saved, values: { injected: 'unknown' } } }, digest('after'), after));
});
