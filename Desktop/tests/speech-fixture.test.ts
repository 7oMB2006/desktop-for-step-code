import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('verify-speech.mjs',
  readFileSync(new URL('../scripts/verify-speech.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = source.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations]);
const launch = declarations.find(declaration => declaration.name.getText(source) === 'launch')?.initializer;
assert.ok(launch && ts.isArrowFunction(launch) && ts.isBlock(launch.body));
const executablePath = launch.body.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(declaration => declaration.name.getText(source) === 'executablePath')?.initializer;
assert.ok(executablePath);
const calls: ts.CallExpression[] = [];
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'electron.launch') calls.push(node);
  ts.forEachChild(node, visit);
};
visit(launch.body);
assert.equal(calls.length, 1, 'Speech acceptance must have one explicit Electron launch');
const program = `(async () => {
  const executablePath = ${executablePath.getText(source)};
  return ${calls[0].getText(source)};
})()`;

interface LaunchOptions {
  executablePath?: string;
  args: string[];
  env: object;
  timeout: number;
}

async function fixtureLaunch(executable?: string) {
  const entry = '/fixture/source-entry.cjs';
  const microphone = '/fixture/synthetic microphone.wav';
  const env = { DESKTOP_TEST_USER_DATA: '/fixture/profile' };
  const options: LaunchOptions[] = [];
  const result = {};
  const returned = await runInNewContext(program, {
    process: { env: executable === undefined ? {} : { DESKTOP_VERIFY_EXE: executable } },
    entry, microphone, env,
    electron: { launch: async (value: LaunchOptions) => { options.push(value); return result; } },
  });
  assert.equal(returned, result);
  assert.equal(options.length, 1);
  assert.equal(options[0].env, env, 'Both modes retain the isolated fixture environment');
  assert.equal(options[0].timeout, 60000);
  const args = Array.from(options[0].args);
  assert.ok(args.includes('--use-fake-device-for-media-stream'));
  assert.ok(args.includes('--disable-features=AudioServiceSandbox'));
  assert.ok(args.includes(`--use-file-for-fake-audio-capture=${microphone}`));
  return { options: options[0], args, entry };
}

test('speech source acceptance launches its isolated entry with native synthetic audio flags', async () => {
  const { options, args, entry } = await fixtureLaunch();
  assert.equal(Object.hasOwn(options, 'executablePath'), false);
  assert.equal(args[0], entry);
  assert.equal(args.filter(argument => argument === entry).length, 1);
});

test('speech packaged acceptance preserves the exact requested executable and never passes the source entry', async () => {
  for (const executable of ['C:\\Fixture Package\\Speech CI.exe', '/Fixture/Step Code.app/Contents/MacOS/Step Code']) {
    const { options, args, entry } = await fixtureLaunch(executable);
    assert.equal(options.executablePath, executable);
    assert.equal(args.includes(entry), false);
    assert.ok(args.every(argument => argument.startsWith('--')),
      'A packaged application must not receive an alternative source application');
  }
});
