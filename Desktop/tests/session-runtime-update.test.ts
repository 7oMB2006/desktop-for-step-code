import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { SessionRuntimes, type RuntimeUpdateLease, type SessionRuntime, type WorkerTransport } from '../electron/session-runtimes';
import type { HistoryEntry } from '../electron/session-branching';
import type { Message, Model, PermissionPreset, RuntimeEvent, RuntimeState, SessionStats } from '../src/contracts';

const original: Model = { provider: 'fixture', id: 'original', name: 'Original' };
const fallback: Model = { provider: 'fixture', id: 'fallback', name: 'Fallback' };
const pending: Model = { provider: 'fixture', id: 'pending', name: 'Pending' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function history(messages: Message[], leafId = 'answer'): HistoryEntry[] {
  return messages.map((message, index) => ({
    id: index === messages.length - 1 ? leafId : 'question',
    parentId: index ? 'question' : null, type: 'message', message,
  }));
}

function stats(total: number): SessionStats {
  return { toolCalls: 0, assistantMessages: 1, tokens: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total } };
}

interface SavedSession {
  id: string;
  file: string;
  messages: Message[];
  entries: HistoryEntry[];
  leafId: string;
}

interface RestoreOptions {
  modelFalseSuccess?: boolean;
  effortFalseSuccess?: boolean;
  permissionFalseSuccess?: boolean;
  permissionResult?: PermissionPreset;
  changedSession?: boolean;
  changedLeaf?: boolean;
  startupMetadata?: 'trusted' | 'foreign-session' | 'invocation';
  levels?: string[];
  configure?: (transport: UpdateTransport) => void;
}

class UpdateTransport implements WorkerTransport {
  calls: { type: string; args?: Record<string, unknown> }[] = [];
  stopCalls = 0;
  updateStopCalls = 0;
  state: RuntimeState;
  messages: Message[];
  entries: HistoryEntry[];
  leafId: string;
  models: Model[] = [original, fallback];
  stats = stats(20);

  constructor(
    readonly receive: (event: RuntimeEvent) => void,
    readonly session: SavedSession,
    readonly restoring: boolean,
    readonly options: RestoreOptions = {},
  ) {
    this.state = {
      sessionId: options.changedSession ? `${session.id}-changed` : session.id,
      sessionFile: session.file, isStreaming: false, pendingMessageCount: 0,
      model: restoring ? fallback : original, thinkingLevel: restoring ? 'low' : 'high',
    };
    this.messages = structuredClone(session.messages);
    this.entries = structuredClone(session.entries);
    this.leafId = options.changedLeaf ? 'changed-leaf' : session.leafId;
    if (options.changedLeaf) this.entries.push({ id: this.leafId, parentId: session.leafId, type: 'custom' });
    if (options.startupMetadata) {
      const capabilities = { id: 'capabilities', parentId: this.leafId, type: 'custom',
        customType: 'step.activity_capabilities', data: { version: 1,
          sessionId: options.startupMetadata === 'foreign-session' ? 'another-session' : session.id } };
      const discovery = { id: 'discovery', parentId: capabilities.id, type: 'custom',
        customType: 'step.activity', data: { version: 1, sessionId: session.id,
          kind: options.startupMetadata === 'invocation' ? 'plugin' : 'skill', stage: 'discovered' } };
      this.entries.push(capabilities, discovery);
      this.leafId = discovery.id;
    }
  }

  start() {}
  respond() {}
  async stop() { this.stopCalls++; }
  async stopForUpdate() { this.updateStopCalls++; }

  async request(type: string, args?: Record<string, unknown>): Promise<any> {
    this.calls.push({ type, args });
    switch (type) {
      case 'get_state': return structuredClone(this.state);
      case 'get_messages': return { messages: structuredClone(this.messages) };
      case 'get_available_models': return { models: structuredClone(this.models) };
      case 'get_session_stats': return structuredClone(this.stats);
      case 'get_entries': return { entries: structuredClone(this.entries), leafId: this.leafId };
      case 'get_available_thinking_levels': return { levels: this.options.levels ?? ['low', 'high'] };
      case 'set_model':
        if (!this.options.modelFalseSuccess) this.state.model = this.models.find(model =>
          model.provider === args?.provider && model.id === args?.modelId);
        return {};
      case 'set_thinking_level':
        if (!this.options.effortFalseSuccess) this.state.thinkingLevel = String(args?.level);
        return {};
      case 'prompt':
        if (!this.options.permissionFalseSuccess && args?.message === '/permissions ask') {
          const label = { ask: 'Ask', 'approve-for-me': 'Approve for Me', 'full-access': 'Full Access' }[this.options.permissionResult ?? 'ask'];
          this.receive({ type: 'extension_ui_request', method: 'setStatus',
            statusKey: 'step-permission', statusText: `Mode: ${label}` });
        }
        return {};
      default: return {};
    }
  }
}

