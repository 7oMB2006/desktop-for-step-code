import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import { isProjectTrustInput, trustProject } from '../electron/project-trust';

test('only a standalone explicit /trust invokes Desktop project trust', () => {
  assert.equal(isProjectTrustInput({ message: ' /trust \n', images: [], files: [] }), true);
  for (const message of ['Discuss /trust', '/trust-me', 'Please trust this project', '/cron', ''])
    assert.equal(isProjectTrustInput({ message }), false);
  for (const data of [{ message: '/trust parent' }, { message: '/trust', files: ['file'] },
    { message: '/trust', images: [{}] }, { message: '/trust', files: null }])
    assert.throws(() => isProjectTrustInput(data), /by itself/);
});

async function fixture(t: TestContext) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'desktop-trust-unit-')));
  const calls: string[] = [];
  const pool = new SessionRuntimes(() => {}, () => ({
    start() {},
    async request(type: string) {
      calls.push(type);
      if (type === 'get_state') return { sessionId: 'trust-test', isStreaming: false };
      if (type === 'get_messages') return { messages: [] };
      if (type === 'get_available_models') return { models: [] };
      return {};
    },
    respond() { throw new Error('Desktop trust answers must not be sent to the agent'); },
    async stop() {},
  } satisfies WorkerTransport));
  const worker = await pool.open('node', 'step', cwd, {});
  t.after(() => pool.stopAll());
  const writes: string[] = [];
  const save = async (path: string) => { writes.push(path); };
  const run = () => trustProject(pool, worker, save, 'zh');
  const request = async () => {
    for (let i = 0; i < 100 && !worker.pendingUI.size; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(worker.pendingUI.size, 1);
    return [...worker.pendingUI.values()][0];
  };
  const answer = async (confirmed: boolean) => {
    const pending = await request();
    pool.respondToRequest(worker, { id: pending.id, confirmed });
  };
  return { cwd, pool, worker, calls, writes, save, run, request, answer };
}

test('project trust requires approval, saves only the canonical folder and never restarts the host', async t => {
  const f = await fixture(t);
  const transport = f.worker.rpc;
  const pending = f.run();
  const request = await f.request();
  assert.ok(request.message?.includes(f.cwd));
  assert.ok(request.message?.includes('扩展代码'));
  assert.ok(request.message?.includes('子目录'));
  assert.equal(f.worker.mutating, true);
  assert.deepEqual(f.writes, []);
  await assert.rejects(f.run(), /operation in progress/);
  await f.answer(true);
  assert.deepEqual(await pending, { saved: true });
  assert.deepEqual(f.writes, [f.cwd]);
  assert.equal(f.worker.rpc, transport);
  assert.equal(f.worker.mutating, false);
  assert.ok(!f.calls.includes('prompt'), 'No model submission or native /trust forwarding');
});

for (const action of ['cancel', 'expire', 'disconnect'] as const) {
  test(`project trust ${action} does not write a decision`, async t => {
    const f = await fixture(t);
    const pending = f.run();
    const request = await f.request();
    if (action === 'cancel') await f.answer(false);
    if (action === 'expire') f.pool.clearRequest(f.worker, request.id);
    if (action === 'disconnect') await f.pool.remove(f.worker);
    assert.deepEqual(await pending, { cancelled: true });
    assert.deepEqual(f.writes, []);
    assert.equal(f.worker.mutating, false);
  });
}

test('failed native storage writes are not reported as saved and release the lock', async t => {
  const f = await fixture(t);
  const pending = trustProject(f.pool, f.worker, async () => { throw new Error('store unavailable'); }, 'en');
  const rejected = assert.rejects(pending, /store unavailable/);
  await f.answer(true);
  await rejected;
  assert.equal(f.worker.mutating, false);
});

test('busy hosts cannot start project trust or write a decision', async t => {
  const f = await fixture(t);
  f.worker.busy = true;
  await assert.rejects(f.run(), /Stop this session task/);
  assert.equal(f.worker.pendingUI.size, 0);
  assert.deepEqual(f.writes, []);
  assert.equal(f.worker.mutating, false);
});

test('replaced transports cannot inherit a pending project approval', async t => {
  const f = await fixture(t);
  const pending = f.run();
  const rejected = assert.rejects(pending, /Session changed/);
  await f.request();
  f.worker.rpc = { ...f.worker.rpc };
  await f.answer(true);
  await rejected;
  assert.deepEqual(f.writes, []);
});

test('a retargeted project junction cannot use approval for its old target', async t => {
  const f = await fixture(t);
  const other = join(f.cwd, 'other');
  const initial = join(f.cwd, 'initial');
  const link = join(f.cwd, 'project');
  await mkdir(initial);
  await mkdir(other);
  await symlink(initial, link, process.platform === 'win32' ? 'junction' : 'dir');
  f.worker.cwd = link;
  const pending = f.run();
  const rejected = assert.rejects(pending, /Project folder changed/);
  await f.request();
  await unlink(link);
  await symlink(other, link, process.platform === 'win32' ? 'junction' : 'dir');
  await f.answer(true);
  await rejected;
  assert.deepEqual(f.writes, []);
});
