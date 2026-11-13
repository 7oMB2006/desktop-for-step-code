import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CapabilityGate } from '../electron/capability-gate';
import type { CapabilityPolicy } from '../electron/capability-policy';
import { capabilityFailureDetails } from '../electron/capability-failure.mjs';
import { CapabilityService } from '../electron/capability-service';
import { RpcManagementStopError, type RpcProcess } from '../electron/runtime';
import { pluginWindowMethodAllowed } from '../electron/plugin-window-policy';

const file = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (predicate(node)) result = node; else ts.forEachChild(node, visit); };
  visit(file);
  assert.ok(result);
  return result;
}
const javascript = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const mutationCase = find(node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression)
  && node.expression.text === 'capabilityMutate') as ts.CaseClause;

function mutationFixture(policy: CapabilityPolicy, unsafeFailure = false, mutationError?: Error, refreshError?: Error) {
  let refreshes = 0, idleChecks = 0, reconciliations = 0;
  const notifications: { type: string }[] = [];
  const service = {
    runtimeAvailable: true,
    async mutate(_input: unknown, guard: (policy: CapabilityPolicy) => Promise<() => void>) {
      const release = await guard(policy);
      try {
        if (unsafeFailure) {
          this.runtimeAvailable = false;
          throw new Error('capability:management-uncertain');
        }
        if (mutationError) throw mutationError;
        return { warnings: [] };
      } finally { release(); }
    },
  };
  const create = new Function('capabilityGate', 'capabilityService', 'guardIdle', 'assertPluginUnused', 'refreshThemePacks', 'syncCustomBackground', 'emit',
    javascript(`
      let settingsMutation = false;
      const transition = false, undoBusy = false, updateInstalling = false, quitting = false, quitPending = false;
      const runtimes = { workers: new Map() }, preferences = {}, themePacks = { packs: [] };
      const window = { webContents: { send() {} } }, markCapabilityPhase = () => {};
      return { locked: () => settingsMutation, invoke: async args => { ${mutationCase.statements.map(node => node.getText(file)).join('\n')} } };
    `));
  return {
    ...create(new CapabilityGate(), service, async () => { idleChecks++; }, async () => {},
      async () => { refreshes++; if (refreshError) throw refreshError; }, async () => { reconciliations++; },
      (event: { type: string }) => notifications.push(event)),
    refreshes: () => refreshes, idleChecks: () => idleChecks, reconciliations: () => reconciliations, notifications,
  };
}

test('actual main discovery actions do not scan themes or persist appearance preferences', async () => {
  for (const action of ['marketplace-add', 'marketplace-update', 'marketplace-remove', 'plugin-check-updates']) {
    const f = mutationFixture({ scope: 'discovery' });
    await f.invoke([{ action }]);
    assert.equal(f.refreshes(), 0);
    assert.equal(f.idleChecks(), 0);
    assert.equal(f.locked(), false);
    assert.equal(f.reconciliations(), 0);
    assert.deepEqual(f.notifications, [{ type: 'desktop_plugin_catalog_changed' }]);
  }
  const theme = mutationFixture({ scope: 'theme', pluginId: 'theme' });
  await theme.invoke([{ action: 'plugin-install' }]);
  assert.equal(theme.refreshes(), 1);
  assert.equal(theme.locked(), false);
  assert.equal(theme.reconciliations(), 0, 'Plugin mutation must not rebind built-in appearance');
  assert.deepEqual(theme.notifications, [{ type: 'desktop_plugin_catalog_changed' }]);
});

test('actual main preserves built-in appearance after partial plugin mutation and refresh failures', async () => {
  for (const action of ['plugin-install', 'plugin-update', 'plugin-remove']) {
    const failure = new Error(`partial ${action}`);
    const f = mutationFixture({ scope: 'runtime' }, false, failure);
    await assert.rejects(f.invoke([{ action }]), error => error === failure);
    assert.equal(f.refreshes(), 0);
    assert.equal(f.reconciliations(), 0);
    assert.equal(f.locked(), false);
    assert.deepEqual(f.notifications, [{ type: 'desktop_plugin_catalog_changed' }]);
  }
  const failure = new Error('theme refresh failed');
  const f = mutationFixture({ scope: 'theme' }, false, undefined, failure);
  await assert.rejects(f.invoke([{ action: 'plugin-remove' }]), error => error === failure);
  assert.equal(f.refreshes(), 1);
  assert.equal(f.reconciliations(), 0);
  assert.deepEqual(f.notifications, [{ type: 'desktop_plugin_catalog_changed' }]);
});

