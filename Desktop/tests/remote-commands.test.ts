import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteCommand } from '../electron/remote-commands';
import { remoteCommands } from '../src/remote';

test('Remote commands have an explicit grammar and preserve ordinary model input', () => {
  assert.deepEqual(parseRemoteCommand('  hello /session s2  '), { type: 'message', text: '  hello /session s2  ' });
  assert.deepEqual(parseRemoteCommand('/session'), { type: 'sessions', page: 1 });
  assert.deepEqual(parseRemoteCommand('/session list 2'), { type: 'sessions', page: 2 });
  assert.deepEqual(parseRemoteCommand('/list 3'), { type: 'sessions', page: 3 });
  for (const command of ['/switch s2', '/session s2', '/session switch s2'])
    assert.deepEqual(parseRemoteCommand(command), { type: 'select', ref: 's2' });
  assert.deepEqual(parseRemoteCommand('/session new p2'), { type: 'new', ref: 'p2' });
  assert.deepEqual(parseRemoteCommand('/session current'), { type: 'current' });
  for (const command of ['/permissions full-access', '/_desktop_retry x', '/connect', '/help extra', '/sessions 0', '/session s1 extra', '/new p1 extra', '/stop a b'])
    assert.deepEqual(parseRemoteCommand(command), { type: 'invalid' }, command);
});

test('every advertised Remote command is recognized without arbitrary upstream passthrough', () => {
  for (const item of remoteCommands) {
    const example = item.command.replace('[page]', '1').replace('<s1>', 's1').replace('[p1]', 'p1').replace('[s1]', 's1');
    assert.notEqual(parseRemoteCommand(example).type, 'invalid', example);
  }
  assert.deepEqual(parseRemoteCommand('/STATUS s1'), { type: 'status', ref: 's1' });
});
