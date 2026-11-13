import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('verify-capabilities.mjs',
  await readFile(new URL('../scripts/verify-capabilities.mjs', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const body = source.statements.find(ts.isTryStatement)?.tryBlock.statements;
assert.ok(body);
const start = body.findIndex(statement => statement.getText(source).startsWith('await page.waitForFunction')
  && statement.getText(source).includes('Example plugin'));
const end = body.findIndex(statement => statement.getText(source).startsWith('assert.match(await examplePanel'));
assert.ok(start >= 0 && end > start, 'Exercise the actual native update completion assertions');
const verify = new Function('page', 'assert', 'examplePanel', 'runtimeBeforeUpdate', 'window', 'document',
  `return (async () => { ${body.slice(start, end).map(statement => statement.getText(source)).join('\n')} })();`);

function fixture(overrides: Record<string, unknown> = {}, runtimeId = 'resident', restartButtons = 0) {
  let ready = false, finish!: () => void;
  const settled = new Promise<void>(resolve => { finish = () => { ready = true; resolve(); }; });
  const events: string[] = [];
  const operation = { version: '1.1.0', phase: 'done', installation: 'committed', sessions: [], ...overrides };
  const document = { querySelectorAll(selector: string) {
    assert.equal(selector, '.pc-plugin-row');
    const row = (name: string, version: string) => ({
      textContent: name,
      querySelector(selector: string) { assert.equal(selector, '.pc-card-version'); return { textContent: version }; },
    });
    return [row('Unrelated plugin', 'v1.1.0'), row('Example plugin', ready ? 'v1.1.0' : 'v1.0.0')];
  } };
  const window = { desktop: {
    async pluginUpdateOperation(input: { pluginId: string }) {
      assert.deepEqual(input, { pluginId: 'example' });
      events.push('operation');
      return operation;
    },
    async snapshot() { return { runtimeId }; },
  } };
  const page = {
    async waitForFunction(predicate: () => boolean) {
      events.push('wait-version');
      assert.equal(predicate(), false, 'Another plugin at the new version cannot finish the wait');
      await settled;
      assert.equal(predicate(), true);
    },
    async evaluate(callback: () => unknown) { return callback(); },
  };
  const examplePanel = { getByRole(role: string, input: { name: string; exact: boolean }) {
    assert.equal(role, 'button');
    assert.match(input.name, /Example plugin/);
    assert.equal(input.exact, true);
    return { async count() { return restartButtons; } };
  } };
  return { events, finish, run: () => verify(page, assert, examplePanel, 'resident', window, document) };
}

test('native capability acceptance waits for the target version, then verifies the committed operation without restarting an unloaded plugin', async () => {
  const value = fixture();
  const pending = value.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(value.events, ['wait-version']);
  value.finish();
  await pending;
  assert.deepEqual(value.events, ['wait-version', 'operation']);
});

for (const [name, overrides, runtime, buttons] of [
  ['wrong version', { version: '1.0.0' }, 'resident', 0],
  ['unfinished operation', { phase: 'restoring' }, 'resident', 0],
  ['uncommitted installation', { installation: 'unchanged' }, 'resident', 0],
  ['unexpected affected session', { sessions: [{ runtimeId: 'resident' }] }, 'resident', 0],
  ['replaced resident', {}, 'replacement', 0],
  ['obsolete restart action', {}, 'resident', 1],
] as const) {
  test(`native capability acceptance rejects ${name} even when the target version is visible`, async () => {
    const value = fixture(overrides, runtime, buttons);
    const pending = value.run();
    value.finish();
    await assert.rejects(pending, assert.AssertionError);
  });
}
