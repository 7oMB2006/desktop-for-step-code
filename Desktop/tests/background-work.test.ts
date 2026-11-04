import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundLaneStates, backgroundState, hasBackgroundWork } from '../electron/background-work';

test('native lane identities are bounded and projected without accepting history metadata', () => {
  assert.deepEqual(backgroundLaneStates(JSON.stringify({ version: 1, parentActive: true,
    lanes: [{ id: 'lane_12345678', status: 'settling', sessionFile: 'private' }] })),
  { parentActive: true, lanes: [{ id: 'lane_12345678', status: 'settling' }] });
  assert.equal(backgroundLaneStates(JSON.stringify({ version: 1,
    lanes: Array.from({ length: 25 }, (_, index) => ({ id: `lane_${index.toString(16).padStart(8, '0')}`, status: 'running' })) })), undefined);
  assert.equal(backgroundLaneStates(JSON.stringify({ version: 1,
    lanes: Array.from({ length: 2 }, () => ({ id: 'lane_12345678', status: 'running' })) })), undefined);
});

test('only a valid empty native snapshot releases background ownership', () => {
  assert.deepEqual(backgroundState(JSON.stringify({ version: 1, lanes: [] })), { active: false, parentActive: false });
  assert.deepEqual(backgroundState(JSON.stringify({ version: 1, lanes: [], parentActive: true })),
    { active: false, parentActive: true });
  for (const value of [undefined, '', 'null', '{}', '{invalid',
    JSON.stringify({ version: 2, lanes: [] }),
    JSON.stringify({ version: 1, lanes: [{}] }),
    JSON.stringify({ version: 1, lanes: [{ id: 'lane_12345678', status: 'completed' }] }),
    JSON.stringify({ version: 1, lanes: [{ id: 'lane_12345678', status: 'running' }] }),
    JSON.stringify({ version: 1, lanes: [{ id: 'lane_12345678', status: 'settling' }] })]) {
    assert.equal(backgroundState(value).active, true);
  }
  assert.equal(hasBackgroundWork({ status: 'connected', backgroundActive: true }), true);
  assert.equal(hasBackgroundWork({ status: 'connected' }), false);
  assert.equal(hasBackgroundWork({ status: 'disconnected', backgroundActive: true }), false);
});
