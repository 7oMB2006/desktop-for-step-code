import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import type { RuntimeEvent } from '../src/contracts';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let receive!: (event: RuntimeEvent) => void;
  let stats: () => Promise<any> = async () => ({ tokens: { total: 100 } });
  const events: RuntimeEvent[] = [];
  const pool = new SessionRuntimes(event => events.push(event), callback => {
    receive = callback;
    return {
      start() {}, stop: async () => {}, respond() {},
      request: async type => {
        if (type === 'get_state') return { sessionId: 'clm-session', isStreaming: false };
        if (type === 'get_messages') return { messages: [] };
        if (type === 'get_available_models') return { models: [] };
        if (type === 'get_session_stats') return stats();
        return {};
      },
    } satisfies WorkerTransport;
  });
  return { pool, events, receive: (event: RuntimeEvent) => receive(event), setStats: (read: typeof stats) => { stats = read; } };
}

for (const role of ['assistant', 'toolResult'] as const) {
  test(`${role} completion refreshes context usage before the active turn ends`, async () => {
    const f = fixture();
    const worker = await f.pool.open('node', 'step', 'workspace', {});
    try {
      f.receive({ type: 'agent_start' });
      const totals = { tokens: { total: 5798300 }, contextUsage: { tokens: 180000, contextWindow: 1000000, percent: 18 } };
      let reads = 0;
      f.setStats(async () => { reads++; return totals; });
      const message = { role, content: [{ type: 'text', text: 'Live context grows during a long task' }] };
      f.receive({ type: 'message_start', message });
      f.receive({ type: 'message_update', message });
      await tick();
      assert.equal(reads, 0, 'Streaming deltas must not flood the RPC stats endpoint');
      f.receive({ type: 'message_end', message });
      await tick();
      assert.equal(reads, 1);
      assert.deepEqual(worker.stats, totals);
      assert.equal(worker.busy, true, 'Updating usage must not end the active turn');
      assert.equal(worker.messages.at(-1)?.content, message.content);
      assert.equal(worker.operations, 0);
      const event = f.events.filter(event => event.type === 'desktop_stats').at(-1);
      assert.equal(event?.runtimeId, worker.id);
      assert.equal(event?.sessionId, worker.state?.sessionId);
      assert.deepEqual(event?.stats, totals, 'Publish current occupancy, not cumulative input tokens');
    } finally { await f.pool.stopAll(); }
  });
}

test('a delayed message usage read cannot overwrite a newer tool-result usage read', async () => {
  const f = fixture();
  const worker = await f.pool.open('node', 'step', 'workspace', {});
  try {
    f.receive({ type: 'agent_start' });
    let release!: (value: unknown) => void;
    f.setStats(() => new Promise(resolve => { release = resolve; }));
    f.receive({ type: 'message_end', message: { role: 'assistant', content: 'Read a file' } });
    assert.equal(typeof release, 'function', 'Message completion must request updated statistics');
    const totals = { tokens: { total: 900 }, contextUsage: { tokens: 600, contextWindow: 1000, percent: 60 } };
    f.setStats(async () => totals);
    f.receive({ type: 'message_end', message: { role: 'toolResult', content: 'File content' } });
    await tick();
    assert.equal(f.events.some(event => event.type === 'desktop_stats'), false);
    release({ tokens: { total: 200 }, contextUsage: { tokens: 20, contextWindow: 1000, percent: 2 } });
    await tick();
    assert.deepEqual(worker.stats, totals);
    assert.equal(f.events.filter(event => event.type === 'desktop_stats').length, 1);
    assert.equal(worker.busy, true);
    assert.equal(worker.operations, 0);
  } finally { await f.pool.stopAll(); }
});

