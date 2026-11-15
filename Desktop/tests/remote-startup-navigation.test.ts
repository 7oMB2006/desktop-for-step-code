import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { SessionNavigation } from '../electron/session-navigation';
import { remoteNavigationTitle, remoteNavigationWait, type RemotePreparationSource } from '../src/remote-navigation';

const file = ts.createSourceFile('main.ts', readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(result);
  return result;
}
const prepare = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'prepareRemoteSession').getText(file);
const navigate = find(node => ts.isCaseClause(node) && ts.isStringLiteral(node.expression)
  && node.expression.text === 'navigateSession').getText(file);
const navigationWait = find(node => ts.isIfStatement(node)
  && node.expression.getText(file) === "method === 'navigateSession'").getText(file);
const mutationGuards = ['undoBusy', 'settingsMutation'].map(flag => find(node => ts.isIfStatement(node)
  && node.expression.getText(file).startsWith(`${flag} && [`)
  && node.expression.getText(file).includes("'navigateSession'")).getText(file)).join('\n');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const gate = deferred(), initialized = deferred();
  const calls: string[] = [];
  const events: any[] = [];
  const javascript = ts.transpileModule(`
    let transition = false, deletingArchived = false, remotePreparation, remotePreparationSequence = 0, requests = 0;
    let settingsMutation = false, undoBusy = false;
    const quitting = false, quitPending = false;
    const updateInstalling = false, providerSettingsPending = false;
    let startup = Promise.resolve(), active = 'home';
    const readingSelections = new Map(), readingOwner = () => 'fixture-owner';
    const runtimeRoot = 'runtime', nodePath = 'node', dataRoot = 'data';
    const workers = new Map();
    const sessions = ['remote', 'local-a', 'local-b'].map(id => ({
      sessionId: id, id, workspace: 'project', cwd: 'project', path: id + '.jsonl'
    }));
    const runtimes = {
      workers, require: id => workers.get(id),
      async prepare() {
        initialized.resolve();
        await gate.promise;
        const worker = { id: 'remote-worker', state: { sessionId: 'remote' }, permissionPreset: 'ask' };
        worker.rpc = { request: async (_type, args) => {
          assert.equal(args.message, '/permissions approve-for-me');
          worker.permissionPreset = 'approve-for-me';
        } };
        workers.set(worker.id, worker);
        return worker;
      },
      async remove(worker) { workers.delete(worker.id); }
    };
    const remoteSessions = () => sessions, cachedSessions = () => sessions;
    const remoteProjects = () => [{ workspace: 'project' }];
    const externalTasks = { retains: () => false };
    const pathKey = value => value, workspaceDirectory = async value => value;
    const managedSessionFile = async (_root, value) => value;
    const join = (...values) => values.join('/');
    const authEnvironment = () => ({}), movedSessionEnvironment = () => ({});
    const emit = () => {}, text = value => value, isChildSession = id => id === 'child';
    const sessionNavigation = new SessionNavigation(async id => {
      calls.push(id);
      return id;
    }, id => active = id, busy => { transition = busy; });
    const miniNavigation = sessionNavigation;
    ${prepare}
    async function invoke(id, surface = 'main') {
      const args = [id, ++requests], method = 'navigateSession', senderId = 1, generation = 0;
      const rendererGenerations = new Map([[1, 0]]);
      const event = { sender: { isDestroyed: () => false, send: (_channel, value) => events.push(value) } };
      ${navigationWait}
      ${mutationGuards}
      switch ('navigateSession') { ${navigate} }
    }
    return {
      prepare: (source = 'feishu-recovery', preset = 'ask') => prepareRemoteSession('remote', undefined, source, preset), invoke, active: () => active,
      busy: () => transition, setTransition: value => { transition = value; },
      setDeleting: value => { deletingArchived = value; },
      setSettings: value => { settingsMutation = value; },
      setUndo: value => { undoBusy = value; },
      setStartup: value => { startup = value; }
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const create = new Function('SessionNavigation', 'gate', 'initialized', 'calls', 'events', 'assert', javascript);
  const host = create(SessionNavigation, gate, initialized, calls, events, assert) as {
    prepare(source?: RemotePreparationSource, preset?: 'ask' | 'approve-for-me'): Promise<{ permissionPreset: string }>;
    invoke(id: string, surface?: string): Promise<string | null>;
    active(): string; busy(): boolean; setTransition(value: boolean): void;
    setDeleting(value: boolean): void; setStartup(value: Promise<void>): void;
    setSettings(value: boolean): void; setUndo(value: boolean): void;
  };
  return { host, gate, initialized, calls, events };
}

for (const surface of ['main', 'mini']) {
  test(`${surface} navigation waits for Remote cold preparation instead of exposing workspace-busy`, async () => {
    const f = fixture();
    const preparing = f.host.prepare();
    await f.initialized.promise;
    let settled = false;
    const navigation = f.host.invoke('local-a', surface).then(value => ({ value }), error => ({ error }))
      .finally(() => { settled = true; });
    try {
      await tick();
      assert.equal(settled, false, 'The click must wait, not reject during automatic Remote recovery');
      assert.deepEqual(f.calls, []);
      assert.equal(f.host.active(), 'home', 'Remote preparation must never activate a local conversation');
      assert.equal(f.host.busy(), true);
    } finally { f.gate.resolve(); await preparing; }
    assert.deepEqual(await navigation, { value: 'local-a' });
    assert.equal(f.host.active(), 'local-a');
    assert.equal(f.host.busy(), false);
  });
}

test('rapid clicks waiting on Remote preparation still commit only the latest local target', async () => {
  const f = fixture();
  const preparing = f.host.prepare();
  await f.initialized.promise;
  const navigations = ['local-a', 'local-b'].map(id => f.host.invoke(id).catch(error => error.message));
  f.gate.resolve();
  await preparing;
  assert.deepEqual(await Promise.all(navigations), [null, 'local-b']);
  assert.equal(f.host.active(), 'local-b');
});

test('failed Remote preparation releases waiting local navigation without forwarding the Remote error', async () => {
  const f = fixture();
  const failure = new Error('Remote startup failed');
  const preparing = f.host.prepare().catch(error => error);
  await f.initialized.promise;
  const navigation = f.host.invoke('local-a').catch(error => error.message);
  f.gate.reject(failure);
  assert.equal(await preparing, failure);
  assert.equal(await navigation, 'local-a');
  assert.equal(f.host.busy(), false);
});

test('navigation waits for initial draft startup before checking workspace ownership', async () => {
  const f = fixture(), startup = deferred();
  f.host.setStartup(startup.promise);
  f.host.setTransition(true);
  const navigation = f.host.invoke('local-a').catch(error => error.message);
  await tick();
  assert.deepEqual(f.calls, []);
  f.host.setTransition(false);
  startup.resolve();
  assert.equal(await navigation, 'local-a');
});

test('unrelated workspace mutations and archived deletion remain protected', async () => {
  for (const flag of ['transition', 'deleting']) {
    const f = fixture();
    if (flag === 'transition') f.host.setTransition(true);
    else f.host.setDeleting(true);
    await assert.rejects(f.host.invoke('local-a'), /Workspace operation in progress/);
    assert.deepEqual(f.calls, []);
  }
});

test('navigation rechecks mutation flags after Remote preparation and keeps child-session rejection', async () => {
  const f = fixture();
  const preparing = f.host.prepare();
  await f.initialized.promise;
  const navigation = f.host.invoke('local-a').catch(error => error.message);
  f.host.setDeleting(true);
  f.gate.resolve();
  await preparing;
  assert.equal(await navigation, 'Workspace operation in progress');
  assert.deepEqual(f.calls, []);
  f.host.setDeleting(false);
  await assert.rejects(f.host.invoke('child'), /Child sessions belong/);
});

for (const flag of ['settings', 'undo']) {
  test(`IPC rechecks ${flag} protection after waiting for Remote recovery`, async () => {
    const f = fixture();
    const preparing = f.host.prepare();
    await f.initialized.promise;
    const navigation = f.host.invoke('local-a').catch(error => error.message);
    if (flag === 'settings') f.host.setSettings(true);
    else f.host.setUndo(true);
    f.gate.resolve();
    await preparing;
    assert.equal(await navigation, flag === 'settings' ? 'Shared settings operation in progress' : 'Undo in progress');
    assert.deepEqual(f.calls, []);
  });
}

for (const source of ['feishu-recovery', 'feishu-session', 'external-agent'] as const) {
  test(`navigation reports the actual ${source} preparation and clears it on completion`, async () => {
    const f = fixture();
    const preparing = f.host.prepare(source);
    await f.initialized.promise;
    const navigation = f.host.invoke('local-a');
    await tick();
    assert.deepEqual(f.events, [{ type: 'desktop_navigation_wait', requestId: 1, waiting: { id: 1, source } }]);
    f.gate.resolve(); await preparing; await navigation;
    assert.deepEqual(f.events.at(-1), { type: 'desktop_navigation_wait', requestId: 1, waiting: undefined });
  });
}

test('failed Remote preparation clears its explanation without leaking its error', async () => {
  const f = fixture();
  const preparing = f.host.prepare('external-agent').catch(() => {});
  await f.initialized.promise;
  const navigation = f.host.invoke('local-a');
  await tick();
  f.gate.reject(new Error('PRIVATE-FAILURE'));
  await preparing; await navigation;
  assert.equal(f.events.length, 2);
  assert.equal(f.events.at(-1).waiting, undefined);
  assert.ok(!JSON.stringify(f.events).includes('PRIVATE-FAILURE'));
});

test('external preparation retains the authorized permission tier alongside its wait source', async () => {
  const f = fixture();
  const preparing = f.host.prepare('external-agent', 'approve-for-me');
  await f.initialized.promise;
  const navigation = f.host.invoke('local-a');
  await tick();
  assert.equal(f.events[0].waiting.source, 'external-agent');
  f.gate.resolve();
  assert.equal((await preparing).permissionPreset, 'approve-for-me');
  assert.equal(await navigation, 'local-a');
  const create = find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'externalTasks').getText(file);
  assert.match(create, /prepareRemoteSession\(undefined, cwd, 'external-agent', preset\)/);
});

test('ordinary navigation never reports a Remote blocker', async () => {
  const f = fixture();
  await f.host.invoke('local-a');
  assert.deepEqual(f.events, [{ type: 'desktop_navigation_wait', requestId: 1, waiting: undefined }]);
});

test('Remote wait payloads accept only bounded identifiers and known sources', () => {
  assert.deepEqual(remoteNavigationWait({ id: 2, source: 'external-agent', private: 'ignored' }),
    { id: 2, source: 'external-agent' });
  for (const value of [undefined, null, {}, { id: 0, source: 'feishu-recovery' },
    { id: '1', source: 'feishu-session' }, { id: 1, source: 'unknown' }, { id: Infinity, source: 'external-agent' }]) {
    assert.equal(remoteNavigationWait(value), undefined);
  }
  assert.match(remoteNavigationTitle('feishu-recovery', 'zh'), /恢复飞书/);
  assert.match(remoteNavigationTitle('feishu-session', 'zh'), /准备飞书/);
  assert.match(remoteNavigationTitle('external-agent', 'zh'), /外部 Agent/);
  assert.doesNotMatch(remoteNavigationTitle('external-agent', 'en'), /Feishu/);
});
