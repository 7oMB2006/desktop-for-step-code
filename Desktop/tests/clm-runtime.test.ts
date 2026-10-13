import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment, runtimeNodePath } from '../electron/runtime';
import { PendingMessages, promptNeedsQueue } from '../electron/pending-messages';

const oldText = 'obsolete successful observation; no new failure\n'.repeat(3500);
const retained = 'KEEP: protocol magic=d371; preserve public API; implementation remains.';
const text = (content: any) => typeof content === 'string' ? content
  : content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n') ?? '';

for (const mode of ['plan', 'goal', 'active-goal', 'fallback', 'cancel']) {
  const name = mode === 'fallback' ? 'real CLM rejects an invalid edit, compacts once and continues queued work'
    : mode === 'cancel' ? 'real CLM cancellation suppresses fallback and preserves queued work for explicit recovery'
    : `real CLM preserves ${mode} state, canonical history and revision on reopen`;
  test(name, { timeout: 90000 }, async () => {
    const errors: unknown[] = [];
    const requests: any[] = [];
    let forkRequest = false;
    let goalCompleted = false;
    let planStage = -1;
    let releaseMaintenance: (() => void) | undefined;
    const recovery = mode === 'fallback' || mode === 'cancel';
    const server = createServer(async (req, res) => {
      try {
        let body = ''; for await (const part of req) body += part;
        const payload = JSON.parse(body); requests.push(payload);
        const all = payload.messages.map((m: any) => text(m.content)).join('\n');
        const maintenance = all.includes('# Automatic context edit index');
        const chunk = (delta: unknown, finish_reason: string | null = null, usage?: unknown) =>
          `data: ${JSON.stringify({ id: 'clm', object: 'chat.completion.chunk', model: 'fixture',
            choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (maintenance) {
          const id = /- id=([^ ]+) role=assistant chars=/.exec(all)?.[1];
          assert.ok(id, 'Maintenance must offer an actual editable assistant body');
          const replacements = [{ id: mode === 'fallback' ? 'not-an-offered-id' : id, text: retained }];
          const delta = all.includes('Reply with only JSON') ? { content: JSON.stringify({ replacements }) }
            : { tool_calls: [{ index: 0, id: 'context-edit', type: 'function', function: {
              name: 'apply_context_edit', arguments: JSON.stringify({ replacements }),
            } }] };
          const finish = () => res.end(chunk(delta, 'tool_calls' in delta ? 'tool_calls' : 'stop',
            { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) + 'data: [DONE]\n\n');
          if (mode === 'cancel') { releaseMaintenance = finish; res.flushHeaders(); }
          else finish();
        } else {
          if (recovery) {
            res.end(chunk({ role: 'assistant', content: `${retained}\nRecovery task finished.` }, 'stop',
              { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }) + 'data: [DONE]\n\n');
            return;
          }
          assert.equal(all.includes(retained), !forkRequest, `Working revision must follow the active branch: ${mode}, request ${requests.length}, fork=${forkRequest}, tail=${text(payload.messages.at(-1)?.content).slice(0, 180)}`);
          assert.ok(!all.includes(oldText), 'Old editable body must be replaced in actor context');
          if (!forkRequest) assert.ok(all.includes('PROTECTED USER REQUIREMENT'));
          if (mode === 'plan' && planStage < 2) assert.match(all, /Desktop Plan mode active/);
          if (mode === 'plan' && planStage >= 0 && planStage < 2) {
            const planPath = /Write the proposal to (.*)\. Only this proposal/.exec(all)?.[1];
            assert.ok(planPath);
            const name = planStage++ === 0 ? 'write_file' : 'exit_plan_mode';
            const args = name === 'write_file' ? { path: planPath, content: '# Proposal\n\nPreserve protocol magic d371 and public API.' } : {};
            res.end(chunk({ tool_calls: [{ index: 0, id: `plan-${planStage}`, type: 'function', function: {
              name, arguments: JSON.stringify(args),
            } }] }, 'tool_calls', { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }) + 'data: [DONE]\n\n');
            return;
          }
          if (mode === 'plan' && planStage === 2) assert.ok(!all.includes('[Desktop Plan mode active]'));
          if (mode === 'active-goal' && !goalCompleted) {
            assert.match(all, /Preserve protocol d371/);
            goalCompleted = true;
            res.end(chunk({ tool_calls: [{ index: 0, id: 'finish-goal', type: 'function', function: {
              name: 'update_goal', arguments: JSON.stringify({ status: 'complete' }),
            } }] }, 'tool_calls', { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }) + 'data: [DONE]\n\n');
            return;
          }
          res.end(chunk({ role: 'assistant', content: 'Fixture continuation complete.' }, 'stop',
            { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }) + 'data: [DONE]\n\n');
        }
      } catch (error) { errors.push(error); res.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const profile = await mkdtemp(join(tmpdir(), 'desktop-clm-rpc-'));
    const workspace = join(profile, 'workspace');
    await mkdir(workspace); await mkdir(join(profile, 'sessions'));
    await writeFile(join(profile, 'config.toml'), `defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n[compaction]\nreserveTokens = 8192\nkeepRecentTokens = 20000\n[compaction.autoClm]\nsoftThresholdRatio = 0.6\nmaxRequests = 1\n`);
    await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
      api: 'openai-completions', baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, apiKey: 'isolated-test',
      models: [{ id: 'fixture', name: 'CLM fixture', contextWindow: 64000, maxTokens: 8192 }],
    } } }));
    const sessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const entries: any[] = [{ type: 'session', version: 3, id: sessionId, cwd: workspace, timestamp }];
    let parentId: string | null = null;
    const append = (entry: any) => { const id = randomUUID().slice(0, 8); entries.push({ ...entry, id, parentId, timestamp }); parentId = id; };
    append({ type: 'model_change', provider: 'fixture', modelId: 'fixture' });
    append({ type: 'message', message: { role: 'user', content: 'PROTECTED USER REQUIREMENT: preserve public API.', timestamp: 1 } });
    for (const [index, body] of [oldText, 'Current state; implementation and verification remain'].entries())
      append({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: body }], timestamp: index + 2,
        provider: 'fixture', model: 'fixture', api: 'openai-completions', stopReason: 'stop', usage: zeroUsage } });
    if (mode === 'goal' || mode === 'active-goal') append({ type: 'custom', customType: 'step-goal', data: {
      id: 'fixture-goal', sessionId, objective: 'Preserve protocol d371', status: mode === 'goal' ? 'paused' : 'active', tokenBudget: 100000,
      tokensUsed: 0, timeUsedSeconds: 0, iteration: 0, createdAt: timestamp, updatedAt: timestamp,
    } });
    const sessionPath = join(profile, 'sessions', `${sessionId}.jsonl`);
    await writeFile(sessionPath, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const events: any[] = [];
    const queue = new PendingMessages(() => {}, (_worker, error) => errors.push(error));
    const pool = new SessionRuntimes(event => {
      events.push(event);
      const owner = pool.workers.get(event.runtimeId);
      if (owner) {
        if (event.type === 'message_start' && event.message?.role === 'user')
          queue.delivered(owner, event.message.content, event.message.timestamp);
        queue.runtimeEvent(owner, event);
      }
      if (event.type === 'extension_ui_request' && event.method === 'select' && event.title?.startsWith('Desktop Plan review')) {
        assert.match(event.title, /protocol magic d371/);
        pool.respondToRequest(pool.require(event.runtimeId), { id: event.id, value: 'Approve plan' });
      }
    }, undefined, {
      launch: () => ({ env: {}, args: ['--desktop-plan-review'] }),
    });
    const node = runtimeNodePath(resolve('runtime'));
    const step = resolve('runtime/step/dist/bundle/step.js');
    const env = isolatedEnvironment(profile);
    const waitFor = async (condition: () => boolean, label: string) => {
      const deadline = Date.now() + 30000;
      while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(condition(), label);
    };
    const settled = async (worker: Awaited<ReturnType<typeof pool.open>>, previousEnds: number) => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const ends = events.filter(event => event.type === 'agent_end' && event.runtimeId === worker.id).length;
        if (ends > previousEnds && !(await worker.rpc.request('get_state')).isStreaming) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (!(await worker.rpc.request('get_state')).isStreaming) return;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail('Runtime did not settle after its authoritative completion event');
    };
    try {
      const worker = await pool.open(node, step, workspace, env, sessionPath);
      if (mode === 'plan') await worker.rpc.request('prompt', { message: '/plan' });
      // Restoring an active Goal starts its own continuation at session_start.
      if (mode !== 'active-goal')
        await worker.rpc.request('prompt', { message: 'Continue checking the protected requirement.' }, 60000);
      if (recovery) {
        if (mode === 'cancel') {
          await waitFor(() => Boolean(releaseMaintenance && worker.state?.isCompacting), 'Maintenance must actually start');
          assert.equal(promptNeedsQueue(worker), true);
          queue.enqueue(worker, 'RECOVERY QUEUED MESSAGE', { message: 'RECOVERY QUEUED MESSAGE' });
          await assert.rejects(queue.steer(worker, queue.list(worker)[0].id, 0), /cannot send/);
          await queue.drain(worker);
          assert.equal(requests.length, 1, 'Queue cannot start an actor during maintenance');
          // Match the Desktop stop path: pause drafts before cancelling the child.
          queue.pause(worker); worker.interrupted = true;
          await worker.rpc.request('abort');
          await waitFor(() => events.some(event => event.type === 'auto_clm_end'), 'Cancellation must end maintenance');
          assert.equal(worker.state?.isCompacting, false);
          assert.equal(events.some(event => event.type === 'compaction_start'), false, 'Cancellation suppresses fallback');
          assert.equal(queue.list(worker).length, 1);
          assert.equal(queue.list(worker)[0].sending, undefined);
          await queue.drain(worker);
          assert.equal(requests.length, 1, 'Explicitly paused queue stays undelivered');
          releaseMaintenance!();
          await waitFor(() => !worker.busy && !worker.state?.isCompacting, 'Cancelled worker must become idle');
          // Resume explicitly with native CLM opt-out so this verifies receipt recovery,
          // rather than asking the intentionally hanging fixture to maintain again.
          await worker.rpc.request('prompt', { message: '/clm off' });
          worker.interrupted = false; worker.failed = false;
          const ends = events.filter(event => event.type === 'agent_end' && event.runtimeId === worker.id).length;
          queue.resumed(worker); await queue.drain(worker);
          await settled(worker, ends);
          await waitFor(() => queue.list(worker).length === 0, 'Authoritative user delivery must clear the receipt');
          const history = await worker.rpc.request('get_messages');
          assert.equal(history.messages.filter((message: any) => message.role === 'user' && text(message.content) === 'RECOVERY QUEUED MESSAGE').length, 1);
          const cancelled = events.find(event => event.type === 'auto_clm_end')?.result;
          assert.equal(cancelled.accepted, false);
          assert.equal(cancelled.fallback, false);
          const journal = (await readFile(sessionPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
          assert.equal(journal.some(entry => entry.customType === 'step-live-context' && !entry.data?.reset), false,
            'Cancelled maintenance must not commit a working-context edit');
        } else {
          await settled(worker, 0);
          const result = events.find(event => event.type === 'auto_clm_end')?.result;
          assert.equal(result?.accepted, false);
          assert.equal(result?.fallback, true, JSON.stringify(result));
          assert.equal(events.filter(event => event.type === 'compaction_start').length, 1);
          const end = events.find(event => event.type === 'compaction_end');
          assert.ok(end?.result, JSON.stringify(end));
          assert.equal(end?.aborted, false);
          assert.equal(worker.state?.isCompacting, false);
          assert.equal(worker.busy, false);
          await pool.read(worker);
          const journal = (await readFile(sessionPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
          assert.equal(journal.filter(entry => entry.type === 'compaction').length, 1);
          assert.ok(worker.messages.some(message => message.role === 'assistant' && text(message.content).includes('Recovery task finished.')));
          assert.equal(worker.stats?.tokens.total, 120 + (requests.length - 1) * 230);
          const previous = events.filter(event => event.type === 'agent_end').length;
          queue.enqueue(worker, 'RECOVERY QUEUED MESSAGE', { message: 'RECOVERY QUEUED MESSAGE' });
          await queue.drain(worker); await settled(worker, previous);
          assert.equal(queue.list(worker).length, 0);
          const history = await worker.rpc.request('get_messages');
          assert.equal(history.messages.filter((message: any) => message.role === 'user'
            && text(message.content) === 'RECOVERY QUEUED MESSAGE').length, 1);
        }
        assert.deepEqual(errors, []);
        return;
      }
      await settled(worker, 0);
      if (mode === 'active-goal') assert.equal(goalCompleted, true, 'Restored Goal must complete through its automatic continuation');
      await pool.read(worker);
      assert.deepEqual(errors, []);
      assert.ok(events.some(event => event.type === 'auto_clm_start'));
      const result = events.find(event => event.type === 'auto_clm_end')?.result;
      assert.equal(result?.accepted, true, JSON.stringify(result));
      assert.equal(events.some(event => event.type === 'compaction_start'), false);
      assert.equal(worker.state?.isCompacting, false);
      assert.equal(worker.stats?.tokens.total, 120 + (requests.length - 1) * 230,
        'Every actual response, including Goal completion review, is counted once');
      const journal = (await readFile(sessionPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.ok(journal.some(entry => entry.message && text(entry.message.content) === oldText), 'Canonical history stays intact');
      const revision = journal.find(entry => entry.customType === 'step-auto-clm');
      assert.ok(revision, 'Accepted maintenance must persist');
      if (mode === 'goal') {
        const history = await worker.rpc.request('get_entries');
        const user = entries.find(entry => entry.message?.role === 'user');
        const branch = await pool.open(node, step, workspace, env, sessionPath,
          { kind: 'fork', entryId: user.id, leafId: history.leafId });
        assert.notEqual(branch.state?.sessionId, sessionId);
        assert.equal(branch.launch?.goal, undefined, 'A fork before goal creation cannot inherit that goal');
        const branchedHistory = await branch.rpc.request('get_entries');
        assert.equal(branchedHistory.entries.some((entry: any) => entry.customType === 'step-auto-clm'), false);
        forkRequest = true;
        await branch.rpc.request('prompt', { message: 'Independent branch task.' }, 60000);
        await settled(branch, 0);
        assert.equal(branch.busy, false);
        assert.deepEqual(errors, []);
        forkRequest = false;
      }
      await pool.stopAll();
      const reopened = await pool.open(node, step, workspace, env, sessionPath);
      assert.equal(mode === 'plan' ? reopened.launch?.plan : reopened.launch?.goal?.status,
        mode === 'plan' ? true : mode === 'goal' ? 'paused' : 'complete');
      if (mode === 'plan') planStage = 0;
      await reopened.rpc.request('prompt', { message: 'Check retained evidence after restart.' }, 60000);
      await settled(reopened, 0);
      await pool.read(reopened);
      if (mode === 'plan') {
        assert.equal(reopened.launch?.plan, false, 'Approved plan exits planning after CLM and restart');
        assert.ok(events.some(event => event.type === 'extension_ui_request' && event.title?.startsWith('Desktop Plan review')));
        assert.equal(reopened.stats?.tokens.total, 120 + (requests.length - 1) * 230);
      }
      assert.deepEqual(errors, []);
      assert.equal(events.filter(event => event.type === 'auto_clm_end').length, 1, 'Reopen must reuse the accepted revision');
      if (mode !== 'active-goal') assert.equal(requests.length, mode === 'plan' ? 5 : 4);
      assert.equal(requests.filter(payload => payload.messages.some((message: any) => text(message.content).includes('# Automatic context edit index'))).length, 1);
    } finally {
      releaseMaintenance?.();
      await pool.stopAll();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
