import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntimes, taskOutcome, type WorkerTransport } from '../electron/session-runtimes';
import { WORKSPACE_POLICY } from '../electron/workspace-policy';
import type { RuntimeEvent } from '../src/contracts';

class Transport implements WorkerTransport {
  stopped = false;
  calls: string[] = [];
  answers: Record<string, unknown>[] = [];
  startArgs: string[] = [];
  constructor(readonly receive: (event: RuntimeEvent) => void, readonly sessionId: string) {}
  start(_node: string, _entry: string, _cwd: string, _env: NodeJS.ProcessEnv, args: string[] = []) { this.startArgs = args; }
  async request(type: string, _args?: Record<string, unknown>): Promise<any> {
    this.calls.push(type);
    if (type === 'get_state') return { sessionId: this.sessionId, sessionFile: `${this.sessionId}.jsonl`, isStreaming: false };
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    return {};
  }
  respond(value: Record<string, unknown>) { this.answers.push(value); }
  async stop() { this.stopped = true; }
}
function fixture() {
  const transports: Transport[] = [];
  const events: RuntimeEvent[] = [];
  const pool = new SessionRuntimes(event => events.push(event), receive => {
    const transport = new Transport(receive, `session-${transports.length}`);
    transports.push(transport);
    return transport;
  });
  const open = (cwd = `workspace-${transports.length}`) => pool.open('node', 'step', cwd, {});
  return { pool, transports, events, open };
}

test('idle configuration refresh preserves runtime identity and ignores the retired transport', async () => {
  const transports: Transport[] = [];
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'same-session');
    transports.push(transport);
    return transport;
  });
  const worker = await pool.open('node', 'step', 'workspace', {});
  const id = worker.id;
  worker.permissionPreset = 'read-only';
  await pool.refresh(worker, 'node', 'step', { NEW_CONFIG: '1' });
  assert.equal(pool.active, worker);
  assert.equal(worker.id, id);
  assert.equal(worker.state?.sessionId, 'same-session');
  assert.equal(worker.permissionPreset, 'read-only');
  assert.equal(transports[0].stopped, true);
  assert.deepEqual(transports[1].startArgs.slice(2, 4), ['--session-id', 'same-session']);
  assert.equal(transports[1].calls.includes('new_session'), false, 'unpersisted empty session is not recreated');
  const revision = worker.revision;
  transports[0].receive({ type: 'desktop_exit' });
  transports[0].receive({ type: 'agent_start' });
  assert.equal(worker.revision, revision);
  assert.equal(worker.status, 'connected');
  assert.equal(worker.busy, false);
  transports[1].receive({ type: 'agent_start' });
  assert.equal(worker.busy, true);
  await pool.stopAll();
});

test('configuration refresh never stops running, queued or mutating workers', async () => {
  for (const field of ['busy', 'queued', 'mutating', 'operations', 'stopping'] as const) {
    const { pool, transports, open } = fixture();
    const worker = await open();
    Object.assign(worker, { [field]: field === 'operations' ? 1 : true });
    await assert.rejects(pool.refresh(worker, 'node', 'step', {}));
    assert.equal(transports[0].stopped, false, field);
    await pool.stopAll();
  }
});

test('failed replacement preserves the active session and suspends all configuration peers', async () => {
  const transports: Transport[] = [];
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'same-session');
    if (transports.length === 2) transport.start = () => { throw new Error('replacement failed'); };
    transports.push(transport);
    return transport;
  });
  const peer = await pool.open('node', 'step', 'peer', {});
  const active = await pool.open('node', 'step', 'active', {});
  await assert.rejects(pool.refresh(active, 'node', 'step', {}), /replacement failed/);
  assert.equal(pool.active, active);
  assert.equal(active.state?.sessionId, 'same-session');
  assert.equal(active.status, 'disconnected');
  await pool.suspend([peer, active]);
  assert.equal(peer.status, 'disconnected');
  assert.ok(transports.every(transport => transport.stopped));
  assert.equal(pool.workers.size, 2);
  transports[0].receive({ type: 'agent_start' });
  assert.equal(peer.busy, false, 'late stopped-transport events cannot revive a suspended worker');
  assert.equal(pool.running, false);
  await pool.stopAll();
});