test('actual main retains its runtime barrier after an unconfirmed executable writer', async () => {
  const f = mutationFixture({ scope: 'runtime' }, true);
  await assert.rejects(f.invoke([{ action: 'skill-create' }]), /management-uncertain/);
  assert.equal(f.locked(), true);
  assert.equal(f.idleChecks(), 1);
  assert.equal(f.refreshes(), 0);
});

const ipcCall = find(node => ts.isCallExpression(node) && node.expression.getText(file) === 'ipcMain.handle'
  && node.arguments[0]?.getText(file) === "'desktop'") as ts.CallExpression;
const ipcSource = ipcCall.arguments[1].getText(file);
const miniMethods = find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'miniMethods') as ts.VariableDeclaration;

function ipcFixture(handler: (method: string, args: unknown[], surface: 'main' | 'mini',
  mark?: (phase: string) => void) => unknown = method => method) {
  const webContents = { id: 1, mainFrame: {} }, miniContents = { id: 2, mainFrame: {} };
  const state = { applications: 0, submissions: 0, resumes: 0, generation: 1, reloadOnApply: false, miniBusy: false };
  const create = new Function('window', 'miniContents', 'state', 'applyProviderSettings', 'handle', 'capabilityFailureDetails', javascript(`
    let settingsMutation = false;
    const providerApplication = undefined, providerSettingsPending = true, undoBusy = false, transition = false;
    const speechSaving = false, speech = { cancel() {} };
    const updateInstalling = false, quitting = false, quitPending = false;
    const capabilityGate = { active: false }, capabilityService = { available: true, runtimeAvailable: true };
    const pluginHosts = { async resumeDeferred() { state.resumes++; } };
    const miniChat = { owns: event => event.sender === miniContents && event.senderFrame === miniContents.mainFrame };
    const pluginWindows = undefined;
    const miniMethods = ${miniMethods.initializer!.getText(file)};
    const rendererGenerations = { get: () => state.generation };
    const miniNavigation = { get busy() { return state.miniBusy; } };
    const runtimes = { workers: new Map() }, selectedRuntime = () => undefined, text = value => value;
    const composers = { submit: async (_receipt, _owner, execute) => { state.submissions++; return execute(); } };
    const canApplyProviders = () => true;
    const diagnoseCapabilityMutation = async (_method, _input, action) => action(() => {});
    const crashLog = { record: async () => {} };
    return ${ipcSource};
  `));
  const invoke = create({ webContents }, miniContents, state, async () => {
    state.applications++;
    if (state.reloadOnApply) state.generation++;
  }, handler, capabilityFailureDetails);
  return {
    state,
    read: (method: string, ...args: unknown[]) => invoke({ sender: webContents, senderFrame: webContents.mainFrame }, method, ...args),
    miniRead: (method: string, ...args: unknown[]) => invoke({ sender: miniContents, senderFrame: miniContents.mainFrame }, method, ...args),
    untrustedRead: (method: string) => invoke({ sender: miniContents, senderFrame: {} }, method),
  };
}

test('actual main passive capability reads never trigger pending provider application or recovery', async () => {
  const f = ipcFixture();
  for (const method of [
    'capabilityCatalog', 'pluginDocument', 'pluginRepositoryInfo', 'pluginConfiguration', 'pluginHostSettings', 'pluginChoosePath', 'pluginWindowOpen',
    'pluginConnectionState', 'pluginConnectionChooseProfile', 'pluginConnectionForgetProfile',
    'themeScene', 'themePoster', 'themeImage',
    'customBackgroundState', 'customBackgroundImage', 'customBackgroundImport', 'customBackgroundSave', 'customBackgroundRemove',
    'bvrConfiguration', 'bvrCheckEnvironment', 'bvrChoosePath', 'capabilityMutate',
    'pluginUpdatePreflight', 'pluginUpdateOperation', 'pluginUpdateApply',
  ]) assert.equal(await f.read(method), method);
  assert.equal(f.state.applications, 0);
  await f.read('beginSession');
  assert.equal(f.state.applications, 1);
});

