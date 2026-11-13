import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExternalConnectorTasks, externalConnectorMethods, externalConnectorProtocol,
  type ExternalGrant, type ExternalTaskHost, type ExternalTasksState, type ExternalTaskStore,
} from '../electron/external-connector-tasks';
import type { RuntimeEvent } from '../src/contracts';
import type { SessionRuntime } from '../electron/session-runtimes';

const grant: ExternalGrant = { agentId: 'hermes-test', roots: ['C:\\project'] };
function worker(index: number): SessionRuntime {
  return {
    id: `runtime-${index}`, cwd: grant.roots[0], state: { sessionId: `session-${index}` },
    rpc: { request: async () => ({}), respond() {}, stop: async () => {}, start() {} },
    status: 'connected', permissionPreset: 'ask', messages: [], pendingUI: new Map(),
    busy: false, runActive: false, failed: false, interrupted: false,
  } as unknown as SessionRuntime;
}
function fixture(saved?: unknown) {
  let state = saved, creates = 0, submissions = 0, stops = 0, withdrawn = 0;
  const workers: SessionRuntime[] = [];
  const store: ExternalTaskStore = {
    load: async () => structuredClone(state),
    save: async value => { state = structuredClone(value); },
  };
  const host: ExternalTaskHost = {
    validate: async (cwd, roots) => { assert.ok(roots.includes(cwd)); },
    create: async (_cwd, valid) => {
      assert.equal(valid(), true);
      const persisted = state as ExternalTasksState;
      assert.equal(persisted.tasks.at(-1)?.phase, 'creating', 'intent is durable before native creation');
      const value = worker(++creates); workers.push(value); return value;
    },
    submit: async (_worker, _message, accepted, valid) => {
      assert.equal(valid(), true);
      assert.ok((state as ExternalTasksState).tasks.at(-1)?.submission, 'submission intent precedes enqueue');
      submissions++; accepted(`queue-${submissions}`);
    },
    withdraw: () => { withdrawn++; return true; },
    stop: async () => { stops++; },
  };
  const core = new ExternalConnectorTasks(host, store);
  const call = (method: string, params: unknown = {}, context = grant, valid?: () => boolean) => core.call(context, method, params, valid);
  const create = (key = 'first') => call('task.create', { key, cwd: grant.roots[0], title: 'Inspect project' }) as Promise<any>;
  const submit = (taskId: string, message = 'Inspect the project and report.', key = 'run-first') =>
    call('run.submit', { taskId, key, message }) as Promise<any>;
  return { core, call, create, submit, host, store, workers, state: () => state as ExternalTasksState,
    counts: () => ({ creates, submissions, stops, withdrawn }) };
}
function complete(value: ReturnType<typeof fixture>, content = 'Inspection complete.') {
  const native = value.workers[0];
  value.core.queueEvent(native, 'queue-1', 'delivered');
  native.messages = [{ role: 'assistant', content: [{ type: 'text', text: content }], stopReason: 'stop' }];
  value.core.event(native, { type: 'agent_end' } as RuntimeEvent);
}

test('external task capabilities advertise only the minimal model protocol', async () => {
  const f = fixture();
  assert.deepEqual(await f.call('system.capabilities'), {
    protocol: externalConnectorProtocol, version: 1, agentId: grant.agentId, roots: grant.roots,
    methods: [...externalConnectorMethods], approvals: 'local-with-explicit-task-delegation', oneRunPerTask: true,
    completedMeans: 'native-turn-ended-not-user-accepted',
  });
  await assert.rejects(f.call('approval.respond', { confirmed: true }), /connector:invalid-input/u);
  await assert.rejects(f.call('human.grant'), /connector:unsupported-method/u);
  assert.equal(f.counts().creates, 0);
});

test('create and submit persist intent and enforce exact idempotent content', async () => {
  const f = fixture();
  const first = await f.create();
  assert.equal(first.phase, 'waiting');
  assert.equal(f.core.retains(f.workers[0]), true);
  assert.equal((await f.create()).id, first.id);
  await assert.rejects(f.call('task.create', { key: 'first', cwd: grant.roots[0], title: 'Changed' }), /connector:key-conflict/u);
  const queued = await f.submit(first.id);
  assert.equal(queued.phase, 'queued');
  assert.equal((await f.submit(first.id)).id, first.id);
  await assert.rejects(f.submit(first.id, 'Different input'), /connector:key-conflict/u);
  await assert.rejects(f.submit(first.id, 'Inspect the project and report.', 'run-second'), /connector:key-conflict/u);
  assert.deepEqual(f.counts(), { creates: 1, submissions: 1, stops: 0, withdrawn: 0 });
  const serialized = JSON.stringify(f.state());
  assert.equal(serialized.includes('run-first'), false);
  assert.equal(serialized.includes('Inspect the project and report.'), false);
});

