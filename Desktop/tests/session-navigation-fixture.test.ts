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

test('navigation fixture disables unrelated external StepPage startup', () => {
  const configs: string[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'writeFile'
      && node.arguments[0]?.getText(source) === "join(root, 'config.toml')"
      && node.arguments[1] && ts.isStringLiteral(node.arguments[1]))
      configs.push(node.arguments[1].text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  assert.equal(configs.length, 1);
  assert.match(configs[0], /\[mcp_servers\.steppage__steppage\]\r?\nenabled = false(?:\r?\n|$)/);
});

test('native recycling capture preserves map writes and restores its instrumentation', () => {
  const context = {
    process: { getBuiltinModule: (name: string) => name === 'path' ? path : childProcess },
    electron: { app: { isPackaged: false } },
  };
  const childProcess = { spawn: () => ({ stdin: { write: () => true } }) };
  runInNewContext('globalThis.originalMapSet = Map.prototype.set', context);
  runInNewContext(`(${installers[0].getText(source)})(electron)`, context);
  const result = runInNewContext(`(() => {
    const worker = { id: 'worker', rpc: {}, pendingUI: new Map(), operations: 0 };
    const workers = new Map();
    const same = workers.set(worker.id, worker) === workers;
    const opening = new Map(), navigation = new Map(), unrelated = new Map();
    const promise = Promise.resolve();
    opening.set('navigation-1', promise);
    navigation.set('navigation-0', { controller: {}, cold: true });
    unrelated.set('personal-session', promise);
    const captured = navigationDiagnosticWorkers === workers
      && navigationDiagnosticPreparations.get(opening) === 'opening'
      && navigationDiagnosticPreparations.get(navigation) === 'navigation'
      && !navigationDiagnosticPreparations.has(unrelated);
    const unchanged = workers.get(worker.id) === worker && opening.get('navigation-1') === promise;
    navigationRestoreSpawn();
    return { same, captured, unchanged, restored: Map.prototype.set === originalMapSet,
      released: navigationDiagnosticWorkers === undefined && navigationDiagnosticPreparations === undefined };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),
    { same: true, captured: true, unchanged: true, restored: true, released: true });
});

for (const isPackaged of [false, true]) for (const supervised of [false, true]) {
  test(`${isPackaged ? 'packaged' : 'source'} ${supervised ? 'supervised' : 'direct'} navigation fixture holds only two session workers, not management RPC`, () => {
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
      Buffer,
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
    const jobScript = join(runtime, 'windows-runtime-job.ps1');
    const launch = (entry: string, args = ['--mode', 'rpc']) => supervised
      ? childProcess.spawn('powershell.exe', ['-NoProfile', '-File', jobScript, '-Spec',
        Buffer.from(JSON.stringify({ job: 'fixture-job', node: 'node', args: [entry, ...args], cwd: runtime })).toString('base64')])
      : childProcess.spawn('node', [entry, ...args]);
    try {
      for (const args of [
        ['-File', jobScript, '-Spec', 'invalid'],
        ['-File', jobScript, '-Spec', Buffer.from(JSON.stringify({ args: null })).toString('base64')],
        ['-File', join(runtime, 'other/windows-runtime-job.ps1'), '-Spec',
          Buffer.from(JSON.stringify({ args: [sessionEntry, '--mode', 'rpc'] })).toString('base64')],
      ]) {
        const child = childProcess.spawn('powershell.exe', args);
        child.stdin.write(state);
        assert.deepEqual(writes.get(child), [state], 'Invalid or unrelated supervisors cannot consume a startup slot');
      }
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
