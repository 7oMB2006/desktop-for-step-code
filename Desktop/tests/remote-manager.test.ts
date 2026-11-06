import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteManager, parseRemoteAction, remoteDecision, type RemoteHost } from '../electron/remote-manager';
import type { SessionRuntime } from '../electron/session-runtimes';
import type { RuntimeEvent, UIRequest } from '../src/contracts';
import { remoteWorkspaceLimit, type RemoteSession } from '../src/remote';
import type { RemotePersistence, SavedRemote } from '../electron/remote-store';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const identity = { botId: 'bot', credentials: { appId: 'PRIVATE-APP', appSecret: 'PRIVATE-SECRET', brand: 'feishu' as const } };
function persistence(value?: SavedRemote) {
  let saved = value ? structuredClone(value) : undefined;
  const store: RemotePersistence = { load: async () => saved ? structuredClone(saved) : undefined,
    save: async value => { saved = value ? structuredClone(value) : undefined; } };
  return { store, read: () => saved };
}
function fixture(store?: RemotePersistence) {
  const workers = ['a', 'b'].map(id => ({
    id, cwd: `workspace-${id}`, state: { sessionId: `session-${id}`, sessionName: `Session ${id}` }, status: 'connected',
    busy: false, submissions: 0, operations: 0, pendingUI: new Map(), messages: [], rpc: {},
  } as unknown as SessionRuntime));
  const inputs: [string, string][] = [], answers: Record<string, unknown>[] = [], stops: string[] = [], opened: string[] = [];
  const saved: RemoteSession[] = [];
  const host: RemoteHost = {
    sessions: () => [...workers.map(worker => ({ runtimeId: worker.id, sessionId: worker.state!.sessionId!, workspace: worker.cwd, name: worker.state!.sessionName! })),
      ...saved.filter(session => !workers.some(worker => worker.state?.sessionId === session.sessionId))],
    refresh: async () => {},
    validateWorkspaces: async () => {},
    prepare: async sessionId => {
      const existing = workers.find(worker => worker.state?.sessionId === sessionId && worker.status === 'connected');
      if (existing) return existing;
      const session = saved.find(item => item.sessionId === sessionId);
      if (!session) throw new Error('Session not found');
      const worker = { ...workers[0], id: `loaded-${sessionId}`, cwd: session.workspace, state: { sessionId, sessionName: session.name },
        remoteAttached: false, pendingUI: new Map(), messages: [], rpc: {} } as unknown as SessionRuntime;
      workers.push(worker); return worker;
    },
    createSession: async workspace => {
      const worker = { ...workers[0], id: `new-${workers.length}`, cwd: workspace,
        state: { sessionId: `session-new-${workers.length}`, sessionName: 'New session' },
        remoteAttached: false, pendingUI: new Map(), messages: [], rpc: {} } as unknown as SessionRuntime;
      workers.push(worker); return worker;
    },
    worker: (id, sessionId) => {
      const worker = workers.find(worker => worker.id === id && worker.state?.sessionId === sessionId && worker.status === 'connected');
      if (!worker) throw new Error('Wrong identity');
      return worker;
    },
    submit: async (worker, message, accepted) => { inputs.push([worker.id, message]); accepted(`queue-${inputs.length}`); },
    stop: async worker => { stops.push(worker.id); },
    respond: (worker, answer) => {
      if (!worker.pendingUI.delete(String(answer.id))) throw new Error('Expired');
      answers.push(answer);
    },
    open: async url => { opened.push(url); },
  };
  const channels: { receive: (event: RuntimeEvent) => void; stopped: boolean; calls: { type: string; args: any }[] }[] = [];
  let operation = async (type: string, _args: any): Promise<any> =>
    type === 'snapshot' ? { identity, peer: { actor: 'human', chat: 'chat' } } : undefined;
  let now = Date.now();
  const manager = new RemoteManager(host, receive => {
    const channel = { receive, stopped: false, calls: [] as { type: string; args: any }[] };
    channels.push(channel);
    return {
      request: async (type, args) => { channel.calls.push({ type, args }); return await operation(type, args); },
      stop: async () => { channel.stopped = true; },
    };
  }, () => {}, () => now, store);
  const receive = (kind: string, fields = {}) => channels.at(-1)!.receive({ type: 'remote_channel', kind, ...fields });
  const connect = async () => {
    await manager.action({ type: 'connect' });
    receive('connected', { botName: 'Fixture bot', callbackUrl: 'https://open.feishu.cn/page/launcher?clientID=fixture' });
    if (store) { await tick(); await tick(); }
  };
  const bind = async (index = 0, workspaces?: string[]) => {
    await manager.action({ type: 'armBinding' });
    const arm = channels.at(-1)!.calls.slice().reverse().find(call => call.type === 'arm')!.args;
    receive('candidate', { armId: arm.armId, candidateId: 'candidate' });
    const worker = workers[index];
    await manager.action({ type: 'bind', candidateId: 'candidate', runtimeId: worker.id, sessionId: worker.state!.sessionId!, workspaces });
    return channels.at(-1)!.calls.slice().reverse().find(call => call.type === 'bind')!.args.bindingId;
  };
  return { manager, host, saved, workers, channels, inputs, answers, stops, opened, receive, connect, bind,
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

test('malformed selection fails closed but unrelated invalid commands do not lock the current target', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  f.receive('input', { bindingId, id: 'bad', text: '/help extra' });
  f.receive('input', { bindingId, id: 'ordinary', text: 'valid target' }); await tick();
  assert.deepEqual(f.inputs, [['a', 'valid target']]);
  f.receive('input', { bindingId, id: 'switch', text: '/session s1 extra' });
  f.receive('input', { bindingId, id: 'blocked', text: 'must not reach old target' }); await tick();
  assert.equal(f.inputs.length, 1);
  assert.equal(f.manager.snapshot().targetUnconfirmed, true);
});
test('a detached queued input retains withdrawal ownership without relighting its remote reaction', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  f.receive('input', { bindingId, id: 'queued-detach', text: 'later task' }); await tick();
  await f.manager.action({ type: 'detach', sessionId: 'session-a' });
  const reactions = () => f.channels[0].calls.filter(call => call.type === 'reaction');
  const before = reactions().length;
  f.manager.queueEvent(f.workers[0], 'queue-1', 'dispatching');
  f.manager.queueEvent(f.workers[0], 'queue-1', 'delivered'); await tick();
  assert.equal(reactions().length, before);
  assert.deepEqual(f.stops, []);
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_end' });
  await f.manager.action({ type: 'select', sessionId: 'session-a' });
  f.receive('input', { bindingId, id: 'settled-status', text: '/status' }); await tick();
  assert.match(f.channels[0].calls.filter(call => call.type === 'card').at(-1)!.args.text, /dispatched 0/);
});
test('local detach invalidates selections already waiting on refresh or cold preparation', async t => {
  for (const stage of ['refresh', 'prepare'] as const) {
    const f = fixture(); t.after(() => f.manager.shutdown());
    await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
    const hold = deferred();
    if (stage === 'refresh') f.host.refresh = async () => { await hold.promise; };
    else {
      f.saved.push({ sessionId: 'cold', workspace: 'workspace-a', name: 'Cold target' });
      const prepare = f.host.prepare;
      f.host.prepare = async id => { await hold.promise; return prepare(id); };
    }
    f.receive('input', { bindingId, id: 'waiting-select', text: `/session ${stage === 'refresh' ? 'session-a' : 'cold'}` });
    await tick();
    await f.manager.action({ type: 'detach', sessionId: 'session-a' });
    hold.resolve(); await tick();
    assert.equal(f.manager.snapshot().binding, undefined);
    assert.deepEqual(f.manager.snapshot().sharing, []);
    f.receive('input', { bindingId, id: 'after-detach', text: 'must remain blocked' }); await tick();
    assert.deepEqual(f.inputs, []);
  }
});
test('ordered remote detach, selection and prose keep their routing barriers', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  f.receive('input', { bindingId, id: 'detach-a', text: '/detach' });
  f.receive('input', { bindingId, id: 'select-b', text: '/session session-b' });
  f.receive('input', { bindingId, id: 'to-b', text: 'send only to b' }); await tick();
  assert.deepEqual(f.inputs, [['b', 'send only to b']]);
  assert.equal(Boolean(f.manager.snapshot().targetUnconfirmed), false);
  f.receive('input', { bindingId, id: 'detach-b', text: '/detach' });
  f.receive('input', { bindingId, id: 'blocked-prose', text: 'no target' }); await tick();
  assert.deepEqual(f.inputs, [['b', 'send only to b']]);
  assert.equal(f.manager.snapshot().targetUnconfirmed, true);
});
test('unavailable legacy short handles invalidate routing instead of falling through to the old target', async t => {
  const p = persistence({ version: 1, identity, access: { actor: 'human', chat: 'chat',
    workspaces: ['workspace-a', 'workspace-b'], sessionId: 'session-b' } });
  const f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.manager.resume(); f.receive('connected'); await tick(); await tick();
  const bindingId = f.channels[0].calls.find(call => call.type === 'bindSaved')!.args.bindingId;
  f.receive('input', { bindingId, id: 'unavailable-handle', text: '/session s1' });
  f.receive('input', { bindingId, id: 'must-not-use-b', text: 'wrong target' }); await tick();
  assert.deepEqual(f.inputs, []);
  assert.equal(f.manager.snapshot().targetUnconfirmed, true);
  f.receive('input', { bindingId, id: 'explicit-exact', text: '/session session-b' });
  f.receive('input', { bindingId, id: 'now-confirmed', text: 'correct target' }); await tick();
  assert.deepEqual(f.inputs, [['b', 'correct target']]);
});
test('image opt-in waits for saved confirmation and failed revocation stays disabled in memory', async t => {
  const p = persistence(), f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  const save = p.store.save, hold = deferred();
  p.store.save = async value => { await hold.promise; await save(value); };
  const enabling = f.manager.action({ type: 'images', allowed: true }); await tick();
  assert.equal(f.manager.snapshot().imagesAllowed, false);
  f.receive('input', { bindingId, id: 'not-granted-yet', text: '', images: ['image-key'] }); await tick();
  assert.deepEqual(f.inputs, []);
  hold.resolve(); await enabling;
  assert.equal(f.manager.snapshot().imagesAllowed, true);
  assert.equal(p.read()?.access?.imagesAllowed, true);
  p.store.save = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(f.manager.action({ type: 'images', allowed: false }), /disabled.*not be saved/);
  assert.equal(f.manager.snapshot().imagesAllowed, false);
  await assert.rejects(f.manager.action({ type: 'images', allowed: true }), /Could not save/);
  assert.equal(f.manager.snapshot().imagesAllowed, false);
});
test('initial binding cannot use an image grant before its save or retain a failed grant in memory', async t => {
  for (const success of [true, false]) {
    const p = persistence(), f = fixture(p.store), hold = deferred(); t.after(() => f.manager.shutdown());
    await f.connect(); await f.manager.action({ type: 'armBinding' });
    const arm = f.channels[0].calls.find(call => call.type === 'arm')!.args;
    f.receive('candidate', { armId: arm.armId, candidateId: 'candidate' });
    const save = p.store.save;
    p.store.save = async value => {
      await hold.promise;
      if (!success) throw new Error('disk unavailable');
      await save(value);
    };
    const binding = f.manager.action({ type: 'bind', candidateId: 'candidate', sessionId: 'session-a', imagesAllowed: true });
    await tick();
    assert.equal(f.manager.snapshot().imagesAllowed, false);
    hold.resolve(); await binding;
    assert.equal(f.manager.snapshot().imagesAllowed, success);
    assert.equal(p.read()?.access?.imagesAllowed === true, success);
  }
});
test('native image delivery is active-run scoped and optional captions follow only confirmed image messages', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); await f.bind();
  const worker = f.workers[0], calls: string[] = [];
  f.host.sendImage = async (_channel, _binding, session, owner, path, valid) => {
    assert.equal(valid(), true); assert.equal(owner, worker); assert.equal(path, 'chart.png');
    calls.push(session); return { messageId: 'native-image' };
  };
  await assert.rejects(f.manager.deliverImage(worker, 'chart.png'), /permission/);
  await f.manager.action({ type: 'images', allowed: true });
  await assert.rejects(f.manager.deliverImage(worker, 'chart.png'), /active/);
  f.manager.runtimeEvent(worker, { type: 'agent_start' }); await tick();
  const imageScopes = () => f.channels[0].calls.filter(call => call.type === 'imageScope').map(call => call.args);
  assert.equal(imageScopes().at(-1).active, true);
  const result = await f.manager.deliverImage(worker, 'chart.png', 'Requested chart');
  assert.equal(result.delivered, true); assert.equal(result.captionDelivered, true);
  assert.deepEqual(calls, ['session-a']);
  assert.equal(f.channels[0].calls.find(call => call.args?.key === 'image-native-image')?.args.text, 'Requested chart');
  f.host.sendImage = async () => { throw new Error('delivery uncertain'); };
  const before = f.channels[0].calls.length;
  await assert.rejects(f.manager.deliverImage(worker, 'chart.png', 'must not send alone'), /uncertain/);
  assert.equal(f.channels[0].calls.length, before);
  f.manager.runtimeEvent(worker, { type: 'desktop_task_completed' });
  assert.equal(imageScopes().at(-1).active, false);
  await assert.rejects(f.manager.deliverImage(worker, 'chart.png'), /active/);
});
test('tasks is read-only across authorized resident sessions and sharing is a separate scope', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  f.saved.push({ sessionId: 'cold', name: 'Never start this', workspace: 'workspace-a' });
  f.host.prepare = async () => { throw new Error('Read-only query started a runtime'); };
  f.workers[1].busy = true;
  f.receive('input', { bindingId, id: 'tasks', text: '/tasks' }); await tick();
  const card = f.channels[0].calls.filter(call => call.type === 'card').at(-1)!.args;
  assert.equal(card.overview.total, 1);
  assert.deepEqual(card.overview.rows.map((row: { name: string }) => row.name), ['Session b']);
  assert.equal(card.overview.rows[0].status, '运行中');
  assert.equal(card.overview.current, 's1 · Session a');
  f.host.language = () => 'en';
  f.receive('input', { bindingId, id: 'tasks-en', text: '/tasks' }); await tick();
  const english = f.channels[0].calls.filter(call => call.type === 'card').at(-1)!.args.overview;
  assert.equal(english.language, 'en'); assert.equal(english.rows[0].status, 'Running');
  assert.equal(f.workers[1].remoteAttached, undefined);
  f.receive('input', { bindingId, id: 'sharing', text: '/sharing' }); await tick();
  assert.doesNotMatch(f.channels[0].calls.filter(call => call.type === 'card').at(-1)!.args.text, /Session b/);
});
test('recall withdraws only the exact remotely queued input and detach does not cancel local work', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  const withdrawn: string[] = [];
  f.host.withdraw = (_worker, id) => { withdrawn.push(id); return true; };
  f.receive('input', { bindingId, id: 'one', text: 'queued input' }); await tick();
  f.workers[0].busy = true;
  await f.manager.action({ type: 'detach', sessionId: 'session-a' });
  assert.deepEqual(f.stops, []);
  assert.equal(f.workers[0].busy, true);
  assert.equal(f.manager.snapshot().sharing?.length, 0);
  f.receive('recalled', { bindingId: 'foreign', id: 'one' });
  assert.deepEqual(withdrawn, []);
  f.receive('recalled', { bindingId, id: 'one' });
  assert.deepEqual(withdrawn, ['queue-1']);
  assert.deepEqual(f.stops, []);
});
test('recall after dispatch or uncertain delivery cannot report cancellation or stop a task', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  let withdrawals = 0;
  f.host.withdraw = () => { withdrawals++; return true; };
  f.receive('input', { bindingId, id: 'one', text: 'start' }); await tick();
  f.manager.queueEvent(f.workers[0], 'queue-1', 'dispatching');
  f.manager.queueEvent(f.workers[0], 'queue-1', 'unknown');
  f.receive('recalled', { bindingId, id: 'one' }); await tick();
  assert.equal(withdrawals, 0);
  assert.deepEqual(f.stops, []);
  assert.match(f.channels[0].calls.filter(call => call.type === 'card').at(-1)!.args.text, /无法确认/);
});
test('image input needs explicit permission and recall during download prevents enqueue', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  const hold = deferred();
  let loads = 0;
  f.host.loadImages = async (_channel, _binding, _id, _keys, valid) => {
    loads++; await hold.promise;
    if (!valid()) throw new Error('Withdrawn');
    return [{ type: 'image', mimeType: 'image/png', data: 'fixture' }];
  };
  f.receive('input', { bindingId, id: 'no-permission', text: '', images: ['img'] }); await tick();
  assert.equal(loads, 0); assert.deepEqual(f.inputs, []);
  await f.manager.action({ type: 'images', allowed: true });
  f.receive('input', { bindingId, id: 'text-only-model', text: 'look', images: ['img'] }); await tick();
  assert.equal(loads, 0);
  assert.match(f.channels[0].calls.filter(call => call.type === 'card').at(-1)!.args.text, /does not declare image support/);
  f.workers[0].state!.model = { id: 'image-fixture', name: 'Image fixture', provider: 'fixture', input: ['text', 'image'] };
  f.receive('input', { bindingId, id: 'image', text: '', images: ['img'] }); await tick();
  assert.equal(loads, 1);
  f.receive('recalled', { bindingId, id: 'image' });
  hold.resolve(); await tick();
  assert.deepEqual(f.inputs, []);
});
test('recall before a routed operation starts is not lost behind another message', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  const hold = deferred(), original = f.host.submit;
  f.host.submit = async (...args) => { await original(...args); await hold.promise; };
  f.receive('input', { bindingId, id: 'first', text: 'first' });
  f.receive('input', { bindingId, id: 'second', text: 'withdraw before entering queue' });
  f.receive('recalled', { bindingId, id: 'second' });
  hold.resolve(); await tick();
  assert.deepEqual(f.inputs, [['a', 'first']]);
});
test('expired approvals show their state and status refreshes only the same pending original request', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  approval(f.workers[0]);
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' }); await tick();
  const original = f.channels[0].calls.filter(call => call.type === 'card' && call.args.actions).at(-1)!.args;
  f.now(Date.now() + 610000);
  f.receive('decision', { bindingId, token: original.actions.token, option: 'Allow once / 允许一次' }); await tick();
  assert.equal(f.answers.length, 0);
  assert.ok(f.channels[0].calls.some(call => call.type === 'revoke' && call.args.status === 'expired'));
  f.receive('input', { bindingId, id: 'refresh', text: '/status' }); await tick();
  const refreshed = f.channels[0].calls.filter(call => call.type === 'card' && call.args.actions).at(-1)!.args;
  assert.notEqual(refreshed.actions.token, original.actions.token);
  assert.equal(refreshed.key, original.key);
  f.receive('decision', { bindingId, token: original.actions.token, option: 'Allow once / 允许一次' });
  assert.equal(f.answers.length, 0);
  f.receive('decision', { bindingId, token: refreshed.actions.token, option: 'Deny / 拒绝' });
  assert.equal(f.answers.length, 1);
});
test('tools and truncation stay on the original reply card without leaking arguments or thinking', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); await f.bind();
  const worker = f.workers[0];
  f.manager.runtimeEvent(worker, { type: 'agent_start' });
  f.manager.runtimeEvent(worker, { type: 'tool_execution_start', toolCallId: 'call', toolName: 'run_command',
    args: { command: 'PRIVATE-COMMAND' } });
  f.manager.runtimeEvent(worker, { type: 'tool_execution_end', toolCallId: 'call', toolName: 'run_command',
    result: { content: [{ type: 'text', text: 'PRIVATE-OUTPUT' }] } });
  f.manager.runtimeEvent(worker, { type: 'message_end', message: { role: 'assistant', content: 'x'.repeat(6000) } });
  f.manager.runtimeEvent(worker, { type: 'desktop_task_completed' }); await tick();
  const cards = f.channels[0].calls.filter(call => call.type === 'card' && call.args.reply);
  assert.equal(new Set(cards.map(call => call.args.key)).size, 1);
  const final = cards.at(-1)!.args;
  assert.equal(final.truncated, true);
  assert.ok(final.progress);
  assert.doesNotMatch(JSON.stringify(cards), /PRIVATE-|tests passed/i);
});
test('normal shutdown retains encrypted-store input; resume uses stable session identity and fresh capabilities', async t => {
  const p = persistence(), first = fixture(p.store); t.after(() => first.manager.shutdown());
  await first.connect(); const oldBinding = await first.bind(1, ['workspace-a', 'workspace-b']);
  approval(first.workers[1]); first.manager.runtimeEvent(first.workers[1], { type: 'agent_start' }); await tick();
  await first.manager.shutdown();
  assert.equal(p.read()?.access?.sessionId, 'session-b');
  assert.doesNotMatch(JSON.stringify(p.read()), /runId|token|approval|rpc|runtimeId/);
  const next = fixture(p.store); t.after(() => next.manager.shutdown());
  next.workers[1].id = 'new-worker-b';
  await next.manager.resume();
  assert.deepEqual(next.channels[0].calls[0], { type: 'connect', args: { identity } });
  next.receive('connected', { botName: 'Fixture bot' }); await tick(); await tick();
  const binding = next.channels[0].calls.find(call => call.type === 'bindSaved')!.args;
  assert.notEqual(binding.bindingId, oldBinding);
  assert.deepEqual(binding.peer, { actor: 'human', chat: 'chat' });
  assert.equal(next.manager.snapshot().binding?.runtimeId, 'new-worker-b');
  assert.equal(next.manager.snapshot().approvalReady, false);
  assert.equal(next.manager.snapshot().saved, true);
  next.receive('input', { bindingId: oldBinding, id: 'old', text: 'must not replay' });
  next.receive('stop', { bindingId: binding.bindingId, runId: 'old-run' }); await tick();
  assert.deepEqual(next.inputs, []); assert.deepEqual(next.stops, []); assert.deepEqual(next.answers, []);
  assert.doesNotMatch(JSON.stringify(next.manager.snapshot()), /PRIVATE-|human|"chat"/);
  next.receive('input', { bindingId: binding.bindingId, id: 'fresh', text: 'new task' }); await tick();
  assert.deepEqual(next.inputs, [['new-worker-b', 'new task']]);
});
test('selection and creation update the saved target, while unbind removes only chat scope', async t => {
  const p = persistence(), f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  await f.manager.action({ type: 'select', sessionId: 'session-b' }); await tick();
  assert.equal(p.read()?.access?.sessionId, 'session-b');
  f.receive('input', { bindingId, id: 'new', text: '/new' }); await tick(); await tick();
  assert.equal(p.read()?.access?.sessionId, f.manager.snapshot().binding?.sessionId);
  await f.manager.action({ type: 'unbind' });
  assert.deepEqual(p.read(), { version: 1, identity });
  await f.manager.shutdown();
  const next = fixture(p.store); t.after(() => next.manager.shutdown());
  await next.manager.resume(); next.receive('connected'); await tick(); await tick();
  assert.equal(next.manager.snapshot().authorized, undefined);
  assert.equal(next.channels[0].calls.some(call => call.type === 'bindSaved'), false);
});
test('explicit disconnect forgets saved credentials and does not reconnect after restart', async () => {
  const p = persistence(), f = fixture(p.store);
  await f.connect(); await f.bind(); await f.manager.action({ type: 'disconnect' });
  assert.equal(p.read(), undefined);
  const next = fixture(p.store); await next.manager.resume();
  assert.equal(next.channels.length, 0);
});
test('removed saved sessions do not select another session or send inference', async t => {
  const p = persistence({ version: 1, identity,
    access: { actor: 'human', chat: 'chat', workspaces: ['workspace-a'], sessionId: 'deleted-session' } });
  const f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.manager.resume(); f.receive('connected'); await tick(); await tick();
  assert.equal(f.manager.snapshot().binding, undefined);
  assert.deepEqual(f.manager.snapshot().authorized, { workspaces: ['workspace-a'] });
  assert.equal(f.manager.snapshot().stage, 'runtime');
  assert.equal(p.read()?.access?.sessionId, undefined);
  assert.deepEqual(f.inputs, []);
});
test('changed or redirected saved projects lose chat access instead of widening authorization', async t => {
  const p = persistence({ version: 1, identity,
    access: { actor: 'human', chat: 'chat', workspaces: ['old-project'], sessionId: 'session-a' } });
  const f = fixture(p.store); t.after(() => f.manager.shutdown());
  f.host.validateWorkspaces = async () => { throw new Error('Project moved'); };
  await f.manager.resume(); f.receive('connected'); await tick(); await tick();
  assert.equal(f.manager.snapshot().authorized, undefined);
  assert.equal(f.manager.snapshot().stage, 'runtime');
  assert.equal(f.channels[0].calls.some(call => call.type === 'bindSaved'), false);
  assert.deepEqual(p.read(), { version: 1, identity });
});
test('late recovery and storage acknowledgments cannot resurrect an explicitly disconnected grant', async () => {
  const p = persistence({ version: 1, identity,
    access: { actor: 'human', chat: 'chat', workspaces: ['workspace-a'], sessionId: 'session-a' } });
  const f = fixture(p.store), hold = deferred();
  f.host.validateWorkspaces = () => hold.promise;
  await f.manager.resume(); f.receive('connected'); await tick();
  await f.manager.disconnect(); hold.resolve(); await tick();
  assert.equal(p.read(), undefined);
  assert.equal(f.manager.snapshot().status, 'idle');
  assert.equal(f.manager.snapshot().authorized, undefined);
  assert.equal(f.channels[0].calls.some(call => call.type === 'bindSaved'), false);
});
test('disconnect queues deletion after a pending save and late bind completion cannot restore access', async () => {
  const p = persistence(), f = fixture(p.store), hold = deferred();
  await f.connect();
  const save = p.store.save;
  p.store.save = async value => { if (value?.access) await hold.promise; await save(value); };
  const binding = f.bind(); await tick();
  const disconnect = f.manager.disconnect(); hold.resolve();
  await Promise.all([binding, disconnect]);
  assert.equal(p.read(), undefined);
  assert.equal(f.manager.snapshot().binding, undefined);
  assert.equal(f.manager.snapshot().status, 'idle');
  assert.equal(f.manager.snapshot().saved, false);
});
test('disconnect during a saved-chat acknowledgment cannot revive its binding or tokens', async () => {
  const p = persistence({ version: 1, identity,
    access: { actor: 'human', chat: 'chat', workspaces: ['workspace-a'], sessionId: 'session-a' } });
  const f = fixture(p.store), hold = deferred();
  f.operation(async type => {
    if (type === 'snapshot') return { identity };
    if (type === 'bindSaved') await hold.promise;
  });
  await f.manager.resume(); f.receive('connected'); await tick();
  await assert.rejects(f.manager.action({ type: 'unbind' }), /restored/);
  await f.manager.disconnect(); hold.resolve(); await tick();
  assert.equal(p.read(), undefined);
  assert.equal(f.manager.snapshot().binding, undefined);
  assert.deepEqual(f.inputs, []); assert.deepEqual(f.answers, []);
});
test('storage errors stay local to Remote and never expose raw credential exceptions', async t => {
  const store: RemotePersistence = { load: async () => { throw new Error('PRIVATE-SECRET'); },
    save: async () => { throw new Error('PRIVATE-SECRET'); } };
  const f = fixture(store); t.after(() => f.manager.shutdown());
  await f.manager.resume();
  assert.equal(f.manager.snapshot().storageError, true);
  assert.equal(f.channels.length, 0);
  assert.doesNotMatch(JSON.stringify(f.manager.snapshot()), /PRIVATE-/);
  await f.connect();
  assert.equal(f.manager.snapshot().status, 'connected');
  assert.equal(f.manager.snapshot().storageError, true);
  assert.equal(f.manager.snapshot().saved, false);
});
test('transport failure preserves the saved connection for a deliberate retry', async t => {
  const p = persistence(), f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.connect(); await f.bind();
  f.receive('error', { stage: 'transport' }); await tick();
  assert.equal(f.manager.snapshot().status, 'error');
  assert.ok(p.read()?.access);
  await f.manager.action({ type: 'connect' });
  assert.deepEqual(f.channels.at(-1)!.calls[0].args, { identity });
});

