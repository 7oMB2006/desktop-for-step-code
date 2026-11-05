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

for (const outcome of ['complete', 'suspend', 'control'] as const) {
test(`pinned RPC background lane survives parent end and navigation: ${outcome}`, { timeout: 60000 }, async () => {
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
      } else if (task === 'BACKGROUND-KEEP-RUNNING') {
        parentRequested = true;
        await parentGate;
        if (res.destroyed) return;
        send({ content: 'PARENT-STILL-USABLE' }, 'stop');
      } else if (task === 'BACKGROUND-PARENT' && !toolReturned) {
        assert.ok(body.tools.some((tool: any) => tool.function?.name === 'subagent'));
        send({ tool_calls: [{ index: 0, id: 'background-call', type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({
            agent: 'general', task: outcome === 'control' ? 'BACKGROUND-CHILD-A' : 'BACKGROUND-CHILD', run_in_background: true,
          }) } }] }, 'tool_calls');
      } else if (task === 'BACKGROUND-START-OTHER' && !body.messages.some((message: any) =>
        message.role === 'tool' && message.tool_call_id === 'background-other')) {
        send({ tool_calls: [{ index: 0, id: 'background-other', type: 'function',
          function: { name: 'subagent', arguments: JSON.stringify({
            agent: 'general', task: 'BACKGROUND-CHILD-B', run_in_background: true,
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
  try {
    const host = await pool.open(node, entry, workspace, env);
    await host.rpc.request('prompt', { message: 'BACKGROUND-PARENT' });
    await waitFor(() => childRequested && host.backgroundActive === true && !pool.isBusy(host) && text(host.messages.at(-1)) === 'PARENT-IDLE');
    assert.equal(pool.running, true);
    assert.equal(quitReasons(pool, false).runningTasks, 1);
    await assert.rejects(pool.assertAllIdle(), /background/i);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    if (outcome === 'control') {
      const sessionId = host.state!.sessionId!;
      const controls = new BackgroundAgents(pool.workers, undefined, true);
      await host.rpc.request('prompt', { message: 'BACKGROUND-START-OTHER' });
      await waitFor(() => otherRequested && !pool.isBusy(host));
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
      await waitFor(() => !host.backgroundActive && !pool.isBusy(host));
      current = await controls.read(host.id, sessionId);
      assert.equal(current.lanes.find(lane => lane.id === first.id)?.status, 'aborted');
      assert.equal(current.lanes.find(lane => lane.id === second.id)?.status, 'completed');
      const native = await host.rpc.request('desktop_subagents', { sessionId, action: 'list' });
      assert.doesNotMatch(JSON.stringify(native), /private-value|sessionFile|activeToolArgs|messages/);
      assert.ok(current.lanes.find(lane => lane.id === second.id)?.steps.some(step => step.output.includes('BACKGROUND-OTHER-DONE')));
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
      assert.equal(host.status, 'disconnected');
      assert.equal(host.backgroundActive, false);
      assert.equal(pool.running, false);
      assert.equal(quitReasons(pool, false).runningTasks, 0);
      assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
      assert.equal(pool.activeId, other.id);
      return;
    }
    releaseChild();
    await waitFor(() => !host.backgroundActive && !pool.isBusy(host)
      && host.messages.some(message => text(message).includes('BACKGROUND-ACKNOWLEDGED')));
    assert.deepEqual(failures, []);
    assert.equal(pool.activeId, other.id, 'Background wake-up does not navigate the user');
    const completed = events.filter(event => event.type === 'desktop_task_completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].runtimeId, host.id);
    assert.equal(pool.unreadSessionIds.has(host.state!.sessionId!), true);
    await pool.assertAllIdle();
    assert.equal(quitReasons(pool, false).runningTasks, 0);
  } finally {
    releaseChild();
    releaseOther(); releaseParent();
    await pool.stopAll();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
}