test('a burst of message completions coalesces into one follow-up statistics request', async () => {
  const f = fixture();
  const worker = await f.pool.open('node', 'step', 'workspace', {});
  try {
    let release!: (value: unknown) => void;
    let reads = 0;
    const totals = { tokens: { total: 900 }, contextUsage: { tokens: 600, contextWindow: 1000, percent: 60 } };
    f.setStats(() => {
      reads++;
      return reads === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(totals);
    });
    f.receive({ type: 'agent_start' });
    for (let index = 0; index < 20; index++)
      f.receive({ type: 'message_end', message: { role: 'toolResult', content: `Result ${index}` } });
    assert.equal(reads, 1);
    assert.equal(worker.operations, 1);
    release({ tokens: { total: 200 } });
    await tick();
    assert.equal(reads, 2);
    assert.deepEqual(worker.stats, totals);
    assert.equal(worker.operations, 0);
    assert.equal(f.events.filter(event => event.type === 'desktop_stats').length, 1);
  } finally { await f.pool.stopAll(); }
});

test('newer changes still refresh when the in-flight statistics request fails', async () => {
  const f = fixture();
  const worker = await f.pool.open('node', 'step', 'workspace', {});
  try {
    let reject!: (error: Error) => void;
    f.setStats(() => new Promise((_resolve, fail) => { reject = fail; }));
    f.receive({ type: 'message_end', message: { role: 'assistant', content: 'First' } });
    const totals = { tokens: { total: 400 } };
    f.setStats(async () => totals);
    f.receive({ type: 'message_end', message: { role: 'toolResult', content: 'Latest' } });
    reject(new Error('Earlier read failed'));
    await tick();
    assert.deepEqual(worker.stats, totals);
    assert.equal(worker.operations, 0);
  } finally { await f.pool.stopAll(); }
});

test('a slow snapshot cannot overwrite a newer coalesced statistics read', async () => {
  const f = fixture();
  const worker = await f.pool.open('node', 'step', 'workspace', {});
  try {
    let releaseFirst!: (value: unknown) => void;
    f.setStats(() => new Promise(resolve => { releaseFirst = resolve; }));
    f.receive({ type: 'message_end', message: { role: 'assistant', content: 'First' } });
    f.receive({ type: 'message_end', message: { role: 'toolResult', content: 'New content' } });
    let releaseSnapshot!: (value: unknown) => void;
    f.setStats(() => new Promise(resolve => { releaseSnapshot = resolve; }));
    const snapshot = f.pool.read(worker);
    const totals = { tokens: { total: 600 } };
    f.setStats(async () => totals);
    releaseFirst({ tokens: { total: 200 } });
    await tick();
    assert.deepEqual(worker.stats, totals);
    releaseSnapshot({ tokens: { total: 400 } });
    await snapshot;
    assert.deepEqual(worker.stats, totals);
    assert.equal(worker.operations, 0);
  } finally { await f.pool.stopAll(); }
});

test('turn completion publishes unknown context without inventing a percentage', async () => {
  const f = fixture();
  const worker = await f.pool.open('node', 'step', 'workspace', {});
  try {
    f.receive({ type: 'agent_start' });
    const totals = { tokens: { total: 5798300 }, contextUsage: { tokens: null, contextWindow: 1000000, percent: null } };
    f.setStats(async () => totals);
    f.receive({ type: 'agent_end' });
    await tick();
    assert.deepEqual(worker.stats, totals);
    assert.equal(worker.busy, false);
    assert.deepEqual(f.events.filter(event => event.type === 'desktop_stats').at(-1)?.stats, totals);
  } finally { await f.pool.stopAll(); }
});

