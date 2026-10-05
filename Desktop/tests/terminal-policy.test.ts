import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalEnvironment, terminalInput, terminalSize } from '../electron/terminal-policy';

test('terminal environment retains OS paths but not desktop settings or secrets', () => {
  const env = terminalEnvironment({ PATH: 'bin', SystemRoot: 'C:\\Windows', TEMP: 'temp', TERM: 'xterm',
    DESKTOP_TEST_USER_DATA: 'profile', STEPCODE_HOME: 'private', STEP_CODING_API_KEY: 'private',
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', NODE_PATH: 'private',
    GITHUB_ACCESS_TOKEN: 'private', GH_TOKEN: 'private', AWS_ACCESS_KEY_ID: 'private',
    OPENAI_API_KEY: 'private', PASSWORD: 'private', SSH_PRIVATE_KEY: 'private', GITHUB_PAT: 'private',
    DOCKER_AUTH_CONFIG: 'private', CUSTOM_UNCLASSIFIED_VALUE: 'private', HTTP_PROXY: 'private',
    unset: undefined });
  assert.deepEqual(env, { PATH: 'bin', SystemRoot: 'C:\\Windows', TEMP: 'temp', TERM: 'xterm' });
});
test('terminal environment matches explicit system variables case-insensitively', () => {
  assert.deepEqual(terminalEnvironment({ Path: 'bin', SystemRoot: 'windows', UserProfile: 'home',
    PSModulePath: 'modules', NODE_OPTIONS: 'private', PAT: 'private' }),
  { Path: 'bin', SystemRoot: 'windows', UserProfile: 'home', PSModulePath: 'modules' });
});
test('terminal resize and input have finite bounded shapes', () => {
  assert.deepEqual(terminalSize(80, 24), { cols: 80, rows: 24 });
  for (const [cols, rows] of [[1, 24], [501, 24], [80, 0], [80, 301], [80.5, 24], [NaN, 24], ['80', 24]]) {
    assert.throws(() => terminalSize(cols, rows));
  }
  assert.equal(terminalInput('\x03中文\r'), '\x03中文\r');
  assert.equal(terminalInput('x'.repeat(65536)).length, 65536);
  assert.throws(() => terminalInput('x'.repeat(65537)));
  assert.throws(() => terminalInput({ command: 'hello' }));
});
