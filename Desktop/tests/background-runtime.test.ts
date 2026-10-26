import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import { quitReasons } from '../electron/quit-review';
import type { RuntimeEvent } from '../src/contracts';

for (const outcome of ['complete', 'suspend'] as const) {
test(`pinned RPC background lane survives parent end and navigation: ${outcome}`, { timeout: 60000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-background-runtime-'));
  const workspace = join(profile, 'workspace');
  await mkdir(workspace);
  let releaseChild!: () => void;
  const childGate = new Promise<void>(resolve => { releaseChild = resolve; });
  let childRequested = false;
  const failures: unknown[] = [];
  const text = (message: any) => typeof message?.content === 'string' ? message.content
    : message?.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') ?? '';
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer isolated-background-fixture');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
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
  const pool = new SessionRuntimes(event => events.push(event), undefined, { idleLimit: () => 0 });
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
    await pool.stopAll();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
}
