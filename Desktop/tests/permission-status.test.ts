import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionFromStatus, permissionPresets } from '../electron/permission-status';

test('Step status is mapped only from its permission channel', () => {
  for (const [label, preset] of [['Ask', 'ask'], ['Read Only', 'read-only'], ['Bypass', 'bypass'], ['Autopilot', 'autopilot']] as const) {
    assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'step-permission', statusText: `Mode: ${label}` }), preset);
  }
  assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'step-permission', statusText: 'Mode: Autopilot (auto-resume)' }), 'autopilot');
  assert.equal(permissionFromStatus({ method: 'notify', statusKey: 'step-permission', statusText: 'Mode: Ask' }), undefined);
  assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'other', statusText: 'Mode: Ask' }), undefined);
  assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'step-permission', statusText: 'Mode: unrestricted' }), undefined);
  assert.deepEqual(permissionPresets, ['ask', 'read-only', 'bypass', 'autopilot']);
});
