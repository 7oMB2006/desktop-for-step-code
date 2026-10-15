import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInterfaceSettings, selectInterfacePreset, validateInterfaceSettings } from '../src/interface-presets';

test('interface presets affect presentation options only', () => {
  assert.deepEqual(selectInterfacePreset('simple'), { preset: 'simple', thinkingExpanded: false, toolsExpanded: false, performanceVisible: false, groupTools: true, compactProcess: true });
  assert.deepEqual(selectInterfacePreset('standard'), { preset: 'standard', thinkingExpanded: false, toolsExpanded: false, performanceVisible: true, groupTools: true, compactProcess: false });
  assert.deepEqual(selectInterfacePreset('detailed'), { preset: 'detailed', thinkingExpanded: true, toolsExpanded: false, performanceVisible: true, groupTools: false, compactProcess: false });
});

test('draft normalization restores preset values and bounds custom data', () => {
  assert.deepEqual(normalizeInterfaceSettings({ preset: 'simple', performanceVisible: true }), selectInterfacePreset('simple'));
  assert.deepEqual(normalizeInterfaceSettings({ preset: 'custom', thinkingExpanded: true, toolsExpanded: 'yes', performanceVisible: false }), {
    preset: 'custom', thinkingExpanded: true, toolsExpanded: false, performanceVisible: false, groupTools: true, compactProcess: false,
  });
  for (const value of [null, [], 42, { preset: 'invalid' }]) assert.deepEqual(normalizeInterfaceSettings(value), selectInterfacePreset('standard'));
});

test('IPC validation rejects invalid interface patches and drops unrelated fields', () => {
  for (const value of [null, [], 'simple', { preset: 'unknown' }, { preset: 'custom', toolsExpanded: 'yes' }, { preset: 'custom', compactProcess: 'yes' }]) {
    assert.throws(() => validateInterfaceSettings(value), /Invalid interface/);
  }
  assert.deepEqual(validateInterfaceSettings({ ...selectInterfacePreset('simple'), permissionPreset: 'full-access' }), selectInterfacePreset('simple'));
});

test('custom settings preserve grouping independently of tool expansion', () => {
  const custom = { ...selectInterfacePreset('simple'), preset: 'custom', toolsExpanded: true };
  assert.deepEqual(normalizeInterfaceSettings(custom), custom);
});
