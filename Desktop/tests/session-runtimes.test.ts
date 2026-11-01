import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SessionRuntimes, taskOutcome, type WorkerTransport } from '../electron/session-runtimes';
import { WORKSPACE_POLICY, DESKTOP_SYSTEM_POLICY, DESKTOP_CRON_POLICY, desktopSystemPolicy } from '../electron/workspace-policy';
import type { RuntimeEvent } from '../src/contracts';
import { QUESTION_TITLE } from '../src/questionnaire';
import { MessageRevision } from '../src/message-revision';
import { applyToolResult } from '../src/message-events';
import { quitReasons } from '../electron/quit-review';

class Transport implements WorkerTransport {
  stopped = false;
  calls: string[] = [];
  answers: Record<string, unknown>[] = [];
  startArgs: string[] = [];
  startEnv: NodeJS.ProcessEnv = {};
  constructor(readonly receive: (event: RuntimeEvent) => void, readonly sessionId: string) {}
  start(_node: string, _entry: string, _cwd: string, env: NodeJS.ProcessEnv, args: string[] = []) { this.startArgs = args; this.startEnv = env; }
  async request(type: string, _args?: Record<string, unknown>): Promise<any> {
    this.calls.push(type);
    if (type === 'get_state') return { sessionId: this.sessionId, sessionFile: `${this.sessionId}.jsonl`, isStreaming: false };
    if (type === 'get_messages') return { messages: [] };
    if (type === 'get_available_models') return { models: [] };
    return {};
  }
  respond(value: Record<string, unknown>) { this.answers.push(value); }
  async stop() { this.stopped = true; }
}
function fixture(hooks: ConstructorParameters<typeof SessionRuntimes>[2] = {}) {
  const transports: Transport[] = [];
  const events: RuntimeEvent[] = [];
  const pool = new SessionRuntimes(event => events.push(event), receive => {
    const transport = new Transport(receive, `session-${transports.length}`);
    transports.push(transport);
    return transport;
  }, hooks);
  const open = (cwd = `workspace-${transports.length}`) => pool.open('node', 'step', cwd, {});
  return { pool, transports, events, open };
}

test('live background lanes retain their host without blocking foreground messages', async () => {
  const { pool, open, transports, events } = fixture({ idleLimit: () => 0 });
  try {
    const host = await open();
    host.messages = [{ role: 'assistant', content: 'Delegated', stopReason: 'stop' }];
    const notify = (lanes: unknown[]) => transports[0].receive({ type: 'extension_ui_request',
      method: 'setStatus', statusKey: 'desktop-subagents', statusText: JSON.stringify({ version: 1, lanes }) });
    notify([{ id: 'lane_12345678', status: 'running' }]);
    transports[0].receive({ type: 'agent_start' });
    transports[0].receive({ type: 'agent_end', messages: host.messages });
    assert.equal(pool.isBusy(host), false, 'The parent can accept another prompt');
    assert.equal(pool.running, true, 'Billing/config changes still have a live owner');
    assert.equal(pool.summaries()[0].status, 'running');
    assert.equal(quitReasons(pool, false).runningTasks, 1);
    await assert.rejects(pool.assertIdle(host), /background/i);
    await assert.rejects(pool.assertAllIdle({ stopHost: false }), /background/i);
    await assert.rejects(pool.refresh(host, 'node', 'step', {}), /background/i);
    assert.ok(!events.some(event => event.type === 'desktop_task_completed'));
    assert.ok(!events.some(event => event.statusKey === 'desktop-subagents'));
    await open();
    host.touched = 0;
    await pool.recycle();
    assert.equal(transports[0].stopped, false);
    notify([{ id: 'lane_12345678', status: 'settling' }]);
    assert.equal(pool.running, true, 'Final notification delivery retains the host too');
    notify([]);
    await new Promise(resolve => setImmediate(resolve));
    await pool.recycle();
    assert.equal(transports[0].stopped, true);
  } finally { await pool.stopAll(); }
});

test('historical lanes and stale transports cannot revive live background ownership', async () => {
  const { pool, open, transports } = fixture();
  try {
    const host = await open();
    host.messages = [{ role: 'custom', customType: 'agent-notification', content: '',
      details: { agentId: 'lane_12345678', event: 'background_progress', status: 'running' } }];
    assert.equal(pool.running, false);
    const receive = transports[0].receive;
    receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-subagents',
      statusText: '{invalid' });
    assert.equal(pool.running, true, 'Unknown live state fails closed');
    receive({ type: 'desktop_exit' });
    receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-subagents',
      statusText: JSON.stringify({ version: 1, lanes: [{ id: 'lane_12345678', status: 'running' }] }) });
    assert.equal(pool.running, false);
    assert.equal(quitReasons(pool, false).runningTasks, 0);
  } finally { await pool.stopAll(); }
});

test('idle guard rechecks a background lane starting while its RPC read is pending', async () => {
  const { pool, open, transports } = fixture();
  try {
    const host = await open();
    const original = transports[0].request.bind(transports[0]);
    transports[0].request = async (type, args) => {
      if (type === 'get_state') transports[0].receive({ type: 'extension_ui_request', method: 'setStatus',
        statusKey: 'desktop-subagents', statusText: JSON.stringify({
          version: 1, lanes: [{ id: 'lane_12345678', status: 'running' }],
        }) });
      return original(type, args);
    };
    await assert.rejects(pool.assertIdle(host), /background/i);
    assert.equal(transports[0].stopped, false);
  } finally { await pool.stopAll(); }
});

test('background notification handoff retains the host before the parent emits agent_start', async () => {
  const { pool, open, transports } = fixture({ idleLimit: () => 0 });
  try {
    const host = await open();
    host.messages = [{ role: 'user', content: 'saved' }];
    await open();
    transports[0].receive({ type: 'extension_ui_request', method: 'setStatus',
      statusKey: 'desktop-subagents', statusText: JSON.stringify({ version: 1, lanes: [], parentActive: true }) });
    assert.equal(host.backgroundActive, false);
    assert.equal(pool.running, true);
    await assert.rejects(pool.assertIdle(host), /Stop/);
    await pool.recycle();
    assert.equal(transports[0].stopped, false);
    // Pre-prompt cancellation may settle without starting a model turn.
    transports[0].receive({ type: 'agent_settled' });
    assert.equal(pool.running, false);
    await pool.recycle();
    assert.equal(transports[0].stopped, true);
  } finally { await pool.stopAll(); }
});

test('startup diagnostics separate process, restoration, snapshot and model phases without session content', async () => {
  const { pool, open } = fixture();
  try {
    const worker = await open();
    const timing = worker.startupTiming!;
    assert.deepEqual(Object.keys(timing).sort(),
      ['modelRestoreMs', 'processReadyMs', 'sessionRestoreMs', 'snapshotMs', 'totalMs']);
    assert.ok(Object.values(timing).every(value => Number.isFinite(value) && value >= 0));
    assert.ok(Math.abs(timing.totalMs - timing.processReadyMs - timing.sessionRestoreMs - timing.snapshotMs - timing.modelRestoreMs) < .001);
    pool.activate(worker);
    assert.equal(worker.startupTiming, timing, 'Resident activation does not claim a new cold startup');
  } finally { await pool.stopAll(); }
});

