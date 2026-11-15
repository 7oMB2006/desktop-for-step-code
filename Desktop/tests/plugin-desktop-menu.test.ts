import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { CapabilityCatalog, CapabilityPlugin, PluginDesktop } from '../src/capabilities';
import { getPluginDesktopEntries, type PluginDesktopEntry } from '../src/plugin-desktop';

const source = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'App');
assert.ok(app?.body);
const effects = app.body.statements.flatMap(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(source) === 'useEffect' ? [node.expression] : []);
const catalogEffects = effects.filter(node => node.getText(source).includes("'desktop_plugin_catalog_changed'"));
assert.equal(catalogEffects.length, 1, 'The production menu catalog effect remains identifiable');
const effect = catalogEffects[0].arguments[0].getText(source);
const program = ts.transpileModule(`return (${effect})();`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const plugin = (id: string, surface: PluginDesktop['surface']): CapabilityPlugin => ({
  id, name: id, mcpServers: [], warnings: [],
  package: { ref: `${id}-ref`, provenance: 'recorded', documentation: {}, tutorials: [], links: [], warnings: [],
    desktop: { title: id, surface, pages: [{ id: 'start', title: 'Start', document: 'start.md' }] } },
});
const catalog = (...plugins: CapabilityPlugin[]): CapabilityCatalog => ({
  plugins, available: [], marketplaces: [], mcp: [], skills: [], warnings: [],
});
function deferred() {
  let resolve!: (value: CapabilityCatalog) => void, reject!: (error: Error) => void;
  const promise = new Promise<CapabilityCatalog>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>(done => setImmediate(done));
type Setter<T> = (value: T | ((current: T) => T)) => void;
function harness({ mini = false, available = true } = {}) {
  const reads: ReturnType<typeof deferred>[] = [];
  const listeners = new Set<(event: { type: string }) => void>();
  const state = { entries: [] as PluginDesktopEntry[], main: 'main' as string | undefined,
    side: 'side' as string | undefined, visited: new Set(['main', 'side', 'removed']) };
  let fullReads = 0;
  const bridge = {
    pluginDesktopCatalog: () => { const response = deferred(); reads.push(response); return response.promise; },
    capabilityCatalog: () => { fullReads++; throw new Error('Full catalog must not run during main mount'); },
    onEvent: (listener: (event: { type: string }) => void) => {
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
  };
  const setter = <K extends keyof typeof state>(key: K): Setter<typeof state[K]> =>
    value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  // Execute the real mount effect, including its request-generation and cleanup guards.
  const cleanup = new Function('bridge', 'isMini', 'getPluginDesktopEntries', 'setPluginEntries',
    'setDesktopMainId', 'setDesktopSideId', 'setDesktopVisited', program)(
    available ? bridge : undefined, mini, getPluginDesktopEntries,
    setter('entries'), setter('main'), setter('side'), setter('visited'),
  ) as (() => void) | undefined;
  return { reads, state, cleanup, listeners, fullReads: () => fullReads,
    emit: (type = 'desktop_plugin_catalog_changed') => listeners.forEach(listener => listener({ type })) };
}

test('main menu mount and catalog-change events use only the desktop catalog', async () => {
  const h = harness();
  assert.equal(h.reads.length, 1);
  assert.equal(h.fullReads(), 0);
  h.reads[0].resolve(catalog(plugin('main', 'main-view'), plugin('side', 'side-panel')));
  await settle();
  assert.deepEqual(h.state.entries.map(entry => entry.id), ['main', 'side']);
  assert.equal(h.state.main, 'main');
  assert.equal(h.state.side, 'side');
  assert.deepEqual([...h.state.visited], ['main', 'side']);
  h.emit('unrelated_event');
  assert.equal(h.reads.length, 1);
  h.emit();
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog(plugin('window', 'window')));
  await settle();
  assert.deepEqual(h.state.entries.map(entry => entry.id), ['window']);
  assert.equal(h.state.main, undefined);
  assert.equal(h.state.side, undefined);
  assert.deepEqual([...h.state.visited], []);
  assert.equal(h.fullReads(), 0);
  h.cleanup?.();
});

test('App never directly requests the full capability catalog', () => {
  const calls: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'capabilityCatalog') calls.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(app!);
  assert.deepEqual(calls, [], 'Full catalog access stays in explicit plugin management surfaces');
});

for (const options of [{ mini: true }, { available: false }]) {
  test(`${options.mini ? 'MiniChat' : 'missing bridge'} does not request a desktop catalog or subscribe`, () => {
    const h = harness(options);
    assert.equal(h.reads.length, 0);
    assert.equal(h.fullReads(), 0);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.cleanup, undefined);
  });
}

for (const oldFailure of [false, true]) {
  test(`an older desktop ${oldFailure ? 'failure' : 'response'} cannot replace a newer catalog`, async () => {
    const h = harness();
    h.emit();
    h.reads[1].resolve(catalog(plugin('new', 'main-view')));
    await settle();
    if (oldFailure) h.reads[0].reject(new Error('Old catalog failed'));
    else h.reads[0].resolve(catalog(plugin('old', 'main-view')));
    await settle();
    assert.deepEqual(h.state.entries.map(entry => entry.id), ['new']);
    h.cleanup?.();
  });
}

test('a current desktop catalog failure clears stale menus and selections', async () => {
  const h = harness();
  h.reads[0].resolve(catalog(plugin('main', 'main-view'), plugin('side', 'side-panel')));
  await settle();
  h.emit();
  h.reads[1].reject(new Error('Desktop catalog failed'));
  await settle();
  assert.deepEqual(h.state.entries, []);
  assert.equal(h.state.main, undefined);
  assert.equal(h.state.side, undefined);
  assert.deepEqual([...h.state.visited], []);
  h.cleanup?.();
});

for (const failure of [false, true]) {
  test(`unmount ignores a pending desktop ${failure ? 'failure' : 'response'} and unsubscribes`, async () => {
    const h = harness();
    const before = structuredClone(h.state);
    h.cleanup?.();
    assert.equal(h.listeners.size, 0);
    if (failure) h.reads[0].reject(new Error('Unmounted catalog failed'));
    else h.reads[0].resolve(catalog(plugin('late', 'main-view')));
    await settle();
    assert.deepEqual(h.state, before);
    h.emit();
    assert.equal(h.reads.length, 1);
  });
}

test('preload forwards the dedicated desktop catalog method without widening its payload', async () => {
  const preload = ts.createSourceFile('preload.ts', readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bridge = preload.statements.flatMap(node => ts.isVariableStatement(node)
    ? [...node.declarationList.declarations] : []).find(node => node.name.getText(preload) === 'bridge');
  assert.ok(bridge?.initializer && ts.isObjectLiteralExpression(bridge.initializer));
  const method = bridge.initializer.properties.find((node): node is ts.PropertyAssignment =>
    ts.isPropertyAssignment(node) && node.name.getText(preload) === 'pluginDesktopCatalog');
  assert.ok(method);
  const calls: unknown[][] = [];
  const projected = catalog(plugin('main', 'main-view'));
  const methodProgram = ts.transpileModule(`return (${method.initializer.getText(preload)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const invoke = new Function('invoke', methodProgram)((...args: unknown[]) => {
    calls.push(args); return Promise.resolve(projected);
  }) as () => Promise<CapabilityCatalog>;
  assert.equal(await invoke(), projected);
  assert.deepEqual(calls, [['pluginDesktopCatalog']]);
});