test('wire message revisions increase per worker and match its snapshot revision', async () => {
  const { pool, transports, events, open } = fixture();
  const worker = await open();
  try {
    for (const event of [
      { type: 'message_start', message: { role: 'assistant', content: [] } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Alpha' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Alpha' } },
    ]) transports[0].receive(event);
    const messages = events.filter(event => event.type.startsWith('message_'));
    assert.deepEqual(messages.map(event => event.runtimeRevision), [1, 2, 3]);
    assert.equal(worker.revision, 3);
    assert.deepEqual(worker.messages[0].content, [{ type: 'text', text: 'AlphaAlpha' }]);
  } finally { await pool.stopAll(); }
});

test('preparing cold history does not activate it or clear its unread status', async () => {
  const { pool, open } = fixture();
  const original = await open();
  pool.unreadSessionIds.add('session-1');
  const prepared = await pool.prepare('node', 'step', 'other-workspace', {}, 'session-1.jsonl');
  assert.equal(pool.active, original);
  assert.equal(prepared.state?.sessionId, 'session-1');
  assert.equal(pool.unreadSessionIds.has('session-1'), true);
  pool.activate(prepared);
  assert.equal(pool.active, prepared);
  assert.equal(pool.unreadSessionIds.has('session-1'), false);
  await pool.stopAll();
});

test('recycling rechecks activation and pending operations after awaiting another disposal', async () => {
  const { pool, transports, open } = fixture();
  const workers = [];
  for (let i = 0; i < 5; i++) {
    const worker = await open();
    worker.messages = [{ role: 'user', content: 'saved' }];
    worker.touched = i;
    workers.push(worker);
  }
  let finish!: () => void;
  let disposing!: () => void;
  const began = new Promise<void>(resolve => { disposing = resolve; });
  const stop = new Promise<void>(resolve => { finish = resolve; });
  transports[3].stop = async () => { disposing(); await stop; };
  const recycling = pool.recycle();
  await began;
  pool.activate(workers[2]);
  workers[1].operations++;
  finish();
  await recycling;
  assert.equal(pool.active, workers[2]);
  assert.equal(pool.workers.has(workers[2].id), true);
  assert.equal(pool.workers.has(workers[1].id), true);
  workers[1].operations--;
  await pool.stopAll();
});

test('repeated new-session requests reuse one empty worker without resetting it', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  empty.permissionPreset = 'read-only';
  const calls = transports[0].calls.length;
  for (let i = 0; i < 5; i++) assert.equal(await open('workspace'), empty);
  assert.equal(pool.active, empty);
  assert.equal(pool.workers.size, 1);
  assert.equal(transports.length, 1);
  assert.equal(transports[0].calls.length, calls);
  assert.equal(empty.permissionPreset, 'read-only');
  await pool.stopAll();
});

test('concurrent new-session requests share the startup worker', async () => {
  const { pool, transports, open } = fixture();
  const workers = await Promise.all(Array.from({ length: 5 }, () => open('workspace')));
  assert.ok(workers.every(worker => worker === workers[0]));
  assert.equal(transports.length, 1);
  assert.equal(transports[0].calls.filter(type => type === 'new_session').length, 1);
  await pool.stopAll();
});

test('new-session requests wait for all ordinary snapshot reads and then reuse the empty worker', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const original = transports[0].request.bind(transports[0]);
  const releases: Array<() => void> = [];
  transports[0].request = async type => {
    if (type === 'get_messages') await new Promise<void>(resolve => releases.push(resolve));
    return original(type);
  };
  const reads = [pool.read(empty), pool.read(empty)];
  let opened = false;
  const openings = Promise.all(Array.from({ length: 5 }, () => open('workspace'))).then(workers => {
    opened = true;
    return workers;
  });
  try {
    await Promise.resolve();
    assert.equal(transports.length, 1, 'Snapshot refresh must not cause another worker to start');
    releases[0]();
    await reads[0];
    assert.equal(opened, false, 'The second refresh must also finish before reuse');
    releases[1]();
    await reads[1];
    const workers = await openings;
    assert.ok(workers.every(worker => worker === empty));
    assert.equal(transports.length, 1);
    assert.equal(empty.operations, 0);
  } finally {
    for (const release of releases) release();
    await Promise.allSettled([...reads, openings]);
    await pool.stopAll();
  }
});