test('idle retention grows within its cap, shrinks under pressure and still expires old sessions', async () => {
  let limit = 4;
  const { pool, open } = fixture({ idleLimit: () => limit });
  try {
    const workers = [];
    for (let index = 0; index < 6; index++) {
      const worker = await open();
      worker.messages = [{ role: 'user', content: 'saved' }];
      worker.touched = Date.now() - (6 - index) * 100;
      workers.push(worker);
    }
    await pool.recycle();
    assert.equal(pool.workers.size, 5, 'Four idle sessions plus the active session');
    assert.equal(pool.workers.has(workers[0].id), false);
    limit = 2;
    await pool.recycle();
    assert.equal(pool.workers.size, 3);
    assert.equal(pool.active, workers[5]);
    workers[3].touched = Date.now() - 6 * 60000;
    limit = 100;
    await pool.recycle();
    assert.equal(pool.workers.has(workers[3].id), false, 'More headroom does not override expiry');
  } finally { await pool.stopAll(); }
});

test('Moved-session Cron isolation survives provider-driven transport refresh', async () => {
  const transports: Transport[] = [];
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'moved');
    transports.push(transport);
    return transport;
  });
  try {
    const worker = await pool.prepare('node', 'step', 'project',
      { DESKTOP_CRON_SCOPE_DIR: 'desktop-owned-bindings' }, 'moved.jsonl');
    assert.equal(transports[0].startEnv.DESKTOP_CRON_SCOPE_DIR, 'desktop-owned-bindings');
    await pool.refresh(worker, 'node', 'step', {});
    assert.equal(transports[1].startEnv.DESKTOP_CRON_SCOPE_DIR, 'desktop-owned-bindings');
    assert.equal(worker.state?.sessionId, 'moved');
  } finally { await pool.stopAll(); }
});

test('native extension dialogs cannot impersonate Desktop project-trust confirmations', async () => {
  const { pool, transports, events, open } = fixture();
  try {
    const worker = await open();
    transports[0].receive({ type: 'extension_ui_request', method: 'confirm', id: 'native-confirm',
      title: 'Native tool', projectTrust: { cwd: 'another-project' }, message: 'not a Desktop authorization' });
    assert.equal(worker.pendingUI.get('native-confirm')?.projectTrust, undefined);
    assert.equal(events.find(event => event.id === 'native-confirm')?.projectTrust, undefined);
    pool.respondToRequest(worker, { id: 'native-confirm', confirmed: false });
    assert.deepEqual(transports[0].answers, [{ id: 'native-confirm', confirmed: false }]);
  } finally { await pool.stopAll(); }
});

for (const durable of [true, false]) {
  test(`Cron ${durable ? 'durable' : 'session'} host survives idle and count-based recycling until native release`, async () => {
    const { pool, transports, events, open } = fixture();
    try {
      const host = await open();
      host.messages = [{ role: 'user', content: 'schedule' }];
      host.touched = 0;
      const notify = (jobs: any[]) => transports[0].receive({ type: 'extension_ui_request',
        method: 'setStatus', statusKey: 'desktop-cron', statusText: JSON.stringify({ version: 1, status: 'ready', jobs }) });
      notify([{ id: 'scheduled', recurring: true, durable, nextFireAt: 0, autoExpireAt: 1 }]);
      for (let i = 0; i < 4; i++) {
        const other = await open();
        other.messages = [{ role: 'user', content: 'other' }];
      }
      assert.equal(pool.isBusy(host), false, 'Scheduling is not an active model turn');
      assert.equal(pool.running, true, 'Account changes must not silently move scheduled billing');
      await pool.assertIdle(host);
      await pool.assertAllIdle({ stopHost: false });
      await assert.rejects(pool.assertIdle(host, { stopHost: true }), /Cron/);
      await assert.rejects(pool.assertAllIdle(), /Cron/);
      await assert.rejects(pool.refresh(host, 'node', 'step', {}), /Cron/);
      await pool.recycle();
      assert.equal(transports[0].stopped, false);
      assert.equal(pool.workers.has(host.id), true);
      assert.ok(!events.some(event => event.statusKey === 'desktop-cron'), 'Internal state is not renderer status text');
      notify([]);
      await pool.recycle();
      assert.equal(transports[0].stopped, true);
      assert.equal(pool.workers.has(host.id), false);
    } finally { await pool.stopAll(); }
  });
}

test('non-stopping idle checks retain task, queue, Goal and mutation protection with Cron waiting', async () => {
  const { pool, transports, open } = fixture();
  const host = await open();
  try {
    transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-cron',
      statusText: JSON.stringify({ version: 1, status: 'ready', jobs: [
        { id: 'scheduled', recurring: true, durable: false, nextFireAt: Date.now() + 60000 },
      ] }) });
    await pool.assertAllIdle({ stopHost: false });
    host.busy = true;
    await assert.rejects(pool.assertAllIdle({ stopHost: false }), /Stop/);
    host.busy = false;
    host.queued = true;
    await assert.rejects(pool.assertAllIdle({ stopHost: false }), /pending messages/);
    host.queued = false;
    host.mutating = true;
    await assert.rejects(pool.assertAllIdle({ stopHost: false }), /Session operation/);
    host.mutating = false;
    host.launch!.goal = { status: 'active', objective: 'fixture', id: 'goal', sessionId: 'session-0',
      tokensUsed: 0, timeUsedSeconds: 0, iteration: 1, createdAt: '', updatedAt: '' };
    await assert.rejects(pool.assertAllIdle({ stopHost: false }), /Pause/);
    host.launch!.goal = undefined;
    await pool.assertAllIdle({ stopHost: false });
    await assert.rejects(pool.assertAllIdle(), /Cron/);
    assert.equal(transports[0].stopped, false);
  } finally { await pool.stopAll(); }
});

test('unknown Cron state keeps its host; stale transports cannot pin a replacement', async () => {
  const transports: Transport[] = [];
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'same-session');
    transports.push(transport);
    return transport;
  });
  try {
    const host = await pool.open('node', 'step', 'workspace', {});
    host.messages = [{ role: 'user', content: 'history' }];
    host.touched = 0;
    pool.activeId = undefined;
    transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-cron', statusText: 'broken' });
    await pool.recycle();
    assert.equal(transports[0].stopped, false);
    assert.equal(host.cron?.status, 'unavailable');
    transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-cron',
      statusText: JSON.stringify({ version: 1, status: 'ready', jobs: [] }) });
    await pool.refresh(host, 'node', 'step', {});
    const replacement = host.rpc;
    transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-cron', statusText: 'broken' });
    assert.equal(host.cron, undefined);
    assert.equal(host.rpc, replacement);
    const live = transports.at(-1)!;
    live.receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-cron', statusText: 'broken' });
    assert.equal(pool.running, true);
    live.receive({ type: 'desktop_exit' });
    assert.equal(host.cron, undefined, 'A crashed process has no live scheduler or temporary jobs');
    assert.equal(pool.running, false);
    await pool.assertAllIdle();
  } finally { await pool.stopAll(); }
});

