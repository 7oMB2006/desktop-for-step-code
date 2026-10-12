import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionFromStatus, permissionPresets } from '../electron/permission-status';

test('Step status is mapped only from its permission channel', () => {
  for (const [label, preset] of [['Ask', 'ask'], ['Approve for Me', 'approve-for-me'], ['Full Access', 'full-access']] as const) {
    assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'step-permission', statusText: `Mode: ${label}` }), preset);
    assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'step-permission', statusText: `Mode: ${label} (auto-resume)` }), preset);
  }
  for (const label of ['Read Only', 'Bypass', 'Autopilot']) {
    assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'step-permission', statusText: `Mode: ${label}` }), undefined);
  }
  assert.equal(permissionFromStatus({ method: 'notify', statusKey: 'step-permission', statusText: 'Mode: Ask' }), undefined);
  assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'other', statusText: 'Mode: Ask' }), undefined);
  assert.equal(permissionFromStatus({ method: 'setStatus', statusKey: 'step-permission', statusText: 'Mode: unrestricted' }), undefined);
  assert.deepEqual(permissionPresets, ['ask', 'approve-for-me', 'full-access']);
});
