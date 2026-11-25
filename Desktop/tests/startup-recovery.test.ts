import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupCommandAllowed, STARTUP_NOTICE_MS, STARTUP_RECOVERY_MS,
  type StartupRecoveryState } from '../src/startup-recovery-contract';

const state: StartupRecoveryState = {
  surface: 'transparent', stage: 'preferences', elapsed: 0, version: '0.6.0', platform: 'win32-x64', busy: false,
};
test('startup recovery commands are gated by the native state', () => {
  for (const surface of ['transparent', 'notice'] as const)
    for (const action of ['continue', 'retry', 'close']) assert.equal(startupCommandAllowed(action, { ...state, surface }), false);
  for (const action of ['continue', 'retry', 'close']) assert.equal(startupCommandAllowed(action, { ...state, surface: 'recovery' }), true);
  assert.equal(startupCommandAllowed('continue', { ...state, surface: 'recovery', failure: 'INIT_FAILED' }), false);
  for (const action of ['continue', 'retry', 'close'])
    assert.equal(startupCommandAllowed(action, { ...state, surface: 'recovery', busy: true }), false);
});
test('startup recovery exposes no arbitrary desktop command', () => {
  for (const action of ['diagnostics', 'desktop', 'readFile', 'restart', {}, null, 0, 'constructor', '__proto__'])
    assert.equal(startupCommandAllowed(action, { ...state, surface: 'recovery' }), false);
  assert.equal(startupCommandAllowed('ready', { ...state, busy: true }), true);
  assert.equal(STARTUP_NOTICE_MS, 4000);
  assert.equal(STARTUP_RECOVERY_MS, 10000);
});