test('waiting for a snapshot rechecks history, activity, operations and worker membership', async () => {
  for (const change of ['history', 'running', 'approval', 'mutating', 'operation', 'failed', 'removed']) {
    const { pool, transports, open } = fixture();
    const empty = await open('workspace');
    const original = transports[0].request.bind(transports[0]);
    let release!: () => void;
    transports[0].request = async type => {
      if (type === 'get_messages') await new Promise<void>(resolve => { release = resolve; });
      return original(type);
    };
    const read = pool.read(empty);
    const opening = open('workspace');
    try {
      await Promise.resolve();
      assert.equal(transports.length, 1, change);
      if (change === 'history') transports[0].receive({ type: 'message_start', message: { role: 'user', content: 'new message' } });
      if (change === 'running') transports[0].receive({ type: 'agent_start' });
      if (change === 'approval') transports[0].receive({ type: 'extension_ui_request', method: 'confirm', id: 'approval' });
      if (change === 'mutating') empty.mutating = true;
      if (change === 'operation') empty.operations++;
      if (change === 'failed') empty.failed = true;
      if (change === 'removed') await pool.remove(empty);
      release();
      await read;
      assert.notEqual(await opening, empty, change);
      assert.equal(transports.length, 2, change);
    } finally {
      release();
      await Promise.allSettled([read, opening]);
      await pool.stopAll();
    }
  }
});

test('a non-snapshot operation alongside a read is not treated as a reusable empty worker', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const original = transports[0].request.bind(transports[0]);
  let release!: () => void;
  transports[0].request = async type => {
    if (type === 'get_messages') await new Promise<void>(resolve => { release = resolve; });
    return original(type);
  };
  const read = pool.read(empty);
  empty.operations++;
  try {
    assert.notEqual(await open('workspace'), empty);
    assert.equal(transports.length, 2);
  } finally {
    release();
    await read;
    await pool.stopAll();
  }
});

test('failed snapshot reads reject waiting opens without spawning and release their bookkeeping', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const original = transports[0].request.bind(transports[0]);
  let fail!: (error: Error) => void;
  transports[0].request = async type => {
    if (type === 'get_messages') await new Promise<void>((_resolve, reject) => { fail = reject; });
    return original(type);
  };
  const read = pool.read(empty);
  const reading = assert.rejects(read, /Snapshot failed/);
  const opening = assert.rejects(open('workspace'), /Snapshot failed/);
  fail(new Error('Snapshot failed'));
  await Promise.all([reading, opening]);
  assert.equal(transports.length, 1);
  assert.equal(empty.operations, 0);
  transports[0].request = original;
  await pool.read(empty);
  assert.equal(await open('workspace'), empty);
  await pool.stopAll();
});

test('new sessions reuse background empties only in the same workspace', async () => {
  const { pool, transports, open } = fixture();
  const a = await open('workspace-a');
  const b = await open('workspace-b');
  assert.notEqual(a, b);
  assert.equal(await open('workspace-a'), a);
  assert.equal(pool.active, a);
  assert.equal(transports.length, 2);
  a.messages = [{ role: 'user', content: 'saved' }];
  const next = await open('workspace-a');
  assert.notEqual(next, a);
  assert.equal(await open('workspace-a'), next);
  assert.equal(transports.length, 3);
  await pool.stopAll();
});

test('restoring a saved session never reuses an unrelated empty worker', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const restored = await pool.open('node', 'step', 'workspace', {}, 'saved.jsonl');
  assert.notEqual(restored, empty);
  assert.ok(transports[1].calls.includes('switch_session'));
  await pool.stopAll();
});

