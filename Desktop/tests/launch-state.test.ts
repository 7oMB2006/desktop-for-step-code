import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLaunch, ultracodeNotification } from '../electron/launch-state';
import { LaunchControls } from '../electron/launch-controls';
import { SessionRuntimes, type WorkerTransport } from '../electron/session-runtimes';
import { conversationEntries } from '../src/conversation-presentation';
import { draftLaunchChanges, emptyLaunch, goalCompletionResponse } from '../src/launch-state';
import { ultracodeInput, visibleInputBlocks } from '../src/ultracode-input';

const goal = { id: 'goal-1', sessionId: 'session-1', objective: 'Make tests pass', status: 'active',
  tokensUsed: 12, timeUsedSeconds: 3, iteration: 1, createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:03Z' };
const entry = (id: string, parentId: string | null, customType: string, data: unknown) => ({ id, parentId, type: 'custom', customType, data });
test('completed goals keep their original user boundary across later tasks and completed-state updates', () => {
  const entries = [
    { id: 'input', parentId: null, type: 'custom_message', customType: 'desktop-goal-input',
      content: 'Make tests pass', display: true, timestamp: '2026-10-11T00:00:00Z' },
    entry('start', 'input', 'step-goal', goal),
    entry('done', 'start', 'step-goal', { ...goal, status: 'complete' }),
    { id: 'next', parentId: 'done', type: 'message', message: { role: 'user', content: 'Next task', timestamp: 200 } },
    entry('budget', 'next', 'step-goal', { ...goal, status: 'complete', tokenBudget: 400 }),
  ];
  const completed = projectLaunch(entries, 'budget', 'session-1').goal!;
  assert.deepEqual(completed.completion, { userEntryId: 'input', userTimestamp: Date.parse('2026-10-11T00:00:00Z') });
  const messages = [
    { role: 'custom', customType: 'desktop-goal-input', display: true, content: 'Make tests pass', entryId: 'input' },
    { role: 'assistant', content: 'Done' },
    { role: 'user', content: 'Next task', entryId: 'next', timestamp: 200 },
    { role: 'assistant', content: 'Next response' },
  ];
  assert.equal(goalCompletionResponse(messages, completed), 1);
  assert.equal(goalCompletionResponse(messages, { ...completed, completion: { userEntryId: 'foreign' } }), undefined);
  assert.equal(goalCompletionResponse(messages, { ...completed, status: 'active' }), undefined);
  assert.equal(projectLaunch(entries, 'start', 'session-1').goal?.completion, undefined, 'Branch before completion does not inherit the finished marker');
});
test('launch projection follows only the active branch and preserves session-only opt-in', () => {
  const entries = [entry('root', null, 'step-plan', { enabled: false }),
    entry('goal', 'root', 'step-goal', goal), entry('other', 'root', 'step-plan', { enabled: true })];
  const state = projectLaunch(entries, 'goal', 'session-1', { ...emptyLaunch(), ultracode: true, goalArmed: true });
  assert.equal(state.plan, false); assert.equal(state.ultracode, true); assert.equal(state.goalArmed, false);
  assert.deepEqual(state.goal, goal);
  assert.equal(projectLaunch(entries, 'other', 'session-1').goal, undefined);
});
test('invalid and foreign goal snapshots do not override valid state; clear does', () => {
  const entries = [entry('a', null, 'step-goal', goal),
    entry('b', 'a', 'step-goal', { ...goal, tokensUsed: -1 }),
    entry('c', 'b', 'step-goal', { ...goal, sessionId: 'foreign' })];
  assert.deepEqual(projectLaunch(entries, 'c', 'session-1').goal, goal);
  entries.push(entry('d', 'c', 'step-goal', { sessionId: 'session-1', cleared: true }));
  assert.equal(projectLaunch(entries, 'd', 'session-1').goal, undefined);
});
test('Ultracode notifications are exact runtime confirmations, not free-form prose', () => {
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Ultraloop session mode: on.' }), true);
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Ultraloop session mode is off. Workflow now requires a per-turn opt-in signal.' }), false);
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Agent says Ultraloop session mode: on.' }), undefined);
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Ultracode is on for the session. Multi-agent workflows are authorized until /ultracode off or the session ends.' }), true);
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Ultracode session mode is off. Use ultracode: <task> for one-turn opt-in.' }), false);
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Ultracode session mode: on.' }), true);
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Ultracode session mode: off.' }), false);
  assert.equal(ultracodeNotification({ method: 'notify', message: 'Agent says Ultracode session mode: on.' }), undefined);
  assert.equal(ultracodeNotification({ method: 'setStatus', message: 'Ultracode session mode: on.' }), undefined);
});
test('Goal input is a visible user entry, while continuation reminders remain hidden', () => {
  const entries = conversationEntries([
    { role: 'custom', customType: 'desktop-goal-input', display: true, content: 'My goal' },
    { role: 'custom', customType: 'step-goal', display: false, content: 'Continue internally' },
    { role: 'assistant', content: 'Working' },
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, 'user');
  assert.equal(entries[1].type, 'response');
  if (entries[1].type === 'response') assert.equal(entries[1].items.length, 1);
});

async function fixture() {
  const history: ReturnType<typeof entry>[] = [];
  const calls: Record<string, unknown>[] = [];
  let transport: WorkerTransport;
  let currentGoal: any;
  let available = true;
  const pool = new SessionRuntimes(() => {}, receive => {
    const append = (type: string, value: unknown) => history.push(entry(String(history.length), history.at(-1)?.id ?? null, type, value));
    transport = {
      start() {}, respond() {}, async stop() {},
      async request(type, args) {
        if (type === 'get_state') return { sessionId: 'session-1', isStreaming: false };
        if (type === 'get_messages') return { messages: [] };
        if (type === 'get_available_models') return { models: [] };
        if (type === 'get_entries') return { entries: history, leafId: history.at(-1)?.id ?? null };
        if (type === 'get_commands') return { commands: available ? ['plan', 'goal', 'ultraloop', '_desktop_goal_input'].map(name => ({ name, source: 'extension' })) : [] };
        if (type !== 'prompt') return {};
        calls.push(args!);
        const message = String(args?.message);
        if (message === '/plan') append('step-plan', { enabled: !projectLaunch(history, history.at(-1)?.id ?? null, 'session-1').plan });
        if (message.startsWith('/ultraloop')) receive({ type: 'extension_ui_request', method: 'notify',
          message: message.endsWith(' on')
            ? 'Ultracode is on for the session. Multi-agent workflows are authorized until /ultracode off or the session ends.'
            : 'Ultracode session mode is off. Use ultracode: <task> for one-turn opt-in.' });
        if (message.startsWith('/goal start ')) { currentGoal = { ...goal, objective: message.slice(12) }; append('step-goal', currentGoal); }
        if (message === '/goal pause' || message === '/goal resume') { currentGoal.status = message.endsWith('pause') ? 'paused' : 'active'; append('step-goal', { ...currentGoal }); }
        if (message === '/goal clear') { currentGoal = undefined; append('step-goal', { sessionId: 'session-1', cleared: true }); }
        return {};
      },
    };
    return transport;
  });
  const worker = await pool.open('node', 'step', 'workspace', {});
  return { pool, worker, calls, controls: new LaunchControls(pool), unavailable: () => available = false };
}
test('Goal arming does not create history, is mutually exclusive with Plan, and preserves Ultracode', async () => {
  const { pool, worker, controls, calls } = await fixture();
  await controls.set(worker, 'plan', true);
  await controls.set(worker, 'ultracode', true);
  await controls.set(worker, 'goal', true);
  assert.equal(worker.launch?.goalArmed, true);
  assert.equal(worker.launch?.plan, false);
  assert.equal(worker.launch?.planArmed, false);
  assert.equal(worker.launch?.ultracode, false);
  assert.equal(worker.launch?.ultracodeArmed, true);
  assert.ok(!calls.some(call => String(call.message).startsWith('/ultraloop')), 'Arming is not session-wide consent');
  assert.ok(!calls.some(call => String(call.message).startsWith('/goal')));
  await pool.stopAll();
});
test('a new draft reconciles disabled launch choices on the reused empty worker', async () => {
  for (const mode of ['plan', 'goal'] as const) {
    const { pool, worker, controls } = await fixture();
    try {
      await controls.set(worker, mode, true);
      await controls.set(worker, 'ultracode', true);
      const reused = await pool.open('node', 'step', 'workspace', {});
      assert.equal(reused, worker);
      for (const change of draftLaunchChanges(reused.launch, emptyLaunch()))
        await controls.set(reused, change.mode, change.enabled);
      assert.equal(reused.launch?.plan, false);
      assert.equal(Boolean(reused.launch?.planArmed), false);
      assert.equal(reused.launch?.goalArmed, false);
      assert.equal(reused.launch?.ultracodeArmed, false);
      assert.equal(controls.input(reused, { message: 'ordinary task' }).message, 'ordinary task');
    } finally { await pool.stopAll(); }
  }
  assert.deepEqual(draftLaunchChanges(emptyLaunch(), emptyLaunch()), [], 'Ordinary drafts need no unsupported mode commands');
  assert.deepEqual(draftLaunchChanges({ ...emptyLaunch(), goalArmed: true },
    { ...emptyLaunch(), plan: true, planArmed: true }), [
    { mode: 'goal', enabled: false }, { mode: 'plan', enabled: true },
  ]);
});
test('one-shot Ultracode consumes only pending launch choices and preserves the original user presentation', async () => {
  const { pool, worker, controls } = await fixture();
  await controls.set(worker, 'ultracode', true);
  const images = [{ type: 'image', mimeType: 'image/png', data: 'fixture' }];
  const payload = controls.input(worker, { message: 'Inspect this image', images });
  assert.equal(payload.message, 'ultracode:\n\nInspect this image');
  assert.deepEqual(payload.images, images);
  controls.consume(worker);
  assert.equal(worker.launch?.ultracodeArmed, false);
  assert.equal(worker.launch?.ultracode, false);
  assert.equal(controls.input(worker, { message: 'Next task' }).message, 'Next task');
  assert.deepEqual(visibleInputBlocks({ role: 'user', content: [{ type: 'text', text: String(payload.message) }, ...images] }),
    [{ type: 'text', text: 'Inspect this image' }, ...images]);
  assert.equal(visibleInputBlocks({ role: 'assistant', content: String(payload.message) })[0].text, payload.message);
  assert.equal(visibleInputBlocks({ role: 'user', content: 'ultracode: is a command example' })[0].text, 'ultracode: is a command example');
  await pool.stopAll();
});
test('Goal owns its optional orchestration intent without enabling session-standing Ultracode', async () => {
  const { pool, worker, controls, calls } = await fixture();
  await controls.set(worker, 'goal', true);
  await controls.set(worker, 'ultracode', true);
  await controls.startGoal(worker, { message: 'Make tests pass' });
  assert.equal(worker.launch?.goal?.objective, 'Make tests pass');
  assert.equal(worker.launch?.goal?.ultracode, true);
  assert.equal(worker.launch?.ultracodeArmed, false);
  assert.equal(worker.launch?.ultracode, false);
  assert.ok(calls.some(call => call.message === '/goal start ultracode: Make tests pass'));
  assert.ok(!calls.some(call => String(call.message).startsWith('/ultraloop')));
  await pool.stopAll();
});
test('Goal starts from the original input including images, then Plan pauses without deleting it', async () => {
  const { pool, worker, controls, calls } = await fixture();
  await controls.set(worker, 'goal', true);
  const images = [{ type: 'image', mimeType: 'image/png', data: 'fixture' }];
  assert.equal(await controls.startGoal(worker, { message: 'Make tests pass', images }), true);
  const custom = calls.find(call => String(call.message).startsWith('/_desktop_goal_input '));
  assert.deepEqual(JSON.parse(String(custom?.message).slice('/_desktop_goal_input '.length)), { message: 'Make tests pass', images });
  assert.equal(worker.launch?.goalArmed, false);
  await controls.set(worker, 'plan', true);
  assert.equal(worker.launch?.goal?.status, 'paused');
  assert.equal(worker.launch?.goal?.id, 'goal-1');
  assert.equal(worker.launch?.plan, true);
  await controls.goal(worker, 'resume');
  assert.equal(worker.launch?.plan, false);
  assert.equal(worker.launch?.goal?.status, 'active');
  await controls.goal(worker, 'clear');
  assert.equal(worker.launch?.goal, undefined);
  await pool.stopAll();
});
test('unsupported runtime commands never claim the mode is enabled', async () => {
  const { pool, worker, controls, unavailable } = await fixture();
  unavailable();
  await assert.rejects(controls.set(worker, 'plan', true), /does not support/);
  assert.equal(worker.launch?.plan, false);
  await assert.rejects(controls.set(worker, 'goal', true), /does not support/);
  assert.equal(worker.launch?.goalArmed, false);
  await pool.stopAll();
});
test('exhausted budgets cannot silently disable Plan during a failed Goal resume', async () => {
  const { pool, worker, controls } = await fixture();
  await controls.set(worker, 'goal', true);
  await controls.startGoal(worker, { message: 'Make tests pass' });
  await controls.set(worker, 'plan', true);
  // The command validation runs against an authoritative projected budget limit.
  const read = pool.readLaunch.bind(pool);
  pool.readLaunch = async target => {
    await read(target);
    if (target.launch?.goal) target.launch.goal.status = 'budget_limited';
  };
  await assert.rejects(controls.goal(worker, 'resume'), /budget/);
  assert.equal(worker.launch?.plan, true);
  await pool.stopAll();
});
test('active goals keep workers resident and block destructive idle operations', async () => {
  const { pool, worker, controls } = await fixture();
  await controls.set(worker, 'goal', true);
  await controls.startGoal(worker, { message: 'Make tests pass' });
  worker.messages = [{ role: 'user', content: 'Goal' }];
  worker.touched = 0;
  pool.activeId = undefined;
  assert.equal(pool.running, true);
  await pool.recycle();
  assert.equal(pool.workers.has(worker.id), true);
  await assert.rejects(pool.assertIdle(worker), /Pause/);
  await pool.stopAll();
});
