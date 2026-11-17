import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { PluginUpdateOperation } from '../src/plugin-update';

const source = readFileSync(new URL('../src/PluginCenter.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PluginCenter.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer = '', applyInitializer = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'requestRemoval')
    initializer = node.initializer!.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'applyRemoval')
    applyInitializer = node.initializer!.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(initializer, 'Exercise the actual renderer request handler');
const javascript = ts.transpileModule(`const requestRemoval = ${initializer};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function fixture(previous: PluginUpdateOperation | null) {
  const state = { pending: false, open: false, preflights: 0, reads: 0, panel: undefined as any, error: '' };
  const operation = { current: false };
  const bridge = {
    async pluginRemovalOperation() { state.reads++; return previous; },
    async pluginRemovalPreflight(input: { id: string; ref: string }) {
      state.preflights++;
      assert.deepEqual(input, { id: 'example', ref: 'installed-ref' });
      return { token: 'new-consent', readiness: 'needs-release' };
    },
  };
  const create = new Function('operation', 'bridge', 'state', `
    const updateOperation = { current: false }, bvrState = { pending: false }, alive = { current: true };
    const nativeRemovals = true, removalPanel = undefined, language = 'en';
    const setPending = value => state.pending = value;
    const setError = value => state.error = value;
    const setRemovalOpen = value => state.open = value;
    const setRemovalPanel = value => state.panel = value;
    const capabilityErrorText = error => String(error);
    ${javascript}
    return requestRemoval;
  `);
  return { state, request: create(operation, bridge, state) as (input: unknown) => Promise<void> };
}
const plugin = { id: 'example', name: 'Example', package: { ref: 'installed-ref' } };

test('renderer reopens a persisted uncertain removal without issuing another preflight', async () => {
  const previous: PluginUpdateOperation = { id: 'old-consent', pluginId: 'example', version: '1.0.0',
    installation: 'unknown', phase: 'attention', sessions: [], warnings: [] };
  const f = fixture(previous);
  await f.request(plugin);
  assert.equal(f.state.preflights, 0);
  assert.equal(f.state.panel.operation, previous);
  assert.equal(f.state.open, true);
  assert.equal(f.state.pending, false);
});

test('a known completed removal does not grant consent for a new installation', async () => {
  const f = fixture({ id: 'old-consent', pluginId: 'example', version: '1.0.0',
    installation: 'committed', phase: 'done', sessions: [], warnings: [] });
  await f.request(plugin);
  assert.equal(f.state.preflights, 1);
  assert.equal(f.state.panel.preflight.token, 'new-consent');
  assert.equal(f.state.panel.operation, undefined);
  assert.equal(f.state.open, true);
});

test('concurrent renderer requests cannot create duplicate removal confirmations', async () => {
  const f = fixture(null);
  await Promise.all([f.request(plugin), f.request(plugin)]);
  assert.equal(f.state.reads, 1);
  assert.equal(f.state.preflights, 1);
  assert.equal(f.state.pending, false);
});

for (const [error, unknown] of [['capability:stale', false], ['capability:operation-denied', false],
  ['IPC channel closed', true]] as const) {
  test(`renderer distinguishes a refused apply from a lost reply: ${error}`, async () => {
    const state = { panel: undefined as any, pending: false };
    const javascript = ts.transpileModule(`const applyRemoval = ${applyInitializer};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const execute = new Function('state', 'failure', `
      const removalPanel = { intent: 'remove', pluginId: 'example', name: 'Example',
        preflight: { token: 'consent', version: '1.0.0', readiness: 'needs-release', sessions: [] } };
      const operation = { current: false }, updateOperation = { current: false }, alive = { current: true };
      const language = 'en';
      const bridge = {
        pluginRemovalApply: async () => { throw new Error(failure); },
        pluginRemovalOperation: async () => null,
        capabilityCatalog: async () => ({})
      };
      const setPending = value => state.pending = value;
      const setRemovalPanel = value => state.panel = value;
      const setRemovalOpen = () => {}, setWarnings = () => {}, setSelected = () => {};
      const acceptCatalog = () => {}, onChanged = async () => {}, setError = () => {};
      const capabilityErrorText = error => String(error);
      ${javascript}
      return applyRemoval();
    `);
    await execute(state, error);
    assert.equal(state.panel.operation?.installation, unknown ? 'unknown' : undefined);
    assert.equal(state.panel.preflight, undefined, 'The consumed consent is never reused');
    assert.equal(state.pending, false);
  });
}
