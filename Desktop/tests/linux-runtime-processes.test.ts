import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { once } from 'node:events';
import { runtimeProcessKind } from '../scripts/linux-runtime-processes.mjs';

test('runtime identity requires the staged executable and a recognized entry or renamed Step title', () => {
  const expected = { node: '/staged/node', entry: '/staged/step.js', admin: '/staged/admin.mjs', terminal: '/staged/host.cjs' };
  assert.equal(runtimeProcessKind([expected.node, expected.entry, '--mode', 'rpc'], expected.node, expected), 'runtime');
  assert.equal(runtimeProcessKind(['step', '', ''], expected.node, expected), 'runtime');
  assert.equal(runtimeProcessKind([expected.node, expected.admin], expected.node, expected), 'admin');
  assert.equal(runtimeProcessKind([expected.node, expected.terminal], expected.node, expected), 'terminal');
  assert.equal(runtimeProcessKind(['step'], '/unrelated/node', expected), undefined);
  assert.equal(runtimeProcessKind([expected.node, '/unrelated/script.js'], expected.node, expected), undefined);
  assert.equal(runtimeProcessKind(['step', '/unrelated/script.js'], expected.node, expected), undefined);
});

test('a real Linux Node title change hides argv without changing executable identity', { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
  const child = fork('-e', ["process.title = 'step'; process.send('ready'); process.on('message', () => process.exit(0));"],
    { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(child, 'exit');
  try {
    await once(child, 'message');
    const args = (await readFile(`/proc/${child.pid}/cmdline`, 'utf8')).split('\0');
    const node = await realpath(process.execPath);
    assert.equal(args[0], 'step');
    assert.equal(runtimeProcessKind(args, await realpath(`/proc/${child.pid}/exe`),
      { node, entry: '/not-in-mutable-argv/step.js', admin: '/admin.mjs', terminal: '/host.cjs' }), 'runtime');
    child.send('stop');
    assert.deepEqual(await exited, [0, null]);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
});