test('busy, modifying, failed and disconnected empty workers are not reused', async () => {
  const states = [
    { busy: true }, { submissions: 1 }, { operations: 1 }, { mutating: true },
    { failed: true }, { interrupted: true }, { status: 'disconnected' },
  ];
  for (const state of states) {
    const { pool, transports, open } = fixture();
    const old = await open('workspace');
    Object.assign(old, state);
    assert.notEqual(await open('workspace'), old, JSON.stringify(state));
    assert.equal(transports[0].stopped, false);
    await pool.stopAll();
  }
  for (const state of [{ isCompacting: true }, { pendingMessageCount: 1 }, { isStreaming: true }]) {
    const { pool, open } = fixture();
    const old = await open('workspace');
    Object.assign(old.state!, state);
    assert.notEqual(await open('workspace'), old);
    await pool.stopAll();
  }
  const { pool, transports, open } = fixture();
  const old = await open('workspace');
  transports[0].receive({ type: 'extension_ui_request', method: 'confirm', id: 'approval' });
  assert.notEqual(await open('workspace'), old);
  assert.equal(old.pendingUI.size, 1);
  await pool.stopAll();
});

test('failed empty-worker startup is released so a later new session can retry', async () => {
  const { pool, transports, open } = fixture();
  const first = open('workspace');
  transports[0].request = async () => { throw new Error('Startup failed'); };
  await assert.rejects(first, /Startup failed/);
  assert.equal(pool.workers.size, 0);
  assert.equal(transports[0].stopped, true);
  const next = await open('workspace');
  assert.equal(pool.active, next);
  assert.equal(transports.length, 2);
  await pool.stopAll();
});

function branchFixture(outcome: 'success' | 'cancelled' | 'changed' = 'success') {
  const transports: Transport[] = [];
  const events: RuntimeEvent[] = [];
  const history = [{ id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'question', timestamp: 1 } },
    { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'answer', timestamp: 2 } }];
  const pool = new SessionRuntimes(event => events.push(event), receive => {
    const transport = new Transport(receive, 'source');
    let branched = false;
    transport.request = async (type, args) => {
      transport.calls.push(type);
      if (type === 'get_state') return { sessionId: branched ? 'branch' : 'source', sessionFile: 'source.jsonl', isStreaming: false };
      if (type === 'get_messages') return { messages: branched && transport.calls.includes('fork') ? [] : history.map(entry => entry.message) };
      if (type === 'get_entries') return { entries: history, leafId: outcome === 'changed' && transports.length > 1 ? 'u1' : 'a1' };
      if (type === 'get_available_models') return { models: [] };
      if (type === 'get_commands') return { commands: [{ name: 'permissions', source: 'extension' }] };
      if (type === 'prompt') assert.equal(args?.message, '/permissions read-only');
      if (type === 'clone' || type === 'fork') {
        branched = outcome !== 'cancelled';
        return { cancelled: outcome === 'cancelled' };
      }
      return {};
    };
    transports.push(transport);
    return transport;
  });
  return { pool, transports, events };
}

