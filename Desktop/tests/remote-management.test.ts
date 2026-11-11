import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { CapabilityGate } from '../electron/capability-gate';
import { capabilityPolicy } from '../electron/capability-policy';
import { assertPluginUnused } from '../electron/capability-service';
import { RemoteManager, type RemoteHost } from '../electron/remote-manager';
import { SessionRuntimes, type SessionRuntime, type WorkerTransport } from '../electron/session-runtimes';
import type { CapabilityMutation } from '../src/capabilities';
import type { RuntimeEvent } from '../src/contracts';

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
const idle = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'guardIdle');
const ipc = find(node => ts.isCallExpression(node) && node.expression.getText(file) === 'ipcMain.handle'
  && node.arguments[0]?.getText(file) === "'desktop'") as ts.CallExpression;
const remote = find(node => ts.isNewExpression(node) && node.expression.getText(file) === 'RemoteManager') as ts.NewExpression;
const callback = (name: string) => {
  const property = (remote.arguments![0] as ts.ObjectLiteralExpression).properties.find(node =>
    ts.isPropertyAssignment(node) && node.name.getText(file) === name) as ts.PropertyAssignment;
  assert.ok(property);
  return property.initializer.getText(file);
};
const methods = ['capabilityMutate', 'pluginConfiguration', 'pluginSaveConfiguration',
  'pluginHostSettings', 'pluginSaveHostSettings', 'bvrConfiguration', 'bvrSaveConfiguration',
  'bvrCheckEnvironment', 'capabilityImportSkill', 'prepareStepPage', 'saveMcp', 'login', 'logout'];
const clauses: string[] = [];
const collect = (node: ts.Node) => {
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && methods.includes(node.expression.text))
    clauses.push(node.getText(file));
  ts.forEachChild(node, collect);
};
collect(file);

class Transport implements WorkerTransport {
  constructor(readonly receive: (event: RuntimeEvent) => void = () => {}) {}
  stopped = false;
  state: Record<string, unknown> | undefined = { sessionId: 'remote-management', isStreaming: false };
  mcp: { name: string; status: string }[] | undefined = [];
  beforeState?: () => void;
  beforeSummary?: () => void;
  stateFailure?: Error;
  start() {}
  respond() {}
  async stop() { this.stopped = true; }
  async request(type: string): Promise<any> {
    if (type === 'get_state') {
      this.beforeState?.();
      if (this.stateFailure) throw this.stateFailure;
      return this.state;
    }
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    if (type === 'get_desktop_summary') { this.beforeSummary?.(); return { mcp: this.mcp }; }
    return {};
  }
}

