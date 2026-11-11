import test from 'node:test';
import assert from 'node:assert/strict';
import { externalSessionCommandAllowed, parseExternalConnectorAction } from '../electron/external-connector-policy';
import { pluginWindowMethodAllowed } from '../electron/plugin-window-policy';

test('external connector management parses only narrow explicit actions', () => {
  assert.deepEqual(parseExternalConnectorAction({ type: 'enable' }), { type: 'enable' });
  assert.deepEqual(parseExternalConnectorAction({ type: 'pair', displayName: ' Hermes ', roots: ['C:\\project'] }),
    { type: 'pair', displayName: 'Hermes', roots: ['C:\\project'] });
  for (const input of [null, [], {}, { type: 'execute' }, { type: 'enable', token: 'secret' },
    { type: 'pair', displayName: ' ', roots: ['root'] }, { type: 'pair', displayName: 'name', roots: [] },
    { type: 'pair', displayName: 'name', roots: ['a', 'a'] }, { type: 'revoke', agentId: '../escape' }])
    assert.throws(() => parseExternalConnectorAction(input), /connector:invalid-input/);
});
test('external-owned sessions block competing input and policy changes, not native human approval or stop', () => {
  for (const type of ['prompt', 'queue_edit', 'queue_steer', 'queue_steer_first', 'queue_recover',
    'set_permission_preset', 'set_launch_mode', 'set_model', 'compact', 'goal_action'])
    assert.equal(externalSessionCommandAllowed(type), false, type);
  for (const type of ['abort', 'extension_ui_response', 'get_session_stats'])
    assert.equal(externalSessionCommandAllowed(type), true, type);
});
test('plugin windows cannot manage generic external connections', () => {
  for (const method of ['externalConnectorState', 'externalConnectorAction'])
    assert.equal(pluginWindowMethodAllowed(method, [], 'own'), false);
});
