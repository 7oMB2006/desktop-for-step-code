import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionCollaboration, publicMessages } from '../electron/session-collaboration';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import type { RuntimeEvent } from '../src/contracts';
import { PendingMessages } from '../electron/pending-messages';

class Transport implements WorkerTransport {
  calls: { type: string; args?: Record<string, unknown> }[] = [];
  env: NodeJS.ProcessEnv = {};
  args: string[] = [];
  constructor(private id: string) {}
  start(_node: string, _entry: string, _cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) { this.env = env; this.args = args; }
  async request(type: string, args?: Record<string, unknown>) {
    this.calls.push({ type, args });
    if (type === 'get_state') return { sessionId: this.id, isStreaming: false };
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    return {};
  }
  respond() { throw new Error('Local approvals must not be sent to upstream'); }
  async stop() {}
}
async function fixture(beforePrompt?: (worker: import('../electron/session-runtimes').SessionRuntime, message: string) => Promise<void>) {
  const events: RuntimeEvent[] = [];
  const transports: Transport[] = [];
  const pool: SessionRuntimes = new SessionRuntimes(event => events.push(event), () => {
    const transport = new Transport(`session-${transports.length}`);
    transports.push(transport);
    return transport;
  }, { beforePrompt, launch: worker => broker.attach(worker), dispose: worker => broker.detach(worker) });
  const queue = new PendingMessages(() => {}, () => {}, undefined, (worker, message) => pool.preparePrompt(worker, message));
  const broker: SessionCollaboration = new SessionCollaboration(pool, 'extension.mjs', () => 'zh',
    (worker, message) => { queue.enqueue(worker, message, { message }); });
  await broker.start();
  const a = await pool.open('node', 'step', 'workspace-a', {});
  const b = await pool.open('node', 'step', 'workspace-b', {});
  const close = async () => { await pool.stopAll(); await broker.stop(); };
  const approve = (approved: boolean) => {
    const request = [...a.pendingUI.values()][0];
    assert.ok(request);
    pool.respondToRequest(a, { id: request.id, confirmed: approved });
  };
  return { pool, broker, queue, events, transports, a, b, close, approve };
}

test('prose snapshots exclude thinking, tool payloads and images and bound their output', () => {
  const snapshot = publicMessages([
    { role: 'user', content: 'hello' },
    { role: 'toolResult', content: 'secret tool payload' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'image', data: 'image bytes' }, { type: 'text', text: 'x'.repeat(5000) }] },
  ], 1);
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].text.length, 4000);
  assert.equal(snapshot.messages[0].truncated, true);
  assert.equal(snapshot.omittedMessages, 1);
  assert.ok(!JSON.stringify(snapshot).includes('private reasoning'));
});

test('read/list are snapshots and do not switch sessions, stop workers, or clear unread', async () => {
  const f = await fixture();
  try {
    f.b.messages = [{ role: 'assistant', content: 'visible B' }];
    f.b.busy = true;
    f.pool.unreadSessionIds.add(f.b.state!.sessionId!);
    f.pool.activate(f.a);
    const listed = await f.broker.dispatch(f.a, { action: 'list' });
    assert.ok(JSON.stringify(listed).includes('session-1'));
    assert.ok(JSON.stringify(listed).includes('stepcode-desktop://sessions/session-1'));
    assert.ok(!JSON.stringify(listed).includes('runtimeId'));
    const read = await f.broker.dispatch(f.a, { action: 'read', sessionId: 'stepcode-desktop://sessions/session-1' });
    assert.ok(JSON.stringify(read).includes('visible B'));
    assert.equal(f.pool.active, f.a);
    assert.equal(f.b.busy, true);
    assert.equal(f.pool.unreadSessionIds.has('session-1'), true);
    assert.ok(!f.transports[1].calls.some(call => call.type === 'prompt'));
    await assert.rejects(f.broker.dispatch(f.a, { action: 'read', sessionId: 'session-0' }), /own conversation/);
    await assert.rejects(f.broker.dispatch(f.a, { action: 'read', sessionId: '../auth.json' }), /Expected a session/);
    await assert.rejects(f.broker.dispatch(f.a, { action: 'read', sessionId: 'session-1', limit: 100 }), /limit/);
  } finally { await f.close(); }
});

