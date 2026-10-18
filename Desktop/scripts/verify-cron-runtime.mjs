import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, unlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real staged JSONL processes; all profiles, clocks and model calls are isolated.
// CI's TEMP may use an 8.3 alias; upstream's synchronous trust lookup preserves it.
const directory = await realpath(await mkdtemp(join(tmpdir(), 'desktop-cron-runtime-')));
await build({
  entryPoints: ['electron/session-runtimes.ts', 'electron/session-collaboration.ts', 'electron/runtime.ts', 'electron/project-trust.ts', 'electron/cron-management.ts'],
  outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
});
const { SessionRuntimes } = await import(pathToFileURL(join(directory, 'session-runtimes.mjs')));
const { SessionCollaboration } = await import(pathToFileURL(join(directory, 'session-collaboration.mjs')));
const { RpcProcess, isolatedEnvironment } = await import(pathToFileURL(join(directory, 'runtime.mjs')));
const { trustProject } = await import(pathToFileURL(join(directory, 'project-trust.mjs')));
const { CronManagement } = await import(pathToFileURL(join(directory, 'cron-management.mjs')));
const runtime = resolve(process.env.DESKTOP_CRON_VERIFY_RUNTIME ?? 'runtime');
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const entry = join(runtime, 'step/dist/bundle/step.js');
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
assert.ok(manifest.patches.includes('desktop-cron-state'), 'Stage the Cron observer patch first');
const baseline = Date.now();
const errors = [];
let requests = 0;
const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: 'cron-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;
const text = content => typeof content === 'string' ? content : content?.map(item => item.text ?? '').join('\n') ?? '';
const server = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fixture' }] }));
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    let body = '';
    for await (const part of req) body += part;
    const payload = JSON.parse(body);
    requests++;
    const last = payload.messages.at(-1);
    const content = text(last.content);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (last.role === 'user' && content.startsWith('CRON-FIXTURE|')) {
      const { name, args } = JSON.parse(content.slice('CRON-FIXTURE|'.length));
      assert.ok(payload.tools.some(tool => tool.function.name === name));
      res.end(chunk({ role: 'assistant', tool_calls: [{
        index: 0, id: `cron-tool-${requests}`, type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      }] }, 'tool_calls') + 'data: [DONE]\n\n');
    } else res.end(chunk({ role: 'assistant', content: 'CRON FIXTURE COMPLETE' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  } catch (error) {
    errors.push(error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const fixtures = [];
async function until(predicate, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
async function fixture(name, trusted = true) {
  const root = join(directory, name);
  const profile = join(root, 'profile');
  const cwd = join(root, 'project');
  const clock = join(root, 'clock.txt');
  await mkdir(join(profile, 'agent'), { recursive: true });
  await mkdir(join(profile, 'home'));
  await mkdir(cwd);
  await writeFile(clock, String(baseline));
  await writeFile(join(profile, 'config.toml'), [
    'defaultProvider = "fixture"', 'defaultModel = "fixture"', 'permissionPreset = "full-access"',
    'approvalMode = "auto"', 'nonInteractiveApproval = "allow"', 'fullAccessAcknowledged = true',
    '[telemetry]', 'enabled = false', '',
  ].join('\n'));
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl: `${origin}/v1`, api: 'openai-completions', apiKey: 'local-cron-fixture-only',
    models: [{ id: 'fixture', name: 'Cron fixture', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 2048 }],
  } } }));
  if (trusted) await writeFile(join(profile, 'agent/trust.json'), JSON.stringify({ [await realpath(cwd)]: true }));
  const env = { ...isolatedEnvironment(profile), HOME: join(profile, 'home'), USERPROFILE: join(profile, 'home'),
    DESKTOP_CRON_TEST_CLOCK: clock, DESKTOP_CRON_TEST_ORIGIN: origin,
    NODE_OPTIONS: `--require="${resolve('tests/fixtures/cron-clock.cjs').replaceAll('\\', '/')}"` };
  const raw = [];
  const events = [];
  const pool = new SessionRuntimes(event => events.push(event), receive => new RpcProcess(event => { raw.push(event); receive(event); }),
    { launch: worker => broker.attach(worker), dispose: worker => broker.detach(worker) });
  const broker = new SessionCollaboration(pool, join(runtime, 'desktop-sessions.mjs'), () => 'en', () => {});
  await broker.start();
  const f = { pool, broker, cwd, env, profile, clock, raw, events, store: join(cwd, '.stepcode/cron/tasks.json'),
    close: async () => { await pool.stopAll(); await broker.stop(); } };
  fixtures.push(f);
  f.worker = await pool.open(node, entry, cwd, env);
  await until(() => f.worker.cron?.status === 'ready', 'initial native Cron snapshot');
  await f.worker.rpc.request('set_model', { provider: 'fixture', modelId: 'fixture' });
  return f;
}
async function tool(f, name, args) {
  const previousResults = f.worker.messages.filter(message => message.role === 'toolResult' && message.toolName === name).length;
  await f.worker.rpc.request('prompt', { message: 'CRON-FIXTURE|' + JSON.stringify({ name, args }) }, 60000);
  await until(() => !f.pool.isBusy(f.worker) && f.worker.messages.filter(message =>
    message.role === 'toolResult' && message.toolName === name).length > previousResults, name);
  const result = f.worker.messages.findLast(message => message.role === 'toolResult' && message.toolName === name);
  return { result, value: result.isError ? undefined : result.details ?? JSON.parse(text(result.content)) };
}
const results = [];
async function check(name, run) {
  await run();
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  await check('Desktop management creates, lists and deletes native jobs with zero model calls', async () => {
    const f = await fixture('management');
    try {
      const before = requests;
      const manager = new CronManagement(f.pool, async () => ({ jobs: [], trusted: true }), () => {});
      await manager.create({ runtimeId: f.worker.id, cron: '0 9 * * *', prompt: 'management-only-probe', recurring: true, durable: true });
      const result = await manager.list([f.cwd]);
      assert.equal(result.tasks.length, 1);
      assert.equal(result.hosts[0].trusted, true);
      assert.equal(result.tasks[0].prompt, 'management-only-probe');
      assert.equal(result.tasks[0].runtimeId, f.worker.id);
      const record = JSON.parse((await readFile(f.store, 'utf8')).trim());
      assert.equal('sessionId' in record, false);
      assert.equal('title' in record, false);
      assert.ok(record.autoExpireAt);
      await manager.delete(f.worker.id, result.tasks[0].id);
      assert.equal((await manager.list([f.cwd])).tasks.length, 0);
      assert.equal(f.worker.messages.length, 0, 'Management does not add chat/tool history');
      assert.equal(requests, before);
      await assert.rejects(f.worker.rpc.request('desktop_cron', { action: 'create', cron: 'invalid', prompt: 'bad', recurring: true, durable: false }));
      assert.equal((await manager.list([f.cwd])).tasks.length, 0);
    } finally { await f.close(); }
  });
  await check('Desktop management cannot bypass native project trust with Full Access', async () => {
    const f = await fixture('management-untrusted', false);
    try {
      const manager = new CronManagement(f.pool, async () => ({ jobs: [], trusted: false }), () => {});
      await assert.rejects(manager.create({ runtimeId: f.worker.id, cron: '0 9 * * *', prompt: 'untrusted-probe', recurring: true, durable: true }), /trusted/);
      await manager.create({ runtimeId: f.worker.id, cron: '0 9 * * *', prompt: 'session-only-probe', recurring: false, durable: false });
      const result = await manager.list([f.cwd]);
      assert.equal(result.tasks[0].durable, false);
      assert.equal(result.hosts[0].trusted, false);
      await manager.delete(f.worker.id, result.tasks[0].id);
    } finally { await f.close(); }
  });
  for (const durable of [false, true]) {
    await check(`${durable ? 'durable' : 'session'} task retains idle host, fires once, then releases`, async () => {
      const f = await fixture(durable ? 'durable' : 'session');
      try {
        const { result, value } = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'cron-probe', recurring: false, durable });
        assert.ok(!result.isError, text(result.content));
        await until(() => f.worker.cron?.jobs.some(job => job.id === value.id), 'created job snapshot');
        assert.equal(f.worker.cron.jobs[0].durable, durable);
        assert.equal(f.pool.running, true);
        await assert.rejects(f.pool.assertAllIdle(), /Cron/);
        assert.ok(!f.events.some(event => event.statusKey === 'desktop-cron'), 'No raw scheduler JSON in renderer events');
        const updates = f.raw.filter(event => event.statusKey === 'desktop-cron').length;
        await new Promise(resolve => setTimeout(resolve, 1100));
        assert.equal(f.raw.filter(event => event.statusKey === 'desktop-cron').length, updates, 'Unchanged ticks do not flood the stream');
        f.worker.touched = 0;
        f.pool.activeId = undefined;
        await f.pool.recycle();
        assert.equal(f.pool.workers.has(f.worker.id), true);
        await writeFile(f.clock, String(value.nextFireAt + 1));
        await until(() => f.worker.messages.some(message => message.customType === 'step-cron')
          && !f.pool.isBusy(f.worker) && f.worker.cron?.jobs.length === 0, 'native fire and release');
        assert.equal(f.worker.messages.filter(message => message.customType === 'step-cron').length, 1);
        f.worker.touched = 0;
        await f.pool.recycle();
        assert.equal(f.pool.workers.has(f.worker.id), false);
      } finally { await f.close(); }
    });
  }
  await check('native delete releases recurring host without changing shared schema', async () => {
    const f = await fixture('delete');
    try {
      const { value: job } = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'private scheduled text', durable: true });
      const record = JSON.parse((await readFile(f.store, 'utf8')).trim());
      assert.equal('sessionId' in record, false);
      assert.ok(!JSON.stringify(f.worker.cron).includes('private scheduled text'));
      const { value } = await tool(f, 'cron_delete', { id: job.id });
      assert.equal(value.found, true);
      await until(() => f.worker.cron?.jobs.length === 0, 'delete snapshot');
      assert.equal(f.pool.running, false);
      assert.equal(await readFile(f.store, 'utf8'), '');
    } finally { await f.close(); }
  });
  await check('explicitly reopened durable session restores its live scheduling state', async () => {
    const f = await fixture('reopen');
    try {
      const { value: job } = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'reopened-probe', recurring: false, durable: true });
      const state = await f.worker.rpc.request('get_state');
      assert.ok(state.sessionFile);
      await f.pool.remove(f.worker);
      f.worker = await f.pool.open(node, entry, f.cwd, f.env, state.sessionFile);
      assert.equal(f.worker.state.sessionId, state.sessionId);
      await until(() => f.worker.cron?.jobs.some(item => item.id === job.id), 'reopened snapshot');
      assert.equal(f.pool.running, true);
      await writeFile(f.clock, String(job.nextFireAt + 1));
      await until(() => f.worker.messages.some(message => message.customType === 'step-cron')
        && !f.pool.isBusy(f.worker) && f.worker.cron?.jobs.length === 0, 'reopened native fire');
    } finally { await f.close(); }
  });
  await check('native seven-day expiry releases recurring task without auto-recreation', async () => {
    const f = await fixture('expiry');
    try {
      const { value: job } = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'expiry-probe', durable: true });
      assert.ok(job.autoExpireAt);
      await writeFile(f.clock, String(job.autoExpireAt + 1));
      await until(() => f.worker.messages.some(message => message.customType === 'step-cron')
        && !f.pool.isBusy(f.worker) && f.worker.cron?.jobs.length === 0, 'expired native release');
      assert.equal(await readFile(f.store, 'utf8'), '');
      assert.equal(f.pool.running, false);
    } finally { await f.close(); }
  });
  await check('storage lock failure retains host and recovers through native retry', async () => {
    const f = await fixture('storage');
    try {
      const { value: job } = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'locked-probe', recurring: false, durable: true });
      await writeFile(f.store + '.lock', '');
      await writeFile(f.clock, String(job.nextFireAt + 1));
      await until(() => f.worker.cron?.status === 'unavailable', 'failed storage snapshot');
      f.worker.touched = 0;
      f.pool.activeId = undefined;
      await f.pool.recycle();
      assert.equal(f.pool.workers.has(f.worker.id), true);
      assert.equal(f.worker.cron.jobs.length, 1);
      await unlink(f.store + '.lock');
      await until(() => f.worker.cron?.status === 'ready' && f.worker.cron.jobs.length === 0
        && !f.pool.isBusy(f.worker), 'native recovery');
    } finally { await f.close(); }
  });
  await check('untrusted project remains untrusted under Full Access', async () => {
    const f = await fixture('untrusted', false);
    try {
      const { result } = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'must-not-persist', durable: true });
      assert.equal(result.isError, true);
      assert.match(text(result.content), /trusted project/);
      assert.deepEqual(f.worker.cron.jobs, []);
      await assert.rejects(readFile(f.store), { code: 'ENOENT' });
    } finally { await f.close(); }
  });
  await check('explicit trust saves through the native store, requires restart, then permits durable Cron', async () => {
    const f = await fixture('explicit-trust', false);
    const admin = new RpcProcess(() => {});
    admin.start(node, join(runtime, 'admin.mjs'), f.profile, f.env);
    try {
      const callsBefore = requests;
      const save = cwd => admin.request('trust_project', { cwd });
      const cancelled = trustProject(f.pool, f.worker, save, 'en');
      await until(() => f.worker.pendingUI.size === 1, 'trust cancellation prompt');
      f.pool.respondToRequest(f.worker, { id: [...f.worker.pendingUI.keys()][0], confirmed: false });
      assert.deepEqual(await cancelled, { cancelled: true });
      await assert.rejects(readFile(join(f.profile, 'agent/trust.json')), { code: 'ENOENT' });
      const approved = trustProject(f.pool, f.worker, save, 'en');
      await until(() => f.worker.pendingUI.size === 1, 'explicit trust prompt');
      f.pool.respondToRequest(f.worker, { id: [...f.worker.pendingUI.keys()][0], confirmed: true });
      assert.deepEqual(await approved, { saved: true });
      const saved = JSON.parse(await readFile(join(f.profile, 'agent/trust.json'), 'utf8'));
      assert.deepEqual(saved, { [await realpath(f.cwd)]: true });
      assert.equal(requests, callsBefore, 'Trust management never invokes the model');
      const blocked = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'not-active-yet', durable: true });
      assert.equal(blocked.result.isError, true, 'Saved trust must not implicitly change live project resources');
      const previous = await f.worker.rpc.request('get_state');
      await f.pool.remove(f.worker);
      f.worker = await f.pool.open(node, entry, f.cwd, f.env, previous.sessionFile);
      assert.equal(f.worker.state.sessionId, previous.sessionId);
      const { result, value: job } = await tool(f, 'cron_create', { cron: '* * * * *', prompt: 'approved-project', durable: true });
      assert.ok(!result.isError, text(result.content));
      await until(() => f.worker.cron?.jobs.some(item => item.id === job.id), 'trusted durable snapshot');
      await tool(f, 'cron_delete', { id: job.id });
    } finally { await admin.stop(); await f.close(); }
  });
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/cron-runtime.json', JSON.stringify({ commit: manifest.commit, results, requests, directory }, null, 2));
  console.log(`Cron real RPC acceptance passed: ${results.length} cases (local model, controlled clock; not reboot or billing acceptance).`);
} finally {
  for (const f of fixtures) await f.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
