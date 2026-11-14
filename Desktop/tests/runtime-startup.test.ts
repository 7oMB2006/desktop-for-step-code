import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';
import { runtimeStartup, startupBlocked, startupWaiting, type RuntimeStartup } from '../src/runtime-startup';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

const runtime = resolve('runtime');
const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const entry = join(runtime, 'step/dist/bundle/step.js');
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, timeout = 15000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() >= end) throw new Error('Startup fixture did not reach its expected state');
    await delay(25);
  }
}
async function fixture(t: test.TestContext, kind: 'slow' | 'missing' | 'timeout') {
  const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
  assert.ok(manifest.patches.includes('desktop-async-startup'), 'Requires the actual staged startup patch');
  const root = await mkdtemp(join(tmpdir(), 'desktop-startup-protocol-'));
  const started = join(root, 'mcp-started.log');
  await mkdir(join(root, 'sessions'));
  const payloads: unknown[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    payloads.push(JSON.parse(body));
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({
      id: 'startup-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(chunk({ role: 'assistant', content: 'Startup fixture completed.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'fixture-not-a-real-key',
    models: [{ id: 'fixture', name: 'Startup fixture', contextWindow: 32768, maxTokens: 1024 }],
  } } }));
  await writeFile(join(root, 'config.toml'), [
    'defaultProvider = "fixture"', 'defaultModel = "fixture"', '[telemetry]', 'enabled = false',
    '[mcp_servers."steppage__steppage"]', 'enabled = false',
    '[mcp_servers.startup_fixture]', 'enabled = true', `startup_timeout_sec = ${kind === 'timeout' ? 1 : 20}`,
    `command = ${JSON.stringify(kind === 'missing' ? join(root, 'does-not-exist.exe') : node)}`,
    `args = [${JSON.stringify(resolve('tests/fixtures/startup-mcp.mjs'))}]`,
    '[mcp_servers.startup_fixture.env]', `FIXTURE_MCP_STARTED = ${JSON.stringify(started)}`,
    `FIXTURE_MCP_DELAY_MS = "${kind === 'slow' ? 5000 : 0}"`,
    `FIXTURE_MCP_NEVER = "${kind === 'timeout' ? 1 : 0}"`,
  ].join('\n') + '\n');
  const rpc = new RpcProcess(() => {});
  t.after(async () => {
    try { await rpc.stop(); }
    finally {
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
      await removeTestProfile(root);
    }
  });
  const runtimeId = randomUUID(), revision = randomUUID();
  const start = performance.now();
  rpc.start(node, entry, root, { ...isolatedEnvironment(root), HOME: root, USERPROFILE: root,
    DFSC_ASYNC_STARTUP_V1: '1', DFSC_RUNTIME_ID: runtimeId, DFSC_CONFIGURATION_REVISION: revision });
  const state = () => rpc.request('desktop_startup', { action: 'state' }) as Promise<RuntimeStartup>;
  const core = await rpc.request('get_state');
  const coreMs = performance.now() - start;
  assert.ok(runtimeStartup(core.desktopStartup, runtimeId));
  assert.equal(core.desktopStartup.targetBound, false);
  assert.equal(existsSync(started), false, 'The temporary session cannot start MCP before explicit binding');
  await rpc.request('new_session');
  const next = await state();
  assert.notEqual(next.startupEpoch, core.desktopStartup.startupEpoch);
  assert.equal(existsSync(started), false, 'Replacing the temporary session still cannot start MCP');
  const identity = { sessionId: next.sessionId, startupEpoch: next.startupEpoch };
  await rpc.request('prompt', { message: '/permissions ask' });
  assert.equal((await rpc.request('get_state')).pendingMessageCount, 0);
  await rpc.request('desktop_startup', { action: 'bind', ...identity });
  await rpc.request('desktop_startup', { action: 'model', ...identity });
  return { rpc, root, started, state, coreMs, identity, payloads };
}

test('startup validation distinguishes terminal discovery failure from waiting and keeps cleanup fail-closed', () => {
  const state: RuntimeStartup = { protocol: 1, runtimeId: randomUUID(), sessionId: 'one', startupEpoch: randomUUID(),
    configurationRevision: randomUUID(), catalogRevision: 0, targetBound: true, modelReady: true,
    cleanupConfirmed: true, discovery: 'ready', tools: [], coreReadyAt: Date.now() };
  assert.ok(runtimeStartup(state, state.runtimeId, 'one'));
  assert.equal(startupBlocked(state), false);
  assert.equal(runtimeStartup({ ...state, cleanupConfirmed: undefined }, state.runtimeId), undefined);
  assert.equal(runtimeStartup(state, randomUUID()), undefined);
  assert.equal(startupWaiting({ ...state, discovery: 'failed' }), false);
  assert.equal(startupBlocked({ ...state, discovery: 'failed' }), true);
  assert.equal(startupBlocked({ ...state, cleanupConfirmed: false }), true);
});