test('host-stop guard rechecks Cron state arriving during the idle RPC read', async () => {
  const { pool, transports, open } = fixture();
  try {
    const host = await open();
    const transport = transports[0];
    const request = transport.request.bind(transport);
    transport.request = async (type, args) => {
      if (type === 'get_state') transport.receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-cron',
        statusText: JSON.stringify({ version: 1, status: 'ready', jobs: [
          { id: 'racing-cron', recurring: true, durable: false, nextFireAt: Date.now() + 60000 },
        ] }) });
      return request(type, args);
    };
    await assert.rejects(pool.assertIdle(host, { stopHost: true }), /Cron/);
    assert.equal(transport.stopped, false);
    await pool.assertIdle(host);
  } finally { await pool.stopAll(); }
});

test('clarification has no implicit expiry and only its matching completion clears it', async () => {
  const { pool, transports, events, open } = fixture();
  const worker = await open();
  try {
    const question = { version: 1, callId: 'ask-1', questions: [
      { id: 'q1', label: 'Question', question: 'Which?', options: [], allowFreeform: true },
    ] };
    transports[0].receive({ type: 'extension_ui_request', method: 'input', id: 'question',
      title: QUESTION_TITLE + JSON.stringify(question) });
    assert.equal(worker.pendingUI.has('question'), true);
    assert.equal(worker.uiTimers.size, 0, 'No desktop invented timeout or automatic answer');
    transports[0].receive({ type: 'tool_execution_end', toolCallId: 'another' });
    assert.equal(worker.pendingUI.has('question'), true);
    transports[0].receive({ type: 'tool_execution_end', toolCallId: 'ask-1' });
    assert.equal(worker.pendingUI.size, 0);
    assert.ok(events.some(e => e.type === 'desktop_ui_expired' && e.id === 'question'));
    assert.equal(transports[0].answers.length, 0);
  } finally { await pool.stopAll(); }
});

for (const type of ['tool_execution_end', 'agent_end'] as const) {
  test(`clarification expiry preserves renderer acceptance of ${type}`, async () => {
    const { pool, transports, events, open } = fixture();
    const worker = await open();
    try {
      const count = type === 'agent_end' ? 2 : 1;
      for (let index = 0; index < count; index++) {
        transports[0].receive({ type: 'extension_ui_request', method: 'input', id: `question-${index}`,
          title: QUESTION_TITLE + JSON.stringify({ version: 1, callId: `ask-${index}`, questions: [
            { id: 'q1', label: 'Question', question: 'Which?', options: [], allowFreeform: true },
          ] }) });
      }
      const revision = new MessageRevision();
      revision.acceptSnapshot({ runtimeId: worker.id, runtimeRevision: worker.revision });
      const start = events.length;
      transports[0].receive({ type, toolCallId: 'ask-0', toolName: 'clarify_user',
        isError: true, result: { content: [{ type: 'text', text: 'Question cancelled' }] } });
      const emitted = events.slice(start).filter(event => event.runtimeId === worker.id
        && (event.type === 'desktop_ui_expired' || event.type === type));
      assert.equal(emitted.length, count + 1);
      assert.equal(emitted.at(-1)?.type, type);
      for (const event of emitted) assert.equal(revision.acceptEvent(event), true,
        `${event.type} must have a newer revision than every preceding expiry`);
      assert.equal(emitted.at(-1)?.runtimeRevision, worker.revision);
      assert.equal(worker.pendingUI.size, 0);
      if (type === 'tool_execution_end') {
        const result = applyToolResult([], emitted.at(-1)!)[0];
        assert.equal(result.toolCallId, 'ask-0');
        assert.equal(result.isError, true);
        assert.deepEqual(result.content, [{ type: 'text', text: 'Question cancelled' }]);
      }
    } finally { await pool.stopAll(); }
  });
}

test('native Ultracode restore and CLM maintenance update worker state without granting one-turn consent', async () => {
  const { pool, transports, open } = fixture();
  const worker = await open();
  try {
    transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'ultracode', statusText: 'Ultracode on' });
    assert.equal(worker.launch?.ultracode, true);
    assert.equal(Boolean(worker.launch?.ultracodeTurn), false);
    transports[0].receive({ type: 'auto_clm_start', reason: 'native-threshold' });
    assert.equal(worker.state?.isCompacting, true);
    assert.equal(pool.isBusy(worker), true);
    await assert.rejects(pool.refresh(worker, 'node', 'step', {}));
    transports[0].receive({ type: 'auto_clm_end', result: { attempted: true, accepted: false, fallback: true } });
    assert.equal(worker.state?.isCompacting, false);
    transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'ultracode' });
    assert.equal(worker.launch?.ultracode, false);
  } finally { await pool.stopAll(); }
});

for (const outcome of [{ result: {}, aborted: false }, { errorMessage: 'failed', aborted: false }, { aborted: true }]) {
  test(`native compaction clears maintenance on ${outcome.aborted ? 'cancel' : outcome.errorMessage ? 'failure' : 'success'}`, async () => {
    const { pool, transports, events, open } = fixture();
    const worker = await open();
    try {
      transports[0].receive({ type: 'compaction_start', reason: 'manual' });
      assert.equal(worker.state?.isCompacting, true);
      assert.equal(pool.isBusy(worker), true);
      transports[0].receive({ type: 'compaction_end', reason: 'manual', willRetry: false, ...outcome });
      assert.equal(worker.state?.isCompacting, false);
      assert.equal(pool.isBusy(worker), false);
      assert.ok(events.some(event => event.type === 'desktop_runtimes'));
    } finally { await pool.stopAll(); }
  });
}

test('idle configuration refresh preserves runtime identity and ignores the retired transport', async () => {
  const transports: Transport[] = [];
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'same-session');
    transports.push(transport);
    return transport;
  });
  const worker = await pool.open('node', 'step', 'workspace', {});
  const id = worker.id;
  worker.permissionPreset = 'approve-for-me';
  await pool.refresh(worker, 'node', 'step', { NEW_CONFIG: '1' });
  assert.equal(pool.active, worker);
  assert.equal(worker.id, id);
  assert.equal(worker.state?.sessionId, 'same-session');
  assert.equal(worker.permissionPreset, 'approve-for-me');
  assert.equal(transports[0].stopped, true);
  const resumeAt = transports[1].startArgs.indexOf('--session-id');
  assert.deepEqual(transports[1].startArgs.slice(resumeAt, resumeAt + 2), ['--session-id', 'same-session']);
  assert.equal(transports[1].calls.includes('new_session'), false, 'unpersisted empty session is not recreated');
  const revision = worker.revision;
  transports[0].receive({ type: 'desktop_exit' });
  transports[0].receive({ type: 'agent_start' });
  assert.equal(worker.revision, revision);
  assert.equal(worker.status, 'connected');
  assert.equal(worker.busy, false);
  transports[1].receive({ type: 'agent_start' });
  assert.equal(worker.busy, true);
  await pool.stopAll();
});

test('configuration refresh suspends a missing selected model instead of applying the first provider', async () => {
  const transports: Transport[] = [];
  const step = { provider: 'step', id: 'step-5', name: 'Step 5' };
  const sol = { provider: 'fixture', id: 'sol', name: 'Sol' };
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'same-session');
    const first = transports.length === 0;
    const request = transport.request.bind(transport);
    transport.request = async (type, args) => {
      if (type === 'get_state') return { sessionId: 'same-session', isStreaming: false, model: first ? step : sol };
      if (type === 'get_available_models') return { models: first ? [sol, step] : [sol] };
      return request(type, args);
    };
    transports.push(transport);
    return transport;
  });
  try {
    const worker = await pool.open('node', 'step', 'workspace', {});
    await assert.rejects(pool.refresh(worker, 'node', 'step', {}), /step\/step-5.*unavailable/);
    assert.equal(transports[1].calls.includes('set_model'), false);
    assert.equal(transports[1].stopped, true);
    assert.equal(worker.status, 'disconnected');
    assert.equal(worker.state?.model?.provider, 'step', 'UI retains the original identity, not the runtime fallback');
  } finally { await pool.stopAll(); }
});

