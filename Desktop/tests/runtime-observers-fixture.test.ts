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
  readonly stderr = new EventEmitter();
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
  ['speech', 'verify-speech.mjs', 'globalThis.speechRuntimeDiagnostics = []'],
] as const;

test('speech bootstrap diagnostics are bounded and exclude URLs, credentials and arbitrary handle names', async () => {
  const source = ts.createSourceFile('verify-speech.mjs',
    await readFile(new URL('../scripts/verify-speech.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let template: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'writeFile'
      && node.arguments[0]?.getText(source) === 'preload') template = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(template);
  const code = runInNewContext(template.getText(source), { join, evidence: 'fixture', base: 'http://127.0.0.1:1234' });
  const records: string[] = [], requests: string[] = [];
  const timers: (() => void)[] = [], exit: ((code: number) => void)[] = [];
  const context = {
    URL, Request,
    require(name: string) {
      assert.equal(name, 'node:fs');
      return { appendFileSync(_path: string, value: string) { records.push(value); } };
    },
    process: { argv: ['node', 'step.js'], pid: 123, uptime: () => 1,
      once(event: string, callback: (code: number) => void) { assert.equal(event, 'exit'); exit.push(callback); },
      _getActiveHandles: () => [{ constructor: { name: 'Socket' } }, { constructor: { name: 'private-fixture-secret' } }],
      _getActiveRequests: () => [{ constructor: { name: 'GetAddrInfoReqWrap' } }],
    },
    setTimeout(callback: () => void) { timers.push(callback); return { unref() {} }; },
    fetch: async (input: string | URL) => { requests.push(String(input)); return { status: 200 }; },
  };
  runInNewContext(code, context);
  await context.fetch('https://api.stepfun.com/v1/models?key=private-fixture-secret');
  timers[0](); exit[0](0);
  assert.equal(records.map(value => JSON.parse(value)).some(value => value.phase === 'pending'
    && value.handles.join(',') === 'Socket,other' && value.requests[0] === 'GetAddrInfoReqWrap'), true);
  assert.match(requests[0], /^http:\/\/127\.0\.0\.1:1234\/\?url=/);
  assert.doesNotMatch(records.join(''), /private-fixture-secret|https:|api\.stepfun/);
  assert.throws(() => context.fetch('https://private-fixture-secret.invalid/'), /External fixture request blocked/);
  for (let index = 0; index < 140; index++) await context.fetch('http://127.0.0.1:1234/models');
  assert.equal(records.length, 128);
});

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
            if (name === 'node:module') return { syncBuiltinESMExports() {} };
            assert.equal(name, 'node:string_decoder');
            return { StringDecoder };
          },
        },
        setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay }); },
        diagnosticNatives: [] as NativeRecord[],
        diagnosticRemote: undefined as FixtureChild | undefined,
        diagnosticBindingIds: [] as string[],
        diagnosticPromptMessages: [] as string[],
        speechRuntimeDiagnostics: [] as {
          supervised: boolean; commands: { type: string }[]; responses: { type: string; success: boolean }[];
          outputBytes: number; stderrBytes: number; errorCodes: string[]; exit: { code: number } | null;
        }[],
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
      assert.equal(context.speechRuntimeDiagnostics.length, 0);
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
      } else if (kind === 'speech') {
        assert.equal(context.speechRuntimeDiagnostics.length, 1);
        const record = context.speechRuntimeDiagnostics[0];
        assert.equal(record.supervised, supervised);
        child.send({ type: 'response', id: 'state', success: true, data: { secret: 'never-log-fixture-data' } });
        child.stdin.write('{"type":"prompt","message":"never-log-fixture-data"}\n');
        child.stderr.emit('data', Buffer.from('ERR_MODULE_NOT_FOUND never-log-fixture-data ERR_PRIVATE_SECRET'));
        assert.deepEqual([...record.commands].map(value => value.type), ['get_state']);
        assert.deepEqual([...record.responses].map(value => ({ type: value.type, success: value.success })),
          [{ type: 'get_state', success: true }]);
        assert.deepEqual([...record.errorCodes], ['ERR_MODULE_NOT_FOUND']);
        assert.ok(record.outputBytes > 0 && record.stderrBytes > 0);
        assert.doesNotMatch(JSON.stringify(record), /never-log-fixture-data|ERR_PRIVATE_SECRET/);
        child.emit('exit', 0, null);
        assert.equal(record.exit?.code, 0);
        assert.deepEqual(child.writes, [request, '{"type":"prompt","message":"never-log-fixture-data"}\n']);
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
