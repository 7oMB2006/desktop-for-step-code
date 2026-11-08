import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { McpServer } from '../src/contracts';

const source = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'App');
assert.ok(app?.body);
const declarations = app.body.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
function jsxCallback(tag: string, attribute: string, matches: (node: ts.JsxOpeningLikeElement) => boolean = () => true) {
  const found: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === tag && matches(node)) {
      const prop = node.attributes.properties.find((item): item is ts.JsxAttribute =>
        ts.isJsxAttribute(item) && item.name.getText(source) === attribute);
      if (prop?.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression)
        found.push(prop.initializer.expression.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(app!);
  assert.equal(found.length, 1, `Expected one ${tag}.${attribute}`);
  return found[0];
}
function attributeText(node: ts.JsxOpeningLikeElement, name: string) {
  return node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === name)?.getText(source);
}

type Edit = { name: string; original?: string; config: McpServer; args: string; secrets: string };
type Settings = { mcp: Record<string, McpServer>; account: {}; profiles: [] };
const settings = (): Settings => ({ mcp: { 'plugin-a__server': { command: 'node', args: ['a.mjs'], enabled: true },
  'server-b': { command: 'node', args: ['b.mjs'], enabled: true } }, account: {}, profiles: [] });
function deferred() {
  let resolve!: (value: Settings) => void, reject!: (error: Error) => void;
  const promise = new Promise<Settings>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>(done => setImmediate(done));

function harness(reducedMotion = false) {
  const reads: ReturnType<typeof deferred>[] = [];
  const state = { edit: null as Edit | null, error: '', open: false, closing: false, tab: '' };
  // Execute the production closures and JSX callbacks, not copies of the request guards.
  const runtime = declarations.filter(node => ts.isIdentifier(node.name) && (
    ['run', 'closeMcpEdit', 'finishSettingsClose', 'closeSettings', 'openSettings'].includes(node.name.text)
    || ts.isCallExpression(node.initializer!) && node.initializer.expression.getText(source) === 'useRef'
      && node.initializer.arguments[0]?.getText(source) === '0'
  )).map(node => `const ${node.getText(source)};`).join('\n');
  const program = ts.transpileModule(`
    const useRef = current => ({ current });
    const useCallback = callback => callback;
    const window = { matchMedia: () => ({ matches: reducedMotion }) };
    const isMini = false;
    let mcpEdit = null;
    const setMcpEdit = value => { mcpEdit = value; state.edit = value; };
    const setError = value => { state.error = value; };
    const setSettingsOpen = value => { state.open = value; };
    const setSettingsClosing = value => { state.closing = value; };
    const setTab = value => { state.tab = value; };
    const setSettings = () => {};
    const setLoginProfile = () => {};
    const setKey = () => {};
    const setCapabilityRevision = () => {};
    const setCapabilityTarget = () => {};
    const openPlugins = () => finishSettingsClose();
    const t = (_zh, en) => en;
    const latestData = { current: { preferences: { language: 'en' } } };
    const composerErrorText = error => String(error);
    ${runtime}
    return {
      manage: ${jsxCallback('PluginCenter', 'onManageMcp')},
      edit: ${jsxCallback('CapabilitySettings', 'onEditMcp')},
      typeArgs: ${jsxCallback('textarea', 'onChange', node => attributeText(node, 'value') === 'value={mcpEdit.args}')},
      closeEditor: ${jsxCallback('IconButton', 'onClick', node => {
        let parent: ts.Node | undefined = node.parent;
        while (parent) {
          if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === 'section'
            && attributeText(parent.openingElement, 'aria-label') === 'aria-label="MCP"') return true;
          parent = parent.parent;
        }
        return false;
      })},
      category: id => (${jsxCallback('button', 'onClick', node => attributeText(node, 'aria-current') === "aria-current={tab === id ? 'page' : undefined}")})(),
      openSettings, closeSettings, finishSettingsClose,
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handlers = new Function('bridge', 'state', 'settings', 'reducedMotion', program)(
    { settings: () => { const response = deferred(); reads.push(response); return response.promise; } },
    state, settings(), reducedMotion,
  ) as {
    manage(name?: string): void; edit(name?: string): void; typeArgs(event: { target: { value: string } }): void;
    closeEditor(): void; category(id: string): void; openSettings(): Promise<void>; closeSettings(): void; finishSettingsClose(): void;
  };
  return { ...handlers, state, reads };
}
async function startNamedRead(h: ReturnType<typeof harness>, name = 'plugin-a__server') {
  const first = h.reads.length;
  h.manage(name);
  assert.equal(h.reads.length, first + 1);
  h.reads[first].resolve(settings());
  await settle();
  assert.equal(h.reads.length, first + 2, 'The named MCP configuration read started');
  return h.reads[first + 1];
}

test('the current MCP response still opens the requested configuration and reports current failures', async () => {
  const h = harness();
  const response = await startNamedRead(h);
  response.resolve(settings()); await settle();
  assert.deepEqual(h.state.edit, { name: 'plugin-a__server', original: 'plugin-a__server',
    config: settings().mcp['plugin-a__server'], args: '["a.mjs"]', secrets: '{}' });
  h.closeEditor();
  const failure = await startNamedRead(h);
  failure.reject(new Error('fixture')); await settle();
  assert.equal(h.state.error, 'Could not read MCP configuration');
});

for (const target of ['server-b', undefined]) {
  test(`a late named MCP read preserves the ${target ?? 'new server'} editor and its draft`, async () => {
    const h = harness();
    const response = await startNamedRead(h);
    h.edit(target); h.typeArgs({ target: { value: '["UNSAVED-DRAFT"]' } });
    const draft = structuredClone(h.state.edit);
    response.resolve(settings()); await settle();
    assert.deepEqual(h.state.edit, draft);
  });
}
test('changing editor target before settings opens prevents the obsolete follow-up read', async () => {
  const h = harness();
  h.manage('plugin-a__server');
  h.edit('server-b'); h.typeArgs({ target: { value: '["UNSAVED-DRAFT"]' } });
  const draft = structuredClone(h.state.edit);
  h.reads[0].resolve(settings()); await settle();
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.state.edit, draft);
});
test('a superseded named MCP response cannot replace the latest named target', async () => {
  const h = harness();
  const old = await startNamedRead(h);
  const latest = await startNamedRead(h, 'server-b');
  latest.resolve(settings()); await settle();
  h.typeArgs({ target: { value: '["LATEST-DRAFT"]' } });
  const draft = structuredClone(h.state.edit);
  old.resolve(settings()); await settle();
  assert.deepEqual(h.state.edit, draft);
});
test('a stale MCP failure does not overwrite feedback for a newer editing target', async () => {
  const h = harness();
  const response = await startNamedRead(h);
  h.edit('server-b'); h.state.error = 'newer feedback';
  response.reject(new Error('old request')); await settle();
  assert.equal(h.state.error, 'newer feedback');
  assert.equal(h.state.edit?.name, 'server-b');
});

for (const reduced of [false, true]) {
  for (const phase of ['opening', 'reading'] as const) {
    test(`closing settings invalidates MCP ${phase} immediately (${reduced ? 'reduced motion' : 'animated exit'})`, async () => {
      const h = harness(reduced);
      h.manage('plugin-a__server');
      if (phase === 'reading') { h.reads[0].resolve(settings()); await settle(); }
      h.closeSettings();
      assert.equal(h.state.open, !reduced);
      assert.equal(h.state.closing, !reduced);
      h.reads.at(-1)!.resolve(settings()); await settle();
      assert.equal(h.reads.length, phase === 'opening' ? 1 : 2, 'No obsolete follow-up is sent after dismissal');
      assert.equal(h.state.edit, null, 'A response during the exit animation must not reopen an editor');
    });
  }
  test(`closing settings also ignores a late MCP failure (${reduced ? 'reduced motion' : 'animated exit'})`, async () => {
    const h = harness(reduced);
    const response = await startNamedRead(h);
    h.closeSettings(); h.state.error = 'newer feedback';
    response.reject(new Error('old request')); await settle();
    assert.equal(h.state.error, 'newer feedback');
  });
}
for (const action of ['finishSettingsClose', 'closeEditor', 'category', 'openSettings'] as const) {
  test(`${action} invalidates a pending named MCP editor request`, async () => {
    const h = harness();
    const response = await startNamedRead(h);
    if (action === 'category') h.category('general');
    else void h[action]();
    response.resolve(settings()); await settle();
    assert.equal(h.state.edit, null);
    if (action === 'openSettings') { h.reads.at(-1)!.resolve(settings()); await settle(); }
  });
}
