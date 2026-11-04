import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundAgents, backgroundAgentsSnapshot } from '../electron/background-agents';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';

const laneId = 'lane_12345678';
const raw = (sessionId = 'session-a') => ({ sessionId, lanes: [{
  agentId: laneId, mode: 'single', status: 'running', startedAt: Date.now() - 1000, updatedAt: Date.now(),
  results: [{ agent: 'explore', task: 'Read the project', status: 'running', model: 'fixture', usage: { turns: 1 },
    activeText: 'A useful output excerpt', activeTool: 'read_file' }],
}] });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function fixture() {
  const calls: { type: string; args?: Record<string, unknown> }[] = [];
  let handle = async (_args?: Record<string, unknown>): Promise<any> => raw();
  const rpc: WorkerTransport = {
    start() {}, respond() {}, async stop() {},
    async request(type, args) {
      calls.push({ type, args });
      if (type === 'get_state') return { sessionId: 'session-a', isStreaming: false };
      if (type === 'get_messages') return { messages: [] };
      if (type === 'get_available_models') return { models: [] };
      if (type === 'desktop_subagents') return handle(args);
      return {};
    },
  };
  const pool = new SessionRuntimes(() => {}, () => rpc);
  const worker = await pool.open('node', 'step', 'workspace', {});
  calls.length = 0;
  let blocked = false;
  const service = new BackgroundAgents(pool.workers, () => blocked);
  return { calls, rpc, pool, worker, service, handle: (next: typeof handle) => { handle = next; },
    block: () => { blocked = true; } };
}

test('background projection allowlists fields, keeps missing usage unknown and redacts before clipping', () => {
  const source: any = raw();
  Object.assign(source.lanes[0], { sessionFile: 'private-path', environment: { secret: 'never' } });
  Object.assign(source.lanes[0].results[0], {
    agent: 'authorization: Bearer hidden', messages: [{ role: 'user', content: 'private transcript' }],
    activeText: `cookie=${'private-value'.repeat(3000)}\nSafe output`,
    errorMessage: 'api_key=private-error',
    usage: { input: 0, output: -1, cacheRead: NaN, cacheWrite: Infinity, turns: 2, cost: 99 },
  });
  const result = backgroundAgentsSnapshot(source, 'session-a', new Set([laneId]));
  const step = result.lanes[0].steps[0];
  assert.deepEqual(step.usage, { input: 0, turns: 2 });
  assert.equal(step.agent, '[redacted]');
  assert.equal(step.error, '[redacted]');
  assert.equal(step.output, '[redacted]\nSafe output');
  assert.equal(step.redacted, 1);
  assert.equal(result.lanes[0].settling, true);
  assert.doesNotMatch(JSON.stringify(result), /private-|hidden|transcript|sessionFile|environment/);
});

test('background snapshots enforce identities, timestamps, roster and output bounds', () => {
  const source: any = raw();
  source.lanes = Array.from({ length: 30 }, (_, index) => ({
    ...source.lanes[0], agentId: `lane_${index.toString(16).padStart(8, '0')}`, omittedResults: 3,
    results: Array.from({ length: 10 }, () => ({
      ...source.lanes[0].results[0], activeText: 'x'.repeat(40000), usage: {},
      startedAt: -1, updatedAt: Date.now() + 3600000, status: 'future',
    })),
  }));
  const result = backgroundAgentsSnapshot(source, 'session-a');
  const steps = result.lanes.flatMap(lane => lane.steps);
  assert.equal(result.lanes.length, 24);
  assert.equal(steps.length, 64);
  assert.equal(steps.reduce((total, step) => total + step.output.length, 0), 32000);
  assert.ok(steps.every(step => step.output.length <= 12000 && step.outputTruncated));
  assert.ok(steps.every(step => step.status === 'unknown' && step.startedAt === undefined && step.updatedAt === undefined));
  assert.equal(result.lanes[7].omittedSteps, 13);
  assert.throws(() => backgroundAgentsSnapshot(source, 'session-b'));
  for (const patch of [{ agentId: '../lane' }, { mode: 'other' }, { status: 'other' }, { results: null }]) {
    assert.throws(() => backgroundAgentsSnapshot({ sessionId: 'session-a', lanes: [{ ...raw().lanes[0], ...patch }] }, 'session-a'));
  }
  assert.throws(() => backgroundAgentsSnapshot({ sessionId: 'session-a', lanes: [raw().lanes[0], raw().lanes[0]] }, 'session-a'));
});

