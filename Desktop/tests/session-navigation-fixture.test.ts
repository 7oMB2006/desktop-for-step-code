import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('verify-session-navigation.mjs',
  await readFile(new URL('../scripts/verify-session-navigation.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const installers: ts.Expression[] = [];
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'app.evaluate'
    && node.arguments[0]?.getText(source).includes('globalThis.navigationStalled = 0'))
    installers.push(node.arguments[0]);
  ts.forEachChild(node, visit);
};
visit(source);
assert.equal(installers.length, 1, 'Exercise the actual native startup interceptor');

for (const isPackaged of [false, true]) {
  test(`${isPackaged ? 'packaged' : 'source'} navigation fixture holds only two session workers, not management RPC`, () => {
    const app = { isPackaged };
    const resourcesPath = resolve('isolated-fixture-resources');
    const runtime = isPackaged ? join(resourcesPath, 'runtime') : resolve('runtime');
    const sessionEntry = join(runtime, 'step/dist/bundle/step.js');
    const writes = new Map<object, unknown[]>();
    const spawn = (_node: string, _args: string[]) => {
      const child = { stdin: { write(value: unknown) { writes.get(child)!.push(value); return true; } } };
      writes.set(child, []);
      return child;
    };
    const childProcess = { spawn };
    const context = {
      process: {
        resourcesPath,
        getBuiltinModule(name: string) {
          if (name === 'child_process') return childProcess;
          assert.equal(name, 'path');
          return path;
        },
      },
      electron: { app },
      navigationStalled: 0,
      navigationReleaseStartup: undefined as unknown as (index: number) => void,
      navigationRestoreSpawn: undefined as unknown as () => void,
    };
    runInNewContext(`(${installers[0].getText(source)})(electron)`, context);
    const state = JSON.stringify({ type: 'get_state' }) + '\n';
    const launch = (entry: string, args = ['--mode', 'rpc']) => childProcess.spawn('node', [entry, ...args]);
    try {
      for (const entry of [join(runtime, 'capability-admin.mjs'), join(runtime, 'admin.mjs'),
        join(runtime, 'another/step.js')]) {
        const child = launch(entry);
        assert.equal(child.stdin.write(state), true);
        assert.deepEqual(writes.get(child), [state], 'Unrelated RPC cannot consume a startup slot or be held');
      }
      const nonRpc = launch(sessionEntry, []);
      nonRpc.stdin.write(state);
      assert.deepEqual(writes.get(nonRpc), [state]);
      const first = launch(sessionEntry), second = launch(sessionEntry), third = launch(sessionEntry);
      const catalog = JSON.stringify({ type: 'catalog' }) + '\n';
      first.stdin.write(catalog);
      assert.deepEqual(writes.get(first), [catalog], 'Non-startup commands remain unmodified');
      first.stdin.write(state);
      second.stdin.write(state);
      third.stdin.write(state);
      assert.equal(context.navigationStalled, 2, 'Both real cold workers must actually be held');
      assert.deepEqual(writes.get(first), [catalog]);
      assert.deepEqual(writes.get(second), []);
      assert.deepEqual(writes.get(third), [state], 'The interceptor retains its two-worker bound');
      context.navigationReleaseStartup(0);
      context.navigationReleaseStartup(0);
      assert.deepEqual(writes.get(first), [catalog, state], 'Releasing a held command is idempotent');
      assert.deepEqual(writes.get(second), [], 'Releasing one worker cannot unlock the other');
      context.navigationReleaseStartup(1);
      assert.deepEqual(writes.get(second), [state]);
      second.stdin.write(state);
      assert.equal(context.navigationStalled, 2, 'Only the initial get_state is held');
      assert.deepEqual(writes.get(second), [state, state]);
    } finally {
      context.navigationReleaseStartup(0);
      context.navigationReleaseStartup(1);
      context.navigationRestoreSpawn();
    }
    assert.equal(childProcess.spawn, spawn);
  });
}
