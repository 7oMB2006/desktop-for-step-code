import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { isolatedEnvironment } from '../electron/runtime';
import { SessionRuntimes, type SessionRuntime } from '../electron/session-runtimes';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

const candidate = process.env.DFSC_TEST_BACKGROUND_COMMAND_ENTRY;
const requests = ['PROCESS-FIXTURE-A', 'PROCESS-FIXTURE-B'];
const text = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n') : '';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

test('real RPC shell processes survive session navigation and fork, and stop only with their owning host', {
  skip: !candidate ? 'Set DFSC_TEST_BACKGROUND_COMMAND_ENTRY to an isolated candidate bundle entry' : process.platform !== 'win32',
  timeout: 180000,
}, async t => {
  const profile = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'dfsc-background-command-'));
  const workspace = join(profile, 'workspace');
  const entry = join(profile, 'runtime', 'step', 'dist', 'bundle', 'step.js');
  const pool = new SessionRuntimes(() => {}, undefined, {
    backgroundAvailable: () => false,
    backgroundCommandsAvailable: () => true,
    idleLimit: () => 0,
  });
  const failures: unknown[] = [];
  const calls = new Map<string, number>();
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer background-command-fixture');
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const prompt = text(body.messages.findLast((part: { role: string; content: unknown }) =>
        part.role === 'user' && requests.includes(text(part.content)))?.content);
      assert.ok(requests.includes(prompt), 'Unexpected model request');
      const count = (calls.get(prompt) ?? 0) + 1;
      calls.set(prompt, count);
      assert.ok(count <= 2, 'Unexpected repeat model request');
      const slot = requests.indexOf(prompt);
      const id = `start-background-command-${slot}`;
      const tool = body.messages.find((part: { role: string; tool_call_id?: string }) =>
        part.role === 'tool' && part.tool_call_id === id);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (tool) send({ content: `STARTED-${slot}` }, 'stop');
      else {
        assert.ok(body.tools.some((item: { function?: { name: string } }) => item.function?.name === 'run_command'));
        const node = JSON.stringify(process.execPath.replaceAll('\\', '/'));
        const child = `require("node:fs").writeFileSync("proc-${slot}.pid",String(process.pid));setInterval(()=>{},1000)`;
        send({ tool_calls: [{ index: 0, id, type: 'function', function: { name: 'run_command',
          arguments: JSON.stringify({ command: `${node} -e '${child}' & wait`, run_in_background: true }),
        } }] }, 'tool_calls');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  const waitFor = async <T>(label: string, check: () => T | Promise<T>, timeout = 25000): Promise<NonNullable<T>> => {
    const end = Date.now() + timeout;
    do {
      t.signal.throwIfAborted();
      if (failures.length) throw failures[0];
      const result = await check();
      if (result) return result;
      await delay(50, undefined, { signal: t.signal });
    } while (Date.now() < end);
    throw new Error(`Timed out waiting for ${label}`);
  };
  const state = (worker: SessionRuntime) => worker.rpc.request('get_state');
  const assertCommands = async (worker: SessionRuntime, count: number) => {
    const live = await state(worker);
    assert.equal(live.sessionId, worker.state?.sessionId);
    assert.deepEqual(live.desktopBackgroundCommands, { version: 1, count });
  };
  const start = async (worker: SessionRuntime, slot: number) => {
    await worker.rpc.request('prompt', { message: requests[slot] });
    const pid = await waitFor(`background command ${slot} and settled turn`, async () => {
      for (const request of worker.pendingUI.values()) {
        assert.equal(request.method, 'confirm');
        pool.respondToRequest(worker, { id: request.id, confirmed: true });
      }
      if (pool.isBusy(worker) || !worker.messages.some(message => message.role === 'assistant' &&
        text(message.content) === `STARTED-${slot}`)) return;
      const pid = Number(await readFile(join(workspace, `proc-${slot}.pid`), 'utf8').catch(() => ''));
      return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
    });
    assert.equal(alive(pid), true);
    await assertCommands(worker, 1);
    return pid;
  };

  try {
    await mkdir(workspace);
    const candidateEntry = resolve(candidate!);
    assert.equal(basename(candidateEntry), 'step.js');
    assert.equal(basename(dirname(candidateEntry)), 'bundle');
    const sourcePackage = resolve(candidateEntry, '../../..');
    const runtimePackage = join(profile, 'runtime', 'step');
    await cp(join(sourcePackage, 'dist'), join(runtimePackage, 'dist'), { recursive: true });
    for (const name of ['package.json', 'README.md']) await cp(join(sourcePackage, name), join(runtimePackage, name));
    await cp(resolve('electron/windows-runtime-job.ps1'), join(profile, 'runtime', 'windows-runtime-job.ps1'));
    await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    await writeFile(join(profile, 'config.toml'),
      'defaultProvider = "fixture"\ndefaultModel = "fixture"\npermissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n');
    await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
      api: 'openai-completions', baseUrl: origin, apiKey: 'background-command-fixture',
      models: [{ id: 'fixture', name: 'Background command fixture', contextWindow: 100000, maxTokens: 2048 }],
    } } }));
    const env = isolatedEnvironment(profile);
    const a = await pool.open(process.execPath, entry, workspace, env);
    const pidA = await start(a, 0);
    const b = await pool.open(process.execPath, entry, workspace, env);
    assert.notEqual(b.state?.sessionId, a.state?.sessionId);
    await assertCommands(b, 0);
    await pool.recycle();
    assert.equal(pool.workers.get(a.id), a);
    assert.equal(alive(pidA), true);
    const pidB = await start(b, 1);
    pool.activate(a);
    assert.equal(pool.active, a);
    const source = await state(a);
    const history = await a.rpc.request('get_entries');
    const branchPoint = history.entries.find((item: { type: string; message?: { role: string } }) =>
      item.type === 'message' && item.message?.role === 'user');
    assert.ok(source.sessionFile && branchPoint && history.leafId);
    const sourceLog = await readFile(source.sessionFile, 'utf8');
    const fork = await pool.open(process.execPath, entry, workspace, env, source.sessionFile,
      { kind: 'fork', entryId: branchPoint.id, leafId: history.leafId }).catch(async error => {
      const currentLog = await readFile(source.sessionFile, 'utf8');
      const appended = currentLog.slice(sourceLog.length).split(/\r?\n/).filter(Boolean).map(line => {
        const entry = JSON.parse(line);
        return entry.customType ?? entry.type;
      });
      t.diagnostic(`Source entries appended during fork: ${appended.join(', ') || '(none)'}`);
      throw error;
    });
    assert.notEqual(fork.state?.sessionId, a.state?.sessionId);
    assert.ok(await readFile(source.sessionFile, 'utf8') === sourceLog, 'Fork must not modify its source history');
    await assertCommands(fork, 0);
    await pool.recycle();
    assert.deepEqual([alive(pidA), alive(pidB)], [true, true]);
    await assert.rejects(pool.assertIdle(a, { stopHost: true }), /bash_kill/);
    await pool.assertIdle(a, { stopHost: true, allowStoppingBackgroundCommands: true });
    await pool.remove(a);
    await waitFor('A process exit', () => !alive(pidA));
    assert.equal(alive(pidB), true);
    await assertCommands(b, 1);
    const restored = await pool.open(process.execPath, entry, workspace, env, source.sessionFile);
    assert.equal(restored.state?.sessionId, a.state?.sessionId);
    await assertCommands(restored, 0);
    assert.equal(alive(pidB), true);
    await pool.stopAll();
    await waitFor('B process exit', () => !alive(pidB));
    assert.deepEqual([...calls.values()], [2, 2]);
  } finally {
    server.closeAllConnections();
    try { await pool.stopAll(); }
    finally {
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await removeTestProfile(profile);
  }
});
