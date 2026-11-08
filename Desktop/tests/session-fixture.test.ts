import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const { waitForNewSessionButton, waitForSessionFixtureSnapshot } = await import(new URL('../scripts/session-fixture.mjs', import.meta.url).href);

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
