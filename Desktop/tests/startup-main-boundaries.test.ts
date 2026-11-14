import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const main = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const renderer = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(file: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(result);
  return result;
}
const javascript = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const method of ['cloneSession', 'branchSession']) {
  test(`actual main ${method} reads copied messages before copying Workflow bindings, then hydrates them`, async () => {
    const clause = find(main, node => ts.isCaseClause(node)
      && node.expression.getText(main) === `'${method}'`) as ts.CaseClause;
    const calls: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression)
        && ts.isCallExpression(node.expression.expression)
        && ['modelSelections.copyHistory', 'workflowBindings.copyHistory', 'runtimes.read']
          .includes(node.expression.expression.expression.getText(main))) calls.push(node.getText(main));
      ts.forEachChild(node, visit);
    };
    visit(clause);
    const start = calls.findIndex(call => call.includes('modelSelections.copyHistory'));
    assert.ok(start >= 0);
    const statements = calls.slice(start);
    const worker = { state: { sessionId: 'copy' }, messages: [] as object[] };
    const history = [{ role: 'assistant', content: [{ type: 'toolCall', id: 'interrupted', name: 'workflow' }] }];
    const order: string[] = [];
    let copied = false;
    const run = new Function('worker', 'source', 'sessionId', 'modelSelections', 'workflowBindings', 'runtimes',
      javascript(`return (async () => { ${statements.join('\n')} })();`));
    await run(worker, { state: { sessionId: 'original' } }, 'original',
      { copyHistory: async () => { order.push('model'); } },
      { copyHistory: async (from: string, to: string, messages: object[]) => {
        assert.equal(from, 'original'); assert.equal(to, 'copy');
        assert.deepEqual(messages, history, 'an empty startup snapshot cannot filter out Workflow bindings');
        copied = true; order.push('bindings');
      } },
      { read: async (owner: typeof worker) => {
        assert.equal(owner, worker);
        order.push(copied ? 'hydrate' : 'history');
        worker.messages = history;
      } });
    assert.deepEqual(order, ['model', 'history', 'bindings', 'hydrate']);
  });
}

