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
  for (const command of ['/permissions full-access', '/_desktop_retry x', '/connect', '/help extra', '/sessions 0', '/stop a b'])
    assert.deepEqual(parseRemoteCommand(command), { type: 'invalid' }, command);
  for (const command of ['/session s1 extra', '/new p1 extra', '/switch'])
    assert.deepEqual(parseRemoteCommand(command), { type: 'invalid', selection: true }, command);
  assert.deepEqual(parseRemoteCommand('/tasks'), { type: 'tasks' });
  assert.deepEqual(parseRemoteCommand('/sharing'), { type: 'sharing' });
  assert.deepEqual(parseRemoteCommand('/detach s2'), { type: 'detach', ref: 's2' });
});

test('every advertised Remote command is recognized without arbitrary upstream passthrough', () => {
  for (const item of remoteCommands) {
    const example = item.command.replace('[pN]', 'p1').replace('[page]', '1').replace('<s1>', 's1').replace('[p1]', 'p1').replace('[s1]', 's1');
    assert.notEqual(parseRemoteCommand(example).type, 'invalid', example);
  }
  assert.deepEqual(parseRemoteCommand('/STATUS s1'), { type: 'status', ref: 's1' });
});

test('session lists accept an optional normalized project followed by an optional page', () => {
  for (const command of ['/sessions p2', '/list p2', '/session list p2'])
    assert.deepEqual(parseRemoteCommand(command), { type: 'sessions', project: 'p2', page: 1 }, command);
  for (const command of ['/sessions P2 3', '/LIST P2 3', '/SESSION LIST P2 3'])
    assert.deepEqual(parseRemoteCommand(command), { type: 'sessions', project: 'p2', page: 3 }, command);
  assert.deepEqual(parseRemoteCommand(' \t/sessions\tP20\t9999\n'), { type: 'sessions', project: 'p20', page: 9999 });
  assert.deepEqual(parseRemoteCommand('/sessions 2'), { type: 'sessions', page: 2 });
  assert.deepEqual(parseRemoteCommand('/session list 2'), { type: 'sessions', page: 2 });
  assert.deepEqual(parseRemoteCommand('/list'), { type: 'sessions', page: 1 });
  assert.deepEqual(parseRemoteCommand('/session p2'), { type: 'select', ref: 'p2' });
});

test('session lists reject malformed, reordered and extra arguments without treating them as model input', () => {
  for (const command of [
    '/sessions p0', '/sessions p01', '/sessions px', '/sessions s1', '/sessions unknown',
    '/sessions p10000', '/sessions p2 0', '/sessions p2 01', '/sessions p2 -1',
    '/sessions p2 1.5', '/sessions p2 10000', '/sessions p2 NaN', '/sessions p2 next',
    '/sessions 2 p1', '/sessions p1 p2', '/sessions p1 2 extra',
    '/session list p2 2 extra', '/list p1 unknown', '/sessions p1/child',
  ]) assert.deepEqual(parseRemoteCommand(command), { type: 'invalid' }, command);
});