test('provider saves can suspend an unavailable model and restore only that identity when enabled again', async () => {
  const transports: Transport[] = [];
  const step = { provider: 'step', id: 'step-5', name: 'Step 5' };
  const sol = { provider: 'fixture', id: 'sol', name: 'Sol' };
  let enabled = true;
  let broken = false;
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'same-session');
    let selected = transports.length === 0 ? step : sol;
    const request = transport.request.bind(transport);
    transport.request = async (type, args) => {
      if (broken) throw new Error('Transport failed');
      if (type === 'get_state') return { sessionId: 'same-session', isStreaming: false, model: selected };
      if (type === 'get_available_models') return { models: enabled ? [sol, step] : [sol] };
      if (type === 'set_model') {
        assert.deepEqual(args, { provider: step.provider, modelId: step.id });
        selected = step;
      }
      return request(type, args);
    };
    transports.push(transport);
    return transport;
  });
  try {
    const worker = await pool.open('node', 'step', 'workspace', {});
    enabled = false;
    await pool.refresh(worker, 'node', 'step', {}, { allowUnavailableModel: true });
    assert.equal(worker.modelUnavailable, true);
    assert.equal(worker.status, 'disconnected');
    assert.equal(worker.state?.model?.id, step.id);
    assert.equal(transports[1].stopped, true);
    assert.equal(transports[1].calls.includes('set_model'), false);
    enabled = true;
    await pool.refresh(worker, 'node', 'step', {}, { allowUnavailableModel: true });
    assert.equal(worker.modelUnavailable, false);
    assert.equal(worker.status, 'connected');
    assert.equal(worker.state?.model?.id, step.id);
    assert.equal(worker.state?.sessionId, 'same-session');
    broken = true;
    await assert.rejects(pool.refresh(worker, 'node', 'step', {}, { allowUnavailableModel: true }), /Transport failed/);
    assert.equal(worker.modelUnavailable, false, 'unrelated failures are not treated as a disabled model');
  } finally { await pool.stopAll(); }
});

test('model initialization verifies saved sessions before activation and does not change the viewed chat on failure', async () => {
  const transports: Transport[] = [];
  const initializing: boolean[] = [];
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, `session-${transports.length}`);
    transports.push(transport);
    return transport;
  }, { initializeModel: async (_worker, restoring) => {
    initializing.push(restoring);
    if (restoring) throw new Error('Saved model unavailable');
  } });
  try {
    const original = await pool.open('node', 'step', 'workspace', {});
    await assert.rejects(pool.prepare('node', 'step', 'workspace', {}, 'saved.jsonl'), /Saved model unavailable/);
    assert.equal(pool.active, original);
    assert.equal(transports[1].stopped, true);
    assert.deepEqual(initializing, [false, true]);
  } finally { await pool.stopAll(); }
});

test('reused empty sessions recheck the current new-session model preference', async () => {
  let initialized = 0;
  const pool = new SessionRuntimes(() => {}, receive => new Transport(receive, 'same-session'),
    { initializeModel: async (_worker, restoring) => {
      assert.equal(restoring, false);
      initialized++;
    } });
  try {
    const first = await pool.open('node', 'step', 'workspace', {});
    assert.equal(await pool.open('node', 'step', 'workspace', {}), first);
    assert.equal(initialized, 2);
  } finally { await pool.stopAll(); }
});

test('configuration refresh never stops running, queued or mutating workers', async () => {
  for (const field of ['busy', 'queued', 'mutating', 'operations', 'stopping'] as const) {
    const { pool, transports, open } = fixture();
    const worker = await open();
    Object.assign(worker, { [field]: field === 'operations' ? 1 : true });
    await assert.rejects(pool.refresh(worker, 'node', 'step', {}));
    assert.equal(transports[0].stopped, false, field);
    await pool.stopAll();
  }
});
test('configuration refresh never replays a session-only Full Access grant or hides the new native tier', async () => {
  for (const nativeTier of ['Ask', 'Full Access']) {
    const transports: Transport[] = [];
    const prompts: string[] = [];
    const pool = new SessionRuntimes(() => {}, receive => {
      const transport = new Transport(receive, 'same-session');
      const index = transports.length;
      transport.start = () => {
        if (index) receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'step-permission', statusText: `Mode: ${nativeTier}` });
      };
      const request = transport.request.bind(transport);
      transport.request = async (type, args) => {
        if (type === 'prompt') prompts.push(String(args?.message));
        return request(type, args);
      };
      transports.push(transport);
      return transport;
    });
    try {
      const worker = await pool.open('node', 'step', 'workspace', {});
      worker.permissionPreset = 'full-access';
      await pool.refresh(worker, 'node', 'step', {});
      assert.deepEqual(prompts, [], 'Reconstruction must not request a fresh Full Access grant');
      assert.equal(worker.permissionPreset, nativeTier === 'Ask' ? 'ask' : 'full-access');
      transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'step-permission', statusText: 'Mode: Full Access' });
      assert.equal(worker.permissionPreset, nativeTier === 'Ask' ? 'ask' : 'full-access', 'Old transport cannot restore its grant');
    } finally { await pool.stopAll(); }
  }
});
test('unanswered Full Access consent expires without granting and cannot accept a late response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pool, transports, open } = fixture();
  try {
    const worker = await open();
    worker.permissionPreset = 'ask';
    transports[0].receive({ type: 'extension_ui_request', id: 'full-risk', method: 'select',
      title: 'Enable full access?\n\nRisk message', options: [
        'Yes, continue anyway \u2014 apply full access for this session',
        "Yes, and don't ask again \u2014 enable full access and remember this choice",
        'Cancel \u2014 go back without enabling full access',
      ] });
    assert.equal(worker.pendingUI.has('full-risk'), true);
    t.mock.timers.tick(119999);
    assert.equal(worker.pendingUI.has('full-risk'), true);
    t.mock.timers.tick(1);
    assert.equal(worker.pendingUI.has('full-risk'), false);
    assert.deepEqual(transports[0].answers, [{ id: 'full-risk', cancelled: true }]);
    assert.equal(worker.permissionPreset, 'ask');
    assert.equal(worker.fullAccessCancellationRevision, 0, 'Expiry is not an intentional user cancellation');
    assert.throws(() => pool.respondToRequest(worker, { id: 'full-risk', value: 'grant' }), /expired/);
  } finally { await pool.stopAll(); }
});
test('only explicit native Full Access cancellation records a cancellation result', async () => {
  const { pool, transports, open } = fixture();
  const options = [
    'Yes, continue anyway \u2014 apply full access for this session',
    "Yes, and don't ask again \u2014 enable full access and remember this choice",
    'Cancel \u2014 go back without enabling full access',
  ];
  try {
    const worker = await open();
    for (const value of options.slice(0, 2)) {
      transports[0].receive({ type: 'extension_ui_request', id: 'risk', method: 'select', title: 'Enable full access?\n\nRisk', options });
      pool.respondToRequest(worker, { id: 'risk', value });
      assert.equal(worker.fullAccessCancellationRevision, 0);
    }
    for (const answer of [{ value: options[2] }, { cancelled: true }]) {
      const before = worker.fullAccessCancellationRevision!;
      transports[0].receive({ type: 'extension_ui_request', id: 'risk', method: 'select', title: 'Enable full access?\n\nRisk', options });
      pool.respondToRequest(worker, { id: 'risk', ...answer });
      assert.equal(worker.fullAccessCancellationRevision, before + 1);
    }
    transports[0].receive({ type: 'extension_ui_request', id: 'other', method: 'select', title: 'Another choice', options });
    pool.respondToRequest(worker, { id: 'other', cancelled: true });
    assert.equal(worker.fullAccessCancellationRevision, 2, 'Unrelated dialogs do not cancel permission activation');
    assert.throws(() => pool.respondToRequest(worker, { id: 'risk', cancelled: true }), /expired/);
    assert.equal(worker.fullAccessCancellationRevision, 2);
  } finally { await pool.stopAll(); }
});

