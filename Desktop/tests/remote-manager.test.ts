import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteManager, parseRemoteAction, remoteDecision, type RemoteHost } from '../electron/remote-manager';
import type { SessionRuntime } from '../electron/session-runtimes';
import type { RuntimeEvent, UIRequest } from '../src/contracts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const workers = ['a', 'b'].map(id => ({
    id, cwd: `workspace-${id}`, state: { sessionId: `session-${id}`, sessionName: `Session ${id}` }, status: 'connected',
    busy: false, submissions: 0, operations: 0, pendingUI: new Map(), messages: [], rpc: {},
  } as unknown as SessionRuntime));
  const inputs: [string, string][] = [], answers: Record<string, unknown>[] = [], stops: string[] = [], opened: string[] = [];
  const host: RemoteHost = {
    sessions: () => workers.map(worker => ({ runtimeId: worker.id, sessionId: worker.state!.sessionId!, workspace: worker.cwd, name: worker.state!.sessionName! })),
    worker: (id, sessionId) => {
      const worker = workers.find(worker => worker.id === id && worker.state?.sessionId === sessionId && worker.status === 'connected');
      if (!worker) throw new Error('Wrong identity');
      return worker;
    },
    submit: async (worker, message) => { inputs.push([worker.id, message]); },
    stop: async worker => { stops.push(worker.id); },
    respond: (worker, answer) => {
      if (!worker.pendingUI.delete(String(answer.id))) throw new Error('Expired');
      answers.push(answer);
    },
    open: async url => { opened.push(url); },
  };
  const channels: { receive: (event: RuntimeEvent) => void; stopped: boolean; calls: { type: string; args: any }[] }[] = [];
  let operation = async (_type: string, _args: any) => {};
  let now = Date.now();
  const manager = new RemoteManager(host, receive => {
    const channel = { receive, stopped: false, calls: [] as { type: string; args: any }[] };
    channels.push(channel);
    return {
      request: async (type, args) => { channel.calls.push({ type, args }); await operation(type, args); },
      stop: async () => { channel.stopped = true; },
    };
  }, () => {}, () => now);
  const receive = (kind: string, fields = {}) => channels.at(-1)!.receive({ type: 'remote_channel', kind, ...fields });
  const connect = async () => {
    await manager.action({ type: 'connect' });
    receive('connected', { botName: 'Fixture bot', callbackUrl: 'https://open.feishu.cn/page/launcher?clientID=fixture' });
  };
  const bind = async (index = 0) => {
    await manager.action({ type: 'armBinding' });
    const arm = channels.at(-1)!.calls.slice().reverse().find(call => call.type === 'arm')!.args;
    receive('candidate', { armId: arm.armId, candidateId: 'candidate' });
    const worker = workers[index];
    await manager.action({ type: 'bind', candidateId: 'candidate', runtimeId: worker.id, sessionId: worker.state!.sessionId! });
    return channels.at(-1)!.calls.slice().reverse().find(call => call.type === 'bind')!.args.bindingId;
  };
  return { manager, workers, channels, inputs, answers, stops, opened, receive, connect, bind,
    now: (value: number) => { now = value; }, operation: (value: typeof operation) => { operation = value; } };
}
function approval(worker: SessionRuntime, id = 'approval'): UIRequest {
  const callId = 'call-12345678';
  worker.messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: callId, name: 'run_command', arguments: { command: 'echo fixture' } }] });
  const request: UIRequest = { type: 'extension_ui_request', runtimeId: worker.id, method: 'confirm', id,
    title: 'Approve run_command [12345678]',
    message: `Call: ${callId}\nrun_command can modify the workspace or execute a command\n\necho fixture\n\nBatch calls may ask separately\nbefore approved tools begin running.` };
  worker.pendingUI.set(id, request);
  return request;
}