test('concurrent retries share one native creation and submission', async () => {
  const f = fixture();
  const [left, right] = await Promise.all([f.create(), f.create()]);
  assert.equal(left.id, right.id);
  await Promise.all([f.submit(left.id), f.submit(left.id)]);
  assert.equal(f.counts().creates, 1);
  assert.equal(f.counts().submissions, 1);
});

test('unknown identities cannot read or stop another agent task', async () => {
  const f = fixture(), own = await f.create();
  const foreign = { agentId: 'other-agent', roots: grant.roots };
  assert.deepEqual(await f.call('task.list', {}, foreign), []);
  for (const method of ['task.get', 'task.stop']) {
    await assert.rejects(f.call(method, { taskId: own.id }, foreign), /connector:task-unavailable/u);
  }
  await assert.rejects(f.call('task.create', { key: 'outside', cwd: 'C:\\project\\child', title: 'No' }), /connector:scope/u);
  await assert.rejects(f.call('task.create', { key: 'origin', cwd: grant.roots[0], title: 'No', origin: { source: 'human' } }), /connector:invalid-input/u);
});

test('revocation during async root validation produces no native side effect', async () => {
  const f = fixture();
  let valid = true;
  const scoped = { ...grant, validate: async () => { valid = false; } };
  await assert.rejects(f.call('task.create', { key: 'revoked', cwd: grant.roots[0], title: 'No' }, scoped, () => valid), /connector:revoked/u);
  assert.equal(f.counts().creates, 0);
});

test('a replacement grant cannot lend its directory identity after the exact grant check', async () => {
  const f = fixture();
  let originalDirectory = true;
  const scoped = { ...grant, validate: async () => {
    if (!originalDirectory) throw new Error('connector:scope-changed');
  } };
  f.host.validate = async () => {
    // A second grant for the same spelling can pass broad validation after replacement.
    originalDirectory = false;
  };
  await assert.rejects(f.call('task.create', { key: 'replaced', cwd: grant.roots[0], title: 'No' }, scoped),
    /connector:scope-changed/u);
  assert.equal(f.counts().creates, 0);
  assert.equal(f.state(), undefined, 'no creation intent is recorded for a borrowed identity');
});

test('revocation during durable intent prevents creation and leaves a terminal receipt', async () => {
  const f = fixture();
  let valid = true;
  const original = f.store.save;
  f.store.save = async value => { await original(value); valid = false; };
  await assert.rejects(f.call('task.create', { key: 'revoked', cwd: grant.roots[0], title: 'No' }, grant, () => valid), /connector:revoked/u);
  assert.equal(f.counts().creates, 0);
  assert.equal(f.state().tasks[0].phase, 'interrupted');
});

test('write failure before side effect cannot create a session or enqueue', async () => {
  const f = fixture();
  f.store.save = async () => { throw new Error('secret-disk-path'); };
  await assert.rejects(f.create(), /^Error: connector:storage$/u);
  assert.equal(f.counts().creates, 0);
  const g = fixture(), task = await g.create();
  g.store.save = async () => { throw new Error('secret-disk-path'); };
  await assert.rejects(g.submit(task.id), /^Error: connector:storage$/u);
  assert.equal(g.counts().submissions, 0);
});

test('control commands, invalid fields and excessive input never reach native prompt', async () => {
  const f = fixture(), task = await f.create();
  for (const input of ['/permissions full-access', ' \n/permissions fast', '/init', '/model another', 'ultracode:\n\nDo this']) {
    await assert.rejects(f.submit(task.id, input), /connector:control-command/u);
  }
  for (const input of ['', 'x'.repeat(32001), 'a\u0000b']) {
    await assert.rejects(f.submit(task.id, input), /connector:invalid-input/u);
  }
  await assert.rejects(f.call('run.submit', { taskId: task.id, key: 'r', message: 'Inspect', confirmed: true }), /connector:invalid-input/u);
  assert.equal(f.counts().submissions, 0);
});

test('native identity and Ask are rechecked after the submission intent write', async () => {
  for (const mutation of [
    (w: SessionRuntime) => { w.permissionPreset = 'full-access'; },
    (w: SessionRuntime) => { w.state = { ...w.state!, sessionId: 'another-session' }; },
    (w: SessionRuntime) => { w.rpc = { ...w.rpc }; },
  ]) {
    const f = fixture(), task = await f.create(), original = f.store.save;
    f.store.save = async value => { await original(value); if (value.tasks[0].submission) mutation(f.workers[0]); };
    await assert.rejects(f.submit(task.id), /connector:(ask-required|session-unavailable)/u);
    assert.equal(f.counts().submissions, 0);
  }
});