function deleteSessionFixture() {
  const clause = find(node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression)
    && node.expression.text === 'deleteSession') as ts.CaseClause;
  let entered!: () => void, confirm!: () => void;
  const dialogEntered = new Promise<void>(resolve => { entered = resolve; });
  const confirmation = new Promise<void>(resolve => { confirm = resolve; });
  const state = { dialogs: 0, removes: 0, trashed: 0 };
  const create = new Function('state', 'confirmation', 'entered', javascript(`
    let settingsMutation = false, transition = false;
    const deletingArchived = false, preferences = { language: 'en' }, miniView = {}, window = {};
    const worker = { id: 'background', state: { sessionId: 'saved' }, mutating: false, operations: 0 };
    const runtimes = { workers: new Map([[worker.id, worker]]),
      async assertIdle() {}, async remove() { state.removes++; } };
    const text = value => value, listSessions = async () => [{ id: 'saved', path: 'saved.jsonl' }];
    const externallyOwned = () => false;
    const dialog = { async showMessageBox() { state.dialogs++; entered(); await confirmation; return { response: 1 }; } };
    const shell = { async trashItem() { if (!transition) throw new Error('missing transition lock'); state.trashed++; } };
    const workflowBindings = { async remove() {} }, usageEstimates = { async remove() {} };
    return { worker, lock: () => { settingsMutation = true; }, replace: () => runtimes.workers.set(worker.id, { ...worker }),
      invoke: async () => { const args = ['saved']; ${clause.statements.map(node => node.getText(file)).join('\n')} } };
  `));
  return { ...create(state, confirmation, entered), state, confirm, dialogEntered };
}

test('actual deletion refuses the update lock before prompting and rechecks it after confirmation', async () => {
  const initial = deleteSessionFixture();
  initial.lock();
  await assert.rejects(initial.invoke(), /operation in progress/);
  assert.equal(initial.state.dialogs, 0);
  for (const changed of ['lock', 'mutation', 'identity']) {
    const f = deleteSessionFixture();
    const pending = f.invoke();
    await f.dialogEntered;
    if (changed === 'lock') f.lock();
    if (changed === 'mutation') f.worker.mutating = true;
    if (changed === 'identity') f.replace();
    f.confirm();
    await assert.rejects(pending, /operation in progress/);
    assert.equal(f.state.removes, 0);
    assert.equal(f.state.trashed, 0);
  }
  const ready = deleteSessionFixture();
  const pending = ready.invoke();
  await ready.dialogEntered;
  ready.confirm();
  assert.equal(await pending, true);
  assert.equal(ready.state.removes, 1);
  assert.equal(ready.state.trashed, 1);
});

