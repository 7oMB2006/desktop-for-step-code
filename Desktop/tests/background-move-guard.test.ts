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
