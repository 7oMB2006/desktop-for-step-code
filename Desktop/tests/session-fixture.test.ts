import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const { waitForNewSessionButton, waitForSessionFixtureSnapshot, restartIdleSessionFixture } =
  await import(new URL('../scripts/session-fixture.mjs', import.meta.url).href);

test('workflow planned relaunch and cleanup use orderly shutdown without removing the forced-crash case', async () => {
  const source = ts.createSourceFile('verify-workflow-runtime.mjs',
    await readFile(new URL('../scripts/verify-workflow-runtime.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let shutdowns = 0, forcedCrashes = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression))
        assert.notEqual(node.expression.getText(source), 'app.exit', 'normal closure must not bypass native cleanup');
      if (ts.isIdentifier(node.expression) && node.expression.text === 'closeDesktopFixtureAndWait') {
        assert.ok(ts.isAwaitExpression(node.parent));
        assert.equal(node.arguments[0].getText(source), 'app');
        shutdowns++;
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'terminateFixtureTree') {
        assert.equal(node.arguments[0].getText(source), 'app.process().pid');
        forcedCrashes++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(shutdowns, 2, 'planned relaunch and final cleanup must both await closure');
  assert.equal(forcedCrashes, 1, 'crash recovery must still kill the isolated fixture tree');
  const body = source.statements.find(ts.isTryStatement)!;
  const statements = body.tryBlock.statements;
  const shutdown = statements.findIndex(statement => statement.getText(source) === 'await closeDesktopFixtureAndWait(app);');
  assert.ok(shutdown >= 0);
  assert.equal(statements[shutdown + 1].getText(source), 'app = await launch();',
    'the next process can start only after orderly closure has completed');
});

test('idle restart readiness waits only for refused preflights and preserves the original worker', async () => {
  const order: string[] = [];
  let attempts = 0;
  const page = { evaluate: async (callback: () => unknown) => runInNewContext(`(${callback.toString()})()`, {
    window: { desktop: {
      restart: async () => {
        order.push('restart');
        if (++attempts < 3) throw new Error("Error invoking remote method 'desktop': Error: Session operation in progress");
        return { runtimeId: 'new', state: { isStreaming: false } };
      },
      snapshot: async () => { order.push('identity'); return { runtimeId: 'old' }; },
    } },
  }) };
  assert.deepEqual(await restartIdleSessionFixture(page, 'old'), { runtimeId: 'new', state: { isStreaming: false } });
  assert.deepEqual(order, ['restart', 'identity', 'restart', 'identity', 'restart']);
});

test('idle restart readiness never retries a different failure or a changed runtime', async () => {
  for (const changed of [false, true]) {
    let calls = 0;
    const failure = new Error(changed
      ? "Error invoking remote method 'desktop': Error: Session operation in progress"
      : 'RPC process failed to exit');
    const page = { evaluate: async () => {
      if (++calls === 1) throw failure;
      assert.equal(changed, true, 'unrelated failures must not even poll');
      return { runtimeId: 'unexpected' };
    } };
    await assert.rejects(restartIdleSessionFixture(page, 'old'),
      changed ? /A refused restart must retain the original runtime/ : error => error === failure);
    assert.equal(calls, changed ? 2 : 1);
  }
});

test('idle restart readiness retains the busy failure at its deadline', async () => {
  const failure = new Error("Error invoking remote method 'desktop': Error: Session operation in progress");
  let calls = 0;
  const page = { evaluate: async () => {
    if (++calls === 1) throw failure;
    return { runtimeId: 'old' };
  } };
  await assert.rejects(restartIdleSessionFixture(page, 'old', 0), error => error === failure);
  assert.equal(calls, 2);
});

test('file preview acceptance waits for real browser state and retains native restart exit assertions', async () => {
  const text = await readFile(new URL('../scripts/verify-file-preview.mjs', import.meta.url), 'utf8');
  const source = ts.createSourceFile('verify-file-preview.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let restart = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
        const predicate = node.arguments[0];
        assert.ok(predicate && (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)));
        assert.equal(predicate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'restartIdleSessionFixture') {
        restart++;
        assert.equal(node.arguments[1].getText(source), 'beforeRestart.runtimeId');
        assert.ok(ts.isAwaitExpression(node.parent));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(restart, 1);
  assert.ok(text.includes("'Session restart waits until the old RPC process is gone'"));
  assert.ok(text.includes("error.code === 'ESRCH'"));
});

test('first-run acceptance never polls an async predicate through browser Promise truthiness', async () => {
  const source = ts.createSourceFile('verify-first-run.mjs',
    await readFile(new URL('../scripts/verify-first-run.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let snapshotPolls = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
        const predicate = node.arguments[0];
        assert.ok(predicate && (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)),
          'browser polling must use an inspectable synchronous predicate');
        assert.equal(predicate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false,
          'async IPC predicates belong in the awaited Node-side snapshot poller');
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'waitForSessionFixtureSnapshot') {
        snapshotPolls++;
        assert.ok(ts.isAwaitExpression(node.parent), 'snapshot polling must finish before persistence assertions');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(snapshotPolls >= 2, 'reply completion and restored permissions both poll resolved IPC snapshots');
});

test('update installer fixture awaits native startup before creating a separate harness window', async () => {
  const source = ts.createSourceFile('verify-update-installer.mjs',
    await readFile(new URL('../scripts/verify-update-installer.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const body = source.statements.find(ts.isTryStatement)!;
  const statements = body.tryBlock.statements;
  const harnessIndex = statements.findIndex(statement => statement.getText(source).includes("app.waitForEvent('window')"));
  assert.ok(harnessIndex > 0);
  const startup = statements.slice(0, harnessIndex).map(statement => statement.getText(source));
  assert.ok(startup.some(statement => statement.includes('await app.firstWindow()')));
  assert.ok(startup.some(statement => statement.includes('await mainPage.waitForFunction(')
    && statement.includes('.first-run-production')), 'the native renderer must finish loading first');
  assert.ok(startup.some(statement => statement.includes('await mainPage.evaluate(() => window.desktop.snapshot())')),
    'preload availability alone cannot establish completed main-process startup');
  const shutdown = body.finallyBlock!.statements[0];
  assert.ok(ts.isExpressionStatement(shutdown) && ts.isAwaitExpression(shutdown.expression)
    && ts.isCallExpression(shutdown.expression.expression)
    && shutdown.expression.expression.expression.getText(source) === 'closeDesktopFixtureAndWait',
  'assertion failures must still perform bounded, orderly shutdown');
  const success = source.statements.find(statement => statement.getText(source).includes('Update UI acceptance passed:'))!;
  assert.ok(success.getStart(source) > body.end, 'acceptance cannot pass before Electron has actually closed');
});

test('capability restart readiness rejects the old connected worker and the connecting replacement', async () => {
  const source = ts.createSourceFile('verify-capabilities.mjs',
    await readFile(new URL('../scripts/verify-capabilities.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let initializer: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'restartSession')
      initializer = node.initializer?.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer);
  const snapshots = [
    { runtimeId: 'old', status: 'connected' },
    { runtimeId: 'old', status: 'connected' },
    { runtimeId: 'new', status: 'connecting' },
    { runtimeId: 'new', status: 'connected' },
  ];
  let reads = 0, clicks = 0, buttonChecks = 0;
  const page = {
    evaluate: async () => snapshots[reads++],
    locator: (selector: string) => {
      assert.equal(selector, '.cap-footer');
      return { getByRole: () => ({ click: async () => { clicks++; } }) };
    },
    waitForFunction: async (predicate: (footer: string) => boolean, footer: string) => {
      assert.equal(reads, 4, 'an enabled button cannot replace actual connected-worker readiness');
      assert.equal(footer, '.cap-footer');
      assert.equal(runInNewContext(`(${predicate.toString()})(footer)`, {
        footer,
        document: { querySelector: () => ({ disabled: false }) },
      }), true);
      buttonChecks++;
    },
  };
  const restart = runInNewContext(`(${initializer})`, { page, waitForSessionFixtureSnapshot });
  await restart();
  assert.equal(clicks, 1);
  assert.equal(reads, 4);
  assert.equal(buttonChecks, 1);
});

test('new-session readiness polls through missing and disabled buttons after reload', async () => {
  const buttons = [null, { disabled: true }, { disabled: false }];
  const results: boolean[] = [];
  const page = {
    waitForFunction: async (callback: (theme?: string) => boolean, theme?: string) => {
      for (const button of buttons) {
        results.push(runInNewContext(`(${callback.toString()})(theme)`, {
          theme,
          document: {
            querySelector: (selector: string) => {
              assert.equal(selector, '.new-chat');
              return button;
            },
          },
        }));
      }
    },
  };
  await waitForNewSessionButton(page);
  assert.deepEqual(results, [false, false, true]);
});

test('new-session readiness requires both an enabled button and the requested theme', async () => {
  const states = [
    { button: null, theme: 'light' },
    { button: { disabled: true }, theme: 'light' },
    { button: { disabled: false }, theme: 'dark' },
    { button: { disabled: false }, theme: 'light' },
  ];
  const results: boolean[] = [];
  const page = {
    waitForFunction: async (callback: (theme?: string) => boolean, theme?: string) => {
      assert.equal(theme, 'light');
      for (const state of states) {
        results.push(runInNewContext(`(${callback.toString()})(theme)`, {
          theme,
          document: {
            querySelector: () => state.button,
            documentElement: { dataset: { theme: state.theme } },
          },
        }));
      }
    },
  };
  await waitForNewSessionButton(page, 'light');
  assert.deepEqual(results, [false, false, false, true]);
});

test('fixture polling awaits each IPC snapshot until the response has settled', async () => {
  const pending = { messages: [], state: { isStreaming: false } };
  const streaming = { messages: ['response'], state: { isStreaming: true } };
  const settled = { messages: ['response'], state: { isStreaming: false } };
  const snapshots = [pending, streaming, settled];
  let reads = 0;
  const page = {
    evaluate: async (callback: () => unknown) => runInNewContext(`(${callback.toString()})()`, {
      window: { desktop: { snapshot: async () => snapshots[reads++] } },
    }),
  };
  const actual = await waitForSessionFixtureSnapshot(page,
    (snapshot: typeof settled) => snapshot.messages.length === 1 && !snapshot.state.isStreaming, 'a settled response');
  assert.equal(actual, settled);
  assert.equal(reads, 3, 'a Promise or a streaming response cannot satisfy the wait early');
});

test('fixture polling awaits a predicate that resolves false before retrying', async () => {
  let reads = 0;
  const page = { evaluate: async () => ++reads };
  assert.equal(await waitForSessionFixtureSnapshot(page, async (value: number) => value === 2, 'the second snapshot'), 2);
  assert.equal(reads, 2);
});

test('fixture polling fails within its deadline when no snapshot matches', async () => {
  let reads = 0;
  await assert.rejects(waitForSessionFixtureSnapshot({ evaluate: async () => ++reads },
    () => false, 'a missing model request', 0), /Timed out waiting for a missing model request/);
  assert.equal(reads, 1);
});

test('fixture polling preserves IPC failures', async () => {
  const failure = new Error('Snapshot IPC disconnected');
  await assert.rejects(waitForSessionFixtureSnapshot({ evaluate: async () => { throw failure; } },
    () => true, 'a connected session'), error => error === failure);
});