function submitCallback(constructor: 'RemoteManager' | 'ExternalConnectorTasks') {
  const expression = find(main, node => ts.isNewExpression(node)
    && node.expression.getText(main) === constructor) as ts.NewExpression;
  const property = (expression.arguments![0] as ts.ObjectLiteralExpression).properties.find(node =>
    ts.isPropertyAssignment(node) && node.name.getText(main) === 'submit') as ts.PropertyAssignment;
  assert.ok(property);
  return property.initializer.getText(main);
}
function submissionFixture(kind: 'remote' | 'external') {
  const worker = { id: 'runtime-a', rpc: {}, state: { sessionId: 'session-a' }, status: 'connected',
    permissionPreset: 'ask', pendingUI: new Map<string, unknown>(), failed: false };
  const sessionNavigation = { busy: false };
  const state = {
    ready: undefined as (() => Promise<void>) | undefined, readiness: 0, valid: true, externalOwned: false,
    enqueued: [] as { worker: object; message: string; payload: object }[],
    accepted: [] as string[], resumed: [] as object[], drained: [] as object[],
  };
  const runtimes = {
    workers: new Map<string, object>([[worker.id, worker]]),
    async assertExecutionReady(candidate: object) {
      assert.equal(candidate, worker);
      state.readiness++;
      await state.ready?.();
    },
  };
  const pendingMessages = {
    enqueue(candidate: object, message: string, payload: object) {
      state.enqueued.push({ worker: candidate, message, payload });
      return 'queue-1';
    },
    resumed(candidate: object) { state.resumed.push(candidate); },
    async drain(candidate: object) { state.drained.push(candidate); },
  };
  const create = new Function('runtimes', 'pendingMessages', 'sessionNavigation', 'externalTasks', javascript(`
    const transition = false, settingsMutation = false, undoBusy = false, quitting = false;
    const quitPending = false, updateInstalling = false, providerSettingsPending = false;
    return ${submitCallback(kind === 'remote' ? 'RemoteManager' : 'ExternalConnectorTasks')};
  `));
  const submit = create(runtimes, pendingMessages, sessionNavigation,
    { retains: () => state.externalOwned }) as (
      worker: object, message: string, accepted: (id: string) => void, extra: unknown,
    ) => Promise<void>;
  return { worker, state, runtimes, sessionNavigation,
    submit: (images?: unknown[]) => submit(worker, 'fixture message', id => state.accepted.push(id),
      kind === 'remote' ? images : () => state.valid) };
}
function unaccepted(f: ReturnType<typeof submissionFixture>) {
  assert.deepEqual(f.state.enqueued, []);
  assert.deepEqual(f.state.accepted, []);
  assert.deepEqual(f.state.resumed, []);
  assert.deepEqual(f.state.drained, []);
}
const identityChanges: [string, (fixture: ReturnType<typeof submissionFixture>) => void][] = [
  ['removal', f => { f.runtimes.workers.delete(f.worker.id); }],
  ['worker replacement', f => { f.runtimes.workers.set(f.worker.id, { ...f.worker }); }],
  ['transport replacement', f => { f.worker.rpc = {}; }],
  ['session replacement', f => { f.worker.state.sessionId = 'session-b'; }],
  ['disconnection', f => { f.worker.status = 'disconnected'; }],
  ['navigation', f => { f.sessionNavigation.busy = true; }],
  ['new approval', f => { f.worker.pendingUI.set('approval', {}); }],
];
for (const kind of ['remote', 'external'] as const) {
  test(`actual main ${kind} rejects startup-not-ready before accepting or enqueueing`, async () => {
    const f = submissionFixture(kind);
    f.state.ready = async () => { throw new Error('STARTUP_NOT_READY'); };
    await assert.rejects(f.submit(), /STARTUP_NOT_READY/);
    assert.equal(f.state.readiness, 1);
    unaccepted(f);
  });
  test(`actual main ${kind} validates a failed runtime before starting readiness`, async () => {
    const f = submissionFixture(kind);
    f.worker.failed = true;
    await assert.rejects(f.submit(), /Review the session|connector:unavailable/);
    assert.equal(f.state.readiness, 0);
    unaccepted(f);
  });
  for (const [name, change] of identityChanges) {
    test(`actual main ${kind} rechecks ${name} after readiness awaits`, { timeout: 10000 }, async () => {
      const f = submissionFixture(kind);
      let entered!: () => void, release!: () => void;
      const entering = new Promise<void>(resolve => { entered = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      f.state.ready = async () => { entered(); await held; };
      const outcome = assert.rejects(f.submit(), /identity changed|Review the session|connector:unavailable/);
      await entering;
      unaccepted(f);
      change(f);
      release();
      await outcome;
      unaccepted(f);
    });
  }
  test(`actual main ${kind} accepts only after the unchanged runtime becomes ready`, { timeout: 10000 }, async () => {
    const f = submissionFixture(kind), images = [{ type: 'image', data: 'fixture' }];
    let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.state.ready = async () => { entered(); await held; };
    const outcome = f.submit(images);
    await entering;
    unaccepted(f);
    release();
    await outcome;
    assert.equal(f.state.readiness, 1);
    assert.deepEqual(f.state.enqueued, [{ worker: f.worker, message: 'fixture message',
      payload: { message: 'fixture message', ...(kind === 'remote' ? { images } : {}) } }]);
    assert.deepEqual(f.state.accepted, ['queue-1']);
    assert.deepEqual(f.state.resumed, [f.worker]);
    assert.deepEqual(f.state.drained, [f.worker]);
  });
}
for (const [name, change] of [
  ['revoked task', (f: ReturnType<typeof submissionFixture>) => { f.state.valid = false; }],
  ['permission downgrade', (f: ReturnType<typeof submissionFixture>) => { f.worker.permissionPreset = 'full-access'; }],
] as const) {
  test(`actual main external rechecks ${name} after readiness awaits`, { timeout: 10000 }, async () => {
    const f = submissionFixture('external');
    let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.state.ready = async () => { entered(); await held; };
    const outcome = assert.rejects(f.submit(), /connector:unavailable/);
    await entering;
    change(f);
    release();
    await outcome;
    unaccepted(f);
  });
}
test('actual main Remote rechecks external ownership after readiness awaits', { timeout: 10000 }, async () => {
  const f = submissionFixture('remote');
  let entered!: () => void, release!: () => void;
  const entering = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  f.state.ready = async () => { entered(); await held; };
  const outcome = assert.rejects(f.submit(), /This session belongs to an external task/);
  await entering;
  f.state.externalOwned = true;
  release();
  await outcome;
  unaccepted(f);
});

function rendererFixture() {
  const registration = find(renderer, node => ts.isCallExpression(node)
    && node.expression.getText(renderer) === 'bridge.onEvent'
    && node.arguments[0]?.getText(renderer).includes('set_editor_text')) as ts.CallExpression;
  const navigationPending = { current: { session: { id: 'session-b' } } as object | null };
  const switching = { current: false }, viewId = { current: 'runtime-a' };
  const view = { current: { sessionId: 'session-a', draft: 'Selected B draft' } };
  const state = { requests: [] as Record<string, unknown>[], draft: view.current.draft,
    ownerUpdates: [] as { identity: object; text: string }[], metrics: [] as unknown[], clocks: [] as number[] };
  const composer = { client: { update(identity: object, change: (value: object) => { text: string }) {
    state.ownerUpdates.push({ identity, text: change({}).text });
  } } };
  const create = new Function('navigationPending', 'switching', 'viewId', 'view', 'state', 'composer', javascript(`
    const isMini = false, metricsBySession = { current: new Map() };
    const messageRevision = { current: { acceptEvent: () => true } };
    const updateRunMetrics = (_previous, event) => event;
    const setRunMetrics = value => state.metrics.push(value);
    const setClock = value => state.clocks.push(value);
    const setDraft = value => { state.draft = value; };
    const setRequests = update => { state.requests = update(state.requests); };
    return ${registration.arguments[0].getText(renderer)};
  `));
  const receive = create(navigationPending, switching, viewId, view, state, composer) as (
    event: Record<string, unknown>,
  ) => void;
  return { receive, state, navigationPending, switching, view };
}
test('failed reading suppresses old runtime approval events until authoritative navigation resumes', () => {
  const f = rendererFixture();
  assert.equal(f.switching.current, false, 'The failed navigation has already released its transient switch lock');
  for (const method of ['select', 'input', 'editor', 'confirm']) {
    f.receive({ type: 'extension_ui_request', method, id: method,
      runtimeId: 'runtime-a', sessionId: 'session-a' });
  }
  assert.equal(f.state.requests.length, 0, 'Old authoritative runtime approvals cannot overlay the selected reading');
  f.navigationPending.current = null;
  f.receive({ type: 'extension_ui_request', method: 'confirm', id: 'current-approval',
    runtimeId: 'runtime-a', sessionId: 'session-a' });
  assert.deepEqual(f.state.requests.map(request => request.id), ['current-approval']);
});
test('failed reading keeps old runtime editor updates in their owning composer without replacing the visible draft', () => {
  const f = rendererFixture();
  const event = { type: 'extension_ui_request', method: 'set_editor_text', text: 'A draft',
    runtimeId: 'runtime-a', sessionId: 'session-a' };
  f.receive(event);
  assert.equal(f.state.draft, 'Selected B draft');
  assert.equal(f.view.current.draft, 'Selected B draft');
  assert.deepEqual(f.state.ownerUpdates, [{ identity: { sessionId: 'session-a' }, text: 'A draft' }]);
  f.navigationPending.current = null;
  f.receive(event);
  assert.equal(f.state.draft, 'A draft');
});
test('failed reading records old runtime metrics without displaying them on the selected reading', () => {
  const f = rendererFixture();
  f.receive({ type: 'agent_start', runtimeId: 'runtime-a', sessionId: 'session-a' });
  assert.deepEqual(f.state.metrics, []);
  assert.deepEqual(f.state.clocks, []);
});

function rendererHandoffFixture() {
  const registration = find(renderer, node => ts.isCallExpression(node)
    && node.expression.getText(renderer) === 'bridge.onEvent'
    && node.arguments[0]?.getText(renderer).includes('set_editor_text')) as ts.CallExpression;
  const declaration = (name: string) => `const ${find(renderer, node => ts.isVariableDeclaration(node)
    && node.name.getText(renderer) === name).getText(renderer)};`;
  const pending = { current: { sequence: 7, session: { id: 'session-b' }, reading: { messages: [] } } as object | null };
  const switching = { current: false }, preview = { current: { follow: false, top: 180 } as object | undefined };
  const saved = { current: new Map([['session-b', { draft: 'Unsent B', quotes: [], attachments: [] }]]) };
  const state = { snapshot: {} as object, target: { sessionId: 'session-b', failed: true } as object | null,
    installed: [] as object[], cancelled: [] as number[], aborted: 0, loading: false, remembered: 0, restored: 0 };
  const create = new Function('navigationPending', 'switching', 'previewPosition', 'composerBySession', 'state', javascript(`
    const isMini = false, pendingPresentationRestores = { current: 0 }, viewId = { current: 'runtime-a' };
    const bridge = { snapshot: async () => state.snapshot,
      cancelSessionReading: async sequence => { state.cancelled.push(sequence); } };
    const markdownPreparation = { current: { abort: () => { state.aborted++; } } };
    const setPreparedMarkdown = () => {};
    const setNavigationTarget = value => { state.target = value; };
    const setLoading = value => { state.loading = value; };
    const finishSettingsClose = () => {}, setRemoteOpen = () => {}, setUsageOpen = () => {}, setScheduledOpen = () => {};
    const setPluginsOpen = () => {}, setFulltextOpen = () => {}, setDetails = () => {}, setExpandedRightPanel = () => {};
    const rememberView = () => { state.remembered++; };
    const installSnapshot = value => { state.installed.push(value); return true; };
    const restoreWindowPresentation = () => { state.restored++; }, followLayout = () => {};
    const flushSync = action => action(), running = [];
    const run = action => { const operation = action(); running.push(operation); return operation; };
    ${declaration('leaveReading')}
    ${declaration('refresh')}
    return { receive: ${registration.arguments[0].getText(renderer)}, refresh, settle: () => Promise.all(running) };
  `));
  const handler = create(pending, switching, preview, saved, state) as {
    receive(event: Record<string, unknown>): void; refresh(): Promise<void>; settle(): Promise<unknown>;
  };
  return { ...handler, pending, switching, preview, saved, state };
}
for (const draft of [false, true]) {
  test(`authoritative ${draft ? 'draft' : 'session'} view handoff leaves failed reading and preserves its draft`, async () => {
    const f = rendererHandoffFixture();
    const snapshot = draft ? { draftId: 'draft-c' } : { runtimeId: 'runtime-c', state: { sessionId: 'session-c' } };
    f.state.snapshot = snapshot;
    f.receive({ type: 'desktop_view_changed', surface: 'main', restorePresentation: true });
    await f.settle();
    assert.equal(f.pending.current, null);
    assert.equal(f.state.target, null);
    assert.equal(f.preview.current, undefined);
    assert.equal(f.switching.current, false);
    assert.equal(f.state.loading, false);
    assert.deepEqual(f.state.cancelled, [7]);
    assert.equal(f.state.aborted, 1);
    assert.deepEqual(f.state.installed, [snapshot]);
    assert.equal(f.state.restored, 1);
    assert.equal(f.state.remembered, 0, 'The B reading viewport must not overwrite the previous A view memory');
    assert.equal(f.saved.current.get('session-b')?.draft, 'Unsent B');
    assert.equal((f.saved.current.get('session-b') as { top?: number })?.top, 180);
  });
}
test('an ordinary refresh cannot abandon a failed reading or release its pending selection', async () => {
  const f = rendererHandoffFixture();
  f.state.snapshot = { runtimeId: 'runtime-a', state: { sessionId: 'session-a' } };
  await f.refresh();
  assert.notEqual(f.pending.current, null);
  assert.notEqual(f.state.target, null);
  assert.equal(f.state.installed.length, 0);
  assert.equal(f.state.cancelled.length, 0);
  assert.equal(f.state.aborted, 0);
});