test('actual snapshot does not query a transport while an update owns its mutation', async () => {
  const declaration = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'snapshot') as ts.FunctionDeclaration;
  const refresh = declaration.body!.statements.find(node => ts.isIfStatement(node)
    && node.thenStatement.getText(file).includes('runtimes.read(worker)'))!;
  let reads = 0;
  const invoke = new Function('worker', 'runtimes', javascript(`return (async () => {
    const refresh = true; ${refresh.getText(file)}
  })();`));
  await invoke({ status: 'connected', mutating: true }, { read: async () => { reads++; } });
  assert.equal(reads, 0);
  await invoke({ status: 'connected', mutating: false }, { read: async () => { reads++; } });
  assert.equal(reads, 1);
});
test('actual connection IPC accepts only the native profile choice and rechecks package identity after asynchronous work', async () => {
  const clause = find(node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression)
    && node.expression.text === 'pluginConnectionForgetProfile') as ts.CaseClause;
  const state = { key: 'original', canceled: false, changed: false, busy: false, fail: false,
    writes: [] as unknown[], picks: 0, probes: 0 };
  const create = new Function('state', javascript(`
    let settingsMutation = false;
    const quitting = false, quitPending = false, preferences = { language: 'en' }, window = {};
    const capabilityService = { async connection(ref) {
      if (ref !== 'installed-ref') throw new Error('capability:stale');
      return state.key;
    } };
    const dialog = { async showOpenDialog() {
      state.picks++;
      if (state.changed) state.key = 'updated';
      settingsMutation = state.busy;
      return { canceled: state.canceled, filePaths: ['/native/selected-profile'] };
    } };
    const pluginConnections = {
      async choose(...args) { state.writes.push(args); },
      async snapshot() {
        state.probes++;
        if (state.fail) throw new Error('PRIVATE transport error');
        return { status: 'unselected', roots: [], tasks: [] };
      },
    };
    return async (method, ...args) => { ${clause.statements.map(node => node.getText(file)).join('\n')} };
  `));
  let invoke = create(state);
  assert.equal((await invoke('pluginConnectionState', { ref: 'installed-ref' })).status, 'unselected');
  assert.equal(state.picks, 0);
  state.canceled = true;
  assert.equal(await invoke('pluginConnectionChooseProfile', { ref: 'installed-ref', path: '/renderer/private' }), null);
  assert.deepEqual(state.writes, []);
  state.canceled = false;
  await invoke('pluginConnectionChooseProfile', { ref: 'installed-ref', path: '/renderer/private' });
  assert.deepEqual(state.writes, [['original', '/native/selected-profile']]);
  await invoke('pluginConnectionForgetProfile', { ref: 'installed-ref' });
  assert.deepEqual(state.writes.at(-1), ['original', null]);
  state.changed = true;
  await assert.rejects(invoke('pluginConnectionChooseProfile', { ref: 'installed-ref' }), /capability:stale/);
  assert.equal(state.writes.length, 2, 'package changed during picker: no binding written');
  state.changed = false; state.busy = true;
  await assert.rejects(invoke('pluginConnectionChooseProfile', { ref: 'installed-ref' }), /capability:busy/);
  assert.equal(state.writes.length, 2);
  state.busy = false; state.fail = true;
  invoke = create(state);
  await assert.rejects(invoke('pluginConnectionState', { ref: 'installed-ref' }), /capability:operation-failed/);
});

test('actual dictation IPC never applies pending providers and MiniChat has no speech access', async () => {
  const f = ipcFixture();
  for (const method of ['speechSettings', 'saveSpeech', 'acknowledgeSpeech', 'beginSpeech', 'transcribeSpeech', 'finishSpeech', 'cancelSpeech']) {
    assert.equal(await f.read(method), method);
    await assert.rejects(f.miniRead(method), /main window/);
  }
  assert.equal(f.state.applications, 0);
});

test('merged IPC preserves MiniChat theme reads and refuses management or untrusted frames before dispatch', async () => {
  const calls: string[] = [];
  const f = ipcFixture((method, _args, surface, mark) => {
    assert.equal(typeof mark, 'function');
    calls.push(`${surface}:${method}`);
    return method;
  });
  for (const method of ['themeScene', 'themePoster', 'themeImage'])
    assert.equal(await f.miniRead(method), method);
  assert.equal(f.state.applications, 0);
  for (const method of ['capabilityMutate', 'saveMcp', 'pluginSaveConfiguration', 'pluginHostSettings', 'pluginSaveHostSettings', 'pluginWindowOpen',
    'pluginConnectionState', 'pluginConnectionChooseProfile', 'pluginConnectionForgetProfile'])
    await assert.rejects(f.miniRead(method), /Return to the main window/);
  for (const method of ['themeScene', 'themePoster', 'themeImage'])
    await assert.rejects(f.untrustedRead(method), /Untrusted sender/);
  assert.deepEqual(calls, ['mini:themeScene', 'mini:themePoster', 'mini:themeImage']);
  assert.equal(f.state.applications, 0);
});