test('only the external native terminal answer is frozen and later local text is never read', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  complete(f, 'External answer');
  const done: any = await f.call('task.get', { taskId: task.id });
  assert.equal(done.phase, 'completed');
  assert.equal(done.summary, 'External answer');
  assert.equal(done.resultAvailable, true);
  assert.equal(f.core.retains(f.workers[0]), false);
  f.workers[0].messages.push({ role: 'assistant', content: 'Private local follow-up', stopReason: 'stop' });
  f.core.event(f.workers[0], { type: 'agent_end' } as RuntimeEvent);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).summary, 'External answer');
  await f.call('task.stop', { taskId: task.id });
  assert.equal(f.counts().stops, 0, 'old stop does not abort a new local turn');
  assert.equal(JSON.stringify(f.state()).includes('External answer'), false, 'answer is not saved in routing metadata');
});

test('summary excludes reasoning, redacts secrets, and is bounded', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.core.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.workers[0].messages = [{ role: 'assistant', content: [
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'text', text: 'Authorization: Bearer secret-token-value\n' + 'x'.repeat(10000) },
  ], stopReason: 'stop' }] as any;
  f.core.event(f.workers[0], { type: 'agent_end' } as RuntimeEvent);
  const result: any = await f.call('task.get', { taskId: task.id });
  assert.ok(result.summary.length <= 8000);
  assert.equal(result.summaryTruncated, true);
  assert.equal(result.summary.includes('private reasoning'), false);
  assert.equal(result.summary.includes('secret-token-value'), false);
});

test('pending local approvals are visible but never export request content or authority', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.workers[0].pendingUI.set('approval', { id: 'approval', message: 'private command' } as any);
  const result: any = await f.call('task.get', { taskId: task.id });
  assert.equal(result.awaitingLocalApproval, true);
  assert.equal(JSON.stringify(result).includes('private command'), false);
});