function retryFixture(outcome: 'success' | 'cancelled' | 'unsupported' | 'rejected' = 'success') {
  const events: RuntimeEvent[] = [];
  const image = { type: 'image', mimeType: 'image/png', data: 'fixture' };
  const entries = [
    { id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'same', timestamp: 1 } },
    { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'earlier', timestamp: 2 } },
    { id: 'u2', parentId: 'a1', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'same' }, image], timestamp: 3 } },
    { id: 'a2', parentId: 'u2', type: 'message', message: { role: 'assistant', content: 'discarded', timestamp: 4 } },
  ];
  let leafId = 'a2';
  const submitted: Record<string, unknown>[] = [];
  const pool = new SessionRuntimes(event => events.push(event), receive => {
    const transport = new Transport(receive, 'source');
    transport.request = async (type, args) => {
      if (type === 'get_state') return { sessionId: 'source', sessionFile: 'source.jsonl', isStreaming: false };
      if (type === 'get_entries') return { entries, leafId };
      if (type === 'get_messages') return { messages: leafId === 'a1' ? entries.slice(0, 2).map(entry => entry.message) : entries.map(entry => entry.message) };
      if (type === 'get_available_models') return { models: [] };
      if (type === 'get_commands') return { commands: outcome === 'unsupported' ? [] : [{ name: '_desktop_retry', source: 'extension' }] };
      if (type === 'switch_session') { leafId = 'a2'; return {}; }
      if (type === 'prompt') {
        if (args?.message === '/_desktop_retry u2') {
          if (outcome !== 'cancelled') leafId = 'a1';
        } else if (args?.message !== '/permissions read-only') {
          submitted.push(args!);
          if (outcome === 'rejected') throw new Error('Submission rejected');
          assert.equal(events.some(event => event.type === 'desktop_history'), true);
        }
      }
      return {};
    };
    return transport;
  });
  return { pool, events, submitted, image };
}

test('retry stays in the same worker/session, excludes the old turn and retains images', async () => {
  const { pool, events, submitted, image } = retryFixture();
  const worker = await pool.open('node', 'step', 'cwd', {});
  worker.permissionPreset = 'read-only';
  await pool.retryLatest(worker, 'u2', 'edited');
  assert.equal(pool.active, worker);
  assert.equal(pool.workers.size, 1);
  assert.equal(worker.state?.sessionId, 'source');
  assert.equal(worker.permissionPreset, 'read-only');
  assert.deepEqual(events.find(event => event.type === 'desktop_history')?.messages.map((message: { content: unknown }) => message.content), ['same', 'earlier']);
  assert.deepEqual(submitted, [{ message: 'edited', images: [image] }]);
  assert.equal(worker.submissions, 0);
});
test('retry rejects old and forged entries before navigating', async () => {
  const { pool, events, submitted } = retryFixture();
  const worker = await pool.open('node', 'step', 'cwd', {});
  await assert.rejects(pool.retryLatest(worker, 'u1', 'edited'), /most recent/);
  await assert.rejects(pool.retryLatest(worker, 'forged', 'edited'), /most recent/);
  assert.equal(events.some(event => event.type === 'desktop_history'), false);
  assert.deepEqual(submitted, []);
});
test('cancelled navigation never submits an edited prompt', async () => {
  const { pool, submitted } = retryFixture('cancelled');
  const worker = await pool.open('node', 'step', 'cwd', {});
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /restore the edit point/);
  assert.equal(worker.messages.length, 4);
  assert.deepEqual(submitted, []);
});
test('missing edit extension and busy workers fail before history changes', async () => {
  const { pool, submitted } = retryFixture('unsupported');
  const worker = await pool.open('node', 'step', 'cwd', {});
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /does not support/);
  worker.busy = true;
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /Stop/);
  assert.equal(worker.messages.length, 4);
  assert.deepEqual(submitted, []);
});
test('rejected submission without a persisted user turn restores history and permissions', async () => {
  const { pool, events } = retryFixture('rejected');
  const worker = await pool.open('node', 'step', 'cwd', {});
  worker.permissionPreset = 'read-only';
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /Submission rejected/);
  assert.equal(worker.leafId, 'a2');
  assert.equal(worker.messages.length, 4);
  assert.equal(events.filter(event => event.type === 'desktop_history').length, 2);
  assert.equal(worker.submissions, 0);
});

test('clone is prepared in a different worker and preserves the source and permissions', async () => {
  const { pool, transports } = branchFixture();
  const source = await pool.open('node', 'step', 'cwd', {});
  const originalMessages = source.messages;
  const branch = await pool.open('node', 'step', 'cwd', {}, 'source.jsonl',
    { kind: 'clone', entryId: 'a1', leafId: 'a1', permissionPreset: 'read-only' });
  assert.notEqual(branch.id, source.id);
  assert.equal(pool.active, branch);
  assert.equal(source.state?.sessionId, 'source');
  assert.equal(source.messages, originalMessages);
  assert.equal(transports[0].calls.includes('clone'), false);
  assert.equal(transports[1].calls.includes('clone'), true);
  assert.equal(transports[1].calls.includes('prompt'), true);
  assert.equal(transports[0].stopped, false);
  await pool.stopAll();
});

