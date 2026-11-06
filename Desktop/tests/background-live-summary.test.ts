import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import { BackgroundAgents } from '../electron/background-agents';

class Transport implements WorkerTransport {
  reads = 0;
  held?: (value: any) => void;
  delay = false;
  constructor(readonly receive: (event: any) => void) {}
  start() {} respond() {} async stop() {}
  async request(type: string) {
    if (type === 'get_state') return { sessionId: 'session-a', sessionFile: 'session-a.jsonl', isStreaming: false };
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    if (type === 'desktop_subagents') {
      this.reads++;
      if (this.delay) return new Promise(resolve => { this.held = resolve; });
      return { sessionId: 'session-a', lanes: [] };
    }
    return {};
  }
}
function fixture() {
  let transport!: Transport;
  const pool = new SessionRuntimes(() => {}, receive => transport = new Transport(receive));
  return { pool, transport: () => transport };
}

test('successful observation records an empty display snapshot without changing live ownership', async () => {
  const f = fixture();
  try {
    const host = await f.pool.open('node', 'step', 'workspace', {});
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'unavailable' });
    await f.pool.readBackground(host);
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'known', lanes: [] });
    assert.equal(host.backgroundActive, false);
    assert.equal(host.backgroundLanes, undefined);
    assert.equal(f.transport().reads, 1);
  } finally { await f.pool.stopAll(); }
});

test('a delayed empty read cannot clear a newer running or settling live owner', async () => {
  for (const status of ['running', 'settling']) {
    const f = fixture();
    try {
      const host = await f.pool.open('node', 'step', 'workspace', {});
      f.transport().delay = true;
      const read = f.pool.readBackground(host);
      f.transport().receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-subagents',
        statusText: JSON.stringify({ version: 1, lanes: [{ id: 'lane_12345678', status }] }) });
      f.transport().held!({ sessionId: 'session-a', lanes: [] });
      await assert.rejects(read, /ownership changed/);
      assert.equal(host.backgroundActive, true);
      assert.deepEqual(f.pool.summaries()[0].background, { status: 'known', lanes: [{ id: 'lane_12345678', status }] });
      await assert.rejects(f.pool.assertBackgroundIdle(host), /background agents/);
    } finally { await f.pool.stopAll(); }
  }
});

test('malformed ownership and stale disconnected replies fail closed', async () => {
  const f = fixture();
  try {
    const host = await f.pool.open('node', 'step', 'workspace', {});
    await f.pool.readBackground(host);
    f.transport().receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-subagents', statusText: '{invalid' });
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'unavailable' });
    await assert.rejects(f.pool.assertBackgroundIdle(host), /background agents/);
    f.transport().delay = true;
    const read = f.pool.readBackground(host);
    await f.pool.suspend([host]);
    f.transport().held!({ sessionId: 'session-a', lanes: [] });
    await assert.rejects(read, /ownership changed/);
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'unavailable' });
  } finally { await f.pool.stopAll(); }
});

test('structured notifications and agent_send results invalidate earlier observations', async () => {
  const messages = [
    { role: 'custom', customType: 'agent-notification', content: 'Done', details: { agentId: 'lane_12345678', event: 'background_done', status: 'completed' } },
    { role: 'toolResult', toolName: 'agent_send', content: 'Reply', details: [{ agentId: 'lane_12345678', status: 'running' }] },
  ];
  for (const message of messages) {
    const f = fixture();
    try {
      const host = await f.pool.open('node', 'step', 'workspace', {});
      await f.pool.readBackground(host);
      f.transport().receive({ type: 'message_end', message });
      assert.deepEqual(f.pool.summaries()[0].background, { status: 'unavailable' });
      assert.equal(host.backgroundActive, false);
      assert.equal(host.backgroundLanes, undefined);
    } finally { await f.pool.stopAll(); }
  }
});

test('manual replies discard pre-action observations and never release live ownership', async () => {
  const f = fixture();
  try {
    const host = await f.pool.open('node', 'step', 'workspace', {});
    await f.pool.readBackground(host);
    let release!: (value: unknown) => void;
    const original = f.transport().request.bind(f.transport());
    f.transport().request = async (type: string, args?: Record<string, unknown>) => {
      if (type === 'desktop_subagents' && args?.action === 'reply') return new Promise(resolve => { release = resolve; });
      return original(type);
    };
    const client = new BackgroundAgents(f.pool.workers, undefined, true, true);
    const replying = f.pool.withBackgroundAction(host, () => client.reply({ runtimeId: host.id, sessionId: 'session-a',
      laneId: 'lane_12345678', requestId: '12345678-1234-1234-1234-123456789abc', prompt: 'Continue' }));
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'unavailable' });
    release({ sessionId: 'session-a', laneId: 'lane_12345678', requestId: '12345678-1234-1234-1234-123456789abc', delivery: 'started' });
    await replying;
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'unavailable' });
    assert.equal(host.backgroundActive, false);
    assert.equal(host.backgroundLanes, undefined);
  } finally { await f.pool.stopAll(); }
});

test('unconfirmed manual replies invalidate any observations taken during delivery', async () => {
  const f = fixture();
  try {
    const host = await f.pool.open('node', 'step', 'workspace', {});
    const failure = new Error('Unconfirmed reply');
    await assert.rejects(f.pool.withBackgroundAction(host, async () => {
      await f.pool.readBackground(host);
      throw failure;
    }), error => error === failure);
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'unavailable' });
    assert.equal(host.backgroundActive, false);
  } finally { await f.pool.stopAll(); }
});

test('internal observation works under mutation locks without granting live ownership', async () => {
  const f = fixture();
  try {
    const host = await f.pool.open('node', 'step', 'workspace', {});
    host.mutating = true;
    await f.pool.assertBackgroundIdle(host);
    assert.deepEqual(f.pool.summaries()[0].background, { status: 'known', lanes: [] });
    assert.equal(host.backgroundLanes, undefined);
    host.mutating = false;
  } finally { await f.pool.stopAll(); }
});