test('merged IPC restricts MiniChat background access to passive reads and refuses untrusted frames', async () => {
  const calls: string[] = [];
  const f = ipcFixture((method, _args, surface) => {
    calls.push(`${surface}:${method}`);
    return method;
  });
  const reads = ['customBackgroundState', 'customBackgroundImage'];
  const writes = ['customBackgroundImport', 'customBackgroundSave', 'customBackgroundRemove'];
  for (const method of reads) assert.equal(await f.miniRead(method), method);
  for (const method of writes) await assert.rejects(f.miniRead(method), /Return to the main window/);
  for (const method of [...reads, ...writes]) await assert.rejects(f.untrustedRead(method), /Untrusted sender/);
  assert.deepEqual(calls, reads.map(method => `mini:${method}`));
  assert.equal(f.state.applications, 0);
});

test('merged IPC retains surface and phase marker through exactly one composer submission', async () => {
  const calls: string[] = [];
  const f = ipcFixture((method, args, surface, mark) => {
    assert.equal(method, 'command');
    assert.equal(args[0], 'prompt');
    assert.equal(typeof mark, 'function');
    calls.push(surface);
    return surface;
  });
  assert.equal(await f.read('command', 'prompt', { composerReceipt: 'main-receipt' }), 'main');
  assert.equal(await f.miniRead('command', 'prompt', { composerReceipt: 'mini-receipt' }), 'mini');
  assert.deepEqual(calls, ['main', 'mini']);
  assert.equal(f.state.submissions, 2);
});

test('shared IPC releases deferred host launches without changing passive reads or MiniChat restrictions', async () => {
  const f = ipcFixture();
  await f.read('pluginConfiguration');
  await f.read('pluginHostSettings');
  await f.miniRead('themeScene');
  assert.equal(f.state.resumes, 0);
  await f.read('saveMcp');
  assert.equal(f.state.resumes, 1);
  await f.read('pluginSaveHostSettings');
  assert.equal(f.state.resumes, 2);
  await f.read('capabilityMutate');
  assert.equal(f.state.resumes, 3);
  await assert.rejects(f.miniRead('capabilityMutate'), /Return to the main window/);
  assert.equal(f.state.resumes, 3);
});

test('merged IPC rechecks renderer generation and keeps MiniChat navigation guards for shared settings', async () => {
  let calls = 0;
  const f = ipcFixture(method => { calls++; return method; });
  f.state.reloadOnApply = true;
  await assert.rejects(f.read('beginSession'), /Window reloaded/);
  assert.equal(calls, 0);
  f.state.reloadOnApply = false;
  f.state.miniBusy = true;
  await assert.rejects(f.read('saveMcp'), /MiniChat conversation is opening/);
  assert.equal(calls, 0);
  assert.equal(await f.read('capabilityMutate'), 'capabilityMutate');
  assert.equal(calls, 1);
});

test('actual main IPC rewrap retains only allowlisted Git failure metadata for capability mutations', async () => {
  const error = Object.assign(new Error('capability:marketplace-network'), { details: {
    operation: 'marketplace-refresh', elapsedMs: 80, gitExitCode: 128, gitSystemCode: null, gitSignal: null,
    stderr: 'private-output', environment: { TOKEN: 'private-token' }, source: 'private-source',
  } });
  const f = ipcFixture(async () => { throw error; });
  await assert.rejects(f.read('capabilityMutate'), failure => {
    assert.notEqual(failure, error);
    assert.deepEqual(capabilityFailureDetails(failure), {
      operation: 'marketplace-refresh', elapsedMs: 80, gitExitCode: 128, gitSystemCode: null, gitSignal: null,
    });
    assert.doesNotMatch(JSON.stringify(failure), /private|stderr|environment|source/);
    return true;
  });
  await assert.rejects(f.read('beginSession'), failure => {
    assert.equal(capabilityFailureDetails(failure), undefined);
    return true;
  });
});

