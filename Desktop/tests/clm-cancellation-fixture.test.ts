import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const { waitForSessionFixtureSnapshot } =
  await import(new URL('../scripts/session-fixture.mjs', import.meta.url).href);
const source = ts.createSourceFile('verify-clm-cancellation.mjs',
  await readFile(new URL('../scripts/verify-clm-cancellation.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const acceptance = source.statements.find((node): node is ts.TryStatement => ts.isTryStatement(node));
assert.ok(acceptance?.catchClause, 'The real acceptance must report failures before its teardown');

test('CLM acceptance awaits resolved snapshot conditions rather than truthy Promises', () => {
  let waits = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
        const predicate = node.arguments[0];
        assert.ok(predicate && (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)));
        assert.equal(predicate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false,
          'Browser polling must not treat an unresolved IPC Promise as a passed condition');
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'waitForSessionFixtureSnapshot') {
        assert.ok(ts.isAwaitExpression(node.parent));
        waits++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(waits, 5, 'Restoration, maintenance, queue, cancellation and recovery all await real state');
});

test('real CLM recovery predicate cannot pass before the actor response and idle state', async () => {
  let predicateSource = '';
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'waitForSessionFixtureSnapshot'
      && node.arguments[2]?.getText(source) === "'completed CLM recovery'")
      predicateSource = node.arguments[1].getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(predicateSource);
  const predicate = runInNewContext(`(${predicateSource})`);
  const reply = { role: 'assistant', content: [{ type: 'text', text: 'CLM recovery completed.' }] };
  const snapshots = [
    { pendingMessages: [], state: { isStreaming: false, isCompacting: false }, messages: [] },
    { pendingMessages: [], state: { isStreaming: true, isCompacting: false }, messages: [reply] },
    { pendingMessages: [], state: { isStreaming: false, isCompacting: false }, messages: [reply] },
  ];
  let calls = 0;
  const page = { evaluate: async () => {
    await new Promise(resolve => setImmediate(resolve));
    return snapshots[calls++];
  } };
  assert.equal(await waitForSessionFixtureSnapshot(page, predicate, 'controlled CLM recovery', 1000), snapshots[2]);
  assert.equal(calls, 3);
});

for (const mode of ['normal', 'screenshot failure', 'snapshot stalled', 'disk failure', 'disk stalled'] as const) {
  test(`CLM diagnostics preserve the original failure: ${mode}`, async () => {
    const original = new Error('Original CLM assertion');
    const writes = new Map<string, string>();
    const logs: string[] = [];
    const order: string[] = [];
    const context = {
      original, phase: 'verify cancelled maintenance and retained queue',
      maintenanceCalls: 1, summaries: 0, actorInputs: [], errors: ['fixture error'],
      output: 'evidence', join: (...parts: string[]) => parts.join('/'),
      writeSync: (fd: number, text: string) => { assert.equal(fd, 2); logs.push(text); order.push('log'); },
      writeFile: async (path: string, text: string) => {
        order.push('artifact');
        if (mode === 'disk failure') throw new Error('Diagnostic disk unavailable');
        if (mode === 'disk stalled') await new Promise(() => {});
        writes.set(path, text);
      },
      page: {
        screenshot: async ({ timeout }: { timeout: number }) => {
          assert.equal(timeout, 5000);
          if (mode === 'screenshot failure') throw new Error('Screenshot unavailable');
        },
        evaluate: async (callback: () => unknown) => mode === 'snapshot stalled' ? new Promise(() => {})
          : runInNewContext(`(${callback.toString()})()`, {
            window: { desktop: { snapshot: async () => ({
              state: { isStreaming: false, isCompacting: true, credentials: 'not for diagnostics' },
              pendingMessages: [{ id: 'queued', version: 1, sending: false, text: 'private message' }],
              messages: [{ role: 'assistant', stopReason: 'stop', content: 'private context' }],
            }) } },
          }),
      },
      setTimeout: (callback: () => void, ms: number) => {
        assert.equal(ms, 5000);
        return setTimeout(callback, 10);
      },
      clearTimeout,
    };
    await assert.rejects(runInNewContext(
      `(async () => { try { throw original; } ${acceptance.catchClause!.getText(source)} })()`, context),
    error => error === original);
    assert.equal(order[0], 'log', 'Original error is written synchronously before any fallible diagnostics');
    assert.match(logs[0], /Original CLM assertion/);
    assert.match(logs[0], /verify cancelled maintenance and retained queue/);
    if (mode !== 'disk failure' && mode !== 'disk stalled') {
      const failure = JSON.parse(writes.get('evidence/failure.json')!);
      assert.equal(failure.maintenanceCalls, 1);
      assert.equal(failure.actorInputs, 0);
      assert.deepEqual(failure.errors, ['fixture error']);
    }
    if (mode === 'normal') {
      assert.deepEqual(JSON.parse(writes.get('evidence/snapshot.json')!), {
        state: { isStreaming: false, isCompacting: true },
        pendingMessages: [{ id: 'queued', version: 1, sending: false }],
        messages: [{ role: 'assistant', stopReason: 'stop' }],
      });
    }
    else assert.equal(logs.length, 2, 'Diagnostic failures are reported without replacing the original');
  });
}

test('CLM cleanup watchdog reports its phase without changing its 15-second failure deadline', () => {
  const watchdog = acceptance!.finallyBlock!.statements.find((node): node is ts.VariableStatement => ts.isVariableStatement(node));
  assert.ok(watchdog);
  const initializer = watchdog.declarationList.declarations[0].initializer;
  assert.ok(initializer && ts.isCallExpression(initializer));
  const events: string[] = [];
  runInNewContext(initializer.getText(source), {
    phase: 'explicit recovery',
    writeSync: (_fd: number, text: string) => { events.push(text); },
    app: { process: () => ({ kill: () => { events.push('kill'); } }) },
    process: { exit: (code: number) => { assert.equal(code, 1); events.push('exit'); } },
    setTimeout: (callback: () => void, ms: number) => { assert.equal(ms, 15000); callback(); },
  });
  assert.match(events[0], /cleanup timed out after 15000ms.*explicit recovery/);
  assert.deepEqual(events.slice(1), ['kill', 'exit']);
});