test('each cross-session message requires source-scoped approval including bypass mode', async () => {
  const f = await fixture();
  try {
    f.a.permissionPreset = 'bypass';
    f.b.busy = true;
    const pending = f.broker.dispatch(f.a, { action: 'send', sessionId: 'session-1', message: 'Keep your diff separate.' });
    assert.equal(f.a.pendingUI.size, 1);
    assert.equal(f.b.pendingUI.size, 0);
    assert.ok(f.events.some(event => event.type === 'extension_ui_request' && event.runtimeId === f.a.id));
    assert.ok(!f.transports[1].calls.some(call => call.type === 'prompt'));
    f.approve(false);
    assert.equal((await pending as any).delivered, false);
    const accepted = f.broker.dispatch(f.a, { action: 'send', sessionId: 'stepcode-desktop://sessions/session-1', message: 'Only inspect your files.' });
    f.approve(true);
    assert.equal((await accepted as any).delivery, 'queued');
    assert.equal(f.transports[1].calls.some(call => call.type === 'prompt'), false, 'busy peer messages stay in the Desktop queue');
    assert.equal(f.queue.list(f.b).length, 1);
    f.b.busy = false;
    await f.queue.drain(f.b);
    const prompt = f.transports[1].calls.find(call => call.type === 'prompt')!;
    assert.equal(prompt.args?.streamingBehavior, undefined);
    assert.ok(String(prompt.args?.message).includes('sourceSessionId'));
    assert.ok(String(prompt.args?.message).includes('Only inspect your files.'));
    assert.ok(String(prompt.args?.message).includes('not the peer'));
    assert.equal(f.b.submissions, 0);
    assert.ok(!f.transports[1].calls.some(call => ['abort', 'steer'].includes(call.type)));
  } finally { await f.close(); }
});

test('queued peer turns prepare the next model before dispatch and retain FIFO order', async () => {
  const prepared: string[] = [];
  const f = await fixture(async (worker, message) => {
    prepared.push(message);
    if (worker.pendingModel) {
      await worker.rpc.request('set_model', { modelId: worker.pendingModel.model.id });
      worker.pendingModel = undefined;
    }
  });
  try {
    f.b.busy = true;
    f.queue.enqueue(f.b, 'older local message', { message: 'older local message' });
    f.b.pendingModel = { model: { id: 'next-model', provider: 'fixture', name: 'Next model' } };
    const send = f.broker.dispatch(f.a, { action: 'send', sessionId: 'session-1', message: 'peer follow-up' });
    f.approve(true);
    assert.equal((await send as any).delivery, 'queued');
    assert.equal(prepared.length, 0);
    f.b.busy = false;
    await f.queue.drain(f.b);
    assert.equal(prepared[0], 'older local message');
    assert.equal(f.transports[1].calls.filter(call => ['set_model', 'prompt'].includes(call.type))[0].type, 'set_model');
    f.queue.delivered(f.b, 'older local message', 1);
    f.b.pendingModel = { model: { id: 'peer-model', provider: 'fixture', name: 'Peer model' } };
    await f.queue.drain(f.b);
    assert.match(prepared[1], /peer follow-up/);
    const calls = f.transports[1].calls.filter(call => ['set_model', 'prompt'].includes(call.type));
    assert.deepEqual(calls.map(call => call.type), ['set_model', 'prompt', 'set_model', 'prompt']);
    assert.equal(calls[2].args?.modelId, 'peer-model');
    assert.equal(calls[3].args?.streamingBehavior, undefined);
    f.queue.delivered(f.b, String(calls[3].args?.message), 2);
  } finally { await f.close(); }
});

test('pending approval cannot deliver after target removal, source cancellation or read-only change', async () => {
  for (const reason of ['removed', 'cancelled', 'read-only']) {
    const f = await fixture();
    try {
      const controller = new AbortController();
      const pending = f.broker.dispatch(f.a, { action: 'send', sessionId: 'session-1', message: 'one message' }, controller.signal);
      if (reason === 'removed') {
        await f.pool.remove(f.b);
        f.approve(true);
        await assert.rejects(pending, /not connected/);
      } else if (reason === 'read-only') {
        f.a.permissionPreset = 'read-only';
        f.approve(true);
        await assert.rejects(pending, /read-only/);
      } else {
        controller.abort();
        assert.equal((await pending as any).delivered, false);
        assert.equal(f.a.pendingUI.size, 0);
      }
      assert.ok(!f.transports[1].calls.some(call => call.type === 'prompt'));
    } finally { await f.close(); }
  }
});

test('loopback endpoint rejects browser origins and expired or invalid per-worker tokens', async () => {
  const f = await fixture();
  try {
    const { DESKTOP_SESSION_URL: url, DESKTOP_SESSION_TOKEN: token } = f.transports[0].env;
    assert.ok(f.transports[0].args.includes('--extension'));
    assert.notEqual(token, f.transports[1].env.DESKTOP_SESSION_TOKEN);
    const call = (authorization: string, extra: Record<string, string> = {}) => fetch(url!, {
      method: 'POST', headers: { authorization, ...extra }, body: JSON.stringify({ action: 'list' }),
    });
    assert.equal((await call('Bearer invalid')).status, 403);
    assert.equal((await call(`Bearer ${token}`, { origin: 'http://untrusted.example' })).status, 403);
    const response = await call(`Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(token!));
    await f.pool.remove(f.a);
    assert.equal((await call(`Bearer ${token}`)).status, 403);
  } finally { await f.close(); }
});