function permission(f: ReturnType<typeof fixture>, tool = 'run_command', reason?: string, args?: Record<string, unknown>) {
  const w = f.workers[0], callId = 'exact-native-call-12345678';
  w.messages = [{ role: 'assistant', content: [{ type: 'toolCall', id: callId, name: tool,
    arguments: args ?? (tool === 'run_command' ? { command: 'echo hello', cwd: w.cwd } : { path: 'hello.txt', content: 'hello' }) }] }] as any;
  const request = { type: 'extension_ui_request', id: 'native-approval', runtimeId: w.id, method: 'confirm',
    title: `Approve ${tool} [12345678]`,
    message: `Call: ${callId}\n${reason ?? `${tool} can modify the workspace or execute a command`}\n\nsummary\n\nBatch calls may ask separately\nbefore approved tools begin running.` } as const;
  w.pendingUI.set(request.id, request);
  return request;
}
async function delegated() {
  const f = fixture(), task = await f.create();
  const answers: boolean[] = [];
  f.host.respond = (w, request, confirmed) => { assert.equal(w.pendingUI.get(request.id), request); answers.push(confirmed); w.pendingUI.delete(request.id); };
  await f.submit(task.id);
  const request = permission(f);
  const grant = () => f.core.delegate({ type: 'delegate', taskId: task.id, minutes: 30, categories: ['command', 'file'] });
  const list = () => f.call('approval.list', { taskId: task.id }) as Promise<any>;
  const respond = (requestId: string, decision = 'allow', reason = 'Matches the requested test.') =>
    f.call('approval.respond', { taskId: task.id, requestId, decision, reason }) as Promise<any>;
  return { ...f, task, answers, request, grant, list, respond };
}
test('delegation is local opt-in; exact native approvals allow once and leave durable attributed reasons', async () => {
  const f = await delegated();
  assert.deepEqual((await f.list()).requests, []);
  await assert.rejects(f.respond('invented'), /connector:local-approval/u);
  await f.grant();
  const [request] = (await f.list()).requests;
  assert.equal(request.input, 'echo hello');
  assert.equal(request.callId, 'exact-native-call-12345678');
  assert.equal(request.requestId.includes('native'), false);
  const result = await f.respond(request.requestId);
  assert.equal(result.outcome, 'applied');
  assert.deepEqual(f.answers, [true]);
  assert.equal(f.workers[0].permissionPreset, 'ask');
  await assert.rejects(f.respond(request.requestId), /connector:approval-expired/u);
  assert.equal(f.state().approvalAudit?.at(-1)?.reason, 'Matches the requested test.');
  assert.equal(f.state().approvalAudit?.at(-1)?.requestId, request.requestId);
  assert.equal(f.state().approvalAudit?.at(-1)?.outcome, 'applied');
});
test('deny is one native denial; escalation leaves the request local and cannot be reclaimed', async () => {
  for (const decision of ['deny', 'escalate']) {
    const f = await delegated(); await f.grant();
    const [request] = (await f.list()).requests;
    await f.respond(request.requestId, decision);
    assert.deepEqual(f.answers, decision === 'deny' ? [false] : []);
    assert.equal(f.workers[0].pendingUI.size, decision === 'deny' ? 0 : 1);
    assert.deepEqual((await f.list()).requests, []);
    await assert.rejects(f.respond(request.requestId), /connector:approval-expired/u);
  }
});
test('foreign identity, wrong roots and forged authority cannot inspect or answer approvals', async () => {
  const f = await delegated(); await f.grant();
  for (const method of ['approval.list', 'approval.respond']) {
    await assert.rejects(f.call(method, { taskId: f.task.id, ...(method === 'approval.respond'
      ? { requestId: 'id', decision: 'allow', reason: 'yes' } : {}) }, { ...grant, agentId: 'another' }), /connector:task-unavailable/u);
    await assert.rejects(f.call(method, { taskId: f.task.id, ...(method === 'approval.respond'
      ? { requestId: 'id', decision: 'allow', reason: 'yes' } : {}) }, { ...grant, roots: ['other'] }), /connector:scope/u);
  }
  await assert.rejects(f.call('approval.list', { taskId: f.task.id, delegated: true }), /connector:invalid-input/u);
  await assert.rejects(f.call('human.grant', {}), /connector:unsupported-method/u);
});
test('unsupported, dangerous, uncertain, redacted, incomplete and unselected requests stay local', async () => {
  const f = await delegated(); await f.grant();
  for (const mutate of [
    () => { f.workers[0].messages = []; },
    () => { f.workers[0].pendingUI.set(f.request.id, { ...f.request, method: 'select', options: ['Yes'] }); },
    () => { f.workers[0].pendingUI.set(f.request.id, { ...f.request, projectTrust: { cwd: grant.roots[0] } }); },
    () => { f.workers[0].pendingUI.set(f.request.id, { ...f.request, runtimeId: 'foreign' }); },
    () => { permission(f, 'run_command', 'Shell command could not be fully analyzed (unsupported-shell); explicit approval is required.'); },
    () => { const r = permission(f, 'run_command', 'Dangerous command requires confirmation (recursive-force-remove): test');
      f.workers[0].pendingUI.set(r.id, { ...r, title: 'Dangerous run_command [12345678]' }); },
    () => { permission(f, 'run_command', undefined, { command: 'echo ok', env: { TOKEN: 'private' } }); },
    () => { permission(f, 'run_command', undefined, { command: 'x'.repeat(13000) }); },
    () => { permission(f, 'clarify_user', undefined, { question: 'Proceed?' }); },
  ]) {
    f.workers[0].pendingUI.clear(); permission(f); mutate();
    assert.deepEqual((await f.list()).requests, []);
  }
  permission(f, 'write_file');
  await f.core.delegate({ type: 'delegate', taskId: f.task.id, minutes: 15, categories: ['command'] });
  assert.deepEqual((await f.list()).requests, []);
  await f.core.delegate({ type: 'delegate', taskId: f.task.id, minutes: 15, categories: ['file'] });
  assert.equal((await f.list()).requests.length, 1);
  permission(f, 'write_file', 'write_file can modify the workspace or execute a command\nthen_run: echo verify');
  assert.deepEqual((await f.list()).requests, [], 'file-only lease cannot authorize fused command');
});
test('a stale snapshot, replaced request or native transport cannot be answered', async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof delegated>>) => f.workers[0].pendingUI.delete(f.request.id),
    (f: Awaited<ReturnType<typeof delegated>>) => f.workers[0].pendingUI.set(f.request.id, { ...f.request }),
    (f: Awaited<ReturnType<typeof delegated>>) => { (f.workers[0].messages[0].content as any[])[0].arguments.command = 'different'; },
    (f: Awaited<ReturnType<typeof delegated>>) => { f.workers[0].rpc = { ...f.workers[0].rpc }; },
    (f: Awaited<ReturnType<typeof delegated>>) => { f.workers[0].state!.sessionId = 'changed'; },
    (f: Awaited<ReturnType<typeof delegated>>) => { f.workers[0].permissionPreset = 'full-access'; },
  ]) {
    const f = await delegated(); await f.grant();
    const [request] = (await f.list()).requests; mutate(f);
    await assert.rejects(f.respond(request.requestId), /connector:(approval-expired|session-unavailable)/u);
    assert.deepEqual(f.answers, []);
  }
});
test('revocation, expiry, local answer and identity replacement during durable approval intent fail closed', async () => {
  for (const action of ['revoke', 'expire', 'local', 'transport', 'gateway']) {
    const f = await delegated(); await f.grant();
    const [request] = (await f.list()).requests, save = f.store.save;
    let once = false, valid = true;
    const realNow = Date.now;
    f.store.save = async value => {
      await save(value);
      if (once || value.approvalAudit?.at(-1)?.outcome !== 'prepared') return;
      once = true;
      if (action === 'revoke') await f.core.delegate({ type: 'undelegate', taskId: f.task.id });
      if (action === 'expire') Date.now = () => realNow() + 3600001;
      if (action === 'local') f.workers[0].pendingUI.delete(f.request.id);
      if (action === 'transport') f.workers[0].rpc = { ...f.workers[0].rpc };
      if (action === 'gateway') { valid = false; f.core.invalidate(grant.agentId); }
    };
    // Do not await a nested persistence write from inside the store callback.
    if (action === 'revoke') {
      f.store.save = async value => { await save(value); if (!once && value.approvalAudit?.at(-1)?.outcome === 'prepared') {
        once = true; void f.core.delegate({ type: 'undelegate', taskId: f.task.id });
        await Promise.resolve(); await Promise.resolve();
      } };
    }
    try {
      await assert.rejects(f.call('approval.respond', { taskId: f.task.id, requestId: request.requestId,
        decision: 'allow', reason: 'Check race' }, grant, () => valid), /connector:(approval-expired|session-unavailable|revoked)/u);
    } finally { Date.now = realNow; }
    assert.deepEqual(f.answers, []);
    await f.core.flush();
  }
});
test('approval intent persistence failure prevents response and restart never restores delegation', async () => {
  const f = await delegated(); await f.grant();
  const saved = structuredClone(f.state()), [request] = (await f.list()).requests;
  f.store.save = async () => { throw new Error('private storage detail'); };
  await assert.rejects(f.respond(request.requestId), /connector:storage/u);
  assert.deepEqual(f.answers, []);
  const restarted = fixture(saved); await restarted.core.initialize();
  assert.deepEqual(restarted.core.localApprovals().tasks, []);
  assert.equal(restarted.core.localApprovals().audit[0].action, 'grant');
  assert.equal((await restarted.call('task.get', { taskId: f.task.id }) as any).approvalDelegation, undefined);
});
test('ending a task drops delegation, and failed final audit does not replay a native decision', async () => {
  const f = await delegated(); await f.grant();
  const [request] = (await f.list()).requests, save = f.store.save;
  f.store.save = async value => {
    if (value.approvalAudit?.some(entry => entry.action === 'allow' && entry.outcome === 'applied')) throw new Error('disk');
    await save(value);
  };
  await assert.rejects(f.respond(request.requestId), /connector:storage/u);
  assert.deepEqual(f.answers, [true]);
  assert.equal(f.state().approvalAudit?.at(-1)?.outcome, 'prepared', 'durable intent does not assert delivery');
  await assert.rejects(f.respond(request.requestId), /connector:storage/u);
  assert.deepEqual(f.answers, [true]);
  complete(f);
  assert.equal((await f.call('task.get', { taskId: f.task.id }) as any).approvalDelegation, undefined);
});
test('ambiguous native response failure is audited as unconfirmed and cannot be replayed', async () => {
  const f = await delegated(); await f.grant();
  const [request] = (await f.list()).requests;
  let attempts = 0;
  f.host.respond = () => { attempts++; throw new Error('transport acknowledgement lost'); };
  await assert.rejects(f.respond(request.requestId), /transport acknowledgement lost/u);
  assert.equal(f.state().approvalAudit?.at(-1)?.outcome, 'prepared');
  assert.deepEqual((await f.list()).requests, []);
  await assert.rejects(f.respond(request.requestId), /connector:approval-expired/u);
  await f.grant();
  assert.deepEqual((await f.list()).requests, [], 'new delegation cannot replay the ambiguous request');
  assert.equal(attempts, 1);
});
test('revocation wins over a grant awaiting persistence and regrant requires a new request reference', async () => {
  const f = await delegated(), save = f.store.save;
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  let held = false;
  f.store.save = async value => {
    if (!held && value.approvalAudit?.at(-1)?.action === 'grant') {
      held = true; started(); await new Promise<void>(resolve => { release = resolve; });
    }
    await save(value);
  };
  const granting = f.grant();
  await pending;
  const revoking = f.core.delegate({ type: 'undelegate', taskId: f.task.id });
  await Promise.resolve();
  release();
  await assert.rejects(granting, /connector:revoked/u);
  await revoking;
  assert.equal((await f.list()).delegation, null);
  await f.grant();
  const [first] = (await f.list()).requests;
  await f.core.delegate({ type: 'undelegate', taskId: f.task.id });
  await f.grant();
  const [second] = (await f.list()).requests;
  assert.notEqual(first.requestId, second.requestId);
  await assert.rejects(f.respond(first.requestId), /connector:approval-expired/u);
});
test('moving the wall clock backward cannot extend the monotonic delegation deadline', async t => {
  const f = await delegated(); await f.grant();
  const now = Date.now(), elapsed = performance.now(), [request] = (await f.list()).requests;
  t.mock.method(Date, 'now', () => now - 3600000);
  t.mock.method(performance, 'now', () => elapsed + 3600001);
  assert.equal((await f.list()).delegation, null);
  await assert.rejects(f.respond(request.requestId), /connector:local-approval/u);
  assert.deepEqual(f.answers, []);
});