test('IPC admits only the narrow Remote action schema', () => {
  for (const value of [null, [], { type: 'prompt' }, { type: 'bind', runtimeId: '../arbitrary' }])
    assert.throws(() => parseRemoteAction(value));
  assert.deepEqual(parseRemoteAction({ type: 'connect', credentials: 'discard' }), { type: 'connect' });
});
test('IPC enforces an explicit bounded project scope without duplicate grants', () => {
  const action = { type: 'bind', candidateId: 'candidate', sessionId: 'session-a' };
  for (const workspaces of [[], ['workspace-a', 'workspace-a'], [null], [''], Array.from({ length: remoteWorkspaceLimit + 1 }, (_, index) => `workspace-${index}`)])
    assert.throws(() => parseRemoteAction({ ...action, workspaces }), /scope/);
  const workspaces = Array.from({ length: remoteWorkspaceLimit }, (_, index) => `workspace-${index}`);
  assert.deepEqual(parseRemoteAction({ ...action, workspaces }), { ...action, runtimeId: undefined, workspaces });
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
test('accepted messages use one original-message reaction, not a Received card, until that input finishes', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  f.receive('input', { bindingId, id: 'original', text: 'hello' });
  f.receive('input', { bindingId, id: 'original', text: 'duplicate' }); await tick();
  const reactions = () => f.channels[0].calls.filter(call => call.type === 'reaction').map(call => call.args);
  assert.deepEqual(reactions(), [{ bindingId, messageId: 'original', active: true, phase: 'queued' }]);
  assert.equal(f.channels[0].calls.some(call => call.type === 'card' && call.args.title.startsWith('Received')), false);
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  f.manager.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_end' }); await tick();
  assert.deepEqual(reactions(), [{ bindingId, messageId: 'original', active: true, phase: 'queued' },
    { bindingId, messageId: 'original', active: true, phase: 'running' },
    { bindingId, messageId: 'original', active: false }]);
  f.manager.runtimeEvent(f.workers[0], { type: 'desktop_task_completed' }); await tick();
  assert.equal(reactions().length, 3);
});
test('ending one turn does not clear a later message still in the local queue', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  for (const id of ['one', 'two']) f.receive('input', { bindingId, id, text: 'same content' });
  await tick();
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  f.manager.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_end' }); await tick();
  const removed = () => f.channels[0].calls.filter(call => call.type === 'reaction' && !call.args.active).map(call => call.args.messageId);
  assert.deepEqual(removed(), ['one']);
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  f.manager.queueEvent(f.workers[0], 'unrelated-local-queue-id', 'delivered');
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_end' }); await tick();
  assert.deepEqual(removed(), ['one']);
  f.manager.queueEvent(f.workers[0], 'queue-2', 'delivered');
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_end' }); await tick();
  assert.deepEqual(removed(), ['one', 'two']);
});
test('removal, dispatch failure and interruption release receipts without replaying queued inputs', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  f.receive('input', { bindingId, id: 'removed', text: 'queued one' }); await tick();
  f.manager.queueEvent(f.workers[0], 'queue-1', 'removed'); await tick();
  f.receive('input', { bindingId, id: 'failed', text: 'queued two' }); await tick();
  f.manager.queueFailed(f.workers[0]); await tick();
  f.receive('input', { bindingId, id: 'stopped', text: 'queued three' }); await tick();
  f.workers[0].interrupted = true;
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_end' }); await tick();
  assert.deepEqual(f.channels[0].calls.filter(call => call.type === 'reaction' && !call.args.active).map(call => call.args.messageId),
    ['removed', 'failed', 'stopped']);
  assert.deepEqual(f.inputs.map(input => input[1]), ['queued one', 'queued two', 'queued three']);
});
test('failed or delayed reactions do not block submissions or terminal cleanup', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  const hold = deferred();
  f.operation(async (type, args) => {
    if (type === 'reaction' && args.active) await hold.promise;
  });
  f.receive('input', { bindingId, id: 'fast', text: 'fast task' }); await tick();
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  f.manager.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_end' });
  f.receive('input', { bindingId, id: 'next', text: 'next task' }); await tick();
  assert.equal(f.inputs.length, 2);
  assert.ok(f.channels[0].calls.some(call => call.type === 'reaction' && call.args.messageId === 'fast' && !call.args.active));
  hold.reject(new Error('PRIVATE-SECRET')); await tick();
  assert.equal(f.manager.snapshot().status, 'connected');
  assert.equal(f.manager.snapshot().stage, 'delivery');
  assert.doesNotMatch(JSON.stringify(f.manager.snapshot()), /PRIVATE-/);
});
test('reaction cleanup remains on its original session across switching and worker exit', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  f.receive('input', { bindingId, id: 'a-message', text: 'a work' }); await tick();
  await f.manager.action({ type: 'select', sessionId: 'session-b' });
  f.receive('input', { bindingId, id: 'b-message', text: 'b work' }); await tick();
  f.manager.dispose(f.workers[0]); await tick();
  let removed = f.channels[0].calls.filter(call => call.type === 'reaction' && !call.args.active);
  assert.deepEqual(removed.map(call => call.args.messageId), ['a-message']);
  await f.manager.action({ type: 'unbind' });
  removed = f.channels[0].calls.filter(call => call.type === 'reaction' && !call.args.active);
  assert.deepEqual(removed.map(call => call.args.messageId), ['a-message', 'b-message']);
});
test('help and bare session are handled locally; rejection and slash commands get no processing reaction', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  for (const [id, text] of [['help', '/help'], ['session', '/session']]) f.receive('input', { bindingId, id, text });
  await tick();
  const cards = f.channels[0].calls.filter(call => call.type === 'card');
  assert.ok(cards.some(call => call.args.key !== 'welcome' && call.args.text.includes('/sessions [p1] [page]')));
  assert.ok(cards.some(call => call.args.text.includes('/session s1')));
  assert.deepEqual(f.inputs, []);
  f.host.submit = async () => { throw new Error('Not accepted'); };
  f.receive('input', { bindingId, id: 'rejected', text: 'must not run' }); await tick();
  assert.equal(f.channels[0].calls.some(call => call.type === 'reaction'), false);
  assert.ok(f.channels[0].calls.some(call => call.args?.title?.startsWith('Not accepted')));
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
test('only authoritative completion labels success; stop requires the slash command, not old card callbacks', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  const worker = f.workers[0];
  f.manager.runtimeEvent(worker, { type: 'agent_start' }); await tick();
  const first = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  f.manager.runtimeEvent(worker, { type: 'message_end', message: { role: 'assistant', content: 'answer' } });
  f.manager.runtimeEvent(worker, { type: 'agent_end' }); await tick();
  assert.equal(f.channels[0].calls.filter(call => call.type === 'card' && call.args.key === first.key).length, 1);
  f.manager.runtimeEvent(worker, { type: 'desktop_task_completed' }); await tick();
  const completed = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  assert.equal(completed.reply, 'completed');
  assert.equal(completed.key, first.key);
  assert.equal(completed.title, 's1 · Session a');
  assert.equal(completed.text, 'answer');
  f.manager.runtimeEvent(worker, { type: 'agent_start' });
  f.receive('stop', { bindingId, runId: first.key }); assert.deepEqual(f.stops, []);
  await tick();
  const current = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  f.receive('stop', { bindingId, runId: current.key }); await tick();
  assert.deepEqual(f.stops, []);
  f.receive('input', { bindingId, id: 'slash-stop', text: '/stop' }); await tick();
  assert.deepEqual(f.stops, ['a']);
});
test('projection coalesces while delivery is stalled and never leaks thinking, tools or history', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); await f.bind();
  await tick();
  const hold = deferred();
  f.operation(async type => { if (type === 'card') await hold.promise; });
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  for (let i = 0; i < 100; i++) f.manager.runtimeEvent(f.workers[0], { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'SECRET THINKING' } });
  f.manager.runtimeEvent(f.workers[0], { type: 'message_end', message: { role: 'assistant', content: 'safe answer' } });
  f.manager.runtimeEvent(f.workers[0], { type: 'desktop_task_completed' });
  assert.equal(f.channels[0].calls.filter(call => call.type === 'card' && call.args.key !== 'welcome').length, 1);
  hold.resolve(); await tick(); await tick();
  const cards = f.channels[0].calls.filter(call => call.type === 'card' && call.args.key !== 'welcome');
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
  assert.equal(card.reply, 'interrupted');
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

