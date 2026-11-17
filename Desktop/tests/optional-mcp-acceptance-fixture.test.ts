import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function script(name: string) {
  return ts.createSourceFile(name, await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
const summary = await script('verify-summary-runtime.mjs');
const capabilities = await script('verify-capabilities.mjs');
function variable(source: ts.SourceFile, name: string): ts.VariableDeclaration {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, `Missing actual fixture variable ${name}`);
  return found;
}
const degradedCall = variable(summary, 'degraded').initializer;
assert.ok(degradedCall && ts.isAwaitExpression(degradedCall) && ts.isCallExpression(degradedCall.expression));
assert.equal(degradedCall.expression.expression.getText(summary), 'waitForSessionFixtureSnapshot');
const ready = new Function(`return (${degradedCall.expression.arguments[1].getText(summary)});`)() as (value: unknown) => boolean;
function snapshot() {
  return { status: 'connected', state: { desktopStartup: {
    targetBound: true, modelReady: true, discovery: 'ready', cleanupConfirmed: true,
    tools: [{ name: 'local-search', status: 'failed', cleanupConfirmed: true },
      { name: 'disabled-fixture', status: 'disabled', cleanupConfirmed: true }],
  } } };
}
test('Summary fixture admits only its intended settled optional MCP failure', () => {
  assert.equal(ready(snapshot()), true);
});
for (const [name, mutate] of [
  ['disconnected runtime', (value: ReturnType<typeof snapshot>) => { value.status = 'connecting'; }],
  ['unbound target', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.targetBound = false; }],
  ['unready model', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.modelReady = false; }],
  ['failed discovery', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.discovery = 'failed'; }],
  ['unconfirmed cleanup', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.cleanupConfirmed = false; }],
  ['unclean failed tool', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.tools[0].cleanupConfirmed = false; }],
  ['still connecting tool', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.tools[0].status = 'connecting'; }],
  ['missing failure fixture', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.tools.shift(); }],
  ['another failed tool', (value: ReturnType<typeof snapshot>) => { value.state.desktopStartup.tools[1].status = 'failed'; }],
] as const) {
  test(`Summary fixture rejects ${name}`, () => {
    const value = snapshot();
    mutate(value);
    assert.equal(Boolean(ready(value)), false);
  });
}

const body = capabilities.statements.find(ts.isTryStatement)?.tryBlock.statements;
assert.ok(body);
function assertionBlock(startText: string, endText: string, ...parameters: string[]) {
  const start = body!.findIndex(node => node.getText(capabilities).startsWith(startText));
  const end = body!.findIndex((node, index) => index > start && node.getText(capabilities).startsWith(endText));
  assert.ok(start >= 0 && end > start, 'Exercise actual native removal assertions');
  return new Function(...parameters, `return (async () => {
    ${body!.slice(start, end).map(node => node.getText(capabilities)).join('\n')}
  })();`);
}
const verifyBlocked = assertionBlock('const blockedRemoval =', 'assert.ok((await page.evaluate',
  'page', 'assert', 'openExampleRemoval', 'beforeBlockedRemoval', 'window');
function blockedFixture(overrides: { owners?: number; buttons?: number; runtimeId?: string; sessionId?: string; messages?: readonly unknown[] } = {}) {
  const events: string[] = [];
  const before = { runtimeId: 'resident', state: { sessionId: 'empty' }, messages: [] };
  const after = { runtimeId: overrides.runtimeId ?? before.runtimeId,
    state: { sessionId: overrides.sessionId ?? before.state.sessionId }, messages: overrides.messages ?? [] };
  const dialog = {
    getByText(text: string | RegExp) {
      assert.ok(text === '需要重新检查' || String(text).includes('持久历史'));
      return { async waitFor() { events.push('blocked-reason'); } };
    },
    locator(selector: string) {
      if (selector === '.pc-update-reasons') return dialog;
      assert.equal(selector, '.pc-update-sessions li');
      return { async count() { return overrides.owners ?? 1; } };
    },
    getByRole(role: string, input: { name: string | RegExp }) {
      assert.equal(role, 'button');
      if (input.name === '取消') return { async click() { events.push('cancel'); } };
      assert.ok(String(input.name).includes('释放占用并卸载'));
      return { async count() { return overrides.buttons ?? 0; } };
    },
    async waitFor(input: { state: string }) { assert.equal(input.state, 'hidden'); events.push('hidden'); },
  };
  const window = { desktop: { async snapshot() { events.push('snapshot'); return after; } } };
  const page = { async evaluate(callback: () => unknown) { return callback(); } };
  return { events, run: () => verifyBlocked(page, assert, async () => dialog, before, window) };
}
test('Occupied removal acceptance cancels read-only preflight and verifies unchanged session identity and history', async () => {
  const value = blockedFixture();
  await value.run();
  assert.deepEqual(value.events, ['blocked-reason', 'blocked-reason', 'cancel', 'hidden', 'snapshot']);
});
for (const [name, overrides] of [
  ['missing owner', { owners: 0 }], ['unsafe apply action', { buttons: 1 }],
  ['replaced worker', { runtimeId: 'replacement' }], ['replaced session', { sessionId: 'other' }],
  ['modified history', { messages: [{ role: 'user', content: 'unexpected' }] }],
] as const) {
  test(`Occupied removal acceptance rejects ${name}`, async () => {
    await assert.rejects(blockedFixture(overrides).run(), assert.AssertionError);
  });
}

const verifyRemoved = assertionBlock('assert.equal(removedOperation.phase', "await removal.getByRole('button'",
  'page', 'assert', 'removedOperation', 'beforeRemoval', 'window');
for (const [name, operation, runtimeId] of [
  ['committed unowned removal', { phase: 'done', installation: 'committed', sessions: [] }, 'resident'],
  ['unfinished removal', { phase: 'applying', installation: 'committed', sessions: [] }, 'resident'],
  ['unknown installation', { phase: 'done', installation: 'unknown', sessions: [] }, 'resident'],
  ['unrelated release', { phase: 'done', installation: 'committed', sessions: [{ runtimeId: 'other' }] }, 'resident'],
  ['replaced worker', { phase: 'done', installation: 'committed', sessions: [] }, 'replacement'],
] as const) {
  test(`Unowned removal acceptance checks ${name}`, async () => {
    const before = { runtimeId: 'resident', state: { sessionId: 'empty' }, messages: [] };
    const window = { desktop: { async snapshot() { return { ...before, runtimeId }; } } };
    const page = { async evaluate(callback: () => unknown) { return callback(); } };
    const result = verifyRemoved(page, assert, operation, before, window);
    if (name === 'committed unowned removal') await result;
    else await assert.rejects(result, assert.AssertionError);
  });
}