test('reads coalesce only within the same host, retain it and release the operation on failure', async () => {
  const f = await fixture();
  const pending = deferred<any>();
  f.handle(() => pending.promise);
  const first = f.service.read(f.worker.id, 'session-a');
  const second = f.service.read(f.worker.id, 'session-a');
  assert.equal(first, second);
  assert.equal(f.worker.operations, 1);
  assert.deepEqual(f.calls, [{ type: 'desktop_subagents', args: { sessionId: 'session-a', action: 'list' } }]);
  pending.resolve(raw());
  assert.equal((await first).lanes[0].id, laneId);
  assert.equal(f.worker.operations, 0);
  f.handle(async () => { throw new Error('unavailable'); });
  await assert.rejects(f.service.read(f.worker.id, 'session-a'), /unavailable/);
  assert.equal(f.worker.operations, 0);
});

for (const change of ['session', 'rpc', 'worker', 'disconnect', 'mutation', 'global'] as const) {
  test(`a late background reply cannot cross ${change} identity or transition`, async () => {
    const f = await fixture();
    const pending = deferred<any>();
    f.handle(() => pending.promise);
    const read = f.service.read(f.worker.id, 'session-a');
    if (change === 'session') f.worker.state!.sessionId = 'session-b';
    if (change === 'rpc') f.worker.rpc = { ...f.rpc };
    if (change === 'worker') f.pool.workers.set(f.worker.id, { ...f.worker });
    if (change === 'disconnect') f.worker.status = 'disconnected';
    if (change === 'mutation') f.worker.mutating = true;
    if (change === 'global') f.block();
    pending.resolve(raw());
    await assert.rejects(read);
    assert.equal(f.worker.operations, 0);
  });
}

test('targeted stops do not abort or pause the parent and wait for native settlement', async () => {
  const f = await fixture();
  f.worker.backgroundActive = true;
  f.worker.backgroundLanes = [{ id: laneId, status: 'running' }];
  f.worker.busy = true; f.worker.queued = true;
  const pending = deferred<any>();
  f.handle(args => args?.action === 'stop' ? pending.promise : Promise.resolve(raw()));
  const stop = f.service.stop(f.worker.id, 'session-a', laneId);
  assert.equal(f.worker.operations, 1);
  await assert.rejects(f.service.stop(f.worker.id, 'session-a', laneId), /pending/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { type: 'desktop_subagents', args: { sessionId: 'session-a', action: 'stop', laneId } });
  pending.resolve({ sessionId: 'session-a', requested: true });
  await stop;
  assert.equal(f.worker.operations, 0);
  assert.equal(f.worker.backgroundActive, true);
  assert.equal(f.worker.busy, true);
  assert.equal(f.worker.queued, true);
  assert.equal(f.calls.some(call => call.type === 'abort' || call.type === 'prompt'), false);
  const settled: any = raw();
  settled.lanes[0].status = 'aborted';
  f.worker.backgroundLanes = [{ id: laneId, status: 'settling' }];
  f.handle(async () => settled);
  assert.equal((await f.service.read(f.worker.id, 'session-a')).lanes[0].settling, true);
  f.worker.backgroundLanes = [];
  assert.equal((await f.service.read(f.worker.id, 'session-a')).lanes[0].settling, false);
});

test('stops reject invalid identities and unconfirmed acknowledgments without retrying', async () => {
  const f = await fixture();
  await assert.rejects(f.service.stop(f.worker.id, 'session-a', '../lane'));
  await assert.rejects(f.service.stop(f.worker.id, 'session-b', laneId));
  assert.equal(f.calls.length, 0);
  for (const value of [{}, { sessionId: 'session-b', requested: true }, { sessionId: 'session-a', requested: false }]) {
    f.handle(async () => value);
    await assert.rejects(f.service.stop(f.worker.id, 'session-a', laneId), /not confirmed/);
    assert.equal(f.worker.operations, 0);
  }
  assert.equal(f.calls.length, 3);
  f.block();
  assert.throws(() => f.service.read(f.worker.id, 'session-a'), /not ready/);
  await assert.rejects(f.service.stop(f.worker.id, 'session-a', laneId), /not ready/);
  assert.equal(f.calls.length, 3);
});