test('failed replacement preserves the active session and suspends all configuration peers', async () => {
  const transports: Transport[] = [];
  const pool = new SessionRuntimes(() => {}, receive => {
    const transport = new Transport(receive, 'same-session');
    if (transports.length === 2) transport.start = () => { throw new Error('replacement failed'); };
    transports.push(transport);
    return transport;
  });
  const peer = await pool.open('node', 'step', 'peer', {});
  const active = await pool.open('node', 'step', 'active', {});
  await assert.rejects(pool.refresh(active, 'node', 'step', {}), /replacement failed/);
  assert.equal(pool.active, active);
  assert.equal(active.state?.sessionId, 'same-session');
  assert.equal(active.status, 'disconnected');
  await pool.suspend([peer, active]);
  assert.equal(peer.status, 'disconnected');
  assert.ok(transports.every(transport => transport.stopped));
  assert.equal(pool.workers.size, 2);
  transports[0].receive({ type: 'agent_start' });
  assert.equal(peer.busy, false, 'late stopped-transport events cannot revive a suspended worker');
  assert.equal(pool.running, false);
  await pool.stopAll();
});

test('wire message revisions increase per worker and match its snapshot revision', async () => {
  const { pool, transports, events, open } = fixture();
  const worker = await open();
  try {
    for (const event of [
      { type: 'message_start', message: { role: 'assistant', content: [] } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Alpha' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Alpha' } },
    ]) transports[0].receive(event);
    const messages = events.filter(event => event.type.startsWith('message_'));
    assert.deepEqual(messages.map(event => event.runtimeRevision), [1, 2, 3]);
    assert.equal(worker.revision, 3);
    assert.deepEqual(worker.messages[0].content, [{ type: 'text', text: 'AlphaAlpha' }]);
  } finally { await pool.stopAll(); }
});

test('preparing cold history does not activate it or clear its unread status', async () => {
  const { pool, open } = fixture();
  const original = await open();
  pool.unreadSessionIds.add('session-1');
  const prepared = await pool.prepare('node', 'step', 'other-workspace', {}, 'session-1.jsonl');
  assert.equal(pool.active, original);
  assert.equal(prepared.state?.sessionId, 'session-1');
  assert.equal(pool.unreadSessionIds.has('session-1'), true);
  pool.activate(prepared);
  assert.equal(pool.active, prepared);
  assert.equal(pool.unreadSessionIds.has('session-1'), false);
  await pool.stopAll();
});

test('recycling rechecks activation and pending operations after awaiting another disposal', async () => {
  const { pool, transports, open } = fixture();
  const workers = [];
  for (let i = 0; i < 5; i++) {
    const worker = await open();
    worker.messages = [{ role: 'user', content: 'saved' }];
    worker.touched = i;
    workers.push(worker);
  }
  let finish!: () => void;
  let disposing!: () => void;
  const began = new Promise<void>(resolve => { disposing = resolve; });
  const stop = new Promise<void>(resolve => { finish = resolve; });
  transports[3].stop = async () => { disposing(); await stop; };
  const recycling = pool.recycle();
  await began;
  pool.activate(workers[2]);
  workers[1].operations++;
  transports[0].receive({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'desktop-cron',
    statusText: JSON.stringify({ version: 1, status: 'ready', jobs: [
      { id: 'late-cron', recurring: true, durable: false, nextFireAt: Date.now() + 60000 },
    ] }) });
  finish();
  await recycling;
  assert.equal(pool.active, workers[2]);
  assert.equal(pool.workers.has(workers[2].id), true);
  assert.equal(pool.workers.has(workers[1].id), true);
  assert.equal(pool.workers.has(workers[0].id), true, 'Recheck a Cron pin acquired while another host was stopping');
  workers[1].operations--;
  await pool.stopAll();
});

test('recycling retains navigation preparations and rechecks new reservations during disposal', async () => {
  const { pool, transports, open } = fixture();
  const workers = [];
  for (let i = 0; i < 5; i++) {
    const worker = await open();
    worker.messages = [{ role: 'user', content: 'saved' }];
    worker.touched = i;
    workers.push(worker);
  }
  const reserved = new Set([workers[2]]);
  let finish!: () => void, disposing!: () => void;
  const began = new Promise<void>(resolve => { disposing = resolve; });
  const stop = new Promise<void>(resolve => { finish = resolve; });
  transports[3].stop = async () => { disposing(); await stop; };
  const recycling = pool.recycle(worker => reserved.has(worker));
  try {
    await began;
    reserved.add(workers[1]);
    finish();
    await recycling;
    assert.equal(pool.workers.get(workers[2].id), workers[2], 'A preparation can be connected before initialization finishes');
    assert.equal(pool.workers.get(workers[1].id), workers[1], 'A new navigation reservation is rechecked after awaiting disposal');
    assert.equal(pool.workers.has(workers[0].id), false, 'Unreserved expired workers still recycle');
    assert.equal(pool.active, workers[4]);
  } finally {
    finish();
    await recycling;
    await pool.stopAll();
  }
});

test('repeated new-session requests reuse one empty worker without resetting it', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  empty.permissionPreset = 'approve-for-me';
  const calls = transports[0].calls.length;
  for (let i = 0; i < 5; i++) assert.equal(await open('workspace'), empty);
  assert.equal(pool.active, empty);
  assert.equal(pool.workers.size, 1);
  assert.equal(transports.length, 1);
  assert.equal(transports[0].calls.length, calls);
  assert.equal(empty.permissionPreset, 'approve-for-me');
  await pool.stopAll();
});

test('concurrent new-session requests share the startup worker', async () => {
  const { pool, transports, open } = fixture();
  const workers = await Promise.all(Array.from({ length: 5 }, () => open('workspace')));
  assert.ok(workers.every(worker => worker === workers[0]));
  assert.equal(transports.length, 1);
  assert.equal(transports[0].calls.filter(type => type === 'new_session').length, 1);
  await pool.stopAll();
});