async function fixture() {
  const transport = new Transport(), pool = new SessionRuntimes(() => {}, () => transport);
  const worker = await pool.open('never-spawn', 'step', 'fixture', {});
  worker.remoteAttached = true;
  const identity = { rpc: worker.rpc, sessionId: worker.state!.sessionId, id: worker.id };
  const state = { writes: [] as string[], queued: [] as string[], answers: 0, backgroundSyncs: 0,
    beforeWrite: undefined as (() => Promise<void>) | undefined };
  const write = async (kind: string) => { await state.beforeWrite?.(); state.writes.push(kind); return {}; };
  const service = {
    available: true, runtimeAvailable: true,
    catalog: async () => ({ plugins: [{ id: 'bilibili-video-research' }] }),
    configuration: async (_input: unknown, save: unknown) => save ? write('configuration') : {},
    hostSettings: async (_input: unknown, save: unknown) => save ? write('host-settings') : {},
    importSkill: async () => write('import'),
    async mutate(input: CapabilityMutation, guard: (policy: object) => Promise<() => void>) {
      const policy = { ...capabilityPolicy(input.action),
        ...(['plugin-remove', 'plugin-update'].includes(input.action) && 'id' in input ? { pluginId: input.id } : {}) };
      const release = await guard(policy);
      try { await write(input.action); return { warnings: [] }; }
      finally { release(); }
    },
  };
  // Execute the production IPC, cases and Remote callbacks in one shared closure.
  const create = new Function('runtimes', 'capabilityService', 'capabilityGate', 'assertPluginUnused', 'state', 'write',
    javascript(`
      let settingsMutation = false;
      const transition = false, undoBusy = false, updateInstalling = false, quitting = false, quitPending = false;
      const speechSaving = false, speech = { cancel() {} };
      const providerApplication = undefined, providerSettingsPending = false;
      const sessionNavigation = { busy: false }, miniNavigation = { busy: false };
      const pluginWindows = undefined, miniChat = undefined, miniMethods = new Set();
      const rendererGenerations = { get: () => 1 };
      const preferences = { language: 'zh' }, themePacks = { packs: [] }, dataRoot = 'fixture';
      const window = { webContents: { id: 1, mainFrame: {}, send() {} } };
      const emit = () => {}, refreshThemePacks = async () => {};
      const syncCustomBackground = async () => { state.backgroundSyncs++; };
      const text = value => value;
      const pluginHosts = { invalidate() {}, async resumeDeferred() {} };
      const admin = { request: async type => write(type) };
      const bvrSettings = { save: async () => write('bvr') };
      const dialog = { async showOpenDialog() { return { canceled: false, filePaths: ['fixture-skill'] }; } };
      const stepPage = { prepare: async action => action('fixture-bundle', 'fixture-home') };
      const diagnoseCapabilityMutation = async (_method, _input, action) => action(() => {});
      const crashLog = { record() {} }, capabilityFailureDetails = () => undefined;
      const canApplyProviders = () => false;
      const pendingMessages = {
        enqueue(_worker, message) { state.queued.push(message); return 'queue-1'; },
        resumed() {}, async drain() {},
      };
      const remote = { runtimeEvent() {} };
      ${idle.getText(file)}
      async function handle(method, args, _surface, markCapabilityPhase) { switch (method) {
        ${clauses.join('\n')}
        default: throw new Error('Unexpected fixture method');
      } }
      const invoke = ${ipc.arguments[1].getText(file)};
      return {
        locked: () => settingsMutation,
        invoke: (method, ...args) => invoke({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, method, ...args),
        guardIdle, submit: ${callback('submit')}, respond: ${callback('respond')},
      };
    `));
  const host = create(pool, service, new CapabilityGate(), assertPluginUnused, state, write) as {
    locked(): boolean;
    invoke(method: string, ...args: unknown[]): Promise<unknown>;
    guardIdle(options?: { stopHost?: boolean; resources?: boolean }): Promise<void>;
    submit(worker: SessionRuntime, message: string, accepted: (id: string) => void): Promise<void>;
    respond(worker: SessionRuntime, answer: object): void;
  };
  return { host, state, worker, pool, transport, retained() {
    assert.equal(worker.remoteAttached, true);
    assert.equal(pool.workers.get(identity.id), worker);
    assert.equal(worker.rpc, identity.rpc);
    assert.equal(worker.state?.sessionId, identity.sessionId);
    assert.equal(transport.stopped, false);
  } };
}

const saves: [string, ...unknown[]][] = [
  ['pluginSaveConfiguration', { ref: 'fixture' }],
  ['pluginSaveHostSettings', { ref: 'fixture' }],
  ['bvrSaveConfiguration', {}],
  ['saveMcp', 'fixture-tools', { command: 'never-run', args: [], enabled: false }, {}],
  ['capabilityImportSkill'],
  ['prepareStepPage'],
];
const actions: CapabilityMutation[] = [
  { action: 'plugin-install', name: 'example', marketplace: 'fixture' },
  { action: 'plugin-update', id: 'example', ref: 'old', candidate: 'next' },
  { action: 'plugin-remove', id: 'example' },
  { action: 'plugin-toggle', id: 'example', enabled: false },
  { action: 'mcp-toggle', name: 'example__tools', enabled: false },
  { action: 'skill-create', name: 'example', description: 'Fixture', instructions: 'Never execute.' },
  { action: 'skill-toggle', id: 'example', enabled: false },
  { action: 'skill-remove', id: 'example' },
];
const operations: [string, ...unknown[]][] = [...saves, ...actions.map(action =>
  ['capabilityMutate', action] as [string, ...unknown[]])];