test('one private-chat authorization switches sessions without unbinding or forwarding slash commands', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd));
  f.receive('input', { bindingId, id: 'switch', text: '/session session-b' });
  f.receive('input', { bindingId, id: 'follow', text: 'follow switched session' });
  await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-b');
  assert.deepEqual(f.inputs, [['b', 'follow switched session']]);
  assert.equal(f.channels[0].calls.filter(call => call.type === 'bind').length, 1);
  assert.equal(f.channels[0].calls.filter(call => call.type === 'unbind').length, 0);
  assert.equal(f.workers[0].remoteAttached, true);
  assert.equal(f.workers[1].remoteAttached, true);
});

test('accepted messages retain their ordered target across a blocked submission and local switching', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd));
  const hold = deferred(), submit = f.host.submit;
  f.host.submit = async (worker, text, accepted) => { await submit(worker, text, accepted); if (text === 'first') await hold.promise; };
  f.receive('input', { bindingId, id: 'one', text: 'first' });
  f.receive('input', { bindingId, id: 'two', text: 'before switching' });
  const switching = f.manager.action({ type: 'select', sessionId: 'session-b' });
  f.receive('input', { bindingId, id: 'three', text: 'after switching' });
  await tick();
  assert.deepEqual(f.inputs, [['a', 'first']]);
  hold.resolve(); await switching; await tick();
  assert.deepEqual(f.inputs, [['a', 'first'], ['a', 'before switching'], ['b', 'after switching']]);
});

