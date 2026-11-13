import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('verify-first-run.mjs',
  await readFile(new URL('../scripts/verify-first-run.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const installers: ts.Expression[] = [];
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'app.evaluate'
    && node.arguments[0]?.getText(source).includes('cp.spawn = function'))
    installers.push(node.arguments[0]);
  ts.forEachChild(node, visit);
};
visit(source);
assert.equal(installers.length, 1, 'Exercise the real official transport installer');

for (const isPackaged of [false, true]) {
  test(`${isPackaged ? 'packaged' : 'source'} first-run transport reaches direct and supervised workers without changing unrelated launches`, async () => {
    const resourcesPath = resolve('isolated-first-run-resources');
    const runtime = isPackaged ? join(resourcesPath, 'runtime') : resolve('runtime');
    const sessionEntry = join(runtime, 'step/dist/bundle/step.js');
    const jobScript = join(runtime, 'windows-runtime-job.ps1');
    const preload = join(runtime, 'fixture-transport.cjs'), base = 'http://127.0.0.1:12345';
    const launches: { file: string; args: string[]; options: object }[] = [];
    const cp = { spawn(file: string, args: string[], options: object) { launches.push({ file, args, options }); } };
    const routed: unknown[][] = [];
    let synced = 0;
    const electron = {
      app: { isPackaged },
      net: { fetch: (_input: string, _init?: object) => Promise.resolve() },
      shell: { openExternal: (_url: string) => Promise.resolve() },
    };
    const context = {
      Buffer,
      electron, input: { preload, base }, firstRunAuthUrl: undefined as string | undefined,
      fetch: (...args: unknown[]) => { routed.push(args); return Promise.resolve(); },
      process: {
        resourcesPath,
        getBuiltinModule(name: string) {
          if (name === 'child_process') return cp;
          if (name === 'path') return path;
          assert.equal(name, 'module');
          return { syncBuiltinESMExports() { synced++; } };
        },
      },
    };
    runInNewContext(`(${installers[0].getText(source)})(electron, input)`, context);
    const options = { cwd: runtime, env: { FIXTURE: 'unchanged' } };
    for (const entry of [join(runtime, 'admin.mjs'), sessionEntry]) {
      const args = [entry, '--mode', 'rpc'];
      cp.spawn('node.exe', args, options);
      assert.deepEqual([...launches.at(-1)!.args], ['--require', preload, ...args]);
      assert.deepEqual(args, [entry, '--mode', 'rpc'], 'Direct launch input is not mutated');
    }
    const spec = { job: 'isolated-job', node: join(runtime, 'node/node.exe'),
      args: [sessionEntry, '--mode', 'rpc', '--session', 'isolated-session'], cwd: runtime };
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64');
    const args = ['-NoProfile', '-File', jobScript, '-Spec', encode(spec)];
    cp.spawn('powershell.exe', args, options);
    const supervised = launches.at(-1)!;
    assert.deepEqual(JSON.parse(Buffer.from(supervised.args[4], 'base64').toString('utf8')),
      { ...spec, args: ['--require', preload, ...spec.args] });
    assert.deepEqual([...supervised.args.slice(0, 4)], args.slice(0, 4));
    assert.deepEqual(args, ['-NoProfile', '-File', jobScript, '-Spec', encode(spec)], 'Supervisor input is not mutated');
    for (const untouched of [
      ['-File', jobScript, '-Spec', 'invalid'],
      ['-File', jobScript, '-Spec', encode({ ...spec, args: null })],
      ['-File', jobScript, '-Spec', encode({ ...spec, args: [sessionEntry] })],
      ['-File', jobScript, '-Spec', encode({ ...spec, args: [join(runtime, 'admin.mjs'), '--mode', 'rpc'] })],
      ['-File', join(runtime, 'other/windows-runtime-job.ps1'), '-Spec', encode(spec)],
      ['-File', join(runtime, 'verify.ps1')],
    ]) {
      cp.spawn('powershell.exe', untouched, options);
      assert.equal(launches.at(-1)!.args, untouched, 'Other launches must not receive a Node preload');
    }
    for (const launch of launches) assert.equal(launch.options, options);
    assert.equal(supervised.file, 'powershell.exe', 'Keep the Job Object supervisor in the launch path');
    assert.equal(synced, 1);
    await electron.net.fetch('https://api.stepfun.ai/v1/models', options);
    assert.deepEqual(routed, [[base + '/?url=' + encodeURIComponent('https://api.stepfun.ai/v1/models'), options]]);
    await electron.shell.openExternal('https://platform.stepfun.ai/isolated-login');
    assert.equal(context.firstRunAuthUrl, 'https://platform.stepfun.ai/isolated-login');
  });
}