test('prepared copies open without cloning or clearing the source unread state', async () => {
  const { pool, transports, open } = fixture();
  const source = await open();
  pool.unreadSessionIds.add(source.state!.sessionId!);
  const copy = await pool.open('node', 'step', 'cwd', {}, 'copy.jsonl',
    { kind: 'open-copy', sessionId: 'session-1', name: 'Copied session' });
  assert.notEqual(copy.id, source.id);
  assert.equal(pool.active, copy);
  assert.equal(pool.unreadSessionIds.has(source.state!.sessionId!), true);
  assert.equal(transports[0].calls.includes('clone'), false);
  assert.equal(transports[1].calls.includes('clone'), false);
  assert.equal(transports[1].calls.includes('switch_session'), true);
  assert.equal(transports[0].stopped, false);
  await pool.stopAll();
});

test('prepared copies reject a mismatched saved identity without replacing the active worker', async () => {
  const { pool, transports, open } = fixture();
  const source = await open();
  await assert.rejects(pool.open('node', 'step', 'cwd', {}, 'copy.jsonl',
    { kind: 'open-copy', sessionId: 'forged' }), /identity changed/);
  assert.equal(pool.active, source);
  assert.equal(pool.workers.size, 1);
  assert.equal(transports[1].stopped, true);
  await pool.stopAll();
});

test('fork prepares a new empty route without the selected question or answer', async () => {
  const { pool, transports } = branchFixture();
  const source = await pool.open('node', 'step', 'cwd', {});
  const branch = await pool.open('node', 'step', 'cwd', {}, 'source.jsonl', { kind: 'fork', entryId: 'u1', leafId: 'a1' });
  assert.deepEqual(branch.messages, []);
  assert.equal(source.messages.length, 2);
  assert.equal(transports[0].calls.includes('fork'), false);
  await pool.stopAll();
});

test('cancelled or stale branches dispose the new worker and leave the source active', async () => {
  for (const outcome of ['cancelled', 'changed'] as const) {
    const { pool, transports } = branchFixture(outcome);
    const source = await pool.open('node', 'step', 'cwd', {});
    await assert.rejects(pool.open('node', 'step', 'cwd', {}, 'source.jsonl',
      { kind: 'clone', entryId: 'a1', leafId: 'a1' }), /cancelled|changed/);
    assert.equal(pool.active, source);
    assert.equal(pool.workers.size, 1);
    assert.equal(transports[1].stopped, true);
    assert.equal(transports[0].stopped, false);
    await pool.stopAll();
  }
});

test('session workers append shared-workspace rules without replacing project or product instructions', async () => {
  const { pool, transports, open } = fixture();
  await open();
  assert.deepEqual(transports[0].startArgs, ['--append-system-prompt', WORKSPACE_POLICY]);
  assert.ok(WORKSPACE_POLICY.includes('Re-read the current file'));
  assert.ok(WORKSPACE_POLICY.includes('paths or hunks'));
  assert.ok(WORKSPACE_POLICY.includes('do not assume'));
  await pool.stopAll();
});