test('incomplete recovery does not prematurely complete an external run', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.core.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.workers[0].messages = [{ role: 'assistant', content: 'Incomplete', stopReason: 'length', incomplete: true }] as any;
  f.core.event(f.workers[0], { type: 'agent_end', desktopRecoveryPending: true } as RuntimeEvent);
  assert.equal(f.core.retains(f.workers[0]), true);
  f.workers[0].messages = [{ role: 'assistant', content: 'Recovered', stopReason: 'stop' }];
  f.core.event(f.workers[0], { type: 'agent_settled', desktopRecoverySettled: true } as RuntimeEvent);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).phase, 'completed');
});

test('native completion review settles only once its final review event arrives', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.core.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.workers[0].messages = [{ role: 'assistant', content: 'Checked answer', stopReason: 'stop' }];
  f.core.event(f.workers[0], { type: 'agent_end', desktopReviewPending: true } as RuntimeEvent);
  assert.equal(f.core.retains(f.workers[0]), true);
  f.core.event(f.workers[0], { type: 'desktop_completion_review',
    review: { version: 1, id: 'review-1', sessionId: 'session-1', status: 'ended', sent: true } } as RuntimeEvent);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).phase, 'completed');
});

test('active native Goal and background work do not count as completed at the first agent end', async () => {
  for (const background of [false, true]) {
    const f = fixture(), task = await f.create();
    await f.submit(task.id);
    f.core.queueEvent(f.workers[0], 'queue-1', 'delivered');
    f.workers[0].messages = [{ role: 'assistant', content: 'Intermediate answer', stopReason: 'stop' }];
    if (background) f.workers[0].backgroundActive = true;
    else f.workers[0].launch = { goal: { status: 'active' } } as any;
    f.core.event(f.workers[0], { type: 'agent_end' } as RuntimeEvent);
    assert.equal(f.core.retains(f.workers[0]), true);
    if (background) f.workers[0].backgroundActive = false;
    else f.workers[0].launch = { goal: { status: 'complete' } } as any;
    f.core.event(f.workers[0], { type: 'desktop_task_completed' } as RuntimeEvent);
    assert.equal((await f.call('task.get', { taskId: task.id }) as any).phase, 'completed');
  }
});