test('new-session requests wait for all ordinary snapshot reads and then reuse the empty worker', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const original = transports[0].request.bind(transports[0]);
  const releases: Array<() => void> = [];
  transports[0].request = async type => {
    if (type === 'get_messages') await new Promise<void>(resolve => releases.push(resolve));
    return original(type);
  };
  const reads = [pool.read(empty), pool.read(empty)];
  let opened = false;
  const openings = Promise.all(Array.from({ length: 5 }, () => open('workspace'))).then(workers => {
    opened = true;
    return workers;
  });
  try {
    await Promise.resolve();
    assert.equal(transports.length, 1, 'Snapshot refresh must not cause another worker to start');
    releases[0]();
    await reads[0];
    assert.equal(opened, false, 'The second refresh must also finish before reuse');
    releases[1]();
    await reads[1];
    const workers = await openings;
    assert.ok(workers.every(worker => worker === empty));
    assert.equal(transports.length, 1);
    assert.equal(empty.operations, 0);
  } finally {
    for (const release of releases) release();
    await Promise.allSettled([...reads, openings]);
    await pool.stopAll();
  }
});

test('waiting for a snapshot rechecks history, activity, operations and worker membership', async () => {
  for (const change of ['history', 'running', 'approval', 'mutating', 'operation', 'failed', 'removed']) {
    const { pool, transports, open } = fixture();
    const empty = await open('workspace');
    const original = transports[0].request.bind(transports[0]);
    let release!: () => void;
    transports[0].request = async type => {
      if (type === 'get_messages') await new Promise<void>(resolve => { release = resolve; });
      return original(type);
    };
    const read = pool.read(empty);
    const opening = open('workspace');
    try {
      await Promise.resolve();
      assert.equal(transports.length, 1, change);
      if (change === 'history') transports[0].receive({ type: 'message_start', message: { role: 'user', content: 'new message' } });
      if (change === 'running') transports[0].receive({ type: 'agent_start' });
      if (change === 'approval') transports[0].receive({ type: 'extension_ui_request', method: 'confirm', id: 'approval' });
      if (change === 'mutating') empty.mutating = true;
      if (change === 'operation') empty.operations++;
      if (change === 'failed') empty.failed = true;
      if (change === 'removed') await pool.remove(empty);
      release();
      await read;
      assert.notEqual(await opening, empty, change);
      assert.equal(transports.length, 2, change);
    } finally {
      release();
      await Promise.allSettled([read, opening]);
      await pool.stopAll();
    }
  }
});

test('a non-snapshot operation alongside a read is not treated as a reusable empty worker', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const original = transports[0].request.bind(transports[0]);
  let release!: () => void;
  transports[0].request = async type => {
    if (type === 'get_messages') await new Promise<void>(resolve => { release = resolve; });
    return original(type);
  };
  const read = pool.read(empty);
  empty.operations++;
  try {
    assert.notEqual(await open('workspace'), empty);
    assert.equal(transports.length, 2);
  } finally {
    release();
    await read;
    await pool.stopAll();
  }
});

test('failed snapshot reads reject waiting opens without spawning and release their bookkeeping', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const original = transports[0].request.bind(transports[0]);
  let fail!: (error: Error) => void;
  transports[0].request = async type => {
    if (type === 'get_messages') await new Promise<void>((_resolve, reject) => { fail = reject; });
    return original(type);
  };
  const read = pool.read(empty);
  const reading = assert.rejects(read, /Snapshot failed/);
  const opening = assert.rejects(open('workspace'), /Snapshot failed/);
  fail(new Error('Snapshot failed'));
  await Promise.all([reading, opening]);
  assert.equal(transports.length, 1);
  assert.equal(empty.operations, 0);
  transports[0].request = original;
  await pool.read(empty);
  assert.equal(await open('workspace'), empty);
  await pool.stopAll();
});

test('new sessions reuse background empties only in the same workspace', async () => {
  const { pool, transports, open } = fixture();
  const a = await open('workspace-a');
  const b = await open('workspace-b');
  assert.notEqual(a, b);
  assert.equal(await open('workspace-a'), a);
  assert.equal(pool.active, a);
  assert.equal(transports.length, 2);
  a.messages = [{ role: 'user', content: 'saved' }];
  const next = await open('workspace-a');
  assert.notEqual(next, a);
  assert.equal(await open('workspace-a'), next);
  assert.equal(transports.length, 3);
  await pool.stopAll();
});

test('restoring a saved session never reuses an unrelated empty worker', async () => {
  const { pool, transports, open } = fixture();
  const empty = await open('workspace');
  const restored = await pool.open('node', 'step', 'workspace', {}, 'saved.jsonl');
  assert.notEqual(restored, empty);
  assert.ok(transports[1].calls.includes('switch_session'));
  await pool.stopAll();
});

test('busy, modifying, failed and disconnected empty workers are not reused', async () => {
  const states = [
    { busy: true }, { submissions: 1 }, { operations: 1 }, { mutating: true },
    { failed: true }, { interrupted: true }, { status: 'disconnected' },
  ];
  for (const state of states) {
    const { pool, transports, open } = fixture();
    const old = await open('workspace');
    Object.assign(old, state);
    assert.notEqual(await open('workspace'), old, JSON.stringify(state));
    assert.equal(transports[0].stopped, false);
    await pool.stopAll();
  }
  for (const state of [{ isCompacting: true }, { pendingMessageCount: 1 }, { isStreaming: true }]) {
    const { pool, open } = fixture();
    const old = await open('workspace');
    Object.assign(old.state!, state);
    assert.notEqual(await open('workspace'), old);
    await pool.stopAll();
  }
  const { pool, transports, open } = fixture();
  const old = await open('workspace');
  transports[0].receive({ type: 'extension_ui_request', method: 'confirm', id: 'approval' });
  assert.notEqual(await open('workspace'), old);
  assert.equal(old.pendingUI.size, 1);
  await pool.stopAll();
});

test('failed empty-worker startup is released so a later new session can retry', async () => {
  const { pool, transports, open } = fixture();
  const first = open('workspace');
  transports[0].request = async () => { throw new Error('Startup failed'); };
  await assert.rejects(first, /Startup failed/);
  assert.equal(pool.workers.size, 0);
  assert.equal(transports[0].stopped, true);
  const next = await open('workspace');
  assert.equal(pool.active, next);
  assert.equal(transports.length, 2);
  await pool.stopAll();
});

function branchFixture(outcome: 'success' | 'cancelled' | 'changed' = 'success') {
  const transports: Transport[] = [];
  const events: RuntimeEvent[] = [];
  const history = [{ id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'question', timestamp: 1 } },
    { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'answer', timestamp: 2 } }];
  const pool = new SessionRuntimes(event => events.push(event), receive => {
    const transport = new Transport(receive, 'source');
    let branched = false;
    transport.request = async (type, args) => {
      transport.calls.push(type);
      if (type === 'get_state') return { sessionId: branched ? 'branch' : 'source', sessionFile: 'source.jsonl', isStreaming: false };
      if (type === 'get_messages') return { messages: branched && transport.calls.includes('fork') ? [] : history.map(entry => entry.message) };
      if (type === 'get_entries') return { entries: history, leafId: outcome === 'changed' && transports.length > 1 ? 'u1' : 'a1' };
      if (type === 'get_available_models') return { models: [] };
      if (type === 'get_commands') return { commands: [{ name: 'permissions', source: 'extension' }] };
      if (type === 'prompt') assert.equal(args?.message, '/permissions approve-for-me');
      if (type === 'clone' || type === 'fork') {
        branched = outcome !== 'cancelled';
        return { cancelled: outcome === 'cancelled' };
      }
      return {};
    };
    transports.push(transport);
    return transport;
  });
  return { pool, transports, events };
}

