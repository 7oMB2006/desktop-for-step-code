import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(result);
  return result;
}
const checkpoint = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'startupCheckpoint');
const sync = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'syncCustomBackground');
const ready = find(node => ts.isCallExpression(node)
  && node.expression.getText(source) === 'app.whenReady().then') as ts.CallExpression;
const body = (ready.arguments[0] as ts.ArrowFunction).body as ts.Block;
const statements = body.statements.map(node => node.getText(source));
const start = statements.indexOf('await syncCustomBackground();') - 1;
const end = statements.indexOf('await collaboration.start();');
assert.ok(start >= 0 && end > start, 'Exercise the real startup background sequence');
const sequence = statements.slice(start, end + 1).join('\n');

function fixture(cancelAt?: 'initialize' | 'publish', failAt?: 'initialize') {
  const calls: string[] = [];
  const create = new Function('calls', 'cancelAt', 'failAt', ts.transpileModule(`
    let startupCancelled = false;
    const quitting = false, quitPending = false;
    const startupWindow = { setStage(stage) { calls.push('stage:' + stage); } };
    ${checkpoint.getText(source)}
    const step = name => {
      calls.push(name);
      if (cancelAt === name) startupCancelled = true;
      if (failAt === name) throw new Error('background fixture failure');
    };
    const customBackground = { async initialize() { step('initialize'); } };
    const publishCustomBackground = issue => step(issue ?? 'publish');
    ${sync.getText(source)}
    const collaboration = { async start() { step('collaboration'); } };
    return async () => { ${sequence} };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
  return { calls, run: create(calls, cancelAt, failAt) as () => Promise<void> };
}

test('startup initializes and reconciles backgrounds before starting collaboration', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.calls, ['stage:custom-background', 'initialize', 'publish', 'stage:collaboration', 'collaboration']);
});

for (const stage of ['initialize', 'publish'] as const) {
  test(`startup cancellation during background ${stage} cannot start later services`, async () => {
    const f = fixture(stage);
    await assert.rejects(f.run(), /Startup cancelled/);
    assert.equal(f.calls.includes('collaboration'), false);
  });
}

test('optional background storage failure falls back without blocking startup', async () => {
  const f = fixture(undefined, 'initialize');
  await f.run();
  assert.deepEqual(f.calls, ['stage:custom-background', 'initialize', 'storage', 'stage:collaboration', 'collaboration']);
});
