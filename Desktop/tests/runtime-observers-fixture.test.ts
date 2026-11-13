import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

async function installer(file: string, marker: string) {
  const source = ts.createSourceFile(file, await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const callbacks: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'app.evaluate'
      && node.arguments[0]?.getText(source).includes(marker)) callbacks.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(callbacks.length, 1, `Exercise the actual ${file} interceptor`);
  return callbacks[0].getText(source);
}

class FixtureChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly writes: unknown[] = [];
  readonly stdin = { destroyed: false, write: (value: unknown) => { this.writes.push(value); return true; } };
  exitCode: number | null = null;
  signalCode: string | null = null;
  constructor(readonly pid: number) { super(); }
  send(value: object) { this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
}

interface NativeRecord { child: FixtureChild; pid?: number; supervisorPid?: number; sessionId?: string; permission?: string }
const observers = [
  ['diagnostics', 'verify-capability-diagnostics.mjs', 'globalThis.diagnosticNatives = []'],
  ['timing', 'verify-conversation-timing.mjs', 'const childProcess ='],
  ['performance', 'verify-session-navigation-performance.mjs', 'globalThis.navigationPerformance ='],
] as const;

for (const [kind, file, marker] of observers) {
  const callback = await installer(file, marker);
  for (const isPackaged of [false, true]) for (const supervised of [false, true]) {
    test(`${kind}: ${isPackaged ? 'packaged' : 'source'} ${supervised ? 'supervised' : 'direct'} worker remains observable without changing its launch`, () => {
      const resourcesPath = resolve('observer-resources');
      const runtime = isPackaged ? join(resourcesPath, 'runtime') : resolve('runtime');
      const sessionEntry = join(runtime, 'step/dist/bundle/step.js');
      const jobScript = join(runtime, 'windows-runtime-job.ps1');
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64');
      const spec = { job: 'observer-job', node: 'node', args: [sessionEntry, '--mode', 'rpc'], cwd: runtime };
      const launches: { command: string; args: string[]; options: object; child: FixtureChild }[] = [];
      const spawn = (command: string, args: string[], options: object) => {
        const child = new FixtureChild(100 + launches.length);
        launches.push({ command, args, options, child });
        return child;
      };
      const cp = { spawn };
      const timers: { callback: () => void; delay: number }[] = [];
      const context = {
        Buffer, performance,
        electron: { app: { isPackaged }, dialog: {}, BrowserWindow: { getAllWindows: () => [{
          setOpacity() {}, setIgnoreMouseEvents() {}, showInactive() {},
        }] } },
        input: join(runtime, 'remote-fixture.mjs'),
        process: {
          resourcesPath,
          getBuiltinModule(name: string) {
            if (name === 'child_process' || name === 'node:child_process') return cp;
            if (name === 'path' || name === 'node:path') return path;
            assert.equal(name, 'node:string_decoder');
            return { StringDecoder };
          },
        },
        setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay }); },
        diagnosticNatives: [] as NativeRecord[],
        diagnosticRemote: undefined as FixtureChild | undefined,
        diagnosticBindingIds: [] as string[],
        diagnosticPromptMessages: [] as string[],
        navigationPerformance: { runtimes: [] as { firstResponseMs: number | null; exited: boolean }[],
          commands: [] as { command: string; success: boolean }[] },
      };
      runInNewContext(`(${callback})(electron, input)`, context);
      const options = { cwd: runtime, env: { FIXTURE: 'unchanged' } };
      const untouched = [
        [join(runtime, 'capability-admin.mjs'), '--mode', 'rpc'],
        [join(runtime, 'other/step.js'), '--mode', 'rpc'],
        [sessionEntry],
        ['-File', jobScript, '-Spec', 'invalid'],
        ['-File', jobScript, '-Spec', encode({ ...spec, args: null })],
        ['-File', jobScript, '-Verify', spec.job],
        ['-File', join(runtime, 'other/windows-runtime-job.ps1'), '-Spec', encode(spec)],
      ];
      for (const args of untouched) {
        const child = cp.spawn('node', args, options);
        child.stdin.write('{"type":"get_state"}\n');
        assert.deepEqual(child.writes, ['{"type":"get_state"}\n']);
      }
      assert.equal(context.diagnosticNatives.length, 0);
      assert.equal(context.navigationPerformance.runtimes.length, 0);
      assert.equal(timers.length, 0);
      const args = supervised ? ['-NoProfile', '-File', jobScript, '-Spec', encode(spec)] : spec.args;
      const command = supervised ? 'powershell.exe' : 'node';
      const child = cp.spawn(command, args, options);
      const request = '{"id":"state","type":"get_state"}\n';
      child.stdin.write(request);
      if (kind === 'diagnostics') {
        assert.equal(context.diagnosticNatives.length, 1);
        const record = context.diagnosticNatives[0];
        assert.equal(record.child, child, 'Retain the original RPC transport object');
        assert.equal(record.pid, supervised ? undefined : child.pid);
        assert.equal(record.supervisorPid, supervised ? child.pid : undefined);
        for (const receipt of [
          { job: 'unrelated', pid: 500 }, { job: spec.job, pid: 0 }, { job: spec.job, pid: '500' },
        ]) child.send({ type: 'dfsc_runtime_job', ...receipt });
        assert.equal(record.pid, supervised ? undefined : child.pid, 'Only the matching valid job receipt identifies Node');
        child.send({ type: 'dfsc_runtime_job', job: spec.job, pid: 500 });
        child.send({ type: 'dfsc_runtime_job', job: spec.job, pid: 501 });
        assert.equal(record.pid, supervised ? 500 : child.pid, 'Do not replace an established worker identity');
        child.send({ type: 'response', success: true, data: { sessionId: 'observer-session' } });
        child.send({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'step-permission', statusText: 'Mode: Ask' });
        child.stdin.write('{"type":"prompt","message":"fixture input"}\n');
        assert.equal(record.sessionId, 'observer-session');
        assert.equal(record.permission, 'Mode: Ask');
        assert.deepEqual([...context.diagnosticPromptMessages], ['fixture input']);
        const remote = cp.spawn('node', [join(runtime, 'remote-channel.mjs')], options);
        assert.equal(context.diagnosticRemote, remote);
        assert.deepEqual([...launches.at(-1)!.args], [context.input]);
        remote.send({ type: 'fixture_binding', bindingId: 'observer-binding' });
        assert.deepEqual([...context.diagnosticBindingIds], ['observer-binding']);
      } else if (kind === 'timing') {
        assert.deepEqual(child.writes, []);
        assert.equal(timers.length, 1);
        assert.equal(timers[0].delay, 1600);
        assert.equal(cp.spawn, spawn, 'The startup hold remains one-shot');
        timers[0].callback();
        child.stdin.write(request);
        assert.deepEqual(child.writes, [request, request]);
      } else {
        assert.equal(context.navigationPerformance.runtimes.length, 1);
        child.send({ type: 'response', id: 'state', success: true });
        assert.ok(context.navigationPerformance.runtimes[0].firstResponseMs !== null);
        assert.deepEqual([...context.navigationPerformance.commands].map(item => item.command), ['get_state']);
        assert.equal(context.navigationPerformance.commands[0].success, true);
        child.emit('exit', 0);
        assert.equal(context.navigationPerformance.runtimes[0].exited, true);
      }
      for (const launch of launches) assert.equal(launch.options, options);
      const launch = launches.find(launch => launch.child === child)!;
      assert.equal(launch.command, command, 'Do not bypass the supervisor');
      assert.equal(launch.args, args, 'Observing a worker cannot rewrite its launch');
    });
  }
}