test('IPC admits only the narrow Remote action schema', () => {
  for (const value of [null, [], { type: 'prompt' }, { type: 'bind', runtimeId: '../arbitrary' }])
    assert.throws(() => parseRemoteAction(value));
  assert.deepEqual(parseRemoteAction({ type: 'connect', credentials: 'discard' }), { type: 'connect' });
});
test('routing stays bound to an explicit identity and ignores duplicate, unsupported and stale inputs', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect());
  await f.connect(); const bindingId = await f.bind(1);
  assert.equal(f.workers[1].remoteAttached, true);
  for (const [id, text] of [['one', 'hello'], ['one', 'duplicate'], ['two', '/permissions full-access'], ['three', 'x'.repeat(12001)]])
    f.receive('input', { bindingId, id, text });
  f.receive('input', { bindingId: 'old-binding', id: 'four', text: 'wrong' });
  await tick();
  assert.deepEqual(f.inputs, [['b', 'hello']]);
  f.workers[1].state!.sessionId = 'replaced';
  f.receive('input', { bindingId, id: 'five', text: 'cannot cross' });
  await tick();
  assert.equal(f.inputs.length, 1);
});
test('only a current code and candidate can bind an idle worker', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  await assert.rejects(f.manager.action({ type: 'bind', candidateId: 'x', runtimeId: 'a', sessionId: 'session-a' }));
  await f.manager.action({ type: 'armBinding' });
  const arm = f.channels[0].calls.slice().reverse().find(call => call.type === 'arm')!.args;
  f.receive('candidate', { armId: 'old', candidateId: 'candidate' });
  assert.equal(f.manager.snapshot().candidate, undefined);
  f.receive('candidate', { armId: arm.armId, candidateId: 'candidate' });
  f.workers[0].busy = true;
  await assert.rejects(f.manager.action({ type: 'bind', candidateId: 'candidate', runtimeId: 'a', sessionId: 'session-a' }), /idle/);
  f.workers[0].busy = false; f.now(arm.expiresAt + 1);
  await assert.rejects(f.manager.action({ type: 'bind', candidateId: 'candidate', runtimeId: 'a', sessionId: 'session-a' }), /expired/);
});
test('late bind acknowledgment and old helper events cannot resurrect a disconnected binding', async () => {
  const f = fixture(); await f.connect();
  const hold = deferred();
  f.operation(async type => { if (type === 'bind') await hold.promise; });
  const pending = f.bind();
  await tick();
  const old = f.channels[0];
  assert.equal(f.workers[0].remoteAttached, true);
  await f.manager.disconnect(); hold.resolve(); await pending;
  old.receive({ type: 'remote_channel', kind: 'connected' });
  old.receive({ type: 'remote_channel', kind: 'input', id: 'old', text: 'not delivered' });
  assert.equal(f.manager.snapshot().status, 'idle');
  assert.equal(f.manager.snapshot().binding, undefined);
  assert.equal(f.workers[0].remoteAttached, false);
  assert.deepEqual(f.inputs, []);
});
test('unbind fences old receipts and retains the local task and pending approvals', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const oldId = await f.bind();
  approval(f.workers[0]); f.workers[0].busy = true;
  await f.manager.action({ type: 'unbind' });
  f.receive('input', { bindingId: oldId, id: 'late', text: 'old chat' }); await tick();
  assert.equal(f.workers[0].busy, true); assert.equal(f.workers[0].pendingUI.size, 1);
  assert.deepEqual(f.stops, []); assert.deepEqual(f.inputs, []);
});
test('rebinding on the same connection rejects old input and approval capabilities', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const oldId = await f.bind();
  const request = approval(f.workers[0]);
  f.manager.runtimeEvent(f.workers[0], request); await tick();
  const token = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.actions.token;
  await f.manager.action({ type: 'unbind' });
  const bindingId = await f.bind(1);
  assert.notEqual(bindingId, oldId);
  f.receive('input', { bindingId: oldId, id: 'old-input', text: 'do not send' });
  f.receive('decision', { bindingId: oldId, token, option: 'Allow once / 允许一次' });
  f.receive('input', { bindingId, id: 'new-input', text: 'current chat' }); await tick();
  assert.deepEqual(f.inputs, [['b', 'current chat']]);
  assert.deepEqual(f.answers, []);
  assert.equal(f.workers[0].pendingUI.get(request.id), request);
});
test('a failed arm clears the challenge and cannot accept a late candidate', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  let armId: string | undefined;
  f.operation(async (type, args) => { if (type === 'arm') { armId = args.armId; throw new Error('transport failed'); } });
  await assert.rejects(f.manager.action({ type: 'armBinding' }));
  f.receive('candidate', { armId, candidateId: 'late' });
  assert.equal(f.manager.snapshot().bindingCode, undefined);
  assert.equal(f.manager.snapshot().candidate, undefined);
  assert.ok(f.channels[0].calls.some(call => call.type === 'disarm' && call.args.armId === armId));
});
test('approval mapping requires the known envelope and exact pending tool call', () => {
  const f = fixture(), worker = f.workers[0], request = approval(worker);
  assert.ok(remoteDecision(request, worker));
  for (const patch of [{ method: 'select' }, { title: 'Allow anything' }, { projectTrust: { cwd: 'x' } }, { messageStyle: 'preformatted' as const }, { runtimeId: 'b' }]) {
    assert.equal(remoteDecision({ ...request, ...patch }, worker), undefined);
  }
  worker.messages.push({ role: 'toolResult', toolCallId: 'call-12345678', content: 'done' });
  assert.equal(remoteDecision(request, worker), undefined);
});
test('actionable approval cards recover the full input and never authorize clipped or summary-only details', () => {
  const f = fixture(), worker = f.workers[0], request = approval(worker);
  const content = worker.messages.at(-1)!.content;
  assert.ok(Array.isArray(content));
  content[0].arguments = { command: 'echo actual-command-not-summary', cwd: 'workspace-a', env: { API_KEY: 'private-value' } };
  const decision = remoteDecision(request, worker);
  assert.match(decision!.text, /echo actual-command-not-summary/);
  assert.match(decision!.text, /workspace-a/);
  assert.doesNotMatch(decision!.text, /echo fixture|private-value/);
  content[0].arguments = { command: 'x'.repeat(5100) };
  assert.equal(remoteDecision(request, worker), undefined);
  content[0].arguments = 'unparsed arguments';
  assert.equal(remoteDecision(request, worker), undefined);
});
test('remote and local approval compete for one request; expired callbacks never answer a replacement', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  const worker = f.workers[0], request = approval(worker);
  f.manager.runtimeEvent(worker, request); await tick();
  const card = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  f.receive('decision', { bindingId, token: card.actions.token, option: 'Allow once / 允许一次' });
  f.receive('decision', { bindingId, token: card.actions.token, option: 'Deny / 拒绝' });
  assert.deepEqual(f.answers, [{ id: request.id, confirmed: true }]);
  const next = approval(worker, 'next'); f.manager.runtimeEvent(worker, next); await tick();
  const second = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  worker.pendingUI.delete('next');
  f.manager.runtimeEvent(worker, { type: 'desktop_ui_expired' });
  f.receive('decision', { bindingId, token: second.actions.token, option: 'Allow once / 允许一次' });
  assert.equal(f.answers.length, 1);
  assert.ok(f.channels[0].calls.some(call => call.type === 'revoke' && call.args.token === second.actions.token));
});
test('an existing card cannot approve changed tool parameters under the same request identity', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  const worker = f.workers[0], request = approval(worker);
  f.manager.runtimeEvent(worker, request); await tick();
  const original = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  const content = worker.messages.at(-1)!.content;
  assert.ok(Array.isArray(content)); content[0].arguments = { command: 'echo changed' };
  f.receive('decision', { bindingId, token: original.actions.token, option: 'Allow once / 允许一次' });
  assert.deepEqual(f.answers, []);
  f.manager.runtimeEvent(worker, { type: 'message_update' }); await tick();
  const updated = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  assert.notEqual(updated.actions.token, original.actions.token);
  assert.match(updated.text, /echo changed/);
  f.receive('decision', { bindingId, token: original.actions.token, option: 'Allow once / 允许一次' });
  assert.deepEqual(f.answers, []);
  f.receive('decision', { bindingId, token: updated.actions.token, option: 'Deny / 拒绝' });
  assert.deepEqual(f.answers, [{ id: request.id, confirmed: false }]);
});
test('a callback probe proves readiness without approving a tool', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  await f.manager.action({ type: 'checkCallbacks' }); await tick();
  const card = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  assert.equal(f.manager.snapshot().approvalReady, false);
  f.receive('decision', { bindingId, token: card.actions.token, option: 'Verify / 验证' });
  assert.equal(f.manager.snapshot().approvalReady, true); assert.deepEqual(f.answers, []);
});
test('only authoritative completion labels success; stale stop buttons cannot stop another run', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  const worker = f.workers[0];
  f.manager.runtimeEvent(worker, { type: 'agent_start' }); await tick();
  const first = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  f.manager.runtimeEvent(worker, { type: 'message_end', message: { role: 'assistant', content: 'answer' } });
  f.manager.runtimeEvent(worker, { type: 'agent_end' }); await tick();
  assert.equal(f.channels[0].calls.filter(call => call.type === 'card').length, 1);
  f.manager.runtimeEvent(worker, { type: 'desktop_task_completed' }); await tick();
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.title, /^Completed/);
  f.manager.runtimeEvent(worker, { type: 'agent_start' });
  f.receive('stop', { bindingId, runId: first.key }); assert.deepEqual(f.stops, []);
  await tick();
  const current = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  f.receive('stop', { bindingId, runId: current.key }); await tick();
  assert.deepEqual(f.stops, ['a']);
});
test('projection coalesces while delivery is stalled and never leaks thinking, tools or history', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); await f.bind();
  const hold = deferred();
  f.operation(async type => { if (type === 'card') await hold.promise; });
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  for (let i = 0; i < 100; i++) f.manager.runtimeEvent(f.workers[0], { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'SECRET THINKING' } });
  f.manager.runtimeEvent(f.workers[0], { type: 'message_end', message: { role: 'assistant', content: 'safe answer' } });
  f.manager.runtimeEvent(f.workers[0], { type: 'desktop_task_completed' });
  assert.equal(f.channels[0].calls.filter(call => call.type === 'card').length, 1);
  hold.resolve(); await tick(); await tick();
  const cards = f.channels[0].calls.filter(call => call.type === 'card');
  assert.equal(cards.length, 2); assert.equal(cards[1].args.text, 'safe answer');
  assert.doesNotMatch(JSON.stringify(cards), /SECRET/);
});
test('length-truncated replies stop projecting Working even without a failure flag', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); await f.bind();
  const worker = f.workers[0];
  worker.failed = false;
  f.manager.runtimeEvent(worker, { type: 'agent_start' }); await tick();
  const message = { role: 'assistant', content: 'Partial answer', stopReason: 'length' } as const;
  worker.messages.push(message);
  f.manager.runtimeEvent(worker, { type: 'message_end', message });
  assert.equal(worker.failed, false);
  f.manager.runtimeEvent(worker, { type: 'agent_end' }); await tick();
  const card = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  assert.match(card.title, /^Interrupted/);
  assert.equal(card.text, 'Partial answer');
});
test('authorization links stay main-owned and are origin-checked; errors and old exits cannot affect a new connection', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  f.receive('authorization', { url: 'https://evil.example/page/cli', expiresAt: Date.now() + 60000 });
  await assert.rejects(f.manager.action({ type: 'openAuthorization' }));
  f.receive('authorization', { url: 'https://open.feishu.cn/page/cli?user_code=SECRET', expiresAt: Date.now() + 60000 });
  assert.doesNotMatch(JSON.stringify(f.manager.snapshot()), /SECRET/);
  await f.manager.action({ type: 'openAuthorization' }); assert.equal(f.opened.length, 1);
  const old = f.channels[0]; old.receive({ type: 'desktop_exit' });
  assert.equal(f.manager.snapshot().status, 'error'); assert.equal(old.stopped, true);
  await f.connect(); old.receive({ type: 'desktop_exit' });
  assert.equal(f.manager.snapshot().status, 'connected');
});
