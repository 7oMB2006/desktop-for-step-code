import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRuntimes, type SessionRuntime, type WorkerTransport } from '../electron/session-runtimes';

const changes: [string, (worker: SessionRuntime, pool: SessionRuntimes) => void, RegExp][] = [
  ['queue', worker => { worker.queued = true; }, /pending messages/],
  ['approval', worker => { worker.pendingUI.set('approval', { id: 'approval' } as any); }, /Stop this session/],
  ['Goal', worker => { worker.launch!.goal = { status: 'active' } as any; }, /Pause/],
  ['task', worker => { worker.busy = true; }, /Stop this session/],
  ['Remote attachment', worker => { worker.remoteAttached = true; }, /Unbind Remote/],
  ['Cron', worker => { worker.cron = { state: 'unknown' } as any; }, /scheduled-work/],
  ['RPC replacement', worker => { worker.rpc = {} as any; }, /Session operation/],
  ['session identity', worker => { worker.state!.sessionId = 'changed'; }, /Session operation/],
  ['worker removal', (worker, pool) => { pool.workers.delete(worker.id); }, /Session operation/],
];

async function fixture() {
  let during: (() => void) | undefined;
  const transport: WorkerTransport = {
    start() {}, respond() {}, async stop() {},
    async request(type: string): Promise<any> {
      if (type === 'get_state') { during?.(); return { sessionId: 'session', isStreaming: false }; }
      if (type === 'get_messages') return { messages: [] };
      if (type === 'get_available_models') return { models: [] };
      return {};
    },
  };
  const pool = new SessionRuntimes(() => {}, () => transport);
  const worker = await pool.open('never-spawn', 'step', 'fixture', {});
  return { pool, worker, during: (value: () => void) => { during = value; } };
}

for (const [name, change, message] of changes) {
  test(`resource-write guard rechecks ${name} during its asynchronous RPC observation`, async () => {
    const f = await fixture();
    f.during(() => change(f.worker, f.pool));
    await assert.rejects(f.pool.assertIdle(f.worker, { stopHost: false, resources: true }), message);
  });
}

test('global idle guard rechecks a previously visited session when another RPC awaits', async () => {
  let during: (() => void) | undefined;
  let session = 0;
  const pool = new SessionRuntimes(() => {}, () => {
    const id = `session-${session++}`;
    return {
      start() {}, respond() {}, async stop() {},
      async request(type: string): Promise<any> {
        if (type === 'get_state') { during?.(); return { sessionId: id, isStreaming: false }; }
        if (type === 'get_messages') return { messages: [] };
        if (type === 'get_available_models') return { models: [] };
        return {};
      },
    };
  });
  const first = await pool.open('never-spawn', 'step', 'first', {});
  first.messages = [{ role: 'user', content: 'retained' }];
  await pool.open('never-spawn', 'step', 'second', {});
  let visits = 0;
  during = () => { if (++visits === 2) first.queued = true; };
  await assert.rejects(pool.assertAllIdle({ stopHost: false, resources: true }), /Session operation/);
});