test('task list omits full answer summaries and bounds the first page', async () => {
  const f = fixture();
  for (let i = 0; i < 21; i++) {
    const task = await f.create(`page-task-${i}`);
    await f.submit(task.id, `Inspect ${i}`, `page-run-${i}`);
    const native = f.workers[i];
    f.core.queueEvent(native, `queue-${i + 1}`, 'delivered');
    native.messages = [{ role: 'assistant', content: 'x'.repeat(8000), stopReason: 'stop' }];
    f.core.event(native, { type: 'agent_end' } as RuntimeEvent);
  }
  const first: any = await f.call('task.list');
  assert.equal(first.length, 20);
  assert.equal(first[0].resultAvailable, true);
  assert.equal(first[0].summary, undefined);
  assert.equal((await f.call('task.list', { offset: 20 }) as any).length, 1);
});

test('unknown delivery and queue failure cannot be retried as another input', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.core.queueEvent(f.workers[0], 'queue-1', 'unknown');
  f.core.queueFailed(f.workers[0]);
  assert.equal((await f.submit(task.id)).phase, 'unknown');
  await assert.rejects(f.submit(task.id, 'new prompt', 'retry-new'), /connector:key-conflict/u);
  assert.equal(f.counts().submissions, 1);
});

test('a native disconnect after queue acceptance cannot cause another submission', async () => {
  const f = fixture(), task = await f.create(), submit = f.host.submit;
  f.host.submit = async (...args) => {
    await submit(...args);
    throw new Error('private transport failure');
  };
  await assert.rejects(f.submit(task.id), /^Error: connector:submission-unconfirmed$/u);
  const uncertain: any = await f.call('task.get', { taskId: task.id });
  assert.equal(uncertain.phase, 'unknown');
  assert.equal(uncertain.submitted, true);
  assert.equal(uncertain.receipt, 'pending');
  assert.equal(uncertain.resultAvailable, false);
  assert.equal((await f.submit(task.id)).phase, 'unknown');
  await assert.rejects(f.submit(task.id, 'new prompt', 'retry-new'), /connector:key-conflict/u);
  assert.equal(f.counts().submissions, 1);
  assert.equal(JSON.stringify(uncertain).includes('private transport failure'), false);
});

