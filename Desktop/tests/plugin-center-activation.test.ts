import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { CapabilityCatalog } from '../src/capabilities';
import type { McpServer } from '../src/contracts';

const source = ts.createSourceFile('PluginCenter.tsx',
  readFileSync(new URL('../src/PluginCenter.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'PluginCenter');
assert.ok(component?.body);
const effects = component.body.statements.flatMap(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(source) === 'useEffect' ? [node.expression] : []);
const lifetime = effects.find(node => node.arguments[0].getText(source).includes('alive.current = true'));
const activation = effects.find(node => node.arguments[0].getText(source).includes('activationRefresh.current'));
const settingsObservation = effects.find(node => node.arguments[0].getText(source).includes('observedMcp.current'));
assert.ok(lifetime && activation && settingsObservation, 'The production lifecycle and activation effects remain identifiable');
const activationEffects: ts.CallExpression[] = [lifetime, settingsObservation, activation];
const mcpKey = component.body.statements.flatMap(node => ts.isVariableStatement(node)
  ? [...node.declarationList.declarations] : []).find(node => node.name.getText(source) === 'mcpKey');
assert.ok(mcpKey?.initializer);
const mcpKeyExpression = mcpKey.initializer.getText(source);
const refresh = component.body.statements.flatMap(node => ts.isVariableStatement(node)
  ? [...node.declarationList.declarations] : []).find(node => node.name.getText(source) === 'refresh');
assert.ok(refresh?.initializer);
const refreshExpression = refresh.initializer.getText(source);
let initialContent: ts.Expression | undefined;
const visit = (node: ts.Node) => {
  if (ts.isConditionalExpression(node) && node.condition.getText(source) === '!catalog'
    && node.whenTrue.getText(source).includes('pc-list-empty')) initialContent = node.whenTrue;
  ts.forEachChild(node, visit);
};
visit(component);
assert.ok(initialContent, 'The existing loading/retry branch remains identifiable');
const compile = (expression: string) => ts.transpileModule(`return (${expression});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

function deferred() {
  let resolve!: (value: CapabilityCatalog) => void, reject!: (error: Error) => void;
  const promise = new Promise<CapabilityCatalog>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>(done => setImmediate(done));
const catalog = (id: string): CapabilityCatalog => ({ plugins: [{ id, name: id, mcpServers: [], warnings: [] }],
  available: [], marketplaces: [], mcp: [], skills: [], warnings: [] });
type Element = { tag: string; props: Record<string, unknown>; children: Array<string | Element> };
type Cleanup = (() => void) | undefined;

function harness(active = false, hydrated = true) {
  const reads: ReturnType<typeof deferred>[] = [];
  let inFlight = 0, peak = 0;
  const bridge = { capabilityCatalog: () => {
    const response = deferred();
    reads.push(response);
    peak = Math.max(peak, ++inFlight);
    return response.promise.finally(() => { inFlight--; });
  } };
  const props: { active: boolean; bridge: typeof bridge; settings?: { mcp: Record<string, McpServer> } } = {
    active, bridge, settings: hydrated ? { mcp: {} } : undefined,
  };
  const alive = { current: true }, operation = { current: false };
  const activationRefresh = { current: undefined as Promise<void> | undefined };
  const observedMcp = { current: undefined as { active: boolean; bridge: typeof bridge; key?: string } | undefined };
  const repositoryQueries = { current: new Map() };
  const state = { loading: false, error: 'previous error', catalog: undefined as CapabilityCatalog | undefined,
    accepted: [] as CapabilityCatalog[], repositoryRevision: 0, mcpRevision: 0 };
  const records: Array<{ dependencies: unknown[]; cleanup: Cleanup }> = [];
  let refreshNow!: (repositories?: boolean) => Promise<void>;
  const render = (next: Partial<typeof props> = {}) => {
    Object.assign(props, next);
    const revision = state.mcpRevision;
    const settingsKey = new Function('settings', compile(mcpKeyExpression))(props.settings);
    // Run the real refresh helper, not a mock of its operation/loading guards.
    refreshNow = new Function('operation', 'setLoading', 'setError', 'bridge', 'alive', 'acceptCatalog',
      'repositoryQueries', 'setRepositoryRevision', 'capabilityErrorText', 'language',
      compile(refreshExpression))(
      operation, (value: boolean) => { state.loading = value; }, (value: string) => { state.error = value; },
      props.bridge, alive, (value: CapabilityCatalog) => { state.catalog = value; state.accepted.push(value); },
      repositoryQueries, (update: (value: number) => number) => { state.repositoryRevision = update(state.repositoryRevision); },
      (error: Error) => error.message, 'en',
    );
    const pending = activationEffects.flatMap((effect, index) => {
      const dependencies = new Function('bridge', 'active', 'mcpKey', 'mcpRevision', compile(effect.arguments[1].getText(source)))(
        props.bridge, props.active, settingsKey, state.mcpRevision,
      ) as unknown[];
      if (records[index]?.dependencies.every((value, position) => Object.is(value, dependencies[position]))) return [];
      const callback = new Function('alive', 'activationRefresh', 'active', 'bridge', 'refresh', 'mcpKey', 'observedMcp', 'setMcpRevision',
        compile(effect.arguments[0].getText(source)))(alive, activationRefresh, props.active, props.bridge,
        refreshNow, settingsKey, observedMcp, (update: (value: number) => number) => { state.mcpRevision = update(state.mcpRevision); }) as () => Cleanup;
      return [{ index, dependencies, callback }];
    });
    for (const { index } of pending) records[index]?.cleanup?.();
    for (const { index, dependencies, callback } of pending)
      records[index] = { dependencies, cleanup: callback() };
    if (state.mcpRevision !== revision) render();
  };
  render();
  return {
    state, reads, render, operation, repositoryQueries, peak: () => peak,
    refresh: (repositories = false) => refreshNow(repositories),
    initial() {
      const React = { createElement: (tag: string, attributes: Record<string, unknown>, ...children: Array<string | Element>) =>
        ({ tag, props: attributes, children }) };
      return new Function('React', 'loading', 't', 'refresh', compile(initialContent!.getText(source)))(
        React, state.loading, (_cn: string, en: string) => en, refreshNow,
      ) as Element;
    },
    unmount() { for (const record of records) record.cleanup?.(); },
  };
}

test('a hidden PluginCenter mount and hidden settings changes never request the full catalog', () => {
  const h = harness();
  assert.equal(h.reads.length, 0);
  assert.equal(h.state.loading, false);
  h.render({ settings: { mcp: { changed: {} } } });
  assert.equal(h.reads.length, 0);
  h.unmount();
});

test('an active first mount starts exactly one catalog read and retains the existing loading state', async () => {
  const h = harness(true);
  assert.equal(h.reads.length, 1);
  assert.equal(h.state.loading, true);
  assert.equal(h.state.error, '');
  assert.deepEqual(h.initial().children, ['Loading']);
  h.reads[0].resolve(catalog('initial'));
  await settle();
  assert.equal(h.state.loading, false);
  assert.equal(h.state.catalog?.plugins[0].id, 'initial');
  h.render();
  assert.equal(h.reads.length, 1, 'A successful catalog render must not start a second initial read');
  h.unmount();
});

test('first activation initializes a previously hidden view and active settings changes refresh once', async () => {
  const h = harness();
  h.render({ active: true });
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve(catalog('initial'));
  await settle();
  const settings = { mcp: { changed: {} } };
  h.render({ settings });
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog('settings'));
  await settle();
  assert.equal(h.state.catalog?.plugins[0].id, 'settings');
  h.render({ settings });
  assert.equal(h.reads.length, 2);
  h.unmount();
});

for (const pending of [false, true]) {
  test(`initial settings hydration adds no catalog read ${pending ? 'during' : 'after'} activation`, async () => {
    const h = harness(true, false);
    assert.equal(h.reads.length, 1);
    if (!pending) { h.reads[0].resolve(catalog('initial')); await settle(); }
    h.render({ settings: { mcp: { tools: { command: 'node', args: ['server.mjs'], enabled: false } } } });
    if (pending) { h.reads[0].resolve(catalog('initial')); await settle(); }
    assert.equal(h.reads.length, 1, 'Hydrating settings must not queue another full catalog ahead of the form');
    h.render({ settings: { mcp: { tools: { command: 'node', args: ['server.mjs'], enabled: true } } } });
    assert.equal(h.reads.length, 2, 'A later real MCP edit still refreshes');
    h.reads[1].resolve(catalog('changed')); await settle();
    h.unmount();
  });
}

test('equivalent fresh settings objects and map ordering never repeat a catalog read', async () => {
  const h = harness();
  h.render({ settings: { mcp: {
    second: { command: 'node', args: ['two.mjs'], configuredSecrets: ['B', 'A'] },
    first: { url: 'https://example.invalid/mcp', enabled: true },
  } } });
  h.render({ active: true });
  h.reads[0].resolve(catalog('initial')); await settle();
  h.render({ settings: { mcp: {
    first: { enabled: true, url: 'https://example.invalid/mcp' },
    second: { configuredSecrets: ['A', 'B'], args: ['two.mjs'], command: 'node', enabled: true },
  } } });
  await settle();
  assert.equal(h.reads.length, 1, 'Object identity, key order, and enabled=true defaults do not invalidate the catalog');
  h.render({ settings: { mcp: {
    first: { enabled: false, url: 'https://example.invalid/mcp' },
    second: { configuredSecrets: ['A', 'B'], args: ['two.mjs'], command: 'node' },
  } } });
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog('changed')); await settle();
  h.unmount();
});

test('ordered launch arguments remain a meaningful MCP setting change', async () => {
  const h = harness();
  h.render({ settings: { mcp: { tools: { command: 'node', args: ['first', 'second'] } } } });
  h.render({ active: true });
  h.reads[0].resolve(catalog('initial')); await settle();
  h.render({ settings: { mcp: { tools: { command: 'node', args: ['second', 'first'] } } } });
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog('changed')); await settle();
  h.unmount();
});

test('deactivation does not refresh, hidden settings stay idle, and reopening refreshes once', async () => {
  const h = harness(true);
  h.reads[0].resolve(catalog('initial'));
  await settle();
  h.render({ active: false });
  h.render({ settings: { mcp: { changed: {} } } });
  assert.equal(h.reads.length, 1);
  h.render({ active: true });
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog('reopened'));
  await settle();
  assert.equal(h.state.catalog?.plugins[0].id, 'reopened');
  h.unmount();
});

test('reopening and a real MCP change in the same render share one activation read', async () => {
  const h = harness(true);
  h.reads[0].resolve(catalog('initial')); await settle();
  h.render({ active: false });
  h.render({ active: true, settings: { mcp: { tools: { command: 'node', args: ['changed.mjs'] } } } });
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog('reopened')); await settle();
  assert.equal(h.reads.length, 2, 'The reopening catalog already reads current main-process MCP settings');
  h.unmount();
});

test('a bridge replacement and MCP change in the same render share one activation read', async () => {
  const h = harness(true);
  h.reads[0].resolve(catalog('initial')); await settle();
  let reads = 0;
  const response = deferred();
  h.render({ bridge: { capabilityCatalog: () => { reads++; return response.promise; } },
    settings: { mcp: { tools: { command: 'node', args: ['changed.mjs'] } } } });
  assert.equal(reads, 1);
  response.resolve(catalog('replacement')); await settle();
  assert.equal(reads, 1);
  h.unmount();
});

test('settings changes during a pending activation serialize one latest refresh instead of dropping it', async () => {
  const h = harness(true);
  h.render({ settings: { mcp: { intermediate: {} } } });
  h.render({ settings: { mcp: { latest: {} } } });
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve(catalog('initial'));
  await settle();
  assert.equal(h.reads.length, 2, 'Only the latest still-active settings change should read again');
  assert.equal(h.peak(), 1);
  h.reads[1].resolve(catalog('latest'));
  await settle();
  assert.equal(h.state.catalog?.plugins[0].id, 'latest');
  assert.equal(h.state.loading, false);
  h.unmount();
});

test('closing cancels queued refreshes and reopening while a read drains still initializes the view', async () => {
  const h = harness(true);
  h.render({ settings: { mcp: { changed: {} } } });
  h.render({ active: false });
  h.reads[0].resolve(catalog('initial'));
  await settle();
  assert.equal(h.reads.length, 1, 'A cancelled queued activation must not read while hidden');
  h.render({ active: true });
  assert.equal(h.reads.length, 2);
  h.render({ active: false });
  h.render({ active: true });
  assert.equal(h.reads.length, 2);
  h.reads[1].resolve(catalog('draining'));
  await settle();
  assert.equal(h.reads.length, 3, 'Reopening must not lose refresh to the previous operation lock');
  h.reads[2].resolve(catalog('reopened'));
  await settle();
  assert.equal(h.state.catalog?.plugins[0].id, 'reopened');
  assert.equal(h.peak(), 1);
  h.unmount();
});

for (const failure of [false, true]) {
test(`unmount ignores a pending ${failure ? 'failure' : 'response'} and cancels queued activation reads`, async () => {
  const h = harness(true);
  h.render({ settings: { mcp: { changed: {} } } });
  h.unmount();
  const previous = structuredClone(h.state);
  if (failure) h.reads[0].reject(new Error('Late failure'));
  else h.reads[0].resolve(catalog('late'));
  await settle();
  assert.deepEqual(h.state, previous);
  assert.equal(h.reads.length, 1);
});
}

test('a failed initial read preserves the existing Retry control and its loading transition', async () => {
  const h = harness(true);
  h.reads[0].reject(new Error('Catalog failed'));
  await settle();
  assert.equal(h.state.error, 'Catalog failed');
  assert.equal(h.state.loading, false);
  const retry = h.initial().children[0] as Element;
  assert.equal(retry.tag, 'button');
  assert.deepEqual(retry.children, ['Retry']);
  (retry.props.onClick as () => void)();
  assert.equal(h.reads.length, 2);
  assert.equal(h.state.loading, true);
  h.reads[1].resolve(catalog('retried'));
  await settle();
  assert.equal(h.state.error, '');
  assert.equal(h.state.catalog?.plugins[0].id, 'retried');
  h.unmount();
});
