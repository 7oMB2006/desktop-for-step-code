import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const { waitForBrowserFixtureSnapshot } = await import(new URL('../scripts/browser-fixture.mjs', import.meta.url).href);

test('native browser acceptance checks resolved IPC values instead of Promise truthiness', async () => {
  const source = ts.createSourceFile('verify-browser-panel.mjs',
    await readFile(new URL('../scripts/verify-browser-panel.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let polls = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunction') {
        const predicate = node.arguments[0];
        assert.ok(predicate && (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)));
        assert.equal(predicate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'waitForBrowserFixtureSnapshot') {
        polls++;
        assert.ok(ts.isAwaitExpression(node.parent));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(polls, 10, 'all native browser IPC readiness checks must await resolved snapshots');
});

test('browser fixture waits through empty and loading tabs until navigation actually finishes', async () => {
  const snapshots = [
    { tabs: [] },
    { tabs: [{ title: '', loading: false }] },
    { tabs: [{ title: 'Fixture', loading: true }] },
    { tabs: [{ title: 'Fixture', loading: false }] },
  ];
  let reads = 0;
  const page = {
    evaluate: async (callback: () => unknown) => runInNewContext(`(${callback.toString()})()`, {
      window: { desktop: { browserList: async () => snapshots[reads++] } },
    }),
  };
  const actual = await waitForBrowserFixtureSnapshot(page,
    (value: typeof snapshots[number]) => value.tabs[0]?.title === 'Fixture' && !value.tabs[0].loading,
    'a loaded browser tab');
  assert.equal(actual, snapshots[3]);
  assert.equal(reads, 4);
});

test('browser fixture awaits an asynchronous predicate before retrying', async () => {
  let reads = 0;
  const page = { evaluate: async () => ++reads };
  assert.equal(await waitForBrowserFixtureSnapshot(page, async (value: number) => value === 2, 'second read'), 2);
  assert.equal(reads, 2);
});

test('browser fixture keeps its deadline and propagates IPC errors', async () => {
  let reads = 0;
  await assert.rejects(waitForBrowserFixtureSnapshot({ evaluate: async () => ++reads },
    () => false, 'a missing tab', 0), /Timed out waiting for a missing tab/);
  assert.equal(reads, 1);
  const failure = new Error('Browser IPC disconnected');
  await assert.rejects(waitForBrowserFixtureSnapshot({ evaluate: async () => { throw failure; } },
    () => true, 'a connected browser'), error => error === failure);
});