test('stop withdraws unsubmitted queues and never auto-approves or retries', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  assert.equal((await f.call('task.stop', { taskId: task.id }) as any).phase, 'stopped');
  assert.equal(f.counts().withdrawn, 1);
  assert.equal(f.counts().stops, 0);
  assert.equal(f.core.retains(f.workers[0]), false);
});

test('empty stopped and revoked tasks release their native runtime without aborting work', async () => {
  const f = fixture(), discarded: SessionRuntime[] = [];
  f.host.discard = async value => { discarded.push(value); };
  const first = await f.create('empty-first');
  await f.call('task.stop', { taskId: first.id });
  await f.create('empty-second');
  f.core.invalidate(grant.agentId);
  await f.core.flush();
  assert.deepEqual(discarded, f.workers);
  assert.equal(f.counts().stops, 0);
});

test('post-creation scope failure releases the unsubmitted native session', async () => {
  const f = fixture(), discarded: SessionRuntime[] = [];
  f.host.discard = async value => { discarded.push(value); };
  const original = f.host.validate;
  let validations = 0;
  f.host.validate = async (cwd, roots) => {
    await original(cwd, roots);
    if (++validations === 3) throw new Error('connector:scope');
  };
  await assert.rejects(f.create(), /connector:scope/u);
  assert.deepEqual(discarded, f.workers);
  assert.equal(f.core.retains(f.workers[0]), false);
});

test('post-intent scope failure cannot enqueue a prompt', async () => {
  const f = fixture(), task = await f.create(), original = f.store.save;
  let replaced = false;
  f.store.save = async value => { await original(value); if (value.tasks[0].submission) replaced = true; };
  f.host.validate = async () => { if (replaced) throw new Error('connector:scope'); };
  await assert.rejects(f.submit(task.id), /connector:scope/u);
  assert.equal(f.counts().submissions, 0);
});

test('native stop remains pending until the running turn actually settles', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.host.withdraw = () => false;
  f.workers[0].busy = true; f.workers[0].runActive = true;
  assert.equal((await f.call('task.stop', { taskId: task.id }) as any).phase, 'queued');
  assert.equal(f.core.retains(f.workers[0]), true);
  f.core.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.workers[0].interrupted = true;
  f.core.event(f.workers[0], { type: 'agent_end' } as RuntimeEvent);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).phase, 'stopped');
});

test('successful local stop releases a waiting task even without an agent_end event', async () => {
  const f = fixture(), task = await f.create();
  f.core.locallyStopped(f.workers[0]);
  const result: any = await f.call('task.get', { taskId: task.id });
  assert.equal(result.phase, 'stopped');
  assert.equal(result.reason, 'locally-stopped');
  assert.equal(result.resultAvailable, false);
  assert.equal(f.core.retains(f.workers[0]), false);
  await assert.rejects(f.submit(task.id), /connector:task-not-ready/u);
  await f.core.flush();
  assert.equal(f.state().tasks[0].phase, 'stopped');
  assert.equal(f.counts().submissions, 0);
});

test('successful local stop releases queued input without inventing delivery or replaying it', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.core.locallyStopped(f.workers[0]);
  const result: any = await f.submit(task.id);
  assert.equal(result.phase, 'stopped');
  assert.equal(result.receipt, 'pending');
  assert.equal(f.core.retains(f.workers[0]), false);
  f.workers[0].messages = [{ role: 'assistant', content: 'A later local answer', stopReason: 'stop' }];
  f.core.event(f.workers[0], { type: 'agent_end' } as RuntimeEvent);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).resultAvailable, false);
  assert.equal(f.counts().submissions, 1);
});

test('successful local stop releases a running attachment when no terminal event was emitted', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.core.queueEvent(f.workers[0], 'queue-1', 'delivered');
  f.core.event(f.workers[0], { type: 'agent_start' } as RuntimeEvent);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).phase, 'running');
  f.core.locallyStopped(f.workers[0]);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).phase, 'stopped');
  assert.equal(f.core.retains(f.workers[0]), false);
});

