import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('verify-remote-access.mjs',
  await readFile(new URL('../scripts/verify-remote-access.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let initializer: ts.Expression | undefined;
let confirmationInitializer: ts.Expression | undefined;
const confirmationActions: string[] = [];
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'launch') initializer = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'confirmRemoteAction')
    confirmationInitializer = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'confirmRemoteAction'
    && ts.isStringLiteral(node.arguments[0])) confirmationActions.push(node.arguments[0].text);
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

test('Remote unbind and disconnect confirm only after the actual disclosure settles', async () => {
  assert.ok(confirmationInitializer);
  assert.deepEqual(confirmationActions, ['解除绑定', '断开连接']);
  for (const action of confirmationActions) {
    const events: string[] = [];
    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    const confirmation = {
      async waitFor() { events.push('visible'); },
      async click() { events.push('confirm'); },
    };
    const button = (name: string) => name === '确认' ? confirmation : {
      async click() { assert.equal(name, action); events.push('open'); },
    };
    const confirm = new Function('button', 'settleLayout',
      `return ${confirmationInitializer.getText(source)};`)(button, async (target: unknown) => {
      assert.equal(target, confirmation);
      events.push('settle');
      await settled;
    });
    const pending = confirm(action);
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(events, ['open', 'visible', 'settle']);
    } finally { finish(); }
    await pending;
    assert.deepEqual(events, ['open', 'visible', 'settle', 'confirm']);
  }
});

test('Remote confirmation never retries or clicks through a disclosure readiness failure', async () => {
  assert.ok(confirmationInitializer);
  const failure = new Error('Confirmation did not settle');
  const events: string[] = [];
  const button = (name: string) => ({
    async click() { events.push(name); },
    async waitFor() { events.push('visible'); },
  });
  const confirm = new Function('button', 'settleLayout',
    `return ${confirmationInitializer.getText(source)};`)(button, async () => { throw failure; });
  await assert.rejects(confirm('解除绑定'), error => error === failure);
  assert.deepEqual(events, ['解除绑定', 'visible']);
});