for (const type of ['auto_clm', 'compaction', 'auto_compaction']) {
  test(`${type} refreshes authoritative usage without ending the active turn or replacing messages`, async () => {
    const f = fixture();
    const worker = await f.pool.open('node', 'step', 'workspace', {});
    try {
      f.receive({ type: 'agent_start' });
      f.receive({ type: 'message_start', message: { role: 'assistant', content: 'Keep this live response' } });
      f.receive({ type: `${type}_start` });
      const totals = { tokens: { total: 345 }, contextUsage: { tokens: 80, contextWindow: 1000, percent: 8 } };
      f.setStats(async () => totals);
      f.receive({ type: `${type}_end` });
      await tick();
      assert.deepEqual(worker.stats, totals);
      assert.equal(worker.busy, true);
      assert.equal(worker.state?.isCompacting, false);
      assert.equal(worker.messages[0].content, 'Keep this live response');
      assert.equal(worker.operations, 0);
      assert.equal(f.events.filter(event => event.type === 'desktop_stats').at(-1)?.runtimeId, worker.id);
      f.receive({ type: `${type}_end` });
      await tick();
      assert.deepEqual(worker.stats, totals, 'Duplicate events must not add maintenance usage twice');
    } finally { await f.pool.stopAll(); }
  });
}

test('a pre-maintenance snapshot cannot overwrite newer fallback statistics', async () => {
  const f = fixture();
  const worker = await f.pool.open('node', 'step', 'workspace', {});
  try {
    let release!: (value: unknown) => void;
    f.setStats(() => new Promise(resolve => { release = resolve; }));
    const oldRead = f.pool.read(worker);
    f.receive({ type: 'auto_clm_start' });
    f.setStats(async () => ({ tokens: { total: 200 } }));
    f.receive({ type: 'auto_clm_end', result: { accepted: false, fallback: true } });
    f.receive({ type: 'compaction_start' });
    f.setStats(async () => ({ tokens: { total: 300 } }));
    f.receive({ type: 'compaction_end' });
    await tick();
    release({ tokens: { total: 100 } });
    await oldRead;
    assert.equal(worker.stats?.tokens.total, 300);
    assert.equal(worker.state?.isCompacting, false);
    assert.equal(f.events.filter(event => event.type === 'desktop_stats').length, 1);
  } finally { await f.pool.stopAll(); }
});

for (const change of ['disconnect', 'session', 'transport', 'failure']) {
  test(`maintenance statistics ignore ${change} while the request is in flight`, async () => {
    const f = fixture();
    const worker = await f.pool.open('node', 'step', 'workspace', {});
    try {
      let release!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      f.setStats(() => new Promise((resolve, fail) => { release = resolve; reject = fail; }));
      f.receive({ type: 'auto_clm_end' });
      if (change === 'disconnect') f.receive({ type: 'desktop_exit' });
      if (change === 'session') worker.state = { ...worker.state!, sessionId: 'other-session' };
      if (change === 'transport') worker.rpc = { ...worker.rpc };
      if (change === 'failure') reject(new Error('Unavailable'));
      else release({ tokens: { total: 999 } });
      await tick();
      assert.equal(worker.stats?.tokens.total, 100);
      assert.equal(worker.operations, 0);
      assert.equal(f.events.some(event => event.type === 'desktop_stats'), false);
    } finally { await f.pool.stopAll(); }
  });
}

test('snapshot decoration cannot revive a worker disconnected while history was loading', async () => {
  let receive!: (event: RuntimeEvent) => void;
  let release: (() => void) | undefined;
  let delay = false;
  const pool = new SessionRuntimes(() => {}, callback => {
    receive = callback;
    return {
      start() {}, stop: async () => {}, respond() {},
      request: async type => type === 'get_state' ? { sessionId: 'history', isStreaming: false }
        : type === 'get_messages' ? { messages: [] } : type === 'get_available_models' ? { models: [] } : {},
    } satisfies WorkerTransport;
  }, { messages: async (_worker, messages) => {
    if (delay) await new Promise<void>(resolve => { release = resolve; });
    return messages;
  } });
  const worker = await pool.open('node', 'step', 'workspace', {});
  try {
    delay = true;
    const reading = pool.read(worker);
    await tick();
    receive({ type: 'desktop_exit' });
    const state = worker.state;
    release!();
    await reading;
    assert.equal(worker.state, state);
    assert.equal(worker.status, 'disconnected');
  } finally { await pool.stopAll(); }
});