test('project scope hides other sessions and failed switching blocks subsequent input until explicit confirmation', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  f.receive('input', { bindingId, id: 'list', text: '/sessions' }); await tick();
  const list = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(list, /Session a/); assert.doesNotMatch(list, /Session b/);
  f.receive('input', { bindingId, id: 'switch', text: '/session session-b' });
  f.receive('input', { bindingId, id: 'next', text: 'still a' }); await tick();
  assert.deepEqual(f.inputs, []);
  assert.equal(f.manager.snapshot().targetUnconfirmed, true);
  f.receive('input', { bindingId, id: 'current', text: '/current' });
  f.receive('input', { bindingId, id: 'blocked', text: 'not confirmed yet' }); await tick();
  assert.deepEqual(f.inputs, []);
  f.receive('input', { bindingId, id: 'confirm', text: '/session session-a' });
  f.receive('input', { bindingId, id: 'confirmed', text: 'confirmed a' }); await tick();
  assert.deepEqual(f.inputs, [['a', 'confirmed a']]);
  assert.equal(f.manager.snapshot().targetUnconfirmed, undefined);
  await assert.rejects(f.manager.action({ type: 'select', sessionId: 'session-b' }), /scope/);
  assert.equal(f.workers[1].remoteAttached, undefined);
});

