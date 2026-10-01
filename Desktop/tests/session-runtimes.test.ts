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
  async request(type: string) {
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
  const open = (cwd = 'workspace') => pool.open('node', 'step', cwd, {});
  return { pool, transports, events, open };
}

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