for (const [method, ...args] of operations) {
  test(`actual main ${method}/${(args[0] as CapabilityMutation)?.action ?? 'save'} retains an idle Remote`, async () => {
    const f = await fixture();
    await f.host.invoke(method, ...args);
    assert.equal(f.state.writes.length, 1);
    assert.equal(f.state.backgroundSyncs,
      ['plugin-install', 'plugin-update', 'plugin-remove'].includes((args[0] as CapabilityMutation)?.action) ? 1 : 0);
    assert.equal(f.host.locked(), false);
    f.retained();
  });
}

const blocked: [string, (worker: SessionRuntime) => void, RegExp][] = [
  ['task', worker => { worker.busy = true; }, /Stop this session/],
  ['queue', worker => { worker.queued = true; }, /pending messages/],
  ['approval', worker => { worker.pendingUI.set('approval', {} as any); }, /Stop this session/],
  ['Goal', worker => { worker.launch!.goal = { status: 'active' } as any; }, /Pause/],
  ['Cron', worker => { worker.cron = { state: 'unknown' } as any; }, /scheduled-work/],
  ['background', worker => { worker.backgroundActive = true; }, /background/],
  ['side question', worker => { worker.btwActive = true; }, /side question/],
  ['disconnected Remote', worker => { worker.status = 'disconnected'; }, /Runtime is not connected/],
];
for (const [name, busy, message] of blocked) {
  for (const [method, ...args] of saves) {
    test(`actual main ${method} still refuses ${name} without changing Remote`, async () => {
      const f = await fixture();
      busy(f.worker);
      await assert.rejects(f.host.invoke(method, ...args), message);
      assert.deepEqual(f.state.writes, []);
      assert.equal(f.host.locked(), false);
      f.retained();
    });
  }
}

for (const [method, ...args] of saves) {
  test(`actual main ${method} ${method === 'prepareStepPage' ? 'preserves' : 'protects'} known waiting Cron with Remote attached`, async () => {
    const f = await fixture();
    f.worker.cron = { version: 1, status: 'ready', jobs: [
      { id: 'waiting', recurring: false, durable: false, nextFireAt: Date.now() + 60000 },
    ] };
    if (method === 'prepareStepPage') {
      await f.host.invoke(method, ...args);
      assert.equal(f.state.writes.length, 1);
    } else {
      await assert.rejects(f.host.invoke(method, ...args), /scheduled-work/);
      assert.deepEqual(f.state.writes, []);
    }
    assert.equal(f.worker.cron.jobs.length, 1);
    f.retained();
  });
}

test('StepPage waiting-Cron exception rejects unavailable, malformed and changing state', async () => {
  for (const cron of [
    { version: 1, status: 'unavailable', jobs: [] },
    { version: 1, status: 'ready', jobs: 'invalid' },
    { version: 2, status: 'ready', jobs: [] },
  ]) {
    const f = await fixture();
    f.worker.cron = cron as any;
    await assert.rejects(f.host.invoke('prepareStepPage'), /scheduled-work/);
    assert.deepEqual(f.state.writes, []);
    f.retained();
  }
  for (const change of [
    (worker: SessionRuntime) => { worker.cron = { version: 1, status: 'unavailable', jobs: [] }; },
    (worker: SessionRuntime) => { worker.busy = true; },
  ]) {
    const f = await fixture();
    f.worker.cron = { version: 1, status: 'ready', jobs: [
      { id: 'waiting', recurring: false, durable: false, nextFireAt: Date.now() + 60000 },
    ] };
    f.transport.beforeState = () => change(f.worker);
    await assert.rejects(f.host.invoke('prepareStepPage'), /scheduled-work|Stop this session/);
    assert.deepEqual(f.state.writes, []);
    f.retained();
  }
});