test('saved sessions are listed without loading or sending transcript content, then explicitly prepared', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect());
  f.saved.push({ sessionId: 'history-c', workspace: 'workspace-a', name: 'Saved C' });
  let prepared = 0;
  const prepare = f.host.prepare;
  f.host.prepare = async id => { prepared++; return prepare(id); };
  await f.connect(); const bindingId = await f.bind();
  f.receive('input', { bindingId, id: 'list', text: '/sessions' }); await tick();
  assert.equal(prepared, 1);
  const list = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(list, /s2 · Saved C/);
  f.receive('input', { bindingId, id: 'switch', text: '/session s2' });
  f.receive('input', { bindingId, id: 'next', text: 'resume saved session' }); await tick();
  assert.equal(prepared, 2);
  assert.equal(f.manager.snapshot().binding?.sessionId, 'history-c');
  assert.deepEqual(f.inputs, [['loaded-history-c', 'resume saved session']]);
});

test('session trees preserve project grants, display aliases and original session handles', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect());
  f.saved.push({ sessionId: 'saved-a', name: 'History A', workspace: 'workspace-a' });
  const sessions = f.host.sessions;
  f.host.sessions = () => sessions().map(session => ({ ...session,
    workspaceName: session.workspace === 'workspace-a' ? 'Desktop project' : 'Docs project' }));
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  f.receive('input', { bindingId, id: 'tree', text: '/session' }); await tick();
  const list = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(list, /p1 · Desktop project \(2\)\n  ├─ s1 · Session a ← 当前 \/ Current\n  └─ s3 · History A/);
  assert.match(list, /p2 · Docs project \(1\)\n  └─ s2 · Session b/);
  assert.deepEqual(f.inputs, []);
  assert.equal(f.workers.length, 2);
  f.receive('input', { bindingId, id: 'projects', text: '/projects' }); await tick();
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text,
    /p1 · Desktop project \(2\)\n\/sessions p1\n\np2 · Docs project \(1\)/);
  f.receive('input', { bindingId, id: 'switch-tree', text: '/session s3' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'saved-a');
  assert.deepEqual(f.inputs, []);
});

