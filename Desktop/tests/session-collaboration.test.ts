import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionCollaboration, publicMessages } from '../electron/session-collaboration';
import { SessionAttachmentExports } from '../electron/session-attachment-exports';
import type { HistoryEntry } from '../electron/session-branching';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import type { RuntimeEvent } from '../src/contracts';
import { PendingMessages } from '../electron/pending-messages';

class Transport implements WorkerTransport {
  entries: HistoryEntry[] = [];
  leafId: string | null = null;
  calls: { type: string; args?: Record<string, unknown> }[] = [];
  env: NodeJS.ProcessEnv = {};
  args: string[] = [];
  constructor(private id: string) {}
  start(_node: string, _entry: string, _cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) { this.env = env; this.args = args; }
  async request(type: string, args?: Record<string, unknown>) {
    this.calls.push({ type, args });
    if (type === 'get_state') return { sessionId: this.id, isStreaming: false };
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_entries') return { entries: this.entries, leafId: this.leafId };
    if (type === 'get_available_models') return { models: [] };
    return {};
  }
  respond() { throw new Error('Local approvals must not be sent to upstream'); }
  async stop() {}
}
async function fixture(beforePrompt?: (worker: import('../electron/session-runtimes').SessionRuntime, message: string) => Promise<void>,
  remote?: ConstructorParameters<typeof SessionCollaboration>[4], attachments?: SessionAttachmentExports,
  openPreview?: ConstructorParameters<typeof SessionCollaboration>[6]) {
  const events: RuntimeEvent[] = [];
  const transports: Transport[] = [];
  const pool: SessionRuntimes = new SessionRuntimes(event => events.push(event), () => {
    const transport = new Transport(`session-${transports.length}`);
    transports.push(transport);
    return transport;
  }, { beforePrompt, launch: worker => broker.attach(worker), dispose: worker => broker.detach(worker) });
  const queue = new PendingMessages(() => {}, () => {}, undefined, (worker, message) => pool.preparePrompt(worker, message));
  const broker: SessionCollaboration = new SessionCollaboration(pool, 'extension.mjs', () => 'zh',
    (worker, message) => { queue.enqueue(worker, message, { message }); }, remote, attachments, openPreview);
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

test('attachment IDs address saved inputs on the authenticated source branch only', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-attachment-test-'));
  const cache = join(profile, 'cache');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/tUAAAAASUVORK5CYII=', 'base64');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]);
  const image = (bytes: Buffer, mimeType: string) => ({ type: 'image', mimeType, data: bytes.toString('base64') });
  const pngImage = image(png, 'image/png');
  const jpegImage = image(jpeg, 'image/jpeg');
  await mkdir(cache);
  await writeFile(join(cache, 'image-00000000-0000-4000-8000-000000000000.png'), 'old export');
  await writeFile(join(cache, 'unrelated.png'), 'keep');
  const f = await fixture(undefined, undefined, new SessionAttachmentExports(cache));
  try {
    const [source] = f.transports;
    const goal = { type: 'custom_message', id: 'goal', parentId: 'old', customType: 'desktop-goal-input',
      display: true, timestamp: '2026-11-22T00:00:00.000Z', content: [pngImage, jpegImage] };
    source.entries = [
      { type: 'message', id: 'old', parentId: null, message: { role: 'user', timestamp: 1, content: [jpegImage] } },
      goal,
      { ...goal, id: 'hidden', parentId: 'goal', display: false },
      { type: 'message', id: 'hidden-user', parentId: 'hidden', message: { role: 'user', display: false, content: [pngImage] } },
      { type: 'message', id: 'assistant', parentId: 'hidden-user', message: { role: 'assistant', content: [pngImage] } },
      { type: 'message', id: 'tool', parentId: 'assistant', message: { role: 'toolResult', content: [pngImage] } },
      { type: 'message', id: 'sibling', parentId: 'old', message: { role: 'user', content: [pngImage] } },
      { type: 'compaction', id: 'compact', parentId: 'tool' },
    ];
    source.leafId = 'compact';
    f.a.messages = [{ role: 'user', content: 'Current compacted context has no images' }];
    const call = (args: object, transport = source) => fetch(transport.env.DESKTOP_SESSION_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${transport.env.DESKTOP_SESSION_TOKEN}` },
      body: JSON.stringify({ action: 'attachments', ...args }),
    });
    const list = async () => (await call({ operation: 'list' })).json();
    assert.equal(source.env.DESKTOP_SESSION_ATTACHMENTS, '1');
    assert.ok(source.args.includes('desktop_session_attachments=allow'));
    assert.deepEqual(await list(), { messages: [
      { messageId: 'goal', timestamp: Date.parse(goal.timestamp), images: [{ imageIndex: 1, mimeType: 'image/png' }, { imageIndex: 2, mimeType: 'image/jpeg' }] },
      { messageId: 'old', timestamp: 1, images: [{ imageIndex: 1, mimeType: 'image/jpeg' }] },
    ] });
    assert.deepEqual(await readdir(cache), ['unrelated.png']);
    assert.deepEqual(await (await call({ operation: 'list' }, f.transports[1])).json(), { messages: [] });
    assert.equal((await call({ operation: 'export', messageId: 'goal' }, f.transports[1])).status, 400);
    for (const args of [{ messageId: 'sibling' }, { messageId: 'missing' }, { messageId: 'hidden' },
      { messageId: 'hidden-user' }, { sessionId: 'session-1' }, { path: '../other.png' }, { imageIndex: 3 }])
      assert.equal((await call({ operation: 'export', ...args })).status, 400);

    source.entries.push({ type: 'message', id: 'new', parentId: 'compact', message: { role: 'user', content: [jpegImage] } });
    source.leafId = 'new';
    const exportGoal = { action: 'attachments', operation: 'export', messageId: 'goal' };
    const controller = new AbortController();
    const cancelled = f.broker.dispatch(f.a, exportGoal, controller.signal);
    const kept = f.broker.dispatch(f.a, exportGoal);
    queueMicrotask(() => controller.abort());
    await assert.rejects(cancelled, /connection expired/);
    const result = await kept as { messageId: string; images: { imageIndex: number; path: string }[] };
    assert.equal(result.messageId, 'goal');
    assert.deepEqual(result.images.map(entry => entry.imageIndex), [1, 2]);
    for (const [i, bytes] of [png, jpeg].entries()) assert.deepEqual(await readFile(result.images[i].path), bytes);
    assert.ok(!JSON.stringify(result).includes(pngImage.data));
    for (let i = 0; i < 130; i++)
      assert.deepEqual(await f.broker.dispatch(f.a, exportGoal), result);
    const subset = await (await call({ operation: 'export', messageId: 'goal', imageIndex: 2 })).json();
    assert.deepEqual(subset.images, [result.images[1]]);
    assert.equal((await readdir(cache)).length, 3);

    const cancelNew = new AbortController();
    const abandoned = f.broker.dispatch(f.a, { action: 'attachments', operation: 'export' }, cancelNew.signal);
    queueMicrotask(() => cancelNew.abort());
    await assert.rejects(abandoned, /connection expired/);
    assert.equal((await readdir(cache)).length, 3, 'a cancelled unshared write leaves no export');
    const latest = await (await call({ operation: 'export' })).json();
    assert.equal(latest.messageId, 'new');
    const revoking = f.broker.dispatch(f.a, { ...exportGoal, messageId: 'old' });
    f.broker.detach(f.a);
    await assert.rejects(revoking, /connection expired/);
    assert.equal(f.pool.active, f.b);
    assert.equal((await call({ operation: 'list' })).status, 403);
  } finally {
    await f.close();
    try { assert.deepEqual(await readdir(cache), ['unrelated.png']); }
    finally { await rm(profile, { recursive: true, force: true }); }
  }
});

test('the local preview broker binds requests to their live caller, regardless of selection', async () => {
  const requests: [string | undefined, string][] = [];
  const f = await fixture(undefined, undefined, undefined, (worker, url) => {
    requests.push([worker.state?.sessionId, url]);
    return { opened: true, load: 'loading' };
  });
  try {
    const env = f.transports[0].env;
    assert.equal(env.DESKTOP_BROWSER_PREVIEW, '1');
    assert.ok(f.transports[0].args.includes('desktop_open_preview=allow'));
    const request = (data: object, token = env.DESKTOP_SESSION_TOKEN) => fetch(env.DESKTOP_SESSION_URL!, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(data),
    });
    const url = 'http://localhost:5173/';
    assert.equal((await request({ action: 'open-preview', url })).status, 400, 'idle requests cannot open a preview');
    f.a.runActive = true;
    f.a.remoteAttached = true;
    assert.equal((await request({ action: 'open-preview', url })).status, 400, 'remote sessions cannot open a preview');
    f.a.remoteAttached = false;
    const nextApproval = async () => {
      for (let attempt = 0; !f.a.pendingUI.size && attempt < 100; attempt++)
        await new Promise(resolve => setTimeout(resolve, 5));
      const approval = [...f.a.pendingUI.values()][0];
      assert.ok(approval);
      assert.ok(approval.message?.endsWith(url));
      assert.deepEqual(requests, []);
    };
    const denied = request({ action: 'open-preview', url });
    await nextApproval();
    f.approve(false);
    assert.equal((await denied).status, 400);
    const allowed = request({ action: 'open-preview', url });
    await nextApproval();
    f.approve(true);
    const result = await allowed;
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { opened: true, load: 'loading' });
    assert.equal(f.pool.active, f.b);
    assert.equal((await request({ action: 'open-preview', url, sessionId: 'session-1' })).status, 400);
    assert.equal((await request({ action: 'open-preview', url }, 'wrong')).status, 403);
    f.broker.detach(f.a);
    assert.equal((await request({ action: 'open-preview', url })).status, 403);
    assert.deepEqual(requests, [['session-0', url]]);
  } finally { f.a.runActive = false; await f.close(); }
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

test('each cross-session message requires source-scoped approval even with Full Access', async () => {
  const f = await fixture();
  try {
    f.a.permissionPreset = 'full-access';
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

test('pending approval cannot deliver after target removal or source cancellation', async () => {
  for (const reason of ['removed', 'cancelled']) {
    const f = await fixture();
    try {
      const controller = new AbortController();
      const pending = f.broker.dispatch(f.a, { action: 'send', sessionId: 'session-1', message: 'one message' }, controller.signal);
      if (reason === 'removed') {
        await f.pool.remove(f.b);
        f.approve(true);
        await assert.rejects(pending, /not connected/);
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
test('image broker derives the source worker from its token and never bypasses runtime tool permissions', async () => {
  const calls: { worker: import('../electron/session-runtimes').SessionRuntime; path: string; caption?: string }[] = [];
  const f = await fixture(undefined, { extensionPath: 'desktop-remote.mjs', sendImage: async (worker, path, caption) => {
    calls.push({ worker, path, caption }); return { delivered: true, messageId: 'native-image' };
  } });
  try {
    assert.ok(f.transports[0].args.includes('desktop-remote.mjs'));
    for (const flag of ['--desktop-plan-review', '--plan-review-surface', '--desktop-clarification'])
      assert.ok(f.transports[0].args.includes(flag), `Remote image workers retain ${flag}`);
    assert.ok(!f.transports[0].args.some(value => value.startsWith('desktop_send_image=')));
    const { DESKTOP_SESSION_URL: url, DESKTOP_SESSION_TOKEN: token } = f.transports[0].env;
    const request = (data: unknown, auth = token) => fetch(url!, {
      method: 'POST', headers: { authorization: `Bearer ${auth}` }, body: JSON.stringify(data),
    });
    assert.equal((await request({ action: 'remote-image', path: 'chart.png' }, 'forged')).status, 403);
    assert.equal(calls.length, 0);
    const reply = await request({ action: 'remote-image', path: 'chart.png', caption: 'Chart', sessionId: f.b.state!.sessionId });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { delivered: true, messageId: 'native-image' });
    assert.equal(calls[0].worker, f.a);
    assert.equal(calls[0].caption, 'Chart');
    assert.equal((await request({ action: 'remote-image', path: 'chart.png', caption: 'x'.repeat(501) })).status, 400);
    assert.equal(calls.length, 1);
    await f.pool.remove(f.a);
    assert.equal((await request({ action: 'remote-image', path: 'chart.png' })).status, 403);
    assert.equal(calls.length, 1);
  } finally { await f.close(); }
});