function retryFixture(outcome: 'success' | 'cancelled' | 'unsupported' | 'rejected' = 'success') {
  const events: RuntimeEvent[] = [];
  const image = { type: 'image', mimeType: 'image/png', data: 'fixture' };
  const entries = [
    { id: 'u1', parentId: null, type: 'message', message: { role: 'user', content: 'same', timestamp: 1 } },
    { id: 'a1', parentId: 'u1', type: 'message', message: { role: 'assistant', content: 'earlier', timestamp: 2 } },
    { id: 'u2', parentId: 'a1', type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'same' }, image], timestamp: 3 } },
    { id: 'a2', parentId: 'u2', type: 'message', message: { role: 'assistant', content: 'discarded', timestamp: 4 } },
  ];
  let leafId = 'a2';
  const submitted: Record<string, unknown>[] = [];
  const pool = new SessionRuntimes(event => events.push(event), receive => {
    const transport = new Transport(receive, 'source');
    transport.request = async (type, args) => {
      if (type === 'get_state') return { sessionId: 'source', sessionFile: 'source.jsonl', isStreaming: false };
      if (type === 'get_entries') return { entries, leafId };
      if (type === 'get_messages') return { messages: leafId === 'a1' ? entries.slice(0, 2).map(entry => entry.message) : entries.map(entry => entry.message) };
      if (type === 'get_available_models') return { models: [] };
      if (type === 'get_commands') return { commands: outcome === 'unsupported' ? [] : [{ name: '_desktop_retry', source: 'extension' }] };
      if (type === 'switch_session') { leafId = 'a2'; return {}; }
      if (type === 'prompt') {
        if (args?.message === '/_desktop_retry u2') {
          if (outcome !== 'cancelled') leafId = 'a1';
        } else if (args?.message !== '/permissions approve-for-me') {
          submitted.push(args!);
          if (outcome === 'rejected') throw new Error('Submission rejected');
          assert.equal(events.some(event => event.type === 'desktop_history'), true);
        }
      }
      return {};
    };
    return transport;
  });
  return { pool, events, submitted, image };
}

test('retry stays in the same worker/session, excludes the old turn and retains images', async () => {
  const { pool, events, submitted, image } = retryFixture();
  const worker = await pool.open('node', 'step', 'cwd', {});
  worker.permissionPreset = 'approve-for-me';
  await pool.retryLatest(worker, 'u2', 'edited');
  assert.equal(pool.active, worker);
  assert.equal(pool.workers.size, 1);
  assert.equal(worker.state?.sessionId, 'source');
  assert.equal(worker.permissionPreset, 'approve-for-me');
  assert.deepEqual(events.find(event => event.type === 'desktop_history')?.messages.map((message: { content: unknown }) => message.content), ['same', 'earlier']);
  assert.deepEqual(submitted, [{ message: 'edited', images: [image] }]);
  assert.equal(worker.submissions, 0);
});
test('retry rejects old and forged entries before navigating', async () => {
  const { pool, events, submitted } = retryFixture();
  const worker = await pool.open('node', 'step', 'cwd', {});
  await assert.rejects(pool.retryLatest(worker, 'u1', 'edited'), /most recent/);
  await assert.rejects(pool.retryLatest(worker, 'forged', 'edited'), /most recent/);
  assert.equal(events.some(event => event.type === 'desktop_history'), false);
  assert.deepEqual(submitted, []);
});
test('cancelled navigation never submits an edited prompt', async () => {
  const { pool, submitted } = retryFixture('cancelled');
  const worker = await pool.open('node', 'step', 'cwd', {});
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /restore the edit point/);
  assert.equal(worker.messages.length, 4);
  assert.deepEqual(submitted, []);
});
test('missing edit extension and busy workers fail before history changes', async () => {
  const { pool, submitted } = retryFixture('unsupported');
  const worker = await pool.open('node', 'step', 'cwd', {});
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /does not support/);
  worker.busy = true;
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /Stop/);
  assert.equal(worker.messages.length, 4);
  assert.deepEqual(submitted, []);
});
test('rejected submission without a persisted user turn restores history and permissions', async () => {
  const { pool, events } = retryFixture('rejected');
  const worker = await pool.open('node', 'step', 'cwd', {});
  worker.permissionPreset = 'approve-for-me';
  await assert.rejects(pool.retryLatest(worker, 'u2', 'edited'), /Submission rejected/);
  assert.equal(worker.leafId, 'a2');
  assert.equal(worker.messages.length, 4);
  assert.equal(events.filter(event => event.type === 'desktop_history').length, 2);
  assert.equal(worker.submissions, 0);
});

test('clone is prepared in a different worker and preserves the source and permissions', async () => {
  const { pool, transports } = branchFixture();
  const source = await pool.open('node', 'step', 'cwd', {});
  const originalMessages = source.messages;
  const branch = await pool.open('node', 'step', 'cwd', {}, 'source.jsonl',
    { kind: 'clone', entryId: 'a1', leafId: 'a1', permissionPreset: 'approve-for-me' });
  assert.notEqual(branch.id, source.id);
  assert.equal(pool.active, branch);
  assert.equal(source.state?.sessionId, 'source');
  assert.equal(source.messages, originalMessages);
  assert.equal(transports[0].calls.includes('clone'), false);
  assert.equal(transports[1].calls.includes('clone'), true);
  assert.equal(transports[1].calls.includes('prompt'), true);
  assert.equal(transports[0].startEnv.STEPCODE_DESKTOP_BRANCH_SOURCE, undefined);
  assert.equal(transports[1].startEnv.STEPCODE_DESKTOP_BRANCH_SOURCE, resolve('source.jsonl'));
  assert.equal(transports[0].stopped, false);
  await pool.stopAll();
});

test('prepared copies open without cloning or clearing the source unread state', async () => {
  const { pool, transports, open } = fixture();
  const source = await open();
  pool.unreadSessionIds.add(source.state!.sessionId!);
  const copy = await pool.open('node', 'step', 'cwd', {}, 'copy.jsonl',
    { kind: 'open-copy', sessionId: 'session-1', name: 'Copied session' });
  assert.notEqual(copy.id, source.id);
  assert.equal(pool.active, copy);
  assert.equal(pool.unreadSessionIds.has(source.state!.sessionId!), true);
  assert.equal(transports[0].calls.includes('clone'), false);
  assert.equal(transports[1].calls.includes('clone'), false);
  assert.equal(transports[1].calls.includes('switch_session'), true);
  assert.equal(transports[1].startEnv.STEPCODE_DESKTOP_BRANCH_SOURCE, undefined);
  assert.equal(transports[0].stopped, false);
  await pool.stopAll();
});

test('prepared copies reject a mismatched saved identity without replacing the active worker', async () => {
  const { pool, transports, open } = fixture();
  const source = await open();
  await assert.rejects(pool.open('node', 'step', 'cwd', {}, 'copy.jsonl',
    { kind: 'open-copy', sessionId: 'forged' }), /identity changed/);
  assert.equal(pool.active, source);
  assert.equal(pool.workers.size, 1);
  assert.equal(transports[1].stopped, true);
  await pool.stopAll();
});