test('actual plugin-window IPC is scoped, revalidates stale refs and never dispatches conversation operations', async () => {
  const sender = { mainFrame: {} };
  const state = { stale: false, busy: false, reads: 0, minimized: false, closed: false, shown: false, events: [] as unknown[] };
  const create = new Function('sender', 'state', 'pluginWindowMethodAllowed', javascript(`
    const quitting = false, miniChat = undefined;
    let settingsMutation = false;
    const owner = { ref: 'own-package', window: {
      minimize() { state.minimized = true; }, isMaximized: () => false, isFullScreen: () => false,
      isFocused: () => true, isDestroyed: () => state.closed, close() { state.closed = true; },
    } };
    const pluginWindows = { owner: event => event.sender === sender && event.senderFrame === sender.mainFrame ? owner : undefined };
    const capabilityService = {
      async desktop(ref) {
        state.reads++;
        if (state.stale || ref !== owner.ref) throw new Error('capability:stale');
        return { id: 'example', package: { ref } };
      },
      async document(input) { return { text: input.path }; },
    };
    const preferences = { language: 'en', theme: 'light', accentColor: 'green', appearance: { density: 'compact' },
      workspaces: ['private-path'], privateField: 'never-project' };
    const window = { webContents: { id: 100, mainFrame: {}, send(_channel, event) { state.events.push(event); } } };
    const showMainWindow = () => { state.shown = true; };
    const handle = () => { throw new Error('Must not dispatch to the main conversation'); };
    const handler = ${ipcSource};
    return (...args) => { settingsMutation = state.busy; return handler(...args); };
  `));
  const invoke = create(sender, state, pluginWindowMethodAllowed);
  const read = (method: string, ...args: unknown[]) => invoke({ sender, senderFrame: sender.mainFrame }, method, ...args);
  const snapshot = await read('pluginWindowState');
  assert.deepEqual(snapshot.preferences, { language: 'en', theme: 'light', accentColor: 'green', appearance: { density: 'compact' } });
  assert.doesNotMatch(JSON.stringify(snapshot), /private-path|never-project/);
  assert.deepEqual(await read('pluginDocument', { ref: 'own-package', path: 'start.md' }), { text: 'start.md' });
  for (const method of ['snapshot', 'command', 'preferences', 'pluginWindowOpen', 'capabilityMutate',
    'pluginConnectionState', 'pluginConnectionChooseProfile', 'pluginConnectionForgetProfile',
    'themeScene', 'themePoster', 'themeImage', 'customBackgroundState', 'customBackgroundImage',
    'customBackgroundImport', 'customBackgroundSave', 'customBackgroundRemove'])
    await assert.rejects(read(method), /capability:invalid-input/);
  await assert.rejects(read('pluginDocument', { ref: 'foreign', path: 'start.md' }), /capability:invalid-input/);
  await assert.rejects(invoke({ sender, senderFrame: {} }, 'pluginWindowState'), /Untrusted sender/);
  await read('pluginWindowConfigure');
  assert.equal(state.shown, true);
  assert.deepEqual(state.events, [{ type: 'desktop_main_action', action: 'plugins',
    payload: { page: 'plugins', pluginId: 'example', detail: 'config' } }]);
  state.stale = true;
  for (const method of ['pluginWindowState', 'pluginWindowConfigure', 'pluginDocument'])
    await assert.rejects(read(method, ...(method === 'pluginDocument' ? [{ ref: 'own-package', path: 'start.md' }] : [])), /capability:stale/);
  const reads = state.reads;
  state.busy = true;
  await assert.rejects(read('pluginWindowState'), /capability:busy/);
  await read('windowControl', 'minimize');
  await read('windowControl', 'close');
  assert.equal(state.reads, reads, 'Stale windows can still close without reviving their package');
  assert.equal(state.minimized, true);
  assert.equal(state.closed, true);
  await assert.rejects(read('windowControl', 'quit'), /capability:invalid-input/);
});