test('new sessions use only locally authorized projects and do not send inference until a later message', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd));
  f.receive('input', { bindingId, id: 'new', text: '/new p2' }); await tick();
  assert.equal(f.manager.snapshot().binding?.workspace, 'workspace-b');
  assert.deepEqual(f.inputs, []);
  assert.equal(f.workers.length, 3);
  f.receive('input', { bindingId, id: 'outside', text: '/new C:/unauthorized' }); await tick();
  assert.equal(f.workers.length, 3);
  f.receive('input', { bindingId, id: 'follow', text: 'first new-session request' }); await tick();
  assert.deepEqual(f.inputs, [], 'A failed creation must not silently send follow-up to the previous target');
  f.receive('input', { bindingId, id: 'confirm-new', text: '/session session-new-2' });
  f.receive('input', { bindingId, id: 'retry-follow', text: 'first new-session request' }); await tick();
  assert.deepEqual(f.inputs, [['new-2', 'first new-session request']]);
});

test('switching keeps original-session approval and stop capabilities independent of the current target', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd));
  const a = f.workers[0], b = f.workers[1];
  f.manager.runtimeEvent(a, { type: 'agent_start' }); await tick();
  f.manager.runtimeEvent(a, approval(a)); await tick();
  const firstApproval = f.channels[0].calls.slice().reverse().find(call => call.args?.actions?.options.includes('Deny / 拒绝'))!.args;
  await f.manager.action({ type: 'select', sessionId: 'session-b' });
  f.manager.runtimeEvent(b, { type: 'agent_start' });
  f.manager.runtimeEvent(b, approval(b)); await tick();
  f.receive('decision', { bindingId, token: firstApproval.actions.token, option: 'Allow once / 允许一次' });
  assert.equal(a.pendingUI.size, 0); assert.equal(b.pendingUI.size, 1);
  f.receive('input', { bindingId, id: 'stop-original', text: '/stop s1' }); await tick();
  assert.deepEqual(f.stops, ['a']);
  f.manager.runtimeEvent(a, { type: 'message_end', message: { role: 'assistant', content: 'A finished' } });
  f.manager.runtimeEvent(a, { type: 'desktop_task_completed' }); await tick();
  const completed = f.channels[0].calls.slice().reverse().find(call => call.args?.reply === 'completed')!.args;
  assert.match(completed.title, /s1 · Session a/);
  assert.equal(completed.text, 'A finished');
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-b');
});

test('selecting an already running resident observes its task and pending approval without forwarding existing prose', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd)), worker = f.workers[1];
  worker.busy = true; worker.runActive = true;
  worker.messages.push({ role: 'assistant', content: 'PRIVATE-EXISTING-PROSE' });
  const request = approval(worker);
  await f.manager.action({ type: 'select', sessionId: 'session-b' }); await tick();
  const calls = f.channels[0].calls.filter(call => call.type === 'card');
  const working = calls.find(call => call.args.reply === 'working')!.args;
  assert.equal(working.sessionKey, 'session-b');
  assert.equal(working.text, '');
  const decision = calls.find(call => call.args.actions?.options.includes('Deny / 拒绝'))!.args;
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE-EXISTING-PROSE/);
  f.receive('decision', { bindingId, token: decision.actions.token, option: 'Deny / 拒绝' });
  assert.equal(worker.pendingUI.has(request.id), false);
  assert.deepEqual(f.answers, [{ id: request.id, confirmed: false }]);
  f.receive('input', { bindingId, id: 'stop-resident', text: '/stop s2' }); await tick();
  assert.deepEqual(f.stops, ['b']);
  assert.deepEqual(f.inputs, []);
});

test('queued slash stop never interrupts a newer run in the same session', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  const hold = deferred(), submit = f.host.submit;
  f.host.submit = async (worker, text, accepted) => { await submit(worker, text, accepted); await hold.promise; };
  f.receive('input', { bindingId, id: 'hold', text: 'queued input' }); await tick();
  f.receive('input', { bindingId, id: 'stop', text: '/stop' }); await tick();
  f.manager.runtimeEvent(f.workers[0], { type: 'desktop_task_completed' });
  f.manager.runtimeEvent(f.workers[0], { type: 'agent_start' });
  hold.resolve(); await tick(); await tick();
  assert.deepEqual(f.stops, []);
});

test('unbinding during cold-session preparation cannot reauthorize a late target or follow-up', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd));
  const hold = deferred(), prepare = f.host.prepare;
  f.host.prepare = async id => { await hold.promise; return prepare(id); };
  f.receive('input', { bindingId, id: 'switch', text: '/session session-b' }); await tick();
  f.receive('input', { bindingId, id: 'follow', text: 'must not deliver' });
  await f.manager.action({ type: 'unbind' });
  hold.resolve(); await tick(); await tick();
  assert.equal(f.manager.snapshot().authorized, undefined);
  assert.equal(f.workers[1].remoteAttached, undefined);
  assert.deepEqual(f.inputs, []);
});

test('one worker exit retains private-chat authorization and other-session control', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect();
  const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd));
  await f.manager.action({ type: 'select', sessionId: 'session-b' });
  f.manager.dispose(f.workers[0]);
  assert.ok(f.manager.snapshot().authorized);
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-b');
  assert.equal(f.manager.snapshot().stage, 'runtime');
  await f.manager.action({ type: 'select', sessionId: 'session-b' });
  assert.equal(f.manager.snapshot().stage, undefined);
  f.receive('input', { bindingId, id: 'next', text: 'still authorized' }); await tick();
  assert.deepEqual(f.inputs, [['b', 'still authorized']]);
  f.manager.dispose(f.workers[1]);
  assert.equal(f.manager.snapshot().binding, undefined);
  assert.ok(f.manager.snapshot().authorized);
  f.receive('input', { bindingId, id: 'help', text: '/help' }); await tick();
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text, /\/sessions/);
});

test('sequential new sessions release idle attachments without changing their stable handles', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  for (let index = 0; index < 10; index++) {
    f.receive('input', { bindingId, id: `new-${index}`, text: '/new' }); await tick();
    assert.ok(f.workers.filter(worker => worker.remoteAttached).length <= 8);
  }
  assert.equal(f.workers.filter(worker => worker.remoteAttached).length, 8);
  assert.equal(f.workers[0].remoteAttached, false);
  f.receive('input', { bindingId, id: 'list', text: '/sessions' }); await tick();
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text, /s1 · Session a/);
  f.receive('input', { bindingId, id: 'return', text: '/session s1' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  assert.equal(f.workers.filter(worker => worker.remoteAttached).length, 8);
  assert.deepEqual(f.inputs, []);
});

test('eight active attachments reject cold selection and creation before spawning another runtime', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  f.saved.push({ sessionId: 'cold-extra', workspace: 'workspace-a', name: 'Cold extra' });
  const running = () => {
    const worker = f.workers.find(worker => worker.id === f.manager.snapshot().binding?.runtimeId)!;
    worker.busy = true; f.manager.runtimeEvent(worker, { type: 'agent_start' });
  };
  running();
  for (let index = 0; index < 7; index++) {
    f.receive('input', { bindingId, id: `new-${index}`, text: '/new' }); await tick(); running();
  }
  assert.equal(f.workers.filter(worker => worker.remoteAttached).length, 8);
  const current = f.manager.snapshot().binding?.sessionId, count = f.workers.length;
  let created = 0, prepared = 0;
  const createSession = f.host.createSession, prepare = f.host.prepare;
  f.host.createSession = async workspace => { created++; return createSession(workspace); };
  f.host.prepare = async sessionId => { prepared++; return prepare(sessionId); };
  await assert.rejects(f.manager.action({ type: 'select', sessionId: 'cold-extra' }), /Eight sessions/);
  f.receive('input', { bindingId, id: 'over-limit', text: '/new' }); await tick();
  assert.equal(created, 0); assert.equal(prepared, 0); assert.equal(f.workers.length, count);
  assert.equal(f.manager.snapshot().binding?.sessionId, current);
  assert.equal(f.workers.filter(worker => worker.remoteAttached).length, 8);
  assert.deepEqual(f.inputs, []);
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.title, /^Not accepted/);
});