async function fixture(t: TestContext, hooks: ConstructorParameters<typeof SessionRuntimes>[2] = {}) {
  const tempRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(tempRoot, 'dfsc-runtime-update-'));
  const sessions = new Map<string, SavedSession>();
  const transports: UpdateTransport[] = [];
  const events: RuntimeEvent[] = [];
  let next: { session: SavedSession; restoring: boolean; options?: RestoreOptions } | undefined;
  const pool = new SessionRuntimes(event => events.push(event), receive => {
    assert.ok(next, 'Every transport launch must have an explicit saved session');
    const { session, restoring, options } = next;
    next = undefined;
    const transport = new UpdateTransport(receive, session, restoring, options);
    transports.push(transport);
    options?.configure?.(transport);
    return transport;
  }, hooks);
  t.after(async () => {
    await pool.stopAll();
    assert.equal(dirname(root), tempRoot);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  return {
    pool, transports, events,
    async open(name = `session-${sessions.size}`) {
      const messages: Message[] = [
        { role: 'user', content: `Question for ${name}`, timestamp: 1 },
        { role: 'assistant', content: `Saved answer for ${name}`, timestamp: 2, stopReason: 'stop' },
      ];
      const session: SavedSession = { id: name, file: join(root, `${name}.jsonl`),
        messages, entries: history(messages), leafId: 'answer' };
      await writeFile(session.file, [
        JSON.stringify({ type: 'session', id: session.id }),
        ...session.entries.map(entry => JSON.stringify(entry)),
      ].join('\n') + '\n', 'utf8');
      sessions.set(name, session);
      next = { session, restoring: false };
      const worker = await pool.open('node', 'step', root, {}, session.file);
      transports.at(-1)!.receive({ type: 'extension_ui_request', method: 'setStatus',
        statusKey: 'step-permission', statusText: 'Mode: Ask' });
      return worker;
    },
    restore(lease: RuntimeUpdateLease, options: RestoreOptions = {}) {
      const session = sessions.get(lease.sessionId);
      assert.ok(session);
      next = { session, restoring: true, options };
      return pool.restoreAfterUpdate(lease, 'node', 'step', {});
    },
  };
}

async function release(pool: SessionRuntimes, worker: SessionRuntime) {
  const leases: RuntimeUpdateLease[] = [];
  await pool.releaseForUpdate([worker], leases);
  assert.equal(leases.length, 1);
  assert.equal(pool.isReleasedForUpdate(leases[0]), true);
  return leases[0];
}

for (const missing of ['file', 'empty-file', 'path-with-messages', 'path-with-leaf', 'empty-session'] as const) {
  test(`update refuses unavailable persisted history (${missing}) before stopping the runtime`, async t => {
    const f = await fixture(t);
    const worker = await f.open();
    const transport = f.transports[0];
    if (missing === 'file') await rm(worker.state!.sessionFile!);
    else if (missing === 'empty-file') await writeFile(worker.state!.sessionFile!, '');
    else {
      delete worker.state!.sessionFile;
      if (missing === 'path-with-leaf' || missing === 'empty-session') worker.messages = [];
      if (missing === 'empty-session') worker.leafId = undefined;
    }
    const savedMessages = worker.messages;
    const savedLeaf = worker.leafId;
    const leases: RuntimeUpdateLease[] = [];
    assert.throws(() => f.pool.assertUpdateRestorable(worker), /capability:runtime-history-unavailable/);
    await assert.rejects(f.pool.releaseForUpdate([worker], leases), /capability:runtime-history-unavailable/);
    assert.deepEqual(leases, []);
    assert.equal(transport.updateStopCalls, 0);
    assert.equal(transport.stopCalls, 0);
    assert.equal(worker.status, 'connected');
    assert.equal(worker.mutating, false);
    assert.equal(worker.messages, savedMessages);
    assert.equal(worker.leafId, savedLeaf);
    assert.equal(f.pool.workers.get(worker.id), worker);
  });
}

test('background update restoration preserves navigation, unread state, recency and pending selection', async t => {
  const f = await fixture(t);
  const background = await f.open('background');
  const foreground = await f.open('foreground');
  const oldTransport = f.transports[0];
  background.pendingModel = { model: pending, thinkingLevel: 'medium' };
  background.touched = 123;
  foreground.touched = 456;
  f.pool.unreadSessionIds.add('background');
  f.pool.unreadSessionIds.add('foreground');
  f.pool.unreadSessionIds.add('unopened');
  const unread = [...f.pool.unreadSessionIds];
  const pendingModel = background.pendingModel;
  const file = await readFile(background.state!.sessionFile!, 'utf8');
  const lease = await release(f.pool, background);
  assert.equal(oldTransport.updateStopCalls, 1);
  assert.equal(oldTransport.stopCalls, 0);
  assert.equal(f.pool.activeId, foreground.id);
  assert.deepEqual([...f.pool.unreadSessionIds], unread);

  await f.restore(lease);

  const replacement = f.transports.at(-1)!;
  assert.notEqual(background.rpc, oldTransport);
  assert.equal(background.rpc, replacement);
  assert.equal(background.status, 'connected');
  assert.equal(background.mutating, false);
  assert.equal(background.state?.sessionId, 'background');
  assert.equal(background.state?.model?.id, original.id);
  assert.equal(background.state?.thinkingLevel, 'high');
  assert.equal(background.permissionPreset, 'ask');
  assert.equal(background.leafId, lease.leafId);
  assert.deepEqual(background.messages, lease.messages);
  assert.equal(background.pendingModel, pendingModel);
  assert.equal(background.touched, 123);
  assert.equal(foreground.touched, 456);
  assert.equal(f.pool.activeId, foreground.id);
  assert.deepEqual([...f.pool.unreadSessionIds], unread);
  assert.equal(f.pool.isReleasedForUpdate(lease), false);
  assert.equal(replacement.calls.some(call => call.type === 'switch_session' && call.args?.sessionPath === lease.sessionFile), true);
  assert.equal(replacement.calls.some(call => call.type === 'set_model'), true);
  assert.equal(replacement.calls.some(call => call.type === 'set_thinking_level' && call.args?.level === 'high'), true);
  assert.equal(replacement.calls.some(call => call.type === 'prompt' && call.args?.message === '/permissions ask'), true);
  assert.equal(await readFile(lease.sessionFile!, 'utf8'), file);
});

test('update accepts only native startup metadata extending the original history branch', async t => {
  const f = await fixture(t);
  const worker = await f.open();
  const lease = await release(f.pool, worker);
  await f.restore(lease, { startupMetadata: 'trusted' });
  assert.equal(worker.status, 'connected');
  assert.equal(worker.state?.sessionId, lease.sessionId);
  assert.equal(worker.leafId, 'discovery');
  assert.deepEqual(worker.messages, lease.messages);
});

for (const startupMetadata of ['foreign-session', 'invocation'] as const) {
  test(`update rejects non-startup or foreign metadata (${startupMetadata})`, async t => {
    const f = await fixture(t);
    const worker = await f.open();
    const lease = await release(f.pool, worker);
    await assert.rejects(f.restore(lease, { startupMetadata }), /Runtime history restoration is unconfirmed/);
    assert.equal(worker.status, 'disconnected');
    assert.equal(worker.leafId, lease.leafId);
    assert.equal(worker.messages, lease.messages);
  });
}

const failedRestorations: { name: string; options: RestoreOptions; error: RegExp }[] = [
  { name: 'model false success', options: { modelFalseSuccess: true }, error: /Model fixture\/original is unavailable/ },
  { name: 'effort false success', options: { effortFalseSuccess: true }, error: /restoration is unconfirmed/ },
  { name: 'permission false success', options: { permissionFalseSuccess: true }, error: /restoration is unconfirmed/ },
  { name: 'unexpected Full Access', options: { permissionResult: 'full-access' }, error: /restoration is unconfirmed/ },
  { name: 'session identity drift', options: { changedSession: true }, error: /changed session identity/ },
  { name: 'history leaf drift', options: { changedLeaf: true }, error: /restoration is unconfirmed/ },
  { name: 'unavailable effort', options: { levels: ['low'] }, error: /Runtime effort is unavailable/ },
];

for (const failure of failedRestorations) {
  test(`update rejects ${failure.name} and preserves the saved history`, async t => {
    const f = await fixture(t);
    const worker = await f.open();
    worker.pendingModel = { model: pending, thinkingLevel: 'medium' };
    worker.touched = 123;
    f.pool.unreadSessionIds.add(worker.state!.sessionId!);
    const file = await readFile(worker.state!.sessionFile!, 'utf8');
    const lease = await release(f.pool, worker);

    await assert.rejects(f.restore(lease, failure.options), failure.error);

    assert.equal(worker.status, 'disconnected');
    assert.equal(worker.failed, true);
    assert.equal(worker.mutating, false);
    assert.equal(f.pool.workers.get(worker.id), worker);
    assert.equal(f.pool.activeId, worker.id);
    assert.deepEqual([...f.pool.unreadSessionIds], [lease.sessionId]);
    assert.equal(worker.state?.sessionId, lease.sessionId);
    assert.equal(worker.state?.sessionFile, lease.sessionFile);
    assert.equal(worker.state?.model?.id, original.id);
    assert.equal(worker.messages, lease.messages);
    assert.equal(worker.leafId, lease.leafId);
    assert.equal(worker.models, lease.models);
    assert.equal(worker.stats, lease.stats);
    assert.equal(worker.launch, lease.launch);
    assert.equal(worker.pendingModel, lease.pendingModel);
    assert.equal(worker.touched, lease.touched);
    assert.equal(f.pool.isReleasedForUpdate(lease), false);
    assert.equal(f.transports.at(-1)!.stopCalls, 1);
      assert.notEqual(worker.permissionPreset, 'full-access');
    assert.equal(await readFile(lease.sessionFile!, 'utf8'), file);
  });
}

test('a process-local Full Access grant is not replayed after update', async t => {
  const f = await fixture(t);
  const worker = await f.open();
  f.transports[0].receive({ type: 'extension_ui_request', method: 'setStatus',
    statusKey: 'step-permission', statusText: 'Mode: Full Access' });
  const lease = await release(f.pool, worker);

  await f.restore(lease);

  assert.equal(worker.status, 'connected');
  assert.equal(worker.permissionPreset, undefined);
  assert.equal(f.transports.at(-1)!.calls.some(call =>
    call.type === 'prompt' && String(call.args?.message).startsWith('/permissions')), false);
});

for (const delayedAt of ['rpc', 'decoration'] as const) {
  test(`a stale restore-time snapshot delayed at ${delayedAt} cannot replace the final restored state`, async t => {
    const held = deferred<void>();
    const unblock = deferred<Message[]>();
    const staleMessages: Message[] = [
      { role: 'user', content: 'Stale question', timestamp: 3 },
      { role: 'assistant', content: 'Stale answer', timestamp: 4, stopReason: 'stop' },
    ];
    const f = await fixture(t, { messages: async (_worker, messages) => {
      if (delayedAt === 'decoration' && messages[0]?.content === 'Stale question') {
        held.resolve();
        return unblock.promise;
      }
      return messages;
    } });
    const worker = await f.open();
    worker.pendingModel = { model: pending, thinkingLevel: 'medium' };
    worker.touched = 123;
    const lease = await release(f.pool, worker);
    let lateRead: Promise<void> | undefined;
    let replacement: UpdateTransport | undefined;
    let interceptMessages = false;

    try {
      await f.restore(lease, { configure: transport => {
        replacement = transport;
        const request = transport.request.bind(transport);
        transport.request = async (type, args) => {
          if (type === 'get_messages' && interceptMessages) {
            interceptMessages = false;
            held.resolve();
            return { messages: await unblock.promise };
          }
          if (type !== 'set_thinking_level' || lateRead) return request(type, args);
          const live = { state: transport.state, messages: transport.messages, entries: transport.entries,
            leafId: transport.leafId, models: transport.models, stats: transport.stats };
          transport.state = { ...transport.state, model: fallback, thinkingLevel: 'low' };
          transport.messages = staleMessages;
          transport.entries = history(staleMessages, 'stale-answer');
          transport.leafId = 'stale-answer';
          transport.models = [fallback];
          transport.stats = stats(999);
          interceptMessages = delayedAt === 'rpc';
          // Capture a concurrent internal read on the replacement transport, not an obsolete process.
          lateRead = f.pool.read(worker);
          Object.assign(transport, live);
          await held.promise;
          return request(type, args);
        };
      } });
      assert.ok(lateRead);
      assert.equal(worker.rpc, replacement);
      assert.equal(worker.operations, 1);
      assert.equal(worker.state?.model?.id, original.id);
      assert.equal(worker.state?.thinkingLevel, 'high');
      assert.equal(worker.leafId, lease.leafId);
      assert.equal(worker.touched, lease.touched);
      const restored = structuredClone({
        state: worker.state, messages: worker.messages, leafId: worker.leafId,
        models: worker.models, stats: worker.stats, launch: worker.launch, touched: worker.touched,
      });

      unblock.resolve(staleMessages);
      await lateRead;

      assert.equal(worker.operations, 0);
      assert.deepEqual({
        state: worker.state, messages: worker.messages, leafId: worker.leafId,
        models: worker.models, stats: worker.stats, launch: worker.launch, touched: worker.touched,
      }, restored);
      assert.equal(worker.pendingModel, lease.pendingModel);
      assert.equal(f.pool.activeId, worker.id);
    } finally {
      unblock.resolve(staleMessages);
      await lateRead;
    }
  });
}
