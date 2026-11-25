import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import assert from 'node:assert/strict';
import test from 'node:test';

class DelayedTransport implements WorkerTransport {
  release?: (value: any) => void;
  constructor(readonly receive: (event: any) => void) {}
  start() {} respond() {} async stop() {}
  async request(type: string) {
    if (type === 'get_state') return { sessionId: 'session-a', sessionFile: 'session-a.jsonl', isStreaming: false };
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    if (type === 'desktop_subagents') return new Promise(resolve => { this.release = resolve; });
    return {};
  }
}

test('a running lane in the read result blocks movement without changing event-owned fields', async () => {
  let transport!: DelayedTransport;
  const pool = new SessionRuntimes(() => {}, receive => transport = new DelayedTransport(receive));
  try {
    const host = await pool.open('node', 'step', 'workspace', {});
    const guard = pool.assertBackgroundIdle(host);
    await new Promise(resolve => setImmediate(resolve));
    transport.release!({ sessionId: 'session-a', lanes: [{ agentId: 'lane_12345678', mode: 'single', status: 'running', results: [] }] });
    await assert.rejects(guard, /background agents/);
    assert.equal(host.backgroundActive, false);
    assert.equal(host.backgroundLanes, undefined);
  } finally { await pool.stopAll(); }
});

test('a disconnected source may move after normal idle guards without querying a dead transport', async () => {
  let transport!: DelayedTransport;
  const pool = new SessionRuntimes(() => {}, receive => transport = new DelayedTransport(receive));
  try {
    const host = await pool.open('node', 'step', 'workspace', {});
    await pool.suspend([host]);
    await pool.assertBackgroundIdle(host, { allowDisconnected: true });
    assert.equal(transport.release, undefined);
    host.queued = true;
    await assert.rejects(pool.assertBackgroundIdle(host, { allowDisconnected: true }), /pending messages/);
    host.queued = false;
    await assert.rejects(pool.assertBackgroundIdle(host), /not connected/);
  } finally { await pool.stopAll(); }
});

test('an unavailable background registry blocks movement and keeps history intact', async () => {
  const transport: WorkerTransport = { start() {}, respond() {}, async stop() {}, async request(type) {
    if (type === 'get_state') return { sessionId: 'session-a', isStreaming: false };
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    if (type === 'desktop_subagents') throw new Error('registry unavailable');
    return {};
  } };
  const pool = new SessionRuntimes(() => {}, () => transport);
  try {
    const host = await pool.open('node', 'step', 'workspace', {});
    host.messages = [{ role: 'user', content: 'Keep history' }];
    const before = structuredClone(host.messages);
    await assert.rejects(pool.assertBackgroundIdle(host), /unavailable/);
    assert.deepEqual(host.messages, before);
  } finally { await pool.stopAll(); }
});

test('a prepared destination can recheck once but requires a fresh, idle command state', async () => {
  let receive!: (event: any) => void;
  let getState = () => ({ sessionId: 'session-a', isStreaming: false, desktopBackgroundCommands: { version: 1, count: 0 } });
  const transport: WorkerTransport = { start() {}, respond() {}, async stop() {}, async request(type) {
    if (type === 'get_state') return getState();
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    if (type === 'desktop_subagents') return { sessionId: 'session-a', lanes: [] };
    return {};
  } };
  const pool = new SessionRuntimes(() => {}, handler => { receive = handler; return transport; },
    { backgroundCommandsAvailable: () => true });
  try {
    const host = await pool.prepare('node', 'step', 'destination', {}, 'session-a.jsonl');
    const zero = getState();
    const changed = () => receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'fixture-startup' });
    const destination = { recheckChangedCommandState: true };
    let reads = 0;
    getState = () => { if (++reads === 1) changed(); return zero; };
    await pool.assertBackgroundIdle(host, destination);
    assert.equal(reads, 3, 'recheck the first snapshot and still verify again after the lane read');

    reads = 0;
    getState = () => { changed(); reads++; return zero; };
    await assert.rejects(pool.assertBackgroundIdle(host, destination), /Cannot verify background commands/);
    assert.equal(reads, 2, 'continued state changes fail closed');

    reads = 0;
    getState = () => {
      if (++reads === 1) { changed(); return zero; }
      return { ...zero, desktopBackgroundCommands: { version: 1, count: 1 } };
    };
    await assert.rejects(pool.assertBackgroundIdle(host, destination), /Stop background commands/);
    assert.equal(reads, 2, 'never accept a fresh snapshot with a live command');
  } finally { await pool.stopAll(); }
});