test('pagination retains stable handles after catalog order changes and status does not load a cold session', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect());
  for (let index = 0; index < 12; index++) f.saved.push({ sessionId: `saved-${index}`, workspace: 'workspace-a', name: `Saved ${index}` });
  await f.connect(); const bindingId = await f.bind();
  f.receive('input', { bindingId, id: 'list-page2', text: '/sessions 2' }); await tick();
  const page = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(page, /^会话 \/ Sessions · 13 · 2 \/ 2/); assert.match(page, /s11 · Saved 9/); assert.doesNotMatch(page, /s2 · Saved 0/);
  let prepared = 0;
  f.host.prepare = async () => { prepared++; throw new Error('Read-only commands must not prepare'); };
  f.saved.reverse();
  f.receive('input', { bindingId, id: 'status', text: '/status s11' }); await tick();
  const status = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(status, /s11 · Saved 9/); assert.match(status, /Runtime not loaded/);
  assert.equal(prepared, 0);
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  assert.deepEqual(f.inputs, []);
});

test('slash disconnect revokes remote control without stopping local work or answering its pending approval', async t => {
  const f = fixture(); t.after(() => f.manager.disconnect()); await f.connect(); const bindingId = await f.bind();
  const worker = f.workers[0], request = approval(worker);
  worker.busy = true; f.manager.runtimeEvent(worker, { type: 'agent_start' }); await tick();
  f.receive('input', { bindingId, id: 'disconnect', text: '/disconnect' }); await tick();
  assert.equal(f.manager.snapshot().status, 'idle');
  assert.equal(f.manager.snapshot().authorized, undefined);
  assert.equal(f.channels[0].stopped, true);
  assert.equal(worker.remoteAttached, false);
  assert.equal(worker.busy, true);
  assert.equal(worker.pendingUI.get(request.id), request);
  f.receive('input', { bindingId, id: 'late', text: 'must not deliver' }); await tick();
  assert.deepEqual(f.stops, []); assert.deepEqual(f.answers, []); assert.deepEqual(f.inputs, []);
});

test('saved handles retain the same session after selecting another project and restarting', async t => {
  const p = persistence(), first = fixture(p.store); t.after(() => first.manager.shutdown());
  await first.connect(); const bindingId = await first.bind(0, ['workspace-a', 'workspace-b']);
  first.receive('input', { bindingId, id: 'list', text: '/sessions' }); await tick();
  first.receive('input', { bindingId, id: 'select', text: '/session s2' }); await tick();
  assert.equal(first.manager.snapshot().binding?.sessionId, 'session-b');
  await first.manager.shutdown();
  assert.deepEqual(p.read()?.access?.sessionRefs, [['session-a', 's1'], ['session-b', 's2']]);
  const second = fixture(p.store); t.after(() => second.manager.shutdown());
  await second.manager.resume(); second.receive('connected'); await tick(); await tick();
  const restored = second.channels[0].calls.find(call => call.type === 'bindSaved')!.args.bindingId;
  second.receive('input', { bindingId: restored, id: 'old-s1', text: '/session s1' }); await tick();
  assert.equal(second.manager.snapshot().binding?.sessionId, 'session-a');
  second.receive('input', { bindingId: restored, id: 'task', text: 'correct project' }); await tick();
  assert.deepEqual(second.inputs, [['a', 'correct project']]);
});