test('fork prepares a new empty route without the selected question or answer', async () => {
  const { pool, transports } = branchFixture();
  const source = await pool.open('node', 'step', 'cwd', {});
  const branch = await pool.open('node', 'step', 'cwd', {}, 'source.jsonl', { kind: 'fork', entryId: 'u1', leafId: 'a1' });
  assert.deepEqual(branch.messages, []);
  assert.equal(source.messages.length, 2);
  assert.equal(transports[0].calls.includes('fork'), false);
  await pool.stopAll();
});

test('cancelled or stale branches dispose the new worker and leave the source active', async () => {
  for (const outcome of ['cancelled', 'changed'] as const) {
    const { pool, transports } = branchFixture(outcome);
    const source = await pool.open('node', 'step', 'cwd', {});
    await assert.rejects(pool.open('node', 'step', 'cwd', {}, 'source.jsonl',
      { kind: 'clone', entryId: 'a1', leafId: 'a1' }), /cancelled|changed/);
    assert.equal(pool.active, source);
    assert.equal(pool.workers.size, 1);
    assert.equal(transports[1].stopped, true);
    assert.equal(transports[0].stopped, false);
    await pool.stopAll();
  }
});

test('session workers append shared-workspace rules without replacing project or product instructions', async () => {
  const { pool, transports, open } = fixture();
  const worker = await open();
  assert.deepEqual(transports[0].startArgs, ['--include-live-events', '--append-system-prompt', desktopSystemPolicy(worker.cwd)]);
  assert.ok(desktopSystemPolicy('/Work/中文 project', 'darwin').includes('Platform: darwin'));
  assert.ok(desktopSystemPolicy('/Work/中文 project', 'darwin').includes(JSON.stringify('/Work/中文 project')));
  assert.ok(WORKSPACE_POLICY.includes('Re-read the current file'));
  assert.ok(WORKSPACE_POLICY.includes('paths or hunks'));
  assert.ok(WORKSPACE_POLICY.includes('do not assume'));
  assert.ok(DESKTOP_SYSTEM_POLICY.includes(WORKSPACE_POLICY));
  assert.ok(DESKTOP_SYSTEM_POLICY.includes('[Open preview](http://localhost:8765/)'));
  assert.ok(DESKTOP_SYSTEM_POLICY.includes('Do not probe Desktop'));
  assert.ok(DESKTOP_SYSTEM_POLICY.includes('Only publish when the user explicitly requests it'));
  assert.ok(DESKTOP_SYSTEM_POLICY.includes(DESKTOP_CRON_POLICY));
  assert.ok(DESKTOP_CRON_POLICY.includes('recurring=true does not make a job durable'));
  assert.ok(DESKTOP_CRON_POLICY.includes('prefer cron_create with durable=true'));
  assert.ok(DESKTOP_CRON_POLICY.includes('Do not silently retry as temporary'));
  assert.ok(DESKTOP_CRON_POLICY.includes('read-only'));
  assert.ok(DESKTOP_CRON_POLICY.includes('ask for authorization before recreating'));
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
test('background Goal attention notifications wait for authoritative status and fire once', async () => {
  for (const status of ['complete', 'blocked', 'usage_limited', 'budget_limited', 'active', 'paused'] as const) {
    const { pool, transports, events, open } = fixture();
    const worker = await open();
    await open('foreground');
    const goal = { id: 'goal-1', sessionId: worker.state!.sessionId!, objective: 'Goal',
      status: 'active' as const, tokensUsed: 0, timeUsedSeconds: 0, iteration: 0,
      createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' };
    worker.launch = { plan: false, ultracode: false, goalArmed: false, goal };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = transports[0].request.bind(transports[0]);
    transports[0].request = async (type, args) => {
      if (type === 'get_entries') {
        await gate;
        return { entries: [{ id: 'status', parentId: null, type: 'custom',
          customType: 'step-goal', data: { ...goal, status } }], leafId: 'status' };
      }
      return original(type, args);
    };
    try {
      transports[0].receive({ type: 'agent_start' });
      transports[0].receive({ type: 'message_end', message: { role: 'assistant', content: 'Stopped', stopReason: 'stop' } });
      transports[0].receive({ type: 'agent_end' });
      transports[0].receive({ type: 'agent_end' });
      assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
      release();
      await pool.readLaunch(worker);
      const expected = status === 'active' || status === 'paused' ? 0 : 1;
      assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, expected, status);
      assert.equal(pool.unreadSessionIds.has(goal.sessionId), expected === 1, status);
      await pool.readLaunch(worker);
      assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, expected, 'History refresh cannot repeat notifications');
    } finally { release(); await pool.stopAll(); }
  }
});

test('delayed Goal completion belongs only to the latest successful idle run', async () => {
  for (const status of ['complete', 'blocked', 'usage_limited', 'budget_limited'] as const) {
    for (const next of ['completed', 'running', 'failed', 'exited', 'replaced'] as const) {
      const { pool, transports, events, open } = fixture();
      const worker = await open();
      await open('foreground');
      const goal = { id: 'goal-1', sessionId: worker.state!.sessionId!, objective: 'Goal',
        status: 'active' as const, tokensUsed: 0, timeUsedSeconds: 0, iteration: 0,
        createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' };
      worker.launch = { plan: false, ultracode: false, goalArmed: false, goal };
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const original = transports[0].request.bind(transports[0]);
      transports[0].request = async (type, args) => {
        if (type === 'get_entries') {
          await gate;
          return { entries: [{ id: 'status', parentId: null, type: 'custom',
            customType: 'step-goal', data: { ...goal, status } }], leafId: 'status' };
        }
        return original(type, args);
      };
      try {
        transports[0].receive({ type: 'agent_start' });
        transports[0].receive({ type: 'message_end', message: { role: 'assistant', content: 'First', stopReason: 'stop' } });
        transports[0].receive({ type: 'agent_end' });
        if (next === 'exited') transports[0].receive({ type: 'desktop_exit', code: 1 });
        else if (next === 'replaced') worker.rpc = new Transport(() => {}, goal.sessionId);
        else {
          transports[0].receive({ type: 'agent_start' });
          if (next !== 'running') {
            transports[0].receive({ type: 'message_end', message: { role: 'assistant',
              content: 'Second', stopReason: next === 'failed' ? 'error' : 'stop' } });
            transports[0].receive({ type: 'agent_end' });
          }
        }
        assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
        release();
        await pool.readLaunch(worker);
        const expected = next === 'completed' ? 1 : 0;
        assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, expected, `${status}: ${next}`);
        assert.equal(pool.unreadSessionIds.has(goal.sessionId), expected === 1, `${status}: ${next}`);
        await pool.readLaunch(worker);
        assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, expected);
      } finally { release(); await pool.stopAll(); }
    }
  }
});

test('successive ordinary runs each emit one completion event', async () => {
  const { pool, transports, events, open } = fixture();
  await open();
  await open('foreground');
  for (let run = 1; run <= 2; run++) {
    transports[0].receive({ type: 'agent_start' });
    transports[0].receive({ type: 'message_end', message: { role: 'assistant', content: `Run ${run}`, stopReason: 'stop' } });
    transports[0].receive({ type: 'agent_end' });
    transports[0].receive({ type: 'agent_end' });
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, run);
  }
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