test('real native core and management stay responsive while MCP connects; rejected execution cannot append or queue',
  { timeout: 45000 }, async t => {
    const f = await fixture(t, 'slow');
    assert.ok(f.coreMs < 5000, `Core ${f.coreMs}ms must not wait for the 5s MCP handshake`);
    await until(f.state, state => state.discovery === 'ready');
    assert.ok((await f.state()).tools.some(tool => tool.status === 'connecting'));
    await f.rpc.request('prompt', { message: '/plan on' });
    const planning = await f.rpc.request('get_entries');
    assert.equal(planning.entries.findLast((entry: { customType?: string }) => entry.customType === 'step-plan')?.data.enabled, true);
    await assert.rejects(f.rpc.request('prompt', { message: '/plan MUST_NOT_APPEND' }), /STARTUP_NOT_READY/);
    await assert.rejects(f.rpc.request('prompt', { message: '/plan approve' }), /STARTUP_NOT_READY/);
    await f.rpc.request('prompt', { message: '/plan off' });
    const before = await f.rpc.request('get_entries');
    for (const [type, args] of [
      ['prompt', { message: 'MUST_NOT_APPEND' }], ['steer', { message: 'MUST_NOT_QUEUE' }],
      ['follow_up', { message: 'MUST_NOT_QUEUE' }], ['compact', {}], ['bash', { command: 'echo MUST_NOT_RUN' }],
    ] as const) await assert.rejects(f.rpc.request(type, args), /STARTUP_NOT_READY/);
    assert.deepEqual(await f.rpc.request('get_entries'), before);
    assert.equal((await f.rpc.request('get_state')).pendingMessageCount, 0);
    assert.equal(f.payloads.length, 0);
    const ready = await until(f.state, state => state.tools.every(tool => !['connecting', 'pending'].includes(tool.status)));
    assert.ok(ready.tools.some(tool => tool.name === 'startup_fixture' && tool.status === 'connected'));
    await f.rpc.request('prompt', { message: 'ONE_ACCEPTED_TASK' });
    await until(async () => ({ count: f.payloads.length, state: await f.rpc.request('get_state') }),
      value => value.count === 1 && !value.state.isStreaming);
    assert.equal(f.payloads.length, 1);
    assert.equal((await f.state()).firstPromptAcceptedAt !== undefined, true);
    console.log(JSON.stringify({ coreMs: f.coreMs, slowMcpMs: 5000, providerRequests: f.payloads.length }));
  });

test('real native missing executable needs exact one-shot consent; timeout cleanup cannot be excluded across epochs',
  { timeout: 60000 }, async t => {
    const missing = await fixture(t, 'missing');
    const state = await until(missing.state, state => state.discovery === 'ready'
      && state.tools.every(tool => !['connecting', 'pending'].includes(tool.status)));
    assert.equal(state.cleanupConfirmed, true);
    assert.deepEqual(state.tools.filter(tool => tool.status === 'failed').map(tool => tool.name), ['startup_fixture']);
    const command = { message: 'EXPLICITLY_ACCEPTED_WITHOUT_MISSING_TOOL' };
    const before = await missing.rpc.request('get_entries');
    await assert.rejects(missing.rpc.request('prompt', command), /STARTUP_NOT_READY/);
    assert.deepEqual(await missing.rpc.request('get_entries'), before);
    const authorize = { action: 'authorize', ...missing.identity, catalogRevision: state.catalogRevision,
      submissionId: randomUUID(), digest: createHash('sha256').update(JSON.stringify(['prompt', command])).digest('hex'),
      missing: ['startup_fixture'] };
    const receipt = await missing.rpc.request('desktop_startup', authorize);
    await assert.rejects(missing.rpc.request('prompt', { message: 'CHANGED_TASK', startupApproval: receipt }), /STARTUP_NOT_READY/);
    await missing.rpc.request('prompt', { ...command, startupApproval: receipt });
    await until(async () => ({ count: missing.payloads.length, state: await missing.rpc.request('get_state') }),
      value => value.count === 1 && !value.state.isStreaming);
    assert.equal(missing.payloads.length, 1);
    await assert.rejects(missing.rpc.request('prompt', { ...command, startupApproval: receipt }), /STARTUP_NOT_READY/);
    await assert.rejects(missing.rpc.request('desktop_startup', authorize), /STARTUP_NOT_READY/);
    assert.equal(missing.payloads.length, 1);

    const timeout = await fixture(t, 'timeout');
    const failed = await until(timeout.state, state => state.tools.some(tool => tool.status === 'failed'));
    assert.equal(failed.cleanupConfirmed, false);
    await assert.rejects(timeout.rpc.request('desktop_startup', { ...authorize, ...timeout.identity,
      catalogRevision: failed.catalogRevision, submissionId: randomUUID() }), /STARTUP_NOT_READY/);
    await timeout.rpc.request('new_session');
    const next = await timeout.state();
    assert.notEqual(next.startupEpoch, failed.startupEpoch);
    assert.equal(next.cleanupConfirmed, false, 'Only replacing the runtime process may clear uncertain cleanup');
    await assert.rejects(timeout.rpc.request('prompt', { message: 'MUST_NOT_BYPASS_NEW_EPOCH' }), /STARTUP_NOT_READY/);
    assert.equal(timeout.payloads.length, 0);
  });