test('actual main recovery rechecks idle after asynchronous resource observation', async () => {
  const constructor = find(node => ts.isNewExpression(node) && node.expression.getText(file) === 'CapabilityService') as ts.NewExpression;
  const options = constructor.arguments![0] as ts.ObjectLiteralExpression;
  const guard = options.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(file) === 'guardRecovery') as ts.PropertyAssignment;
  let observations = 0, changed = false;
  const create = new Function('runtimes', 'assertPluginUnused', 'externallyOwned', javascript(`
    let settingsMutation = false;
    const capabilityService = { runtimeAvailable: true };
    const guard = ${guard.initializer.getText(file)};
    return { guard, locked: () => settingsMutation };
  `));
  const workers = new Map<string, object>(), externalWorkers = new Set<object>();
  const value = create({
    workers,
    async assertAllIdle(options: unknown) {
      assert.deepEqual(options, { stopHost: false, resources: true, allowRemote: true });
      observations++;
      if (changed) throw new Error('late task');
    },
  }, async (id: string) => { assert.equal(id, 'journal-owner'); changed = true; },
  (worker: object) => externalWorkers.has(worker));
  await assert.rejects(value.guard('journal-owner'), /late task/);
  assert.equal(observations, 2);
  assert.equal(value.locked(), false);
  observations = 0;
  changed = false;
  const external = {};
  workers.set('external', external);
  externalWorkers.add(external);
  await assert.rejects(value.guard('journal-owner'), /Stop external tasks before reloading plugins/);
  assert.equal(observations, 0, 'An external-owned task blocks recovery before idle or resource observation');
  assert.equal(changed, false);
  assert.equal(value.locked(), false);
});

test('actual host launcher remains unavailable while management or runtime safety is quarantined', () => {
  const constructor = find(node => ts.isNewExpression(node) && node.expression.getText(file) === 'PluginHostLauncher') as ts.NewExpression;
  const options = constructor.arguments![0] as ts.ObjectLiteralExpression;
  const property = options.properties.find(node => ts.isPropertyAssignment(node)
    && node.name.getText(file) === 'available') as ts.PropertyAssignment;
  const state = { available: true, runtimeAvailable: true };
  const create = new Function('capabilityService', javascript(`
    const runtimeManifest = { patches: ['desktop-plugin-host-launch'] };
    const settingsMutation = false, providerSettingsPending = false, providerApplyFailed = false;
    const quitting = false, quitPending = false;
    return ${property.initializer.getText(file)};
  `));
  const available = create(state);
  assert.equal(available(), true);
  state.available = false;
  assert.equal(available(), false);
  state.available = true;
  state.runtimeAvailable = false;
  assert.equal(available(), false);
});

const beforeQuit = find(node => ts.isCallExpression(node) && node.expression.getText(file) === 'app.on'
  && node.arguments[0]?.getText(file) === "'before-quit'") as ts.CallExpression;

for (const exitConfirmed of [true, false]) {
  test(`actual before-quit ${exitConfirmed ? 'quits after exited' : 'retains live'} quarantined management worker`, { timeout: 10000 }, async () => {
    const service = new CapabilityService({
      root: 'unused-fixture', runtime: 'unused-fixture', node: 'never-spawn', environment: () => ({}),
      createWorker: () => ({
        start() {},
        async request() { return {}; },
        async stopManagement() {
          throw new RpcManagementStopError('Management shutdown unconfirmed', false, exitConfirmed);
        },
      }) as unknown as RpcProcess,
    });
    await assert.rejects(service.initialize(), /management-committed/);
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    const create = new Function('capabilityService', 'settle', javascript(`
      let quitting = false, quitPending = false;
      const sessionEnding = false, transition = false, window = undefined;
      const speech = { cancel() {} };
      const state = { quits: 0, errors: 0, prevented: 0, diagnostics: [], messages: [], externalShutdowns: 0, externalFlushes: 0 };
      const stop = { async stopAll() {}, async stop() {}, async close() {}, async shutdown() {}, async flush() {} };
      const runtimes = stop, terminals = stop, sessionImports = stop, remote = stop, admin = stop;
      const collaboration = stop, bvrBridge = stop, pluginHosts = stop, conversationTiming = stop, modelSelections = stop;
      const usageEstimates = stop, workflowBindings = stop, miniChat = undefined, pluginWindows = undefined, browser = undefined;
      const capabilityGate = { async whenIdle() {} };
      const externalConnectors = { async shutdown() { state.externalShutdowns++; } };
      const externalTasks = { async flush() { state.externalFlushes++; } };
      const quitReasons = () => ({}), needsQuitReview = () => false, showMainWindow = () => {};
      const preferences = { language: 'zh' }, quitReview = { reset() {} };
      const crashLog = { async record(kind, error, details) { state.diagnostics.push({ kind, stage: details.stage }); } };
      const emit = event => { state.errors++; state.messages.push(event.message); settle(); };
      const app = { quit() { state.quits++; settle(); } };
      const handler = ${beforeQuit.arguments[1].getText(file)};
      return {
        state, start: () => handler({ preventDefault() { state.prevented++; } }),
        quitting: () => quitting, pending: () => quitPending,
      };
    `));
    const f = create(service, settle);
    f.start();
    await settled;
    assert.equal(f.state.prevented, 1);
    assert.equal(f.state.quits, exitConfirmed ? 1 : 0);
    assert.equal(f.state.errors, exitConfirmed ? 0 : 1);
    assert.deepEqual(f.state.diagnostics, exitConfirmed ? [] : [{ kind: 'quit-failure', stage: 'services' }]);
    if (!exitConfirmed) assert.match(f.state.messages[0], /退出未完成/);
    assert.equal(f.state.externalShutdowns, 1);
    assert.equal(f.state.externalFlushes, exitConfirmed ? 1 : 0);
    assert.equal(f.quitting(), exitConfirmed);
    assert.equal(f.pending(), exitConfirmed);
    assert.equal(service.available, false);
    await assert.rejects(service.initialize(), /management-unavailable/);
  });
}

