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
  const taskId = '12345678-1234-1234-1234-123456789abc';
  const action = { type: 'delegate', taskId, minutes: 30, categories: ['command', 'file'] };
  assert.deepEqual(parseExternalConnectorAction(action), action);
  assert.deepEqual(parseExternalConnectorAction({ type: 'undelegate', taskId }), { type: 'undelegate', taskId });
  assert.deepEqual(parseExternalConnectorAction({ ...action, minutes: 0 }), { ...action, minutes: 0 });
  for (const input of [{ ...action, minutes: -1 }, { ...action, minutes: 10080 }, { ...action, categories: [] },
    { ...action, categories: ['command', 'command'] }, { ...action, categories: ['trust'] },
    { ...action, agentId: 'spoofed' }, { ...action, taskId: '../escape' }])
    assert.throws(() => parseExternalConnectorAction(input), /connector:invalid-input/);
});
test('persistent policies are a local-only, exact scoped action with independent category and duration validation', () => {
  const action = { type: 'policy', agentId: 'hermes-test', cwd: 'C:\\project', days: null,
    categories: ['risk', 'question'], permissionPreset: 'approve-for-me' };
  assert.deepEqual(parseExternalConnectorAction(action), action);
  for (const patch of [{ days: 0 }, { days: 365 }, { permissionPreset: 'full-access' },
    { categories: ['trust'] }, { token: 'secret' }, { categories: [] }, { extra: true }])
    assert.throws(() => parseExternalConnectorAction({ ...action, ...patch }), /connector:invalid-input/);
  assert.deepEqual(parseExternalConnectorAction({ type: 'unpolicy', agentId: action.agentId, cwd: action.cwd }),
    { type: 'unpolicy', agentId: action.agentId, cwd: action.cwd });
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