test('actual main retains default and login/logout Remote ownership protection', async () => {
  const f = await fixture();
  for (const options of [undefined, { stopHost: true }])
    await assert.rejects(f.host.guardIdle(options), /Unbind Remote/);
  for (const method of ['login', 'logout'])
    await assert.rejects(f.host.invoke(method), /Unbind Remote/);
  await assert.rejects(f.pool.assertIdle(f.worker, { allowRemote: true }), /Unbind Remote/);
  await assert.rejects(f.pool.assertIdle(f.worker, { stopHost: false }), /Unbind Remote/);
  await assert.rejects(f.pool.refresh(f.worker, 'never-spawn', 'step', {}), /Unbind Remote/);
  assert.deepEqual(f.state.writes, []);
  f.retained();
});

test('actual main rejects unavailable or mismatched Remote RPC observations before writing', async () => {
  for (const observation of [undefined, {}, { sessionId: 'other', isStreaming: false }, { sessionId: 'remote-management' }]) {
    const f = await fixture();
    f.transport.state = observation;
    await assert.rejects(f.host.invoke(...saves[0]), /Runtime is not connected/);
    assert.deepEqual(f.state.writes, []);
    f.retained();
  }
  const f = await fixture();
  f.transport.stateFailure = new Error('Runtime timed out: get_state');
  await assert.rejects(f.host.invoke(...saves[0]), /Runtime timed out/);
  assert.deepEqual(f.state.writes, []);
  f.retained();
});

test('Remote-preserving idle checks still revalidate late activity and lost connection', async () => {
  for (const change of [
    (worker: SessionRuntime) => { worker.queued = true; },
    (worker: SessionRuntime) => { worker.status = 'disconnected'; },
  ]) {
    const f = await fixture();
    f.transport.beforeState = () => change(f.worker);
    await assert.rejects(f.host.invoke(...saves[0]), /pending messages|Runtime is not connected/);
    assert.deepEqual(f.state.writes, []);
    f.retained();
  }
});

test('actual main rejects busy state observed only through Remote RPC', async () => {
  for (const busy of [{ isStreaming: true }, { isCompacting: true }, { pendingMessageCount: 1 }]) {
    const f = await fixture();
    Object.assign(f.transport.state!, busy);
    await assert.rejects(f.host.invoke(...saves[0]), /Stop this session/);
    assert.deepEqual(f.state.writes, []);
    f.retained();
  }
});

for (const [name, change] of [
  ['connection', (worker: SessionRuntime) => { worker.status = 'disconnected'; }],
  ['RPC', (worker: SessionRuntime) => { worker.rpc = new Transport(); }],
  ['session ID', (worker: SessionRuntime) => { worker.state!.sessionId = 'replaced'; }],
] as const) {
  test(`Remote-preserving global observation rechecks a previously visited peer's ${name}`, async () => {
    const transports: Transport[] = [];
    const pool = new SessionRuntimes(() => {}, () => {
      const transport = new Transport();
      transport.state!.sessionId = `session-${transports.length}`;
      transports.push(transport);
      return transport;
    });
    const first = await pool.open('never-spawn', 'step', 'first', {});
    first.remoteAttached = true;
    const second = await pool.open('never-spawn', 'step', 'second', {});
    second.remoteAttached = true;
    transports[1].beforeState = () => change(first);
    await assert.rejects(pool.assertAllIdle({ stopHost: false, allowRemote: true, resources: true }), /Session operation/);
    assert.equal(transports.some(transport => transport.stopped), false);
  });
}

