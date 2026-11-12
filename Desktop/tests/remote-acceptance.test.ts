import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('verify-remote-access.mjs',
  await readFile(new URL('../scripts/verify-remote-access.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let initializer: ts.Expression | undefined;
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'launch') initializer = node.initializer;
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(initializer, 'Remote acceptance retains an inspectable shared launcher');

function launcher(electron: unknown, executablePath?: string, close: (app: unknown) => Promise<void> = async () => {}) {
  return new Function('electron', 'executablePath', 'sourceEntry', 'env', 'closeDesktopFixture',
    `return ${initializer!.getText(source)};`)(electron, executablePath, 'isolated-entry.cjs', { FIXTURE: 'only' }, close);
}

for (const executablePath of [undefined, 'isolated-packaged-app']) {
  test(`Remote ${executablePath ? 'packaged' : 'source'} launcher waits for the actual renderer navigation before state reads`, async () => {
    let completeNavigation!: () => void;
    const navigation = new Promise<void>(resolve => { completeNavigation = resolve; });
    const events: string[] = [];
    const page = {
      async waitForURL(url: string, options: { timeout: number }) {
        assert.equal(url, '**/renderer/index.html');
        assert.equal(options.timeout, 60000);
        events.push('navigation');
        await navigation;
      },
    };
    const app = { async firstWindow() { events.push('window'); return page; } };
    const launch = launcher({
      async launch(options: unknown) {
        assert.deepEqual(options, {
          ...(executablePath ? { executablePath } : { args: ['isolated-entry.cjs'] }),
          env: { FIXTURE: 'only' }, timeout: 60000,
        });
        return app;
      },
    }, executablePath);
    let returned = false;
    const pending = launch().then((value: unknown) => { returned = true; return value; });
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(returned, false, 'a window that still navigates must not start Remote IPC polling');
      assert.deepEqual(events, ['window', 'navigation']);
    } finally { completeNavigation(); }
    assert.equal(await pending, app);
  });
}

test('Remote launcher preserves navigation failure instead of retrying or reading a stale window', async () => {
  const failure = new Error('Renderer navigation failed');
  const app = { async firstWindow() { return { async waitForURL() { throw failure; } }; } };
  let cleanups = 0;
  const launch = launcher({ async launch() { return app; } }, undefined, async value => {
    assert.equal(value, app);
    cleanups++;
  });
  await assert.rejects(launch(), error => error === failure);
  assert.equal(cleanups, 1, 'failed navigation still closes its isolated application');
});
