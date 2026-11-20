import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { isolatedEnvironment } from '../electron/runtime';
import { SessionRuntimes, type SessionRuntime } from '../electron/session-runtimes';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

const candidate = process.env.DFSC_CRON_OWNER_RUNTIME;

function answer(response: ServerResponse) {
  const event = { id: 'v018-cron', object: 'chat.completion.chunk', model: 'fixture',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Cron fixture reply' }, finish_reason: 'stop' }] };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
}

test('v018 JSONL Cron keeps owners isolated, fences recovery and preserves legacy rows', { timeout: 90000 }, async t => {
  const runtime = resolve(candidate ?? 'runtime');
  const manifest = await readFile(join(runtime, 'manifest.json'), 'utf8').then(JSON.parse, error => {
    if (!candidate && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!candidate && !manifest?.patches?.includes('desktop-cron-session-ownership-v1')) {
    return t.skip('Requires a staged session-owned v0.1.8 runtime');
  }
  assert.ok(manifest?.patches?.includes('desktop-cron-session-ownership-v1'));
  const entry = join(runtime, manifest.entry);
  const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dfsc-v018-cron-owner-')));
  const project = join(root, 'project'), profile = join(root, 'profile'), home = join(root, 'home');
  const clock = join(root, 'clock'), store = join(project, '.stepcode', 'cron', 'tasks.json');
  const baseline = Math.floor(Date.now() / 60000) * 60000 + 20_000;
  const exactTime = baseline + 15_000;
  const prompt = 'V018-EXACT-DELIVERY';
  const privatePrompt = 'V018-UNTRUSTED-DURABLE-MUST-NOT-RUN';
  const temporaryPrompt = 'V018-UNTRUSTED-SESSION-DELIVERY';
  const errors: unknown[] = [];
  let arrivals = 0;
  let temporaryArrivals = 0;
  let delivery: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer fixture-cron-owner');
      let body = '';
      for await (const chunk of request) body += chunk;
      JSON.parse(body);
      if (body.includes(prompt)) {
        arrivals++;
        delivery = response;
      } else {
        assert.ok(!body.includes(privatePrompt), 'Untrusted durable task reached a model');
        if (body.includes(temporaryPrompt)) temporaryArrivals++;
        answer(response);
      }
    } catch (error) { errors.push(error); response.writeHead(500).end(); }
  });
  const pool = new SessionRuntimes(() => {}, undefined, { backgroundAvailable: () => false });
  const wait = async (label: string, check: () => boolean) => {
    const deadline = Date.now() + 12000;
    do {
      t.signal.throwIfAborted();
      if (errors.length) throw errors[0];
      if (check()) return;
      await delay(25, undefined, { signal: t.signal });
    } while (Date.now() < deadline);
    assert.fail(`Timed out waiting for ${label}`);
  };
  const state = (worker: SessionRuntime) => worker.rpc.request('get_state');
  const manage = (worker: SessionRuntime, action: string, args: Record<string, unknown> = {}) =>
    worker.rpc.request('desktop_cron', { action, sessionId: worker.state?.sessionId, ...args });
  const create = async (worker: SessionRuntime, args: Record<string, unknown> = {}) =>
    (await manage(worker, 'create', { cron: '* * * * *', prompt: 'fixture', recurring: true, durable: true, ...args })).result;
  const list = async (worker: SessionRuntime) => (await manage(worker, 'list')).jobs;
  const records = async () => (await readFile(store, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  try {
    await mkdir(join(project, '.stepcode', 'cron'), { recursive: true });
    await mkdir(join(profile, 'agent'), { recursive: true });
    await mkdir(home);
    await writeFile(clock, String(baseline));
    // An active pre-ownership record and a v017 paused schema-2 row are both parked.
    const unbound = { schemaVersion: 1, id: 'v017-unbound', cron: '* * * * *', prompt: 'LEGACY MUST NOT RUN',
      recurring: false, durable: true, createdAt: baseline - 10_000, nextFireAt: baseline + 2_000 };
    const paused = { ...unbound, schemaVersion: 2, id: 'v017-paused', desktopPausedAt: baseline - 500 };
    await writeFile(store, `${JSON.stringify(unbound)}\n${JSON.stringify(paused)}\n`);
    await new Promise<void>((ready, reject) => server.once('error', reject).listen(0, '127.0.0.1', ready));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const env = { ...isolatedEnvironment(profile), HOME: home, USERPROFILE: home, DESKTOP_CRON_STATE: '1',
      DESKTOP_CRON_TEST_CLOCK: clock, DESKTOP_CRON_TEST_ORIGIN: origin,
      NODE_OPTIONS: `--require="${resolve('tests/fixtures/cron-clock.cjs').replaceAll('\\', '/')}"` };
    await writeFile(join(profile, 'agent/trust.json'), JSON.stringify({ [await realpath(project)]: true }));
    await writeFile(join(profile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n'
      + '[telemetry]\nenabled = false\n[retry]\nenabled = false\n[mcp_servers.steppage__steppage]\nenabled = false\n');
    await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
      api: 'openai-completions', apiKey: 'fixture-cron-owner', baseUrl: `${origin}/v1`,
      models: [{ id: 'fixture', name: 'fixture', contextWindow: 32000, maxTokens: 1000 }],
    } } }));
    let a = await pool.open(node, entry, project, env);
    await a.rpc.request('prompt', { message: 'Persist original session' });
    await wait('original conversation', () => a.messages.some(message => message.role === 'assistant') && !pool.isBusy(a));
    const aState = await state(a);
    assert.ok(aState.sessionFile);
    const b = await pool.open(node, entry, project, env);
    const bState = await state(b);
    assert.notEqual(aState.sessionId, bState.sessionId);
    assert.deepEqual(await list(a), []);
    assert.deepEqual(await list(b), []);

    const calendar = await create(a);
    const interval = await create(b, { intervalHours: 2, durable: false });
    assert.ok(bState.sessionFile);
    await assert.rejects(readFile(bState.sessionFile), { code: 'ENOENT' });
    const emptyOwner = await create(b, { runAt: exactTime + 3600_000, recurring: false });
    const header = JSON.parse((await readFile(bState.sessionFile, 'utf8')).split(/\r?\n/, 1)[0]);
    assert.equal(header.type, 'session');
    assert.equal(header.id, bState.sessionId);
    assert.equal(emptyOwner.sessionFile, bState.sessionFile);
    const once = await create(a, { runAt: exactTime, prompt, recurring: false });
    assert.equal(once.nextFireAt, exactTime);
    assert.equal(once.sessionId, aState.sessionId);
    assert.equal(once.sessionFile, aState.sessionFile);
    assert.equal(interval.intervalHours, 2);
    assert.equal(interval.nextFireAt, baseline + 2 * 3600_000);
    assert.equal(interval.sessionId, bState.sessionId);
    assert.match(calendar.revision, /^[a-f0-9]{64}$/);
    assert.deepEqual((await list(a)).map((job: { id: string }) => job.id).sort(), [calendar.id, once.id].sort());
    assert.deepEqual((await list(b)).map((job: { id: string }) => job.id).sort(), [emptyOwner.id, interval.id].sort());
    await assert.rejects(manage(b, 'list', { sessionId: aState.sessionId }), /Session changed/);
    await assert.rejects(manage(b, 'delete', { jobId: calendar.id, expected: calendar.revision }), /changed|owner|another session/i);
    const { result: edited } = await manage(a, 'update', { jobId: calendar.id, expected: calendar.revision, paused: true });
    assert.equal(edited.status, 'paused');
    assert.equal(edited.createdAt, calendar.createdAt);
    assert.notEqual(edited.revision, calendar.revision);
    await assert.rejects(manage(a, 'delete', { jobId: calendar.id, expected: calendar.revision }), /changed/i);
    assert.equal((await manage(a, 'delete', { jobId: calendar.id, expected: edited.revision })).result.found, true);

    await pool.remove(a);
    a = await pool.open(node, entry, project, { ...env, DESKTOP_CRON_RECOVERY: '1' }, aState.sessionFile);
    assert.equal(a.state?.sessionId, aState.sessionId);
    const [pending] = await list(a);
    assert.equal(pending.revision, once.revision);
    await assert.rejects(a.rpc.request('desktop_cron_resume', { before: exactTime }), /Session changed/);
    await assert.rejects(a.rpc.request('desktop_cron_resume', { sessionId: aState.sessionId, revisions: ['0'.repeat(64)] }),
      /changed|review/i);
    await assert.rejects(create(a), /waiting for approval/i);
    assert.equal(arrivals, 0);
    await a.rpc.request('desktop_cron_resume', { before: exactTime, sessionId: aState.sessionId, revisions: [pending.revision] });
    await writeFile(clock, String(exactTime + 1));
    await wait('exact owner model delivery', () => arrivals === 1);
    await assert.rejects(create(a), /idle|execut/i);
    assert.ok(!b.messages.some(message => message.customType === 'step-cron'));
    answer(delivery!);
    await wait('settled owner run', () => a.messages.some(message => message.customType === 'step-cron') && !pool.isBusy(a));
    await delay(1100);
    assert.equal(arrivals, 1);
    assert.ok(!b.messages.some(message => message.customType === 'step-cron'));
    const saved = await records();
    assert.deepEqual(saved.find(row => row.id === unbound.id), unbound);
    assert.deepEqual(saved.find(row => row.id === paused.id), paused);

    const untrustedProject = join(root, 'untrusted'), untrustedStore = join(untrustedProject, '.stepcode', 'cron', 'tasks.json');
    await mkdir(join(untrustedProject, '.stepcode', 'cron'), { recursive: true });
    const untrusted = await pool.open(node, entry, untrustedProject, env);
    const owner = await state(untrusted);
    const temporaryTime = exactTime + 5000;
    const privateRow = JSON.stringify({ schemaVersion: 2, id: 'private', cron: '* * * * *', prompt: privatePrompt,
      sessionId: owner.sessionId, sessionFile: owner.sessionFile, origin: 'desktop', recurring: false, durable: true,
      createdAt: baseline, runAt: temporaryTime, nextFireAt: temporaryTime }) + '\n';
    await writeFile(untrustedStore, privateRow);
    assert.deepEqual(await manage(untrusted, 'list'), { jobs: [], trusted: false });
    await assert.rejects(create(untrusted), /trusted project/i);
    await assert.rejects(untrusted.rpc.request('desktop_cron_resume', { sessionId: owner.sessionId, revisions: [calendar.revision] }), /trusted/i);
    await assert.rejects(manage(untrusted, 'update', { jobId: 'private', expected: calendar.revision, paused: true }), /changed|session/i);
    await assert.rejects(manage(untrusted, 'delete', { jobId: 'private', expected: calendar.revision }), /changed|session/i);
    const temporary = await create(untrusted, { runAt: temporaryTime, recurring: false, durable: false, prompt: temporaryPrompt });
    const { result: held } = await manage(untrusted, 'update', { jobId: temporary.id, expected: temporary.revision, paused: true });
    assert.equal(held.status, 'paused');
    const { result: released } = await manage(untrusted, 'update', { jobId: temporary.id, expected: held.revision, paused: false });
    assert.equal(released.status, 'enabled');
    assert.deepEqual((await list(untrusted)).map((job: { id: string }) => job.id), [temporary.id]);
    await writeFile(clock, String(temporaryTime + 1));
    await wait('untrusted temporary delivery', () => temporaryArrivals === 1);
    await wait('untrusted temporary settlement', () => !pool.isBusy(untrusted));
    const completed = (await list(untrusted)).find((job: { id: string }) => job.id === temporary.id);
    await manage(untrusted, 'delete', { jobId: completed.id, expected: completed.revision });
    assert.deepEqual(await list(untrusted), []);
    assert.equal(await readFile(untrustedStore, 'utf8'), privateRow);
    assert.deepEqual(errors, []);
  } finally {
    server.closeAllConnections();
    try { await pool.stopAll(); }
    finally {
      if (server.listening) await new Promise<void>(ready => server.close(() => ready()));
      await removeTestProfile(root);
    }
  }
});