test('StepPage waiting-Cron exception rechecks previously visited peers and cannot exempt a restart', async () => {
  const transports: Transport[] = [];
  const pool = new SessionRuntimes(() => {}, () => {
    const transport = new Transport();
    transport.state!.sessionId = `session-${transports.length}`;
    transports.push(transport);
    return transport;
  });
  const first = await pool.open('never-spawn', 'step', 'first', {});
  first.remoteAttached = true;
  first.cron = { version: 1, status: 'ready', jobs: [
    { id: 'waiting', recurring: false, durable: false, nextFireAt: Date.now() + 60000 },
  ] };
  await pool.open('never-spawn', 'step', 'second', {});
  const options = { stopHost: false, allowRemote: true, resources: true, allowWaitingCron: true };
  await pool.assertAllIdle(options);
  await assert.rejects(pool.assertAllIdle({ ...options, stopHost: true }), /Unbind Remote/);
  first.remoteAttached = false;
  await assert.rejects(pool.assertAllIdle({ ...options, stopHost: true }), /Cron/);
  first.remoteAttached = true;
  transports[1].beforeState = () => { first.cron = { version: 1, status: 'unavailable', jobs: [] }; };
  await assert.rejects(pool.assertAllIdle(options), /Session operation/);
  assert.equal(transports.some(transport => transport.stopped), false);
});

for (const scope of ['single', 'all'] as const) {
  test(`Remote-preserving ${scope} observation refuses a real process exit that automatically disposes the binding`, async t => {
    const transports: Transport[] = [];
    let manager: RemoteManager;
    const pool = new SessionRuntimes(() => {}, receive => {
      const transport = new Transport(receive);
      transport.state!.sessionId = `session-${transports.length}`;
      transports.push(transport);
      return transport;
    }, { dispose: worker => manager.dispose(worker) });
    const first = await pool.open('never-spawn', 'step', 'first', {});
    if (scope === 'all') await pool.open('never-spawn', 'step', 'second', {});
    const host: RemoteHost = {
      sessions: () => [...pool.workers.values()].map(worker => ({
        runtimeId: worker.id, sessionId: worker.state!.sessionId!, workspace: worker.cwd, name: worker.id,
      })),
      refresh: async () => {}, validateWorkspaces: async () => {},
      prepare: async () => first, createSession: async () => first,
      worker: (id, sessionId) => {
        const worker = pool.workers.get(id);
        assert.ok(worker && worker.state?.sessionId === sessionId && worker.status === 'connected');
        return worker;
      },
      submit: async () => {}, stop: async () => {}, respond: () => {}, open: async () => {},
    };
    let receive!: (event: RuntimeEvent) => void;
    let armId!: string;
    manager = new RemoteManager(host, handler => {
      receive = handler;
      return {
        request: async (type, args) => {
          if (type === 'arm') {
            assert.equal(typeof args?.armId, 'string');
            armId = args!.armId as string;
          }
          if (type === 'snapshot') return { identity: {
            botId: 'fixture-bot', credentials: { appId: 'fixture', appSecret: 'fixture', brand: 'feishu' },
          }, peer: { actor: 'fixture-human', chat: 'fixture-chat' } };
        },
        stop: async () => {},
      };
    }, () => {});
    t.after(() => manager.shutdown());
    await manager.action({ type: 'connect' });
    receive({ type: 'remote_channel', kind: 'connected', botName: 'Fixture bot',
      callbackUrl: 'https://open.feishu.cn/page/launcher?clientID=fixture' });
    await manager.action({ type: 'armBinding' });
    receive({ type: 'remote_channel', kind: 'candidate', armId, candidateId: 'fixture-candidate' });
    await manager.action({ type: 'bind', candidateId: 'fixture-candidate',
      runtimeId: first.id, sessionId: first.state!.sessionId! });
    assert.equal(first.remoteAttached, true);
    assert.equal(manager.retains(first), true);
    transports.at(-1)!.beforeState = () => transports[0].receive({ type: 'desktop_exit', code: 0 });
    const options = { stopHost: false, allowRemote: true, resources: true };
    await assert.rejects(scope === 'single' ? pool.assertIdle(first, options) : pool.assertAllIdle(options),
      /Runtime is not connected|Session operation/);
    assert.equal(first.status, 'disconnected');
    assert.equal(first.remoteAttached, false);
    assert.equal(manager.retains(first), false);
    assert.equal(transports.some(transport => transport.stopped), false);
  });
}

