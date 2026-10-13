import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { captureLinuxProcessSession, isolatedEnvironment, RpcProcess, runtimeNodePath, runtimePathKey, terminateLinuxProcessSession, terminateLinuxProcessTree } from '../electron/runtime';

const stopped = async (pid: number) => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return ['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
  } catch (error: any) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return true; throw error; }
};

test('runtime executable and path identity follow the host platform', () => {
  assert.equal(runtimeNodePath('/runtime', 'linux'), join('/runtime', 'node', 'node'));
  assert.equal(runtimeNodePath('/runtime', 'win32'), join('/runtime', 'node', 'node.exe'));
  assert.equal(runtimePathKey('C:\\Project\\', 'win32'), 'c:/project');
  assert.notEqual(runtimePathKey('/Project', 'linux'), runtimePathKey('/project', 'linux'));
  assert.notEqual(runtimePathKey('/project\\file', 'linux'), runtimePathKey('/project/file', 'linux'));
  assert.equal(runtimePathKey('/project/', 'linux'), runtimePathKey('/project', 'linux'));
});

test('Linux runtime shutdown waits for its process tree, escalates resistant descendants and leaves unrelated children alone',
  { skip: process.platform !== 'linux', timeout: 15000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-tree-'));
    const fixture = join(root, 'fixture.cjs');
    const grandchild = `process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000);`;
    const child = `const { spawn } = require('node:child_process');
      process.on('SIGTERM', () => {});
      const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      grandchild.stdout.once('data', value => console.log(JSON.stringify([process.pid, Number(value.toString().trim())])));
      setInterval(() => {}, 1000);`;
    await writeFile(fixture, `const { spawn } = require('node:child_process');
      const { createInterface } = require('node:readline');
      process.on('SIGTERM', () => {});
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const children = new Promise(resolve => child.stdout.once('data', value => resolve(JSON.parse(value.toString()))));
      createInterface({ input: process.stdin }).on('line', async line => {
        const request = JSON.parse(line);
        if (request.type === 'get_state') console.log(JSON.stringify({ type: 'response', id: request.id, success: true, data: [process.pid, ...await children] }));
      });`);
    const rpc = new RpcProcess(() => {});
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    let pids: number[] = [];
    try {
      rpc.start(process.execPath, fixture, root, isolatedEnvironment(root));
      pids = await rpc.request('get_state');
      assert.equal(pids.length, 3);
      assert.deepEqual(await Promise.all(pids.map(stopped)), [false, false, false]);
      const pending = assert.rejects(rpc.request('never'), /Runtime stopped/);
      await rpc.stop();
      await pending;
      assert.deepEqual(await Promise.all(pids.map(stopped)), [true, true, true]);
      assert.equal(await stopped(unrelated.pid!), false);
      await assert.rejects(rpc.request('get_state'), /not connected/);
      await rpc.stop();
    } finally {
      await rpc.stop();
      for (const pid of pids) if (!(await stopped(pid))) await terminateLinuxProcessTree(pid, 10);
      if (unrelated.pid) await terminateLinuxProcessTree(unrelated.pid, 10);
      await rm(root, { recursive: true, force: true });
    }
  });

test('Linux process termination refuses the current process and non-child PID values', { skip: process.platform !== 'linux' }, async () => {
  for (const pid of [0, 1, -42, NaN, process.pid]) await assert.rejects(terminateLinuxProcessTree(pid), /Invalid child process/);
});


test('Linux session cleanup refuses a reused leader identity before signalling', { skip: process.platform !== 'linux' }, async () => {
  const child = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
    { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise<void>(resolve => child.stdout.once('data', () => resolve()));
    const session = await captureLinuxProcessSession(child.pid!);
    assert.equal(await terminateLinuxProcessSession({ ...session, started: '0' }, 10), true);
    assert.equal(await stopped(child.pid!), false, 'a mismatched leader identity must not signal the current session');
    assert.equal(await terminateLinuxProcessSession(session, 10), true);
    assert.equal(await stopped(child.pid!), true);
  } finally { if (child.pid) await terminateLinuxProcessTree(child.pid, 10); }
});