for (const failExternalShutdown of [false, true]) {
  test(`actual before-quit waits for the capability writer before ${failExternalShutdown ? 'reporting external shutdown failure' : 'stopping services'}`, { timeout: 10000 }, async () => {
    const gate = new CapabilityGate(), events: string[] = [];
    let release!: () => void, finished!: () => void;
    const writing = new Promise<void>(resolve => { release = resolve; });
    const settled = new Promise<void>(resolve => { finished = resolve; });
    const operation = gate.run(async () => { await writing; events.push('write-finished'); });
    const create = new Function('capabilityGate', 'events', 'finished', 'failExternalShutdown', javascript(`
      let quitting = false, quitPending = false;
      const sessionEnding = false, transition = false, window = undefined;
      const speech = { cancel() {} };
      const stop = { async stopAll() {}, async stop() {}, async close() {}, async shutdown() {}, async flush() {} };
      const runtimes = stop, terminals = stop, sessionImports = stop, remote = stop, admin = stop;
      const collaboration = stop, bvrBridge = stop, pluginHosts = stop, conversationTiming = stop, modelSelections = stop;
      const usageEstimates = stop, workflowBindings = stop, miniChat = undefined, pluginWindows = undefined, browser = undefined;
      const capabilityService = { async stop() { events.push('service-stopped'); } };
      const externalConnectors = { async shutdown() {
        events.push('external-stopped');
        if (failExternalShutdown) throw new Error('External shutdown failed');
      } };
      const externalTasks = { async flush() { events.push('external-flushed'); } };
      const quitReasons = () => ({}), needsQuitReview = () => false, showMainWindow = () => {};
      const preferences = { language: 'zh' }, quitReview = { reset() {} };
      const crashLog = { async record(kind, error, details) { events.push(kind + ':' + details.stage); } };
      const emit = () => { events.push('error'); finished(); };
      const app = { quit() { events.push('quit'); finished(); } };
      const handler = ${beforeQuit.arguments[1].getText(file)};
      return { start: () => handler({ preventDefault() {} }), pending: () => quitPending, quitting: () => quitting };
    `));
    const f = create(gate, events, finished, failExternalShutdown);
    f.start();
    assert.equal(f.pending(), true);
    await Promise.resolve();
    assert.deepEqual(events, [], 'No service may stop while a capability write is pending');
    release();
    await Promise.all([operation, settled]);
    assert.deepEqual(events, failExternalShutdown
      ? ['write-finished', 'external-stopped', 'quit-failure:external-connectors', 'error']
      : ['write-finished', 'external-stopped', 'service-stopped', 'external-flushed', 'quit']);
    assert.equal(f.pending(), !failExternalShutdown);
    assert.equal(f.quitting(), !failExternalShutdown);
  });
}