test('actual recovery callback retains idle Remote and does not reject its owning connection transition', async () => {
  const f = await fixture();
  const constructor = find(node => ts.isNewExpression(node) && node.expression.getText(file) === 'CapabilityService') as ts.NewExpression;
  const property = (constructor.arguments![0] as ts.ObjectLiteralExpression).properties.find(node =>
    ts.isPropertyAssignment(node) && node.name.getText(file) === 'guardRecovery') as ts.PropertyAssignment;
  const create = new Function('runtimes', 'assertPluginUnused', javascript(`
    let settingsMutation = false;
    const transition = true, capabilityService = { runtimeAvailable: true };
    return { guard: ${property.initializer.getText(file)}, locked: () => settingsMutation };
  `));
  const recovery = create(f.pool, assertPluginUnused);
  const release = await recovery.guard('example');
  assert.equal(recovery.locked(), true);
  f.retained();
  release();
  assert.equal(recovery.locked(), false);
});

for (const action of ['plugin-update', 'plugin-remove'] as const) {
  test(`actual main ${action} refuses live or unknown plugin consumers, but not unrelated MCP`, async () => {
    for (const mcp of [undefined, [{ name: 'example__tools', status: 'connected' }]]) {
      const f = await fixture();
      f.transport.mcp = mcp;
      await assert.rejects(f.host.invoke('capabilityMutate', { action, id: 'example' }), /resource-in-use/);
      assert.deepEqual(f.state.writes, []);
      f.retained();
    }
    const f = await fixture();
    f.transport.mcp = [{ name: 'other__tools', status: 'connected' }];
    await f.host.invoke('capabilityMutate', { action, id: 'example' });
    assert.deepEqual(f.state.writes, [action]);
    f.retained();
  });
}

test('actual main rechecks idle after observing plugin consumers', async () => {
  const f = await fixture();
  f.transport.beforeSummary = () => { f.worker.busy = true; };
  await assert.rejects(f.host.invoke('capabilityMutate', { action: 'plugin-remove', id: 'example' }), /Stop this session/);
  assert.deepEqual(f.state.writes, []);
  f.retained();
});

for (const fails of [false, true]) {
  test(`actual shared write blocks Remote input and approval until ${fails ? 'failure' : 'success'} releases its barrier`, async () => {
    const f = await fixture();
    let entered!: () => void, finish!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const finishing = new Promise<void>(resolve => { finish = resolve; });
    f.state.beforeWrite = async () => {
      entered();
      await finishing;
      if (fails) throw new Error('capability:storage');
    };
    const operation = f.host.invoke('capabilityMutate', { action: 'skill-remove', id: 'example' });
    const outcome = fails ? assert.rejects(operation, /capability:storage/) : operation;
    await entering;
    assert.equal(f.host.locked(), true);
    await assert.rejects(f.host.submit(f.worker, 'not accepted', () => { f.state.answers++; }), /Review the session/);
    assert.throws(() => f.host.respond(f.worker, { id: 'approval', confirmed: true }), /Desktop is unavailable/);
    assert.deepEqual(f.state.queued, []);
    assert.equal(f.state.answers, 0);
    await assert.rejects(f.host.invoke(...saves[0]), /Shared settings/);
    finish();
    await outcome;
    assert.equal(f.host.locked(), false);
    await f.host.submit(f.worker, 'accepted after write', () => { f.state.answers++; });
    assert.deepEqual(f.state.queued, ['accepted after write']);
    assert.equal(f.state.answers, 1);
    f.retained();
  });
}
