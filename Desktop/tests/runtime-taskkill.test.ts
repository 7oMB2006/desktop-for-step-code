import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { RpcProcess } from '../electron/runtime';

// Execute the production class with only the OS boundary and clock replaced.
// No real taskkill, PATH mutation or wall-clock delay is needed on any platform.
const runtimeUrl = new URL('../electron/runtime.ts', import.meta.url);
const compiled = ts.transpileModule(await readFile(runtimeUrl, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nativeRequire = createRequire(runtimeUrl);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

class FixtureChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kills = 0;
  killResult: boolean | Error = true;
  constructor(readonly pid: number) { super(); }
  kill() {
    this.kills++;
    if (this.killResult instanceof Error) throw this.killResult;
    // A successful kill request alone is not evidence of exit.
    return this.killResult;
  }
  exit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.exitCode = code; this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

function fixture(containTree = false) {
  let now = 0;
  const timers = new Map<object, { at: number; callback: () => void }>();
  const helpers: FixtureChild[] = [], targets: FixtureChild[] = [];
  const verifications: ((error: Error | null) => void)[] = [];
  const exports = {} as { RpcProcess: typeof RpcProcess };
  runInNewContext(compiled, {
    exports, Buffer, process: { platform: 'win32', env: {} },
    require(name: string) {
      if (name !== 'node:child_process') return nativeRequire(name);
      return {
        spawn(command: string) {
          const child = new FixtureChild(100 + targets.length + helpers.length);
          (command === 'taskkill.exe' ? helpers : targets).push(child);
          return child;
        },
        execFile(_file: string, _args: string[], _options: object, callback: (error: Error | null) => void) {
          verifications.push(callback);
        },
      };
    },
    setTimeout(callback: () => void, delay: number) {
      const handle = {};
      timers.set(handle, { at: now + delay, callback });
      return handle;
    },
    clearTimeout(handle: object) { timers.delete(handle); },
  });
  const rpc = new exports.RpcProcess(() => {}, undefined, containTree);
  const start = () => rpc.start('node', 'step/dist/bundle/step.js', 'fixture', {});
  start();
  if (containTree) {
    const job = (rpc as unknown as { job: { name: string } }).job.name;
    targets[0].stdout.emit('data', Buffer.from(JSON.stringify({ type: 'dfsc_runtime_job', job, pid: 999 }) + '\n'));
  }
  return {
    rpc, start, helpers, targets, verifications, timers,
    async advance(milliseconds: number) {
      const end = now + milliseconds;
      await flush();
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
        await flush();
      }
      now = end;
    },
  };
}

function observe(promise: Promise<void>) {
  const result = { state: 'pending' as 'pending' | 'resolved' | 'rejected', message: '' };
  void promise.then(() => { result.state = 'resolved'; }, error => {
    result.state = 'rejected'; result.message = error.message;
  });
  return result;
}

for (const update of [false, true]) {
  test(`${update ? 'update' : 'ordinary'} stop bounds a hung taskkill and retains cleanup ownership`, async () => {
    const f = fixture(update);
    const first = observe(update ? f.rpc.stopForUpdate() : f.rpc.stop());
    const joined = observe(f.rpc.stop());
    await f.advance(9999);
    assert.equal(first.state, 'pending');
    assert.equal(f.helpers.length, 1, 'Concurrent callers share one helper');
    await f.advance(1);
    assert.equal(first.state, 'rejected', 'A hung helper must not leave stop pending');
    assert.match(first.message, /termination.*timed out/);
    assert.equal(joined.state, 'rejected');
    assert.equal(f.helpers[0].kills, 1);
    assert.equal(f.targets[0].exitCode, null);
    assert.equal(f.rpc.pid, update ? 999 : f.targets[0].pid);
    assert.equal(f.verifications.length, 0, 'A deadline is not confirmed Job release');
    await assert.rejects(f.rpc.request('ready'), /not connected/);
    assert.throws(f.start, /still stopping/);
    await assert.rejects(f.rpc.stop(), /helper.*still running/);
    assert.equal(f.helpers.length, 1, 'Do not accumulate unconfirmed helper processes');
    assert.doesNotThrow(() => f.helpers[0].emit('error', new Error('late helper error')));
    f.helpers[0].exit(null, 'SIGTERM');
    const retry = observe(f.rpc.stop());
    assert.equal(f.helpers.length, 2, 'Explicit cleanup can retry after the helper exits');
    f.targets[0].exit(); f.helpers[1].exit();
    await flush();
    if (update) {
      assert.equal(retry.state, 'pending');
      assert.equal(f.verifications.length, 1);
      f.verifications[0](null);
      await flush();
    }
    assert.equal(retry.state, 'resolved');
    assert.equal(f.timers.size, 0);
    assert.doesNotThrow(f.start);
  });
}

test('target exit cannot hide a hung helper or release it for a replacement', async () => {
  const f = fixture();
  const stopped = observe(f.rpc.stop());
  f.targets[0].exit();
  await f.advance(10000);
  assert.equal(stopped.state, 'rejected');
  assert.throws(f.start, /still stopping/);
  await assert.rejects(f.rpc.stop(), /helper.*still running/);
  f.helpers[0].exit();
  await f.rpc.stop();
  assert.doesNotThrow(f.start);
  assert.doesNotThrow(() => f.helpers[0].emit('error', new Error('old helper error')));
  await f.advance(20000);
  assert.equal(f.rpc.pid, f.targets[1].pid, 'Late old helper events cannot disconnect the replacement');
});

test('an old helper close cannot release the next helper cleanup owner', async () => {
  const f = fixture();
  const first = observe(f.rpc.stop());
  await f.advance(10000);
  assert.equal(first.state, 'rejected');
  // OS exit can precede close; retry is safe once this exact helper exited.
  f.helpers[0].signalCode = 'SIGTERM';
  f.helpers[0].emit('exit', null, 'SIGTERM');
  const retry = observe(f.rpc.stop());
  assert.equal(f.helpers.length, 2);
  f.helpers[0].emit('close', null, 'SIGTERM');
  f.targets[0].exit();
  await f.advance(10000);
  assert.equal(retry.state, 'rejected');
  assert.equal(f.helpers[1].kills, 1);
  assert.throws(f.start, /still stopping/);
  await assert.rejects(f.rpc.stop(), /helper.*still running/);
  f.helpers[1].exit();
  await f.rpc.stop();
  assert.doesNotThrow(f.start);
});

for (const killResult of [false, new Error('kill denied')]) {
  test(`helper cleanup ${killResult === false ? 'refusal' : 'exception'} remains bounded and quarantined`, async () => {
    const f = fixture();
    const stopped = observe(f.rpc.stop());
    f.helpers[0].killResult = killResult;
    await f.advance(10000);
    assert.equal(stopped.state, 'rejected');
    assert.match(stopped.message, /termination.*timed out/);
    f.targets[0].exit();
    assert.throws(f.start, /still stopping/);
    await assert.rejects(f.rpc.stop(), /helper.*still running/);
    assert.equal(f.helpers.length, 1);
    f.helpers[0].exit();
    await f.rpc.stop();
    assert.doesNotThrow(f.start);
  });
}

test('a slow helper within the deadline still requires the exact target to exit', async () => {
  const f = fixture();
  const stopped = observe(f.rpc.stop());
  await f.advance(9500);
  f.helpers[0].exit();
  await flush();
  assert.equal(stopped.state, 'pending');
  await f.advance(1999);
  assert.equal(stopped.state, 'pending');
  f.targets[0].exit(); await flush();
  assert.equal(stopped.state, 'resolved');
  await f.advance(10000);
  assert.equal(f.helpers[0].kills, 0);
  assert.equal(f.timers.size, 0);
});

for (const code of [0, 128]) {
  test(`helper exit ${code} alone cannot confirm target exit`, async () => {
    const f = fixture();
    const stopped = observe(f.rpc.stop());
    f.helpers[0].exit(code);
    await f.advance(2000);
    assert.equal(stopped.state, 'rejected');
    assert.match(stopped.message, code === 0 ? /Runtime did not exit/ : /termination failed \(128\)/);
    assert.equal(f.rpc.pid, f.targets[0].pid);
    assert.equal(f.helpers[0].kills, 0);
    assert.equal(f.timers.size, 0);
  });
}

test('helper exit 128 accepts an already observed target exit in ordinary stop', async () => {
  const f = fixture();
  const stopped = observe(f.rpc.stop());
  f.targets[0].exit(); f.helpers[0].exit(128);
  await flush();
  assert.equal(stopped.state, 'resolved');
  assert.equal(f.timers.size, 0);
});

test('helper failure cancels its deadline without allowing unconfirmed cleanup', async () => {
  const f = fixture();
  const stopped = observe(f.rpc.stop());
  f.helpers[0].emit('error', new Error('spawn failed'));
  f.helpers[0].emit('close', -1, null);
  await f.advance(20000);
  assert.equal(stopped.state, 'rejected');
  assert.match(stopped.message, /helper unavailable/);
  assert.equal(f.helpers[0].kills, 0);
  assert.equal(f.timers.size, 0);
  assert.throws(f.start, /still stopping/);
});

test('a nonzero helper exit still fails ordinary tree termination', async () => {
  const f = fixture();
  const stopped = observe(f.rpc.stop());
  f.helpers[0].exit(5);
  await f.advance(20000);
  assert.equal(stopped.state, 'rejected');
  assert.match(stopped.message, /termination failed \(5\)/);
  assert.equal(f.timers.size, 0);
});

test('update still requires successful Job verification even after target and helper exit', async () => {
  const f = fixture(true);
  const stopped = observe(f.rpc.stopForUpdate());
  f.targets[0].exit(); f.helpers[0].exit(128);
  await flush();
  assert.equal(stopped.state, 'pending');
  assert.equal(f.verifications.length, 1);
  f.verifications[0](new Error('Job still active'));
  await flush();
  assert.equal(stopped.state, 'rejected');
  assert.equal(stopped.message, 'capability:release-unconfirmed');
  const retry = observe(f.rpc.stop());
  assert.equal(f.verifications.length, 2, 'Failed verification retains a retryable Job owner');
  f.verifications[1](null); await flush();
  assert.equal(retry.state, 'resolved');
  assert.equal(f.timers.size, 0);
});