test('local stop of a changed native identity interrupts instead of claiming the original task stopped', async () => {
  for (const mutation of [
    (w: SessionRuntime) => { w.rpc = { ...w.rpc }; },
    (w: SessionRuntime) => { w.state = { ...w.state!, sessionId: 'another-session' }; },
    (w: SessionRuntime) => { w.cwd = 'C:\\another-project'; },
  ]) {
    const f = fixture(), task = await f.create();
    mutation(f.workers[0]);
    f.core.locallyStopped(f.workers[0]);
    const result: any = await f.call('task.get', { taskId: task.id });
    assert.equal(result.phase, 'interrupted');
    assert.equal(result.reason, 'session-identity-changed');
    assert.equal(f.core.retains(f.workers[0]), false);
  }
});

test('local stop after a terminal event cannot overwrite the external result with a later local turn', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  complete(f, 'Frozen external answer');
  f.core.locallyStopped(f.workers[0]);
  f.workers[0].messages.push({ role: 'assistant', content: 'Private local turn', stopReason: 'stop' });
  f.core.event(f.workers[0], { type: 'agent_end' } as RuntimeEvent);
  f.core.locallyStopped(f.workers[0]);
  const result: any = await f.call('task.get', { taskId: task.id });
  assert.equal(result.phase, 'completed');
  assert.equal(result.summary, 'Frozen external answer');
  assert.equal(result.reason, undefined);
  assert.equal(f.core.retains(f.workers[0]), false);
});

test('revocation withdraws queues but never silently stops an already started native task', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  f.host.withdraw = () => false;
  f.core.invalidate(grant.agentId);
  assert.equal(f.core.retains(f.workers[0]), false);
  assert.equal(f.counts().stops, 0);
  assert.equal((await f.call('task.get', { taskId: task.id }) as any).phase, 'interrupted');
});

test('restart preserves idempotency but does not reattach, replay, or persist private answers', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  await f.core.flush();
  const restarted = fixture(f.state());
  const previous = await restarted.create();
  assert.equal(previous.id, task.id);
  assert.equal(previous.phase, 'interrupted');
  assert.equal(previous.reason, 'desktop-restarted');
  assert.equal((await restarted.submit(task.id)).phase, 'interrupted');
  assert.equal(restarted.counts().creates, 0);
  assert.equal(restarted.counts().submissions, 0);
});

test('restart preserves completed receipts without restoring answers or attaching native history', async () => {
  const f = fixture(), task = await f.create();
  await f.submit(task.id);
  complete(f, 'External answer before restart');
  f.workers[0].messages.push({ role: 'assistant', content: 'Private local follow-up', stopReason: 'stop' });
  await f.core.flush();
  const saved = structuredClone(f.state());
  assert.equal(JSON.stringify(saved).includes('External answer before restart'), false);
  assert.equal(JSON.stringify(saved).includes('Private local follow-up'), false);
  const restarted = fixture(saved);
  const previous: any = await restarted.call('task.get', { taskId: task.id });
  assert.equal(previous.phase, 'completed');
  assert.equal(previous.submitted, true);
  assert.equal(previous.receipt, 'delivered');
  assert.equal(previous.reason, undefined);
  assert.equal(previous.resultAvailable, false);
  assert.equal(previous.summary, undefined);
  assert.equal(previous.summaryTruncated, undefined);
  assert.equal((await restarted.create()).id, task.id);
  assert.equal((await restarted.submit(task.id)).phase, 'completed');
  assert.deepEqual(restarted.state().tasks[0].submission, saved.tasks[0].submission);
  assert.equal(restarted.core.retains(f.workers[0]), false);
  restarted.core.event(f.workers[0], { type: 'agent_end' } as RuntimeEvent);
  assert.equal((await restarted.call('task.get', { taskId: task.id }) as any).resultAvailable, false);
  assert.deepEqual(restarted.workers, []);
  assert.deepEqual(restarted.counts(), { creates: 0, submissions: 0, stops: 0, withdrawn: 0 });
});

test('invalid persistent schema fails closed and never starts a native runtime', async () => {
  const f = fixture({ version: 1, tasks: [{ id: 'untrusted' }] });
  await assert.rejects(f.create(), /connector:storage/u);
  assert.equal(f.counts().creates, 0);
});

test('eight unfinished task limit prevents unbounded native process creation', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) await f.create(`task-${i}`);
  await assert.rejects(f.create('task-nine'), /connector:task-limit/u);
  assert.equal(f.counts().creates, 8);
});
