import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ComposerStore } from '../electron/composer-store';
import type { SessionRuntime } from '../electron/session-runtimes';
import type { Model, Preferences, Snapshot } from '../src/contracts';
import { draftLaunchChanges, emptyLaunch } from '../src/launch-state';

type Surface = 'main' | 'mini';
const projectA = 'C:/mini-chat-fixture/project-A';
const projectB = 'C:/mini-chat-fixture/project-B';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function fixture() {
  const source = ts.createSourceFile('main.ts', await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
  const names = ['handle', 'beginSession', 'connect', 'replaceMiniRuntime',
    'selectedDraft', 'selectDraft', 'selectedRuntime', 'selectRuntime'];
  const declarations = names.map(name => {
    const declaration = source.statements.find(node =>
      ts.isFunctionDeclaration(node) && node.name?.text === name
      || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === name));
    assert.ok(declaration, `Missing main.ts declaration: ${name}`);
    return declaration.getText(source);
  });
  const javascript = ts.transpileModule(declarations.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const model: Model = { provider: 'fixture', id: 'selected-model', name: 'Selected model' };
  const draft = { id: 'shared-draft', workspace: projectA, model, models: [model],
    modelChanged: true, launch: emptyLaunch() };
  type Draft = typeof draft;
  const worker = { id: 'worker-A', cwd: projectA, status: 'connected',
    state: { sessionId: 'session-A', isStreaming: false, model }, models: [model], messages: [],
    launch: emptyLaunch(), busy: false, submissions: 0, operations: 0, pendingUI: new Map(),
  } as unknown as SessionRuntime;
  const miniView: { draft?: Draft; runtimeId?: string; worker?: SessionRuntime } = { draft };
  const preferences: Preferences = { language: 'en', theme: 'system', workspaces: [projectA, projectB] };
  const workers = new Map<string, SessionRuntime>();
  const creatingDrafts = new Set<string>();
  const createdDrafts = new Map<string, string>();
  const composers = new ComposerStore(() => {});
  const setupStarted = deferred(), setup = deferred();
  const removalStarted = deferred(), removal = deferred();
  let pauseRemoval = false;
  const observedMainDrafts: (string | undefined)[] = [];
  const sessionOptions: string[] = [];
  const removed: string[] = [];
  let sequence = 0;
  let api!: {
    handle: (method: string, args: unknown[], surface: Surface) => Promise<Snapshot>;
    selectedDraft: (surface: Surface) => Draft | undefined;
    selectedRuntime: (surface: Surface) => string | undefined;
    selectRuntime: (surface: Surface, value: SessionRuntime) => void;
  };
  const prepare = async (_node: string, _entry: string, cwd: string) => {
    assert.equal(cwd, projectA);
    workers.set(worker.id, worker);
    return worker;
  };
  const runtimes = {
    workers, activeId: undefined as string | undefined, unreadSessionIds: new Set<string>(),
    get active(): SessionRuntime | undefined { return workers.get(this.activeId ?? ''); },
    prepare, open: prepare,
    require(id?: string) {
      const value = workers.get(id ?? runtimes.activeId ?? '');
      assert.ok(value && value.status === 'connected', 'Expected a connected fixture runtime');
      return value;
    },
    activate(value: SessionRuntime) { this.activeId = value.id; this.publish(); },
    publish() { observedMainDrafts.push(api.selectedDraft('main')?.workspace); },
    recycle: async () => {},
    isBusy: () => false,
    remove: async (value: SessionRuntime) => {
      removed.push(value.id); workers.delete(value.id);
      if (runtimes.activeId === value.id) runtimes.activeId = undefined;
      if (pauseRemoval) { removalStarted.resolve(); await removal.promise; }
    },
  };
  const snapshot = async (_worker?: SessionRuntime, _refresh = true, ignoreDraft = false, surface: Surface = 'main'): Promise<Snapshot> => {
    const current = ignoreDraft ? undefined : api.selectedDraft(surface);
    const selected = current ? undefined : ignoreDraft ? _worker : surface === 'mini' ? miniView.worker : runtimes.active;
    return { preferences: { ...preferences, workspace: current?.workspace ?? selected?.cwd },
      status: current ? 'ready' : selected?.status ?? 'disconnected', draftId: current?.id,
      runtimeId: selected?.id, state: selected?.state, messages: selected?.messages ?? [],
      models: current?.models ?? selected?.models ?? [], sessions: [] };
  };
  const context = {
    sessionDraft: draft as Draft | undefined, miniView, runtimes, preferences,
    creatingDrafts, createdDrafts, composers, snapshot, transition: false, deletingArchived: false,
    updateInstalling: false, status: 'ready', sessionNavigation: { busy: false },
    text: (value: string) => value, pathKey: (value: string) => value.toLowerCase(),
    workspaceDirectory: async (value: string) => value,
    samePath: async (a: string, b: string) => a === b,
    admin: { request: async (method: string, args: { cwd: string }) => {
      assert.equal(method, 'session_options'); sessionOptions.push(args.cwd);
      return { model, models: [model], permissionPreset: 'ask' };
    } },
    app: { getPath: () => 'C:/mini-chat-fixture/documents' },
    randomUUID: () => `new-draft-${++sequence}`,
    preferredModel: (models: Model[]) => models[0], modelPreference: (value: Model) => value,
    emptyLaunch, draftLaunchChanges, emit: () => {}, savePreferences: async () => {},
    nodePath: 'fixture-node', runtimeRoot: 'fixture-runtime', independentRoot: 'fixture-independent', join,
    authEnvironment: () => ({}), movedSessionEnvironment: () => ({}), crashLog: { setPhase() {} },
    bvrBridge: { detach() {} }, appliedAuthData: {},
    providerModelNames: (models: Model[]) => models,
    modelThinkingLevels: (value: Model) => value.thinkingLevels ?? [],
    modelSelections: {
      select(value: SessionRuntime, selected: Model) { value.pendingModel = { model: selected }; },
      async apply(value: SessionRuntime) {
        setupStarted.resolve();
        await setup.promise;
        value.state!.model = value.pendingModel!.model; value.pendingModel = undefined;
      },
    },
    rememberModel: async () => {}, promptNeedsQueue: () => false, isProjectTrustInput: () => false,
    pendingMessages: { drain() {} },
  };
  api = runInNewContext(javascript + '\n({ handle, selectedDraft, selectedRuntime, selectRuntime })', context);
  const start = async (surface: Surface) => {
    const creation = api.handle('createDraftSession', [draft.id], surface);
    await Promise.race([setupStarted.promise, creation.then(() => assert.fail('Model setup was not held'))]);
    assert.equal(context.transition, false, 'Hold after connect releases the workspace lock');
    assert.equal(creatingDrafts.has(draft.id), true);
    return { creation };
  };
  const navigateAway = (surface: Surface) => {
    const newer = { ...worker, id: 'worker-B', cwd: projectB, pendingModel: undefined,
      state: { ...worker.state!, sessionId: 'session-B' } };
    workers.set(newer.id, newer); api.selectRuntime(surface, newer);
    return newer;
  };
  const holdRemoval = () => {
    pauseRemoval = true;
    return { started: removalStarted.promise, release: removal.resolve };
  };
  return { api, draft, worker, miniView, runtimes, setup, composers, creatingDrafts, createdDrafts,
    observedMainDrafts, sessionOptions, removed, start, navigateAway, holdRemoval };
}

test('shared draft project changes reject during post-connect setup and promote the original project', async () => {
  const f = await fixture();
  const { creation } = await f.start('mini');
  try {
    await assert.rejects(f.api.handle('beginSession', [projectB], 'main'), /draft.*being created/i);
    assert.equal(f.api.selectedDraft('main'), f.draft);
    assert.equal(f.draft.workspace, projectA);
    assert.deepEqual(f.sessionOptions, [], 'Rejected project changes must not load replacement options');
  } finally {
    f.setup.resolve(); await creation;
  }
  assert.equal(f.api.selectedDraft('main'), undefined);
  assert.equal(f.api.selectedDraft('mini'), undefined);
  assert.equal(f.api.selectedRuntime('main'), f.worker.id);
  assert.equal(f.api.selectedRuntime('mini'), f.worker.id);
  assert.equal(f.worker.cwd, projectA);
  assert.equal(f.observedMainDrafts.includes(projectB), false, 'Main must never switch to B and back to A');
  assert.equal(f.createdDrafts.get(f.draft.id), f.worker.id);
  assert.deepEqual(f.composers.owner({ draftId: f.draft.id }), { sessionId: 'session-A' });
  assert.equal(f.creatingDrafts.size, 0);
});

test('promotion preserves independent navigation away from the shared draft', async () => {
  const f = await fixture();
  const { creation } = await f.start('mini');
  const newer = f.navigateAway('main');
  f.setup.resolve(); await creation;
  assert.equal(f.api.selectedRuntime('main'), newer.id);
  assert.equal(f.api.selectedRuntime('mini'), f.worker.id);
  assert.equal(f.creatingDrafts.size, 0);
});

for (const surface of ['main', 'mini'] as const) {
  test(`failed ${surface} creation does not restore an old draft over a newer view`, async () => {
    const f = await fixture();
    const { creation } = await f.start(surface);
    const failure = new Error('MODEL_SETUP_FAILED');
    const rejected = assert.rejects(creation, error => error === failure);
    let newerDraft: ReturnType<typeof f.api.selectedDraft>;
    try {
      f.navigateAway(surface);
      await f.api.handle('beginSession', [projectB], surface);
      newerDraft = f.api.selectedDraft(surface);
      assert.ok(newerDraft);
      assert.notEqual(newerDraft.id, f.draft.id);
      assert.equal(newerDraft.workspace, projectB);
    } finally {
      f.setup.reject(failure); await rejected;
    }
    const other = surface === 'main' ? 'mini' : 'main';
    assert.equal(f.api.selectedDraft(surface), newerDraft);
    assert.equal(f.api.selectedDraft(other), f.draft);
    assert.deepEqual(f.removed, [f.worker.id]);
    assert.equal(f.createdDrafts.size, 0);
    assert.equal(f.creatingDrafts.size, 0);
  });

  test(`failed ${surface} creation restores its draft when the view has not moved`, async () => {
    const f = await fixture();
    const { creation } = await f.start(surface);
    const failure = new Error('MODEL_SETUP_FAILED');
    const rejected = assert.rejects(creation, error => error === failure);
    f.setup.reject(failure); await rejected;
    assert.equal(f.api.selectedDraft('main'), f.draft);
    assert.equal(f.api.selectedDraft('mini'), f.draft);
    assert.equal(f.api.selectedRuntime(surface), undefined);
    assert.deepEqual(f.removed, [f.worker.id]);
    assert.equal(f.createdDrafts.size, 0);
    assert.equal(f.creatingDrafts.size, 0);
  });

  test(`failed ${surface} creation rechecks navigation after asynchronous runtime removal`, async () => {
    const f = await fixture();
    const { creation } = await f.start(surface);
    const cleanup = f.holdRemoval();
    const failure = new Error('MODEL_SETUP_FAILED');
    const rejected = assert.rejects(creation, error => error === failure);
    f.setup.reject(failure);
    let newer: SessionRuntime | undefined;
    try {
      await Promise.race([cleanup.started, rejected.then(() => assert.fail('Runtime removal was not held'))]);
      assert.equal(f.runtimes.workers.has(f.worker.id), false);
      if (surface === 'main') assert.equal(f.runtimes.activeId, undefined);
      newer = f.navigateAway(surface);
    } finally {
      cleanup.release(); await rejected;
    }
    assert.equal(f.api.selectedRuntime(surface), newer!.id);
    assert.equal(f.api.selectedDraft(surface), undefined);
    assert.equal(f.api.selectedDraft(surface === 'main' ? 'mini' : 'main'), f.draft);
    assert.deepEqual(f.removed, [f.worker.id]);
    assert.equal(f.createdDrafts.size, 0);
    assert.equal(f.creatingDrafts.size, 0);
  });
}
