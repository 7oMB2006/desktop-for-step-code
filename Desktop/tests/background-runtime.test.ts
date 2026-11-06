import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import { quitReasons } from '../electron/quit-review';
import type { RuntimeEvent } from '../src/contracts';
import { BackgroundAgents } from '../electron/background-agents';
import { backgroundSubagentStates, projectBackgroundSubagentStates } from '../src/conversation-presentation';

for (const outcome of ['complete', 'suspend', 'control', 'reply', 'retry'] as const) {
test(`pinned RPC background lane survives parent end and navigation: ${outcome}`, { timeout: outcome === 'retry' ? 90000 : 60000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-background-runtime-'));
  const workspace = join(profile, 'workspace');
  await mkdir(workspace);
  let releaseChild!: () => void;
  const childGate = new Promise<void>(resolve => { releaseChild = resolve; });
  let releaseOther!: () => void, releaseParent!: () => void;
  const otherGate = new Promise<void>(resolve => { releaseOther = resolve; });
  const parentGate = new Promise<void>(resolve => { releaseParent = resolve; });
  let childRequested = false;
  let otherRequested = false, parentRequested = false, modelRequests = 0;
  const followUps: string[] = [];
  let releaseReply!: () => void;
  const replyGate = new Promise<void>(resolve => { releaseReply = resolve; });
  const slots = new Map<string, () => void>();
  const failures: unknown[] = [];
  const text = (message: any) => typeof message?.content === 'string' ? message.content
    : message?.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') ?? '';
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer isolated-background-fixture');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      modelRequests++;
      const task = text(body.messages.findLast((message: any) => message.role === 'user'));
      const toolReturned = body.messages.some((message: any) => message.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({
        id: 'background-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (task === 'BACKGROUND-CHILD' || task === 'BACKGROUND-CHILD-A') {
        childRequested = true;
        await childGate;
        if (res.destroyed) return;
        send({ content: 'BACKGROUND-CHILD-DONE' }, 'stop');
      } else if (task === 'BACKGROUND-CHILD-B') {
        otherRequested = true;
        await otherGate;
        if (res.destroyed) return;
        send({ content: `cookie=${'private-value'.repeat(3000)}\nBACKGROUND-OTHER-DONE` }, 'stop');
      } else if (/^BACKGROUND-SLOT-[0-7]$/.test(task)) {
        await new Promise<void>(resolve => { slots.set(task, resolve); });
        if (res.destroyed) return;
        send({ content: `${task}-DONE` }, 'stop');
      } else if (['BACKGROUND-FOLLOW-UP', 'BACKGROUND-CONTINUE', 'BACKGROUND-RETRY'].includes(task)) {
        followUps.push(task);
        assert.ok(body.messages.some((message: any) => text(message).includes('BACKGROUND-CHILD-DONE')),
          'follow-up retains the original child context');
        if (task === 'BACKGROUND-CONTINUE') {
          assert.ok(body.messages.some((message: any) => text(message).includes('FOLLOW-UP-DONE')));
          await replyGate;
        }
        if (res.destroyed) return;
        send({ content: task === 'BACKGROUND-FOLLOW-UP' ? 'FOLLOW-UP-DONE' : 'CONTINUATION-DONE' }, 'stop');
      } else if (task === 'BACKGROUND-KEEP-RUNNING') {
        parentRequested = true;
        await parentGate;
        if (res.destroyed) return;
        send({ content: 'PARENT-STILL-USABLE' }, 'stop');
      } else if (task === 'BACKGROUND-PARENT' && !toolReturned) {
        assert.ok(body.tools.some((tool: any) => tool.function?.name === 'subagent'));
        send({ tool_calls: [{ index: 0, id: 'background-call', type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({
            agent: 'general', task: ['control', 'reply'].includes(outcome) ? 'BACKGROUND-CHILD-A' : 'BACKGROUND-CHILD', run_in_background: true,
          }) } }] }, 'tool_calls');
      } else if (task === 'BACKGROUND-START-OTHER' && !body.messages.some((message: any) =>
        message.role === 'tool' && message.tool_call_id === 'background-other')) {
        send({ tool_calls: [{ index: 0, id: 'background-other', type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({
            agent: 'general', task: 'BACKGROUND-CHILD-B', run_in_background: true,
          }) } }] }, 'tool_calls');
      } else if (task === 'BACKGROUND-PARALLEL' && !body.messages.some((message: any) =>
        message.role === 'tool' && message.tool_call_id === 'background-parallel')) {
        send({ tool_calls: [{ index: 0, id: 'background-parallel', type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({ tasks: [
            { agent: 'general', task: 'PARALLEL-ONE' }, { agent: 'general', task: 'PARALLEL-TWO' },
          ], run_in_background: true }) } }] }, 'tool_calls');
      } else if (task === 'BACKGROUND-CAPACITY' && !body.messages.some((message: any) =>
        message.role === 'tool' && message.tool_call_id === 'background-slot-0')) {
        send({ tool_calls: Array.from({ length: 8 }, (_, index) => ({
          index, id: `background-slot-${index}`, type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({
            agent: 'general', task: `BACKGROUND-SLOT-${index}`, run_in_background: true,
          }) },
        })) }, 'tool_calls');
      } else {
        send({ content: task.includes('agent-notification') ? 'BACKGROUND-ACKNOWLEDGED' : 'PARENT-IDLE' }, 'stop');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  await writeFile(join(profile, 'config.toml'),
    'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: origin, apiKey: 'isolated-background-fixture',
    models: [{ id: 'fixture', name: 'Background fixture', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const events: RuntimeEvent[] = [];
  const settlements: string[] = [];
  const pool = new SessionRuntimes(event => {
    events.push(event);
    if (event.type === 'desktop_background_changed') for (const worker of pool.workers.values())
      settlements.push(...worker.backgroundLanes?.filter(lane => lane.status === 'settling').map(lane => lane.id) ?? []);
  }, undefined, { idleLimit: () => 0 });
  const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
  const entry = resolve('runtime/step/dist/bundle/step.js');
  const env = isolatedEnvironment(profile);
  const waitFor = async (predicate: () => boolean) => {
    const until = Date.now() + 25000;
    while (!predicate()) {
      assert.deepEqual(failures, []);
      for (const worker of pool.workers.values()) for (const request of worker.pendingUI.values()) {
        assert.equal(request.method, 'confirm');
        assert.match(request.title ?? '', /subagent/i);
        pool.respondToRequest(worker, { id: request.id, confirmed: true });
      }
      if (Date.now() > until) throw new Error(`Background fixture timed out: child=${childRequested}, events=${events.map(event => event.type).slice(-15)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const PHASES = ['start', 'open', 'parent dispatched', 'child held', 'child released',
    'ownership cleared', 'ack', 'idle', 'cleanup-server', 'runtime'] as const;
  let phase: typeof PHASES[number] = 'start';
  // Bounded, redacted progress output: only these allow-listed phase names ever
  // leave the fixture, so a CI timeout names the stalled phase without leaking
  // logs, environment, requests or credentials.
  const bump = (next: typeof PHASES[number]) => {
    phase = next;
    console.error(`background-runtime[${outcome}] phase=${next}`);
  };
  const diagnostics = () => [
    `phase=${phase}`,
    `workers=${[...pool.workers.values()].map(worker => `${worker.id}:${worker.status}:busy=${pool.isBusy(worker)}:bg=${worker.backgroundActive === true}:lanes=${worker.backgroundLanes?.length ?? '-'}`).join(',') || 'none'}`,
    `lastEvents=${events.map(event => event.type).slice(-15).join('>')}`,
    `child=${childRequested} other=${otherRequested} parent=${parentRequested} slots=${slots.size} failures=${failures.length}`,
  ].join(' | ');
  try {
    bump('open');
    const host = await pool.open(node, entry, workspace, env);
    bump('parent dispatched');
    await host.rpc.request('prompt', { message: 'BACKGROUND-PARENT' });
    await waitFor(() => childRequested && host.backgroundActive === true && !pool.isBusy(host) && text(host.messages.at(-1)) === 'PARENT-IDLE');
    bump('child held');
    assert.equal(pool.running, true);
    assert.equal(quitReasons(pool, false).runningTasks, 1);
    await assert.rejects(pool.assertAllIdle(), /background/i);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    if (outcome === 'retry') {
      const sessionId = host.state!.sessionId!;
      const controls = new BackgroundAgents(pool.workers, undefined, true, true);
      bump('child released');
      releaseChild();
      await waitFor(() => !host.backgroundActive && !pool.isBusy(host));
      const first = (await controls.read(host.id, sessionId)).lanes[0];
      assert.equal(first.status, 'completed');
      await host.rpc.request('prompt', { message: 'BACKGROUND-CAPACITY' });
      await waitFor(() => slots.size === 8 && !pool.isBusy(host));
      const request = { sessionId, action: 'reply', laneId: first.id,
        requestId: '45678901-1234-1234-1234-123456789abc', prompt: 'BACKGROUND-RETRY' };
      const reply = (patch = {}) => host.rpc.request('desktop_subagents', { ...request, ...patch });
      await assert.rejects(reply(), /Background reply/);
      await assert.rejects(reply({ prompt: 'DIFFERENT-TEXT' }), /identity was reused/);
      assert.deepEqual(followUps, [], 'capacity refusal never delivers the task');
      slots.get('BACKGROUND-SLOT-0')!();
      await waitFor(() => host.backgroundLanes?.length === 7 && !pool.isBusy(host));
      const receipts = await Promise.all([reply(), reply()]);
      assert.deepEqual(receipts.map(receipt => receipt.delivery), ['started', 'started'],
        'unchanged manual retry succeeds after capacity frees, concurrent attempts share one delivery');
      await waitFor(() => followUps.length === 1 && host.backgroundLanes?.length === 7 && !pool.isBusy(host));
      assert.deepEqual(followUps, ['BACKGROUND-RETRY']);
      assert.equal((await reply()).delivery, 'started', 'successful retry retains its receipt');
      assert.deepEqual(followUps, ['BACKGROUND-RETRY']);
      await assert.rejects(reply({ prompt: 'DIFFERENT-TEXT' }), /identity was reused/);
      for (const release of slots.values()) release();
      await waitFor(() => !host.backgroundActive && !pool.isBusy(host));
      bump('idle');
      await pool.assertAllIdle();
      assert.deepEqual(failures, []);
      return;
    }
    if (outcome === 'control' || outcome === 'reply') {
      const sessionId = host.state!.sessionId!;
      const controls = new BackgroundAgents(pool.workers, undefined, true, true);
      await host.rpc.request('prompt', { message: 'BACKGROUND-START-OTHER' });
      await waitFor(() => otherRequested && !pool.isBusy(host));
      bump('child held');
      const beforeFile = await readFile(host.state!.sessionFile!, 'utf8');
      const beforeMessages = await host.rpc.request('get_messages');
      const requests = modelRequests;
      const snapshot = await controls.read(host.id, sessionId);
      assert.equal(snapshot.lanes.length, 2);
      const first = snapshot.lanes.find(lane => lane.steps.some(step => step.task === 'BACKGROUND-CHILD-A'))!;
      const second = snapshot.lanes.find(lane => lane.steps.some(step => step.task === 'BACKGROUND-CHILD-B'))!;
      assert.ok(first && second);
      assert.equal(first.status, 'running'); assert.equal(second.status, 'running');
      assert.equal(await readFile(host.state!.sessionFile!, 'utf8'), beforeFile, 'Reading controls never writes JSONL');
      assert.deepEqual(await host.rpc.request('get_messages'), beforeMessages);
      assert.equal(modelRequests, requests, 'Reading controls never invokes the model');
      for (const args of [
        { sessionId: 'other-session', action: 'list' }, { sessionId, action: 'reply', laneId: first.id },
        { sessionId, action: 'stop', laneId: 'lane_deadbeef' }, { sessionId, action: 'stop', laneId: '../lane' },
      ]) await assert.rejects(host.rpc.request('desktop_subagents', args));
      if (outcome === 'reply') {
        assert.equal(snapshot.replyAvailable, true);
        const request = { runtimeId: host.id, sessionId, laneId: first.id,
          requestId: '12345678-1234-1234-1234-123456789abc', prompt: 'BACKGROUND-FOLLOW-UP' };
        assert.equal((await controls.reply(request)).delivery, 'queued');
        assert.equal((await controls.reply(request)).delivery, 'queued', 'same request is acknowledged without a second delivery');
        await assert.rejects(controls.reply({ ...request, prompt: 'DIFFERENT-TEXT' }), /identity was reused/);
        assert.equal(followUps.length, 0, 'queue does not interrupt the current child turn');
        assert.equal(await readFile(host.state!.sessionFile!, 'utf8'), beforeFile, 'sending never writes a main prompt');
        assert.deepEqual(await host.rpc.request('get_messages'), beforeMessages);
        assert.equal(modelRequests, requests);
        assert.equal((await controls.read(host.id, sessionId)).lanes.find(lane => lane.id === second.id)?.status, 'running');
        bump('child released');
        releaseChild();
        await waitFor(() => followUps.length === 1 && !pool.isBusy(host)
          && host.backgroundLanes?.length === 1);
        assert.deepEqual(followUps, ['BACKGROUND-FOLLOW-UP']);
        const settled = await controls.read(host.id, sessionId);
        assert.equal(settled.lanes.find(lane => lane.id === first.id)?.status, 'completed');
        assert.equal(settled.lanes.find(lane => lane.id === second.id)?.status, 'running');
        assert.equal((await controls.reply(request)).delivery, 'queued', 'receipt is retained after the child finishes');
        const next = { ...request, requestId: '23456789-1234-1234-1234-123456789abc', prompt: 'BACKGROUND-CONTINUE' };
        assert.equal((await controls.reply(next)).delivery, 'started');
        await waitFor(() => followUps.length === 2 && host.backgroundLanes?.length === 2);
        assert.equal(host.backgroundActive, true);
        assert.equal(quitReasons(pool, false).runningTasks, 1);
        const mainMessages = (await host.rpc.request('get_messages')).messages;
        assert.equal(mainMessages.some((message: any) => message.role === 'user'
          && ['BACKGROUND-FOLLOW-UP', 'BACKGROUND-CONTINUE'].includes(text(message))), false);
        releaseReply(); releaseOther();
        bump('ownership cleared');
        await waitFor(() => !host.backgroundActive && !pool.isBusy(host));
        assert.deepEqual(followUps, ['BACKGROUND-FOLLOW-UP', 'BACKGROUND-CONTINUE']);
        await host.rpc.request('prompt', { message: 'BACKGROUND-PARALLEL' });
        await waitFor(() => !host.backgroundActive && !pool.isBusy(host)
          && host.messages.some((message: any) => message.role === 'toolResult' && message.toolCallId === 'background-parallel'));
        const parallel = (await controls.read(host.id, sessionId)).lanes.find(lane => lane.mode === 'parallel');
        assert.ok(parallel);
        await assert.rejects(controls.reply({ ...next, laneId: parallel.id,
          requestId: '34567890-1234-1234-1234-123456789abc' }), /Single background lane/);
        bump('idle');
        await pool.assertAllIdle();
        assert.deepEqual(failures, []);
        return;
      }
      await host.rpc.request('prompt', { message: 'BACKGROUND-KEEP-RUNNING' });
      await waitFor(() => parentRequested && pool.isBusy(host));
      await controls.stop(host.id, sessionId, first.id);
      let current = await controls.read(host.id, sessionId);
      assert.equal(current.lanes.find(lane => lane.id === first.id)?.status, 'aborted');
      assert.equal(current.lanes.find(lane => lane.id === second.id)?.status, 'running');
      assert.equal(pool.isBusy(host), true, 'Targeted stop does not abort the parent request');
      assert.ok(settlements.includes(first.id), 'Native ownership includes a real settlement handoff');
      releaseParent();
      await waitFor(() => !pool.isBusy(host));
      releaseOther();
      bump('child released');
      await waitFor(() => !host.backgroundActive && !pool.isBusy(host));
      bump('ownership cleared');
      current = await controls.read(host.id, sessionId);
      assert.equal(current.lanes.find(lane => lane.id === first.id)?.status, 'aborted');
      assert.equal(current.lanes.find(lane => lane.id === second.id)?.status, 'completed');
      const native = await host.rpc.request('desktop_subagents', { sessionId, action: 'list' });
      assert.doesNotMatch(JSON.stringify(native), /private-value|sessionFile|activeToolArgs|messages/);
      assert.ok(current.lanes.find(lane => lane.id === second.id)?.steps.some(step => step.output.includes('BACKGROUND-OTHER-DONE')));
      bump('idle');
      await pool.assertAllIdle();
      return;
    }
    const other = await pool.open(node, entry, workspace, env);
    host.touched = 0;
    await pool.recycle();
    assert.equal(pool.workers.has(host.id), true);
    assert.equal(pool.activeId, other.id);
    if (outcome === 'suspend') {
      await pool.suspend([host]);
      bump('ownership cleared');
      assert.equal(host.status, 'disconnected');
      assert.equal(host.backgroundActive, false);
      assert.equal(pool.running, false);
      assert.equal(quitReasons(pool, false).runningTasks, 0);
      assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
      assert.equal(pool.activeId, other.id);
      return;
    }
    bump('child released');
    releaseChild();
    await waitFor(() => !host.backgroundActive && !pool.isBusy(host)
      && host.messages.some(message => text(message).includes('BACKGROUND-ACKNOWLEDGED')));
    bump('ack');
    assert.deepEqual(failures, []);
    assert.equal(pool.activeId, other.id, 'Background wake-up does not navigate the user');
    const completed = events.filter(event => event.type === 'desktop_task_completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].runtimeId, host.id);
    assert.equal(pool.unreadSessionIds.has(host.state!.sessionId!), true);
    bump('idle');
    await pool.assertAllIdle();
    assert.equal(quitReasons(pool, false).runningTasks, 0);
  } catch (error) {
    // Bounded failure diagnostics only: current phase, worker status booleans and the
    // last event types. Full logs, environment, requests and credentials are never
    // printed, and the original failure is rethrown unchanged.
    console.error(`background-runtime[${outcome}] failed: ${diagnostics()}`);
    throw error;
  } finally {
    bump('cleanup-server');
    releaseChild();
    releaseOther(); releaseParent(); releaseReply();
    for (const release of slots.values()) release();
    server.closeAllConnections();
    bump('runtime');
    try {
      await pool.stopAll();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
}

test('legal agent_send reply resumes a lane: real tool array, derived running, completed after release', { timeout: 60000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-background-runtime-'));
  const workspace = join(profile, 'workspace');
  await mkdir(workspace);
  let releaseChild!: () => void;
  const childGate = new Promise<void>(resolve => { releaseChild = resolve; });
  let releaseReply!: () => void;
  const replyGate = new Promise<void>(resolve => { releaseReply = resolve; });
  let childRequested = false, replyRequested = false, laneId = '', modelRequests = 0;
  const failures: unknown[] = [];
  const text = (message: any) => typeof message?.content === 'string' ? message.content
    : message?.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') ?? '';
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer isolated-background-fixture');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      modelRequests++;
      const task = text(body.messages.findLast((message: any) => message.role === 'user'));
      const toolReturned = body.messages.some((message: any) => message.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({
        id: 'background-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (task === 'BACKGROUND-CHILD') {
        childRequested = true;
        await childGate;
        if (res.destroyed) return;
        send({ content: 'BACKGROUND-CHILD-DONE' }, 'stop');
      } else if (task === 'BACKGROUND-REPLY') {
        replyRequested = true;
        await replyGate;
        if (res.destroyed) return;
        send({ content: 'REPLY-DONE' }, 'stop');
      } else if (task === 'BACKGROUND-PARENT' && !toolReturned) {
        assert.ok(body.tools.some((tool: any) => tool.function?.name === 'subagent'));
        send({ tool_calls: [{ index: 0, id: 'background-call', type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({
            agent: 'general', task: 'BACKGROUND-CHILD', run_in_background: true,
          }) } }] }, 'tool_calls');
      } else if (task === 'BACKGROUND-FOLLOWUP' && !body.messages.some((message: any) =>
        message.role === 'tool' && message.tool_call_id === 'reply-call')) {
        send({ tool_calls: [{ index: 0, id: 'reply-call', type: 'function', function: { name: 'agent_send',
          arguments: JSON.stringify({ lane_id: laneId, action: 'reply', prompt: 'BACKGROUND-REPLY' }) } }] }, 'tool_calls');
      } else {
        send({ content: task.includes('agent-notification') ? 'BACKGROUND-ACKNOWLEDGED' : 'PARENT-IDLE' }, 'stop');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  await writeFile(join(profile, 'config.toml'),
    'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: origin, apiKey: 'isolated-background-fixture',
    models: [{ id: 'fixture', name: 'Background fixture', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const pool = new SessionRuntimes(() => {}, undefined, { idleLimit: () => 0 });
  const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
  const entry = resolve('runtime/step/dist/bundle/step.js');
  const env = isolatedEnvironment(profile);
  const waitFor = async (predicate: () => boolean) => {
    const until = Date.now() + 25000;
    while (!predicate()) {
      assert.deepEqual(failures, []);
      for (const worker of pool.workers.values()) for (const request of worker.pendingUI.values()) {
        assert.equal(request.method, 'confirm');
        assert.match(request.title ?? '', /subagent/i);
        pool.respondToRequest(worker, { id: request.id, confirmed: true });
      }
      if (Date.now() > until) throw new Error(`Background fixture timed out: child=${childRequested}, reply=${replyRequested}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    const host = await pool.open(node, entry, workspace, env);
    await host.rpc.request('prompt', { message: 'BACKGROUND-PARENT' });
    await waitFor(() => childRequested && host.backgroundActive === true && !pool.isBusy(host) && text(host.messages.at(-1)) === 'PARENT-IDLE');
    releaseChild();
    await waitFor(() => !host.backgroundActive && !pool.isBusy(host)
      && host.messages.some(message => text(message).includes('BACKGROUND-ACKNOWLEDGED')));
    assert.deepEqual(failures, []);
    laneId = host.messages.find(message => message.role === 'toolResult' && message.toolName === 'subagent')!.details!.agentId as string;
    assert.match(laneId, /^lane_[0-9a-f]{8}$/);
    assert.equal(backgroundSubagentStates(host.messages).get(laneId), 'completed');
    await host.rpc.request('prompt', { message: 'BACKGROUND-FOLLOWUP' });
    await waitFor(() => replyRequested && host.backgroundActive === true && !pool.isBusy(host));
    const native = await host.rpc.request('desktop_subagents', { sessionId: host.state!.sessionId, action: 'list' });
    const reply = host.messages.filter(message => message.role === 'toolResult' && message.toolName === 'agent_send').at(-1)!;
    assert.equal(Array.isArray(reply.details), true, 'agent_send reply returns a real lane array');
    assert.deepEqual((reply.details as unknown as { agentId: string; status: string }[]).map(row => ({ id: row.agentId, status: row.status })),
      [{ id: laneId, status: 'running' }]);
    assert.equal(native.lanes.length, 1);
    assert.equal(native.lanes.find((lane: any) => lane.agentId === laneId)?.status, 'running');
    assert.equal(backgroundSubagentStates(host.messages).get(laneId), 'running');
    assert.equal(pool.running, true);
    assert.equal(quitReasons(pool, false).runningTasks, 1);
    let guardRejected = false;
    try { await pool.assertBackgroundIdle(host); } catch { guardRejected = true; }
    assert.equal(guardRejected, true, 'assertBackgroundIdle rejects a genuinely active lane');
    releaseReply();
    await waitFor(() => !host.backgroundActive && !pool.isBusy(host)
      && backgroundSubagentStates(host.messages).get(laneId) === 'completed');
    assert.deepEqual(failures, []);
    await pool.assertAllIdle();
    assert.equal(quitReasons(pool, false).runningTasks, 0);
  } finally {
    releaseReply();
    releaseChild();
    await pool.stopAll();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('suspended background lane stays gone on reopen: native lanes empty, known-empty cache, unknown projection, untouched JSONL', { timeout: 60000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-background-runtime-'));
  const workspace = join(profile, 'workspace');
  await mkdir(workspace);
  let releaseChild!: () => void;
  const childGate = new Promise<void>(resolve => { releaseChild = resolve; });
  let childRequested = false, modelRequests = 0;
  const failures: unknown[] = [];
  const text = (message: any) => typeof message?.content === 'string' ? message.content
    : message?.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') ?? '';
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer isolated-background-fixture');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      modelRequests++;
      const task = text(body.messages.findLast((message: any) => message.role === 'user'));
      const toolReturned = body.messages.some((message: any) => message.role === 'tool');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({
        id: 'background-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (task === 'BACKGROUND-CHILD') {
        childRequested = true;
        await childGate;
        if (res.destroyed) return;
        send({ content: 'BACKGROUND-CHILD-DONE' }, 'stop');
      } else if (task === 'BACKGROUND-PARENT' && !toolReturned) {
        assert.ok(body.tools.some((tool: any) => tool.function?.name === 'subagent'));
        send({ tool_calls: [{ index: 0, id: 'background-call', type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({
            agent: 'general', task: 'BACKGROUND-CHILD', run_in_background: true,
          }) } }] }, 'tool_calls');
      } else {
        send({ content: task.includes('agent-notification') ? 'BACKGROUND-ACKNOWLEDGED' : 'PARENT-IDLE' }, 'stop');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  await writeFile(join(profile, 'config.toml'),
    'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: origin, apiKey: 'isolated-background-fixture',
    models: [{ id: 'fixture', name: 'Background fixture', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const events: RuntimeEvent[] = [];
  const pool = new SessionRuntimes(event => { events.push(event); }, undefined, { idleLimit: () => 0 });
  const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
  const entry = resolve('runtime/step/dist/bundle/step.js');
  const env = isolatedEnvironment(profile);
  const waitFor = async (predicate: () => boolean) => {
    const until = Date.now() + 25000;
    while (!predicate()) {
      assert.deepEqual(failures, []);
      for (const worker of pool.workers.values()) for (const request of worker.pendingUI.values()) {
        assert.equal(request.method, 'confirm');
        assert.match(request.title ?? '', /subagent/i);
        pool.respondToRequest(worker, { id: request.id, confirmed: true });
      }
      if (Date.now() > until) throw new Error(`Background fixture timed out: child=${childRequested}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    const host = await pool.open(node, entry, workspace, env);
    await host.rpc.request('prompt', { message: 'BACKGROUND-PARENT' });
    await waitFor(() => childRequested && host.backgroundActive === true && !pool.isBusy(host) && text(host.messages.at(-1)) === 'PARENT-IDLE');
    assert.equal(pool.running, true);
    assert.equal(quitReasons(pool, false).runningTasks, 1);
    await assert.rejects(pool.assertAllIdle(), /background/i);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    const other = await pool.open(node, entry, workspace, env);
    host.touched = 0;
    await pool.recycle();
    assert.equal(pool.workers.has(host.id), true);
    assert.equal(pool.activeId, other.id);
    await pool.suspend([host]);
    assert.equal(host.status, 'disconnected');
    assert.equal(host.backgroundActive, false);
    assert.equal(pool.running, false);
    assert.equal(quitReasons(pool, false).runningTasks, 0);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    assert.equal(pool.activeId, other.id);
    const sessionId = host.state!.sessionId!;
    const savedPath = host.state!.sessionFile!;
    const laneId = host.messages.find(message => message.role === 'toolResult' && message.toolName === 'subagent')!.details!.agentId as string;
    assert.match(laneId, /^lane_[0-9a-f]{8}$/);
    const beforeFile = await readFile(savedPath, 'utf8');
    const reopened = await pool.prepare(node, entry, workspace, env, savedPath);
    await waitFor(() => reopened.status === 'connected' && reopened.state?.sessionId === sessionId);
    assert.equal(reopened.state!.sessionId, sessionId, 'Reopen restores the same saved session');
    assert.equal(reopened.backgroundActive, false);
    const reopenedFile = await readFile(savedPath, 'utf8');
    assert.ok(reopenedFile.startsWith(beforeFile), 'Reopen preserves every pre-existing journal entry byte-for-byte');
    const additions = reopenedFile.slice(beforeFile.length).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(additions.every(entry => entry.type === 'custom' && ['step.activity', 'step.activity_capabilities'].includes(entry.customType)),
      'Only native resource-discovery records may be appended during this fixture reopening');
    await pool.assertBackgroundIdle(reopened);
    const requests = modelRequests;
    const loadedMessages = await reopened.rpc.request('get_messages');
    const native = await reopened.rpc.request('desktop_subagents', { sessionId, action: 'list' });
    assert.equal(native.lanes.length, 0, 'The authoritative native query reports no live lanes');
    await pool.assertBackgroundIdle(reopened);
    await pool.readBackground(reopened);
    const activity = pool.summaries().find(runtime => runtime.runtimeId === reopened.id)!.background;
    assert.deepEqual(activity, { status: 'known', lanes: [] }, 'The desktop display cache knows the lane set is empty');
    const historical = backgroundSubagentStates(reopened.messages);
    // Windows keeps the frozen running dispatch; a graceful posix shutdown may
    // record the lane's end instead. Both are recorded facts, never invented.
    const historicalStatus = historical.get(laneId);
    assert.ok(historicalStatus === 'running' || historicalStatus === 'failed' || historicalStatus === 'aborted',
      `Reopen preserves the recorded dispatch outcome, got ${historicalStatus}`);
    const projected = projectBackgroundSubagentStates(historical, activity);
    assert.equal(['running', 'queued'].includes(projected.get(laneId)!), false,
      'Known-empty ownership never displays unresolved history as in progress');
    if (historicalStatus === 'running') {
      assert.equal(projected.get(laneId), 'unknown', 'Known-empty ownership downgrades stale running history to unknown');
    }
    assert.equal([...projected.values()].some(status => status === 'running' || status === 'queued'), false,
      'No projected lane still claims to run after reopen');
    assert.deepEqual(await reopened.rpc.request('get_messages'), loadedMessages, 'Lane reads never append messages');
    assert.equal(modelRequests, requests, 'Lane reads never invoke the model');
    assert.equal(await readFile(savedPath, 'utf8'), reopenedFile, 'Lane reads never rewrite or append to the reopened JSONL');
    await pool.assertAllIdle();
    assert.equal(quitReasons(pool, false).runningTasks, 0);
  } finally {
    releaseChild();
    await pool.stopAll();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