test('failed list writes never publish or accept new handles, while confirmed handles remain usable', async t => {
  const p = persistence(), f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  const save = p.store.save;
  p.store.save = async () => { throw new Error('Storage unavailable'); };
  const lastCard = () => f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args;
  f.receive('input', { bindingId, id: 'failed-list', text: '/sessions' }); await tick();
  assert.match(lastCard().title, /^Not accepted/);
  assert.doesNotMatch(lastCard().text, /s2/);
  f.receive('input', { bindingId, id: 'unconfirmed', text: '/session s2' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  f.receive('input', { bindingId, id: 'exact-select', text: '/session session-b' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-b');
  assert.match(lastCard().text, /session-b · Session b/);
  assert.doesNotMatch(lastCard().text, /s2 ·/);
  f.receive('input', { bindingId, id: 'exact-status', text: '/status session-b' }); await tick();
  assert.match(lastCard().text, /session-b · Session b/);
  assert.doesNotMatch(lastCard().text, /s2 ·/);
  f.receive('input', { bindingId, id: 'confirmed', text: '/session s1' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  assert.match(lastCard().text, /s1 · Session a/);
  assert.deepEqual(p.read()?.access?.sessionRefs, [['session-a', 's1']]);
  p.store.save = save;
  f.receive('input', { bindingId, id: 'retry-list', text: '/sessions' }); await tick();
  assert.match(lastCard().text, /s2 · Session b/);
  f.receive('input', { bindingId, id: 'confirmed-later', text: '/session s2' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-b');
  assert.deepEqual(f.inputs, []);
});

test('new-session feedback falls back to the exact ID until its handle can be saved', async t => {
  const p = persistence(), f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind();
  p.store.save = async () => { throw new Error('Storage unavailable'); };
  f.receive('input', { bindingId, id: 'new', text: '/new' }); await tick();
  const text = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(text, /session-new-2 · New session/);
  assert.doesNotMatch(text, /s2 ·/);
  f.receive('input', { bindingId, id: 'unpublished', text: '/session s2' }); await tick();
  assert.match(f.channels[0].calls.at(-1)!.args.title, /^Not accepted/);
  assert.deepEqual(p.read()?.access?.sessionRefs, [['session-a', 's1']]);
  assert.deepEqual(f.inputs, []);
});

test('recovering storage through current preserves old mappings and restart cannot renumber disclosed handles', async t => {
  const p = persistence(), first = fixture(p.store); t.after(() => first.manager.shutdown());
  await first.connect(); const bindingId = await first.bind(0, ['workspace-a', 'workspace-b']);
  first.receive('input', { bindingId, id: 'listed', text: '/sessions' }); await tick();
  const save = p.store.save;
  p.store.save = async () => { throw new Error('Storage unavailable'); };
  first.saved.push({ sessionId: 'history', workspace: 'workspace-a', name: 'History' });
  first.receive('input', { bindingId, id: 'failed-refresh', text: '/sessions' }); await tick();
  p.store.save = save;
  first.receive('input', { bindingId, id: 'current', text: '/current' }); await tick();
  assert.deepEqual(p.read()?.access?.sessionRefs, [['session-a', 's1'], ['session-b', 's2'], ['history', 's3']]);
  await first.manager.shutdown();
  const next = fixture(p.store); t.after(() => next.manager.shutdown());
  next.workers.reverse();
  await next.manager.resume(); next.receive('connected'); await tick(); await tick();
  const restored = next.channels[0].calls.find(call => call.type === 'bindSaved')!.args.bindingId;
  next.receive('input', { bindingId: restored, id: 'old-s2', text: '/session s2' }); await tick();
  assert.equal(next.manager.snapshot().binding?.sessionId, 'session-b');
  next.receive('input', { bindingId: restored, id: 'old-s1', text: '/session s1' }); await tick();
  assert.equal(next.manager.snapshot().binding?.sessionId, 'session-a');
  assert.deepEqual(next.inputs, []);
});

test('same-process transport recovery does not confirm an unsuccessful handle write', async t => {
  const p = persistence(), f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  p.store.save = async () => { throw new Error('Storage unavailable'); };
  f.receive('input', { bindingId, id: 'failed-list', text: '/sessions' }); await tick();
  f.receive('error', { stage: 'transport' }); await tick();
  await f.manager.action({ type: 'connect' });
  f.receive('connected'); await tick(); await tick();
  const restored = f.channels.at(-1)!.calls.find(call => call.type === 'bindSaved')!.args.bindingId;
  f.receive('input', { bindingId: restored, id: 'not-durable', text: '/session s2' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  assert.match(f.channels.at(-1)!.calls.at(-1)!.args.title, /^Not accepted/);
  f.receive('input', { bindingId: restored, id: 'durable', text: '/session s1' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  assert.deepEqual(p.read()?.access?.sessionRefs, [['session-a', 's1']]);
});

test('initial binding never advertises a short handle when the first grant cannot be saved', async t => {
  const p = persistence(), f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.connect();
  const save = p.store.save;
  p.store.save = async () => { throw new Error('Storage unavailable'); };
  const bindingId = await f.bind();
  const welcome = f.channels[0].calls.find(call => call.args?.key === 'welcome')!.args.text;
  assert.match(welcome, /Current: session-a · Session a/);
  assert.doesNotMatch(welcome, /s1 · Session a/);
  f.receive('input', { bindingId, id: 'not-durable', text: '/status s1' }); await tick();
  assert.match(f.channels[0].calls.at(-1)!.args.title, /^Not accepted/);
  p.store.save = save;
  f.receive('input', { bindingId, id: 'retry-list', text: '/sessions' }); await tick();
  assert.match(f.channels[0].calls.at(-1)!.args.text, /s1 · Session a/);
  assert.deepEqual(p.read()?.access?.sessionRefs, [['session-a', 's1']]);
});

test('a delayed initial save confirms only its own handle snapshot, not a later failed list', async t => {
  const p = persistence(), f = fixture(p.store), hold = deferred(); t.after(() => f.manager.shutdown());
  await f.connect();
  const save = p.store.save;
  let initial = true;
  p.store.save = async value => {
    if (!value?.access) return save(value);
    if (!initial) throw new Error('Storage unavailable');
    initial = false; await hold.promise; await save(value);
  };
  const binding = f.bind(0, ['workspace-a', 'workspace-b']); await tick();
  const bindingId = f.channels[0].calls.find(call => call.type === 'bind')!.args.bindingId;
  f.receive('input', { bindingId, id: 'pending-list', text: '/sessions' }); await tick();
  hold.resolve(); await binding; await tick();
  assert.deepEqual(p.read()?.access?.sessionRefs, [['session-a', 's1']]);
  f.receive('input', { bindingId, id: 'not-saved', text: '/session s2' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  assert.match(f.channels[0].calls.at(-1)!.args.title, /^Not accepted/);
  assert.deepEqual(f.inputs, []);
});

test('worker exit during a failed first grant save keeps authorization without confirming provisional handles', async t => {
  const p = persistence(), f = fixture(p.store), hold = deferred(); t.after(() => f.manager.shutdown());
  await f.connect();
  p.store.save = async () => { await hold.promise; throw new Error('Storage unavailable'); };
  const binding = f.bind(); await tick();
  f.manager.dispose(f.workers[0]); hold.resolve(); await binding; await tick();
  assert.equal(f.manager.snapshot().binding, undefined);
  assert.deepEqual(f.manager.snapshot().authorized, { workspaces: ['workspace-a'] });
  const welcome = f.channels[0].calls.find(call => call.args?.key === 'welcome')!.args.text;
  assert.match(welcome, /Current: 未选择 \/ Not selected/);
  assert.equal(p.read()?.access, undefined);
  f.receive('error', { stage: 'transport' }); await tick();
  await f.manager.action({ type: 'connect' });
  f.receive('connected'); await tick(); await tick();
  const bindingId = f.channels.at(-1)!.calls.find(call => call.type === 'bindSaved')!.args.bindingId;
  f.receive('input', { bindingId, id: 'not-durable', text: '/status s1' }); await tick();
  assert.match(f.channels.at(-1)!.calls.at(-1)!.args.title, /^Not accepted/);
  assert.deepEqual(f.inputs, []);
});

test('legacy saved connections reject short handles until an explicit fresh list', async t => {
  const p = persistence({ version: 1, identity, access: { actor: 'human', chat: 'chat',
    workspaces: ['workspace-a', 'workspace-b'], sessionId: 'session-b' } });
  const f = fixture(p.store); t.after(() => f.manager.shutdown());
  await f.manager.resume(); f.receive('connected'); await tick(); await tick();
  const bindingId = f.channels[0].calls.find(call => call.type === 'bindSaved')!.args.bindingId;
  f.receive('input', { bindingId, id: 'legacy', text: '/session s1' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-b');
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text, /旧编号尚未用于操作/);
  assert.equal(p.read()?.access?.sessionRefs, undefined);
  f.receive('input', { bindingId, id: 'fresh', text: '/sessions' }); await tick();
  assert.ok(p.read()?.access?.sessionRefs);
  f.receive('input', { bindingId, id: 'new-s2', text: '/session s2' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
  assert.deepEqual(f.inputs, []);
});

test('retired persisted handles are not recycled for newly discovered sessions', async t => {
  const p = persistence({ version: 1, identity, access: { actor: 'human', chat: 'chat',
    workspaces: ['workspace-a'], sessionId: 'session-a', sessionRefs: [['deleted', 's1'], ['session-a', 's7']] } });
  const f = fixture(p.store); t.after(() => f.manager.shutdown());
  f.saved.push({ sessionId: 'new-history', workspace: 'workspace-a', name: 'New history' });
  await f.manager.resume(); f.receive('connected'); await tick(); await tick();
  const bindingId = f.channels[0].calls.find(call => call.type === 'bindSaved')!.args.bindingId;
  f.receive('input', { bindingId, id: 'fresh', text: '/sessions' }); await tick();
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text, /s8 · New history/);
  f.receive('input', { bindingId, id: 'retired', text: '/session s1' }); await tick();
  assert.equal(f.manager.snapshot().binding?.sessionId, 'session-a');
});

test('authorized empty projects remain selectable for creating their first session', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  f.host.projects = () => [{ workspace: 'workspace-a', name: 'Project A' }, { workspace: 'empty-project', name: 'Empty' }];
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'empty-project']);
  assert.ok(f.manager.snapshot().projects?.some(project => project.workspace === 'empty-project'));
  f.receive('input', { bindingId, id: 'empty-list', text: '/sessions p2' }); await tick();
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text, /Empty \(0\)/);
  f.receive('input', { bindingId, id: 'create', text: '/new p2' }); await tick();
  assert.equal(f.manager.snapshot().binding?.workspace, 'empty-project');
  assert.deepEqual(f.inputs, []);
});

test('following pages use one snapshot while a new first page refreshes the catalog', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  for (let index = 0; index < 12; index++) f.saved.push({ sessionId: `history-${index}`, workspace: 'workspace-a', name: `History ${index}` });
  await f.connect(); const bindingId = await f.bind();
  const card = () => f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text as string;
  f.receive('input', { bindingId, id: 'first', text: '/sessions' }); await tick();
  assert.match(card(), /s10 · History 8/);
  let refreshed = 0;
  f.host.refresh = async () => { refreshed++; f.saved.reverse(); };
  f.receive('input', { bindingId, id: 'second', text: '/sessions 2' }); await tick();
  assert.equal(refreshed, 0);
  assert.match(card(), /s11 · History 9/);
  assert.match(card(), /s13 · History 11/);
  assert.doesNotMatch(card(), /s2 · History 0/);
  f.receive('input', { bindingId, id: 'refresh', text: '/sessions' }); await tick();
  assert.equal(refreshed, 1);
  assert.match(card(), /s13 · History 11/);
});

test('project filtering keeps global handles and identifies the current target outside that project', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  await f.connect(); const bindingId = await f.bind(0, ['workspace-a', 'workspace-b']);
  f.receive('input', { bindingId, id: 'filtered', text: '/sessions p2' }); await tick();
  const text = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(text, /s2 · Session b/);
  assert.match(text, /当前.*p1.*workspace-a.*s1/);
  assert.doesNotMatch(text, /p1 · workspace-a \(1\)/);
  f.receive('input', { bindingId, id: 'invalid-project', text: '/sessions p3' }); await tick();
  assert.match(f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.title, /^Not accepted/);
  assert.deepEqual(f.inputs, []);
});

test('renaming updates attached metadata and same-named projects get distinguishing suffixes', async t => {
  const f = fixture(); t.after(() => f.manager.shutdown());
  f.workers[0].cwd = '/alpha/client'; f.workers[1].cwd = '/beta/client';
  await f.connect(); const bindingId = await f.bind(0, f.workers.map(worker => worker.cwd));
  f.workers[0].state!.sessionName = 'Renamed';
  f.receive('input', { bindingId, id: 'current', text: '/current' }); await tick();
  let text = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(text, /Renamed/); assert.doesNotMatch(text, /Session a/);
  assert.equal(f.manager.snapshot().binding?.name, 'Renamed');
  f.receive('input', { bindingId, id: 'projects', text: '/projects' }); await tick();
  text = f.channels[0].calls.slice().reverse().find(call => call.type === 'card')!.args.text;
  assert.match(text, /alpha\/client/); assert.match(text, /beta\/client/);
  assert.doesNotMatch(text, /workspace-a|workspace-b/);
});
