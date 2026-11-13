import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { installRuntimeFixturePreload } from '../scripts/runtime-transport-fixture.mjs';

for (const isPackaged of [false, true]) for (const admin of [false, true]) {
  test(`${isPackaged ? 'packaged' : 'source'} transport (admin=${admin}) reaches direct and supervised workers without changing unrelated launches`, () => {
    const resourcesPath = resolve('isolated-transport-resources');
    const runtime = isPackaged ? join(resourcesPath, 'runtime') : resolve('runtime');
    const sessionEntry = join(runtime, 'step/dist/bundle/step.js');
    const jobScript = join(runtime, 'windows-runtime-job.ps1');
    const preload = join(runtime, 'fixture-transport.cjs');
    const launches: { file: string; args: string[]; options: object }[] = [];
    const cp = { spawn(file: string, args: string[], options: object) { launches.push({ file, args, options }); } };
    let synced = 0;
    const context = {
      Buffer, electron: { app: { isPackaged } }, input: { preload, admin },
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
    runInNewContext(`(${installRuntimeFixturePreload.toString()})(electron, input)`, context);
    const options = { cwd: runtime, env: { FIXTURE: 'unchanged' } };
    for (const entry of [join(runtime, 'admin.mjs'), join(runtime, 'capability-admin.mjs'), sessionEntry]) {
      const args = [entry, '--mode', 'rpc'];
      cp.spawn('node.exe', args, options);
      assert.deepEqual([...launches.at(-1)!.args], admin || entry === sessionEntry ? ['--require', preload, ...args] : args);
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
      ['-File', jobScript, '-Verify', 'isolated-job'],
    ]) {
      cp.spawn('powershell.exe', untouched, options);
      assert.equal(launches.at(-1)!.args, untouched, 'Other launches must not receive a Node preload');
    }
    for (const launch of launches) assert.equal(launch.options, options);
    assert.equal(supervised.file, 'powershell.exe', 'Keep the Job Object supervisor in the launch path');
    assert.equal(synced, 1);
  });
}

for (const file of ['verify-first-run.mjs', 'verify-account-routing.mjs', 'verify-account-settings.mjs',
  'verify-plugin-host-authorization-electron.mjs', 'verify-speech.mjs']) {
  test(`${file} installs the shared worker transport with its original admin scope`, async () => {
    const source = ts.createSourceFile(file, await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.ok(source.statements.some(statement => ts.isImportDeclaration(statement)
      && statement.moduleSpecifier.getText(source) === "'./runtime-transport-fixture.mjs'"
      && statement.importClause?.namedBindings?.getText(source).includes('installRuntimeFixturePreload')));
    const installers: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'app.evaluate'
        && node.arguments[0]?.getText(source) === 'installRuntimeFixturePreload') installers.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(installers.length, 1, 'The worker hook must run once per isolated application launch');
    const options = installers[0].arguments[1];
    assert.ok(options && ts.isObjectLiteralExpression(options));
    const adminOption = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'admin');
    if (file === 'verify-account-settings.mjs') assert.equal(adminOption?.getText(source), 'admin: false');
    else assert.equal(adminOption, undefined);
  });
}