test('workers keep separate histories and approvals across navigation and targeted stop', async () => {
  const { pool, transports, events, open } = fixture();
  const a = await open();
  transports[0].receive({ type: 'agent_start' });
  const b = await open('other');
  transports[1].receive({ type: 'agent_start' });
  transports[0].receive({ type: 'message_start', message: { role: 'user', content: 'only A', timestamp: 1 } });
  transports[1].receive({ type: 'message_start', message: { role: 'user', content: 'only B', timestamp: 2 } });
  transports[0].receive({ type: 'extension_ui_request', method: 'confirm', id: 'same-id' });
  transports[1].receive({ type: 'extension_ui_request', method: 'confirm', id: 'same-id' });
  assert.equal(pool.active, b);
  assert.equal(a.messages[0].content, 'only A');
  assert.equal(b.messages[0].content, 'only B');
  assert.equal(a.pendingUI.get('same-id')?.runtimeId, a.id);
  assert.equal(b.pendingUI.get('same-id')?.runtimeId, b.id);
  assert.deepEqual(pool.summaries().map(summary => summary.status), ['waiting', 'waiting']);
  await pool.require(b.id).rpc.request('abort');
  assert.ok(transports[1].calls.includes('abort'));
  assert.ok(!transports[0].calls.includes('abort'));
  assert.equal(transports[0].stopped, false);
  assert.ok(events.some(event => event.type === 'message_start' && event.runtimeId === a.id));
  await assert.rejects(pool.assertAllIdle(), /Stop/);
  await pool.stopAll();
});

test('disposed workers cannot deliver late events or receive stale commands', async () => {
  const { pool, transports, events, open } = fixture();
  const a = await open();
  await pool.remove(a);
  const before = events.length;
  transports[0].receive({ type: 'desktop_exit' });
  transports[0].receive({ type: 'message_start', message: { role: 'user', content: 'stale' } });
  assert.equal(events.length, before);
  assert.throws(() => pool.require(a.id), /not connected/);
});

test('crash is session scoped and leaves other running workers intact', async () => {
  const { pool, transports, open } = fixture();
  const a = await open();
  const b = await open();
  transports[1].receive({ type: 'agent_start' });
  transports[0].receive({ type: 'desktop_exit', code: 1 });
  assert.equal(a.status, 'disconnected');
  assert.equal(b.status, 'connected');
  assert.equal(pool.running, true);
  assert.deepEqual(pool.summaries().map(summary => summary.status), ['failed', 'running']);
  await pool.stopAll();
});

test('idle recycling retains active, running, pending and unpersisted workers', async () => {
  const { pool, transports, open } = fixture();
  const old = await open();
  old.messages = [{ role: 'user', content: 'persisted' }]; old.touched = 0;
  const running = await open();
  transports[1].receive({ type: 'agent_start' });
  const pending = await open();
  transports[2].receive({ type: 'extension_ui_request', method: 'confirm', id: 'approval' });
  const empty = await open();
  const active = await open();
  await pool.recycle();
  assert.ok(transports[0].stopped);
  for (const worker of [running, pending, empty, active]) assert.equal(pool.workers.get(worker.id), worker);
  await pool.stopAll();
});

test('snapshot read cannot overwrite a message arriving while queries are pending', async () => {
  const { pool, transports, open } = fixture();
  const a = await open();
  const original = transports[0].request.bind(transports[0]);
  let release!: () => void;
  transports[0].request = async type => {
    if (type === 'get_messages') await new Promise<void>(resolve => { release = resolve; });
    return original(type);
  };
  const read = pool.read(a);
  transports[0].receive({ type: 'agent_start' });
  transports[0].receive({ type: 'message_start', message: { role: 'user', content: 'new delta' } });
  release(); await read;
  assert.equal(a.messages[0].content, 'new delta');
  assert.equal(a.busy, true);
  await pool.stopAll();
});

test('background request timeout expires only its own worker and is not reset by navigation', async () => {
  const { pool, transports, events, open } = fixture();
  const a = await open();
  transports[0].receive({ type: 'extension_ui_request', method: 'confirm', id: 'timed', timeout: 20 });
  const b = await open();
  transports[1].receive({ type: 'extension_ui_request', method: 'confirm', id: 'timed' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(a.pendingUI.size, 0);
  assert.equal(b.pendingUI.size, 1);
  assert.deepEqual(transports[0].answers, [{ id: 'timed', cancelled: true }]);
  assert.deepEqual(transports[1].answers, []);
  assert.ok(events.some(event => event.type === 'desktop_ui_expired' && event.runtimeId === a.id));
  await pool.stopAll();
});

test('reading committed history during a stream preserves the live assistant message', async () => {
  const { pool, transports, open } = fixture();
  const a = await open();
  transports[0].receive({ type: 'agent_start' });
  transports[0].receive({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: 'live text' }] } });
  const original = transports[0].request.bind(transports[0]);
  transports[0].request = async type => type === 'get_state' ? { sessionId: 'session-0', sessionFile: 'session-0.jsonl', isStreaming: true } : original(type);
  await pool.read(a);
  assert.equal(JSON.stringify(a.messages), '[{"role":"assistant","content":[{"type":"text","text":"live text"}]}]');
  assert.equal(a.busy, true);
  await pool.stopAll();
});

