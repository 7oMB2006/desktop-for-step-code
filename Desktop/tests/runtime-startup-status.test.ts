import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { startupNeedsAttention, type RuntimeStartup } from '../src/runtime-startup';

const state = (overrides: Partial<RuntimeStartup> = {}): RuntimeStartup => ({
  discovery: 'ready', targetBound: true, modelReady: true, cleanupConfirmed: true, tools: [],
  ...overrides,
} as RuntimeStartup);

test('Plugins only marks failures or unconfirmed cleanup, not ordinary startup', () => {
  assert.equal(startupNeedsAttention(undefined), false);
  assert.equal(startupNeedsAttention(state()), false);
  assert.equal(startupNeedsAttention(state({ discovery: 'discovering', targetBound: false, modelReady: false })), false);
  for (const status of ['pending', 'connecting', 'connected', 'disabled'] as const)
    assert.equal(startupNeedsAttention(state({ tools: [{ name: 'fixture', status, toolCount: 0, startedAt: 0 }] })), false);
  assert.equal(startupNeedsAttention(state({ discovery: 'failed' })), true);
  assert.equal(startupNeedsAttention(state({ cleanupConfirmed: false })), true);
  assert.equal(startupNeedsAttention(state({ tools: [{ name: 'fixture', status: 'failed', toolCount: 0, startedAt: 0 }] })), true);
  assert.equal(startupNeedsAttention(state({ tools: [{
    name: 'fixture', status: 'connected', cleanupConfirmed: false, toolCount: 1, startedAt: 0,
  }] })), true);
});

test('Plugin cards distinguish current-session failures from enabled configuration and ignore old runtimes', () => {
  const source = ts.createSourceFile('PluginCenter.tsx',
    readFileSync(new URL('../src/PluginCenter.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'PluginCenter');
  const status = component?.body?.statements.flatMap(node => ts.isVariableStatement(node)
    ? [...node.declarationList.declarations] : []).find(node => node.name.getText(source) === 'status');
  assert.ok(status?.initializer);
  const compiled = ts.transpileModule(`return (${status.initializer.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const present = (startup?: RuntimeStartup, runtimeId?: string) =>
    new Function('startup', 'runtimeId', 'servers', 'backgroundState', 't', compiled)(
      startup, runtimeId, () => [{ name: 'fixture', enabled: true }], undefined, (_zh: string, en: string) => en,
    )({ id: 'plugin' });
  assert.equal(present(), 'Services enabled');
  const failed = state({ runtimeId: 'current', tools: [{ name: 'fixture', status: 'failed', toolCount: 0, startedAt: 0 }] });
  assert.equal(present(failed, 'current'), 'Unavailable in current session');
  assert.equal(present(failed, 'other'), 'Services enabled');
  assert.equal(present(state({ runtimeId: 'current', tools: [{
    name: 'fixture', status: 'connected', cleanupConfirmed: false, toolCount: 1, startedAt: 0,
  }] }), 'current'), 'Current session cleanup unconfirmed');
});