test('successful background completion emits sound event once, never from restored history', async () => {
  const { pool, transports, events, open } = fixture();
  const a = await open();
  await open('foreground');
  transports[0].receive({ type: 'agent_start' });
  transports[0].receive({ type: 'message_end', message: { role: 'assistant', content: 'done', stopReason: 'stop' } });
  transports[0].receive({ type: 'agent_end' });
  transports[0].receive({ type: 'agent_end' });
  const completed = events.filter(event => event.type === 'desktop_task_completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].runtimeId, a.id);
  assert.equal(pool.summaries()[0].status, 'completed');
  assert.ok(pool.unreadSessionIds.has(a.state!.sessionId!));
  assert.equal(taskOutcome([{ role: 'assistant', content: 'history', stopReason: 'stop' }]), 'completed');
  await pool.read(a);
  assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 1);
  const calls = transports[0].calls.length;
  pool.activate(a);
  assert.equal(transports[0].calls.length, calls, 'Activating a resident worker does not query RPC');
  assert.equal(pool.summaries()[0].status, 'idle');
  assert.equal(pool.unreadSessionIds.size, 0);
  await pool.stopAll();
});

test('foreground completion and restored successful history do not create unread dots', async () => {
  const { pool, transports, open } = fixture();
  const a = await open();
  a.messages = [{ role: 'assistant', content: 'old reply', stopReason: 'stop' }];
  assert.equal(pool.summaries()[0].status, 'idle');
  transports[0].receive({ type: 'agent_start' });
  transports[0].receive({ type: 'message_end', message: { role: 'assistant', content: 'new reply', stopReason: 'stop' } });
  transports[0].receive({ type: 'agent_end' });
  assert.equal(pool.summaries()[0].status, 'idle');
  assert.equal(pool.unreadSessionIds.size, 0);
  await pool.stopAll();
});

test('unread completion survives worker recycling and clears when the session reopens', async () => {
  const { pool, transports, open } = fixture();
  const a = await open();
  await open('other');
  transports[0].receive({ type: 'agent_start' });
  transports[0].receive({ type: 'message_end', message: { role: 'assistant', content: 'done', stopReason: 'stop' } });
  transports[0].receive({ type: 'agent_end' });
  const sessionId = a.state!.sessionId!;
  await pool.remove(a);
  assert.ok(pool.unreadSessionIds.has(sessionId));
  const replacement = await open();
  replacement.state = { ...replacement.state!, sessionId };
  pool.activate(replacement);
  assert.ok(!pool.unreadSessionIds.has(sessionId));
  await pool.stopAll();
});

test('abort, error, truncation and process exit never signal successful completion', async () => {
  for (const reason of ['aborted', 'error', 'length', 'manual', 'crash']) {
    const { pool, transports, events, open } = fixture();
    const worker = await open();
    transports[0].receive({ type: 'agent_start' });
    if (reason === 'manual') worker.interrupted = true;
    transports[0].receive({ type: 'message_end', message: { role: 'assistant', content: 'partial', stopReason: reason === 'manual' || reason === 'crash' ? 'stop' : reason } });
    if (reason === 'crash') transports[0].receive({ type: 'desktop_exit', code: 1 });
    transports[0].receive({ type: 'agent_end' });
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0, reason);
    assert.ok(['failed', 'interrupted'].includes(pool.summaries()[0].status), reason);
    await pool.stopAll();
  }
});
