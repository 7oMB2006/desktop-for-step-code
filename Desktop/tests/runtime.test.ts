import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JsonLines, RpcProcess, RpcCommandError, isolatedEnvironment } from '../electron/runtime';
import { createServer } from 'node:http';
import { permissionFromStatus } from '../electron/permission-status';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

test('Only an explicit negative RPC response is a command rejection, not timeout or disconnect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rpc-rejection-'));
  const entry = join(root, 'fixture.cjs');
  await writeFile(entry, `
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const command = JSON.parse(line);
      if (command.type === 'pending') return;
      process.stdout.write(JSON.stringify({ type: 'response', id: command.id,
        success: command.type === 'ready', error: 'Rejected' }) + '\\n');
    });
  `);
  const rpc = new RpcProcess(() => {});
  try {
    await assert.rejects(rpc.request('ready'), e => e instanceof Error && !(e instanceof RpcCommandError));
    rpc.start(process.execPath, entry, root, isolatedEnvironment(root));
    await rpc.request('ready');
    await assert.rejects(rpc.request('reject'), e => e instanceof RpcCommandError && e.message === 'Rejected');
    await assert.rejects(rpc.request('pending', {}, 20),
      e => e instanceof Error && !(e instanceof RpcCommandError) && e.message.includes('timed out'));
    await rpc.request('ready');
  } finally { await rpc.stop(); }
});

test('POSIX stop waits for cleanup, joins concurrent stops and prevents overlapping restarts', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'rpc-stop-cleanup-'));
  const entry = join(root, 'fixture.cjs');
  await writeFile(entry, `
    const fs = require('node:fs');
    process.on('SIGTERM', () => setTimeout(() => {
      fs.writeFileSync('cleaned.txt', 'cleanup complete'); process.exit(0);
    }, 150));
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const command = JSON.parse(line);
      if (command.type !== 'pending') process.stdout.write(JSON.stringify({ type: 'response', id: command.id, success: true, data: { pid: process.pid } }) + '\\n');
    });
    setInterval(() => {}, 1000);
  `);
  const events: unknown[] = [];
  const rpc = new RpcProcess(event => events.push(event));
  try {
    rpc.start(process.execPath, entry, root, isolatedEnvironment(root));
    const { pid } = await rpc.request('ready');
    const child = (rpc as unknown as { child: ChildProcessWithoutNullStreams }).child;
    const rejected = assert.rejects(rpc.request('pending'), /Runtime stopped/);
    const first = rpc.stop(), second = rpc.stop();
    assert.throws(() => rpc.start(process.execPath, entry, root, isolatedEnvironment(root)), /still stopping/);
    await assert.rejects(rpc.request('ready'), /not connected/);
    await Promise.all([first, second, rejected]);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(await readFile(join(root, 'cleaned.txt'), 'utf8'), 'cleanup complete');
    assert.deepEqual(events, [], 'Intentional shutdown does not emit an unexpected runtime exit');
    rpc.start(process.execPath, entry, root, isolatedEnvironment(root));
    const replacement = rpc.request('ready');
    child.emit('error', new Error('late error from stopped child'));
    assert.notEqual((await replacement).pid, pid);
  } finally { await rpc.stop(); }
});

test('POSIX stop force-kills a child that ignores SIGTERM and waits for its exit', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'rpc-stop-stubborn-'));
  const entry = join(root, 'fixture.cjs');
  await writeFile(entry, `
    process.on('SIGTERM', () => {});
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const command = JSON.parse(line);
      process.stdout.write(JSON.stringify({ type: 'response', id: command.id, success: true, data: { pid: process.pid } }) + '\\n');
    });
    setInterval(() => {}, 1000);
  `);
  const rpc = new RpcProcess(() => {});
  try {
    rpc.start(process.execPath, entry, root, isolatedEnvironment(root));
    const { pid } = await rpc.request('ready');
    const child = (rpc as unknown as { child: ChildProcessWithoutNullStreams }).child;
    await rpc.stop();
    assert.equal(child.signalCode, 'SIGKILL');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await rpc.stop(); }
});

test('real POSIX Step runtime has exited before stop resolves and can then restart', { skip: process.platform === 'win32', timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'rpc-real-stop-'));
  const rpc = new RpcProcess(() => {});
  const node = resolve('runtime/node/node');
  const entry = resolve('runtime/step/dist/bundle/step.js');
  try {
    rpc.start(node, entry, root, isolatedEnvironment(root));
    await rpc.request('get_state');
    const child = (rpc as unknown as { child: ChildProcessWithoutNullStreams }).child;
    const pid = child.pid!;
    await rpc.stop();
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    rpc.start(node, entry, root, isolatedEnvironment(root));
    assert.equal((await rpc.request('get_state')).isStreaming, false);
  } finally { await rpc.stop(); }
});

test('JSONL preserves split multibyte characters and CRLF frames', () => {
  const values: any[] = []; const parser = new JsonLines(v => values.push(v));
  const bytes = Buffer.from('{"text":"中文"}\r\n\n{"n":2}\n');
  for (const byte of bytes) parser.push(Buffer.from([byte]));
  assert.deepEqual(values, [{ text: '中文' }, { n: 2 }]);
  assert.throws(() => parser.push(Buffer.from('bad\n')), /Invalid/);
});
test('an RPC pipe error rejects requests and disconnects without an uncaught stream error', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-step-pipe-'));
  const events: any[] = [];
  const rpc = new RpcProcess(event => events.push(event));
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/step/dist/bundle/step.js'), dir, isolatedEnvironment(dir));
    await rpc.request('get_state', {}, 30000);
    const child = (rpc as unknown as { child: ChildProcessWithoutNullStreams }).child;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    const rejected = assert.rejects(rpc.request('get_messages'), /EPIPE|Runtime stopped/);
    child.stdin.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await rejected;
    await exited;
    assert.ok(events.some(event => event.type === 'desktop_exit' && event.details?.kind === 'rpc-write'));
    await assert.rejects(rpc.request('get_state'), /not connected/);
    // A late error from the released child still has an owner but cannot disconnect a replacement.
    assert.doesNotThrow(() => child.stdin.emit('error', new Error('late pipe error')));
    assert.equal(events.filter(event => event.type === 'desktop_exit').length, 1);
  } finally { await rpc.stop(); }
});

test('real Step runtime streams a local fixture response and restores its persisted session', { timeout: 90000 }, async () => {
  let calls = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* consume request without logging prompts or headers */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (calls++ === 0) {
      const delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture_write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'verified.txt', content: 'tool execution verified' }) } }] };
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    for (const delta of [{ role: 'assistant', content: '' }, { content: 'Local fixture response: ' }, { content: '中文通过' }]) {
      res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    }
    res.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const dir = await mkdtemp(join(tmpdir(), 'desktop-step-stream-'));
  const profile = join(dir, 'profile'); await mkdir(join(profile, 'sessions'), { recursive: true });
  await writeFile(join(profile, 'config.toml'), '[telemetry]\nenabled = false\n');
  const config = join(profile, 'fixture.json');
  await writeFile(config, JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', providers: { fixture: { baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'local-test-only', models: [{ id: 'fixture', name: 'Local fixture', contextWindow: 32768, maxTokens: 2048 }] } } }));
  const env = { ...isolatedEnvironment(profile), STEPCODE_CONFIG_PATH: config, STEP_APPROVAL_MODE: 'confirm' };
  const events: any[] = []; const rpc = new RpcProcess(e => {
    events.push(e);
    if (e.type === 'extension_ui_request' && e.method === 'confirm') rpc.respond({ id: e.id, confirmed: true });
  }); const admin = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/step/dist/bundle/step.js'), dir, env,
      // Streaming frames are ephemeral now; the desktop spawn supplies this flag.
      ['--include-live-events']);
    await rpc.request('get_state', {}, 60000);
    await rpc.request('prompt', { message: 'Reply with a short acknowledgement.' });
    const deadline = Date.now() + 20000;
    while (!events.some(e => e.type === 'agent_end') && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    const history = await rpc.request('get_messages');
    assert.ok(JSON.stringify(history).includes('中文通过'), JSON.stringify(history));
    assert.ok(events.some(e => e.type === 'message_update'));
    assert.ok(events.some(e => e.type === 'extension_ui_request' && e.method === 'confirm'), 'Upstream must request approval');
    assert.equal(await readFile(join(dir, 'verified.txt'), 'utf8'), 'tool execution verified');
    const state = await rpc.request('get_state'); assert.ok(state.sessionFile);
    await rpc.request('set_session_name', { name: 'Persisted fixture' });
    admin.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/admin.mjs'), profile, env);
    const listed = await admin.request('sessions'); assert.ok(listed.some((s: any) => s.id === state.sessionId && s.name === 'Persisted fixture'));
    await rpc.request('new_session'); assert.equal((await rpc.request('get_messages')).messages.length, 0);
    await rpc.request('switch_session', { sessionPath: state.sessionFile });
    assert.ok(JSON.stringify(await rpc.request('get_messages')).includes('中文通过'));
  } finally { await rpc.stop(); await admin.stop(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('isolated runtime removes inherited provider credentials and legacy profile overrides', () => {
  const env = isolatedEnvironment('D:/isolated', { PATH: 'tools', STEP_API_KEY: 'private', OPENAI_API_KEY: 'private', STEPCODE_AUTH_PATH: 'personal', NODE_OPTIONS: '--require malicious.js', USERPROFILE: 'C:/Users/test' });
  assert.equal(env.PATH, 'tools'); assert.equal(env.STEP_API_KEY, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.STEPCODE_AUTH_PATH, 'D:/isolated/auth.json'); assert.equal(env.STEPCODE_LEGACY_AUTH_PATH, 'D:/isolated/legacy-auth.json'); assert.equal(env.NODE_OPTIONS, undefined);
});
test('legacy approval presets are projected as Ask by both draft management and the actual runtime', { timeout: 60000 }, async () => {
  for (const preset of ['read-only', 'bypass', 'autopilot']) {
    const profile = await mkdtemp(join(tmpdir(), 'desktop-permission-migrate-'));
    await mkdir(join(profile, 'sessions'));
    await writeFile(join(profile, 'config.toml'), `permissionPreset = "${preset}"\n[telemetry]\nenabled = false\n`);
    const events: any[] = [];
    const env = isolatedEnvironment(profile);
    const rpc = new RpcProcess(event => events.push(event));
    const admin = new RpcProcess(() => {});
    try {
      admin.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/admin.mjs'), profile, env);
      assert.equal((await admin.request('session_options', { cwd: profile })).permissionPreset, 'ask');
      rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/step/dist/bundle/step.js'), profile, env);
      await rpc.request('get_state', {}, 30000);
      assert.equal(permissionFromStatus(events.filter(event => permissionFromStatus(event)).at(-1)), 'ask');
      assert.equal(events.some(event => event.method === 'select'), false, 'Legacy permissions never imply a Full Access grant');
    } finally { await rpc.stop(); await admin.stop(); }
  }
});
test('acknowledged Full Access still honors explicit deny and confirm tool overrides', { timeout: 60000 }, async () => {
  let calls = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body);
    const tool = payload.messages.at(-1)?.role !== 'tool';
    const delta = tool ? { tool_calls: [{ index: 0, id: `override-${++calls}`, type: 'function',
      function: { name: 'write_file', arguments: '{"path":"override-proof.txt","content":"must not be written"}' } }] }
      : { role: 'assistant', content: 'Override verified.' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: 'override', object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const override of ['deny', 'confirm']) {
      const profile = await mkdtemp(join(tmpdir(), 'desktop-full-access-override-'));
      await writeFile(join(profile, 'config.toml'), 'permissionPreset = "ask"\n[telemetry]\nenabled = false\n');
      await writeFile(join(profile, 'models.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture', providers: {
        fixture: { baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`, api: 'openai-completions', apiKey: 'isolated-test',
          models: [{ id: 'fixture', name: 'Fixture', contextWindow: 32768, maxTokens: 2048 }] },
      } }));
      const events: any[] = [];
      const rpc = new RpcProcess(event => {
        events.push(event);
        if (event.method === 'select' && event.title?.startsWith('Enable full access?')) rpc.respond({ id: event.id, value: event.options[0] });
        if (event.method === 'confirm') rpc.respond({ id: event.id, confirmed: false });
      });
      try {
        rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/step/dist/bundle/step.js'), profile,
          isolatedEnvironment(profile), ['--provider', 'fixture', '--model', 'fixture', '--tool-override', `write_file=${override}`]);
        await rpc.request('get_state');
        await rpc.request('prompt', { message: '/permissions full-access' });
        assert.equal(permissionFromStatus(events.filter(event => permissionFromStatus(event)).at(-1)), 'full-access');
        await rpc.request('prompt', { message: 'Verify explicit tool policy.' });
        const deadline = Date.now() + 15000;
        while (!events.some(event => event.type === 'agent_end') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        assert.ok(events.some(event => event.type === 'agent_end'));
        assert.equal(events.filter(event => event.method === 'confirm').length, override === 'confirm' ? 1 : 0);
        await assert.rejects(readFile(join(profile, 'override-proof.txt')), /ENOENT/);
      } finally { await rpc.stop(); }
    }
    assert.equal(calls, 2, 'Both policy cases received actual model tool calls');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('staged runtime answers RPC and management uses isolated sessions and configuration', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-step-test-'));
  const workspace = join(dir, '项目 with spaces'); await mkdir(workspace);
  const profile = join(dir, 'profile'); await mkdir(join(profile, 'sessions'), { recursive: true });
  await writeFile(join(profile, 'config.toml'), '[telemetry]\nenabled = false\n');
  const env = isolatedEnvironment(profile); const events: any[] = [];
  const rpc = new RpcProcess(e => events.push(e)); const admin = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/step/dist/bundle/step.js'), workspace, env);
    const state = await rpc.request('get_state', {}, 60000); assert.equal(state.isStreaming, false); assert.ok(state.sessionId);
    const commands = (await rpc.request('get_commands')).commands;
    assert.ok(commands.some((command: { name: string; source: string }) => command.name === 'permissions' && command.source === 'extension'));
    assert.ok(events.some(event => permissionFromStatus(event)), 'Startup publishes an upstream permission preset');
    await rpc.request('prompt', { message: '/permissions approve-for-me' });
    assert.ok(events.some(event => permissionFromStatus(event) === 'approve-for-me'));
    const enabling = rpc.request('prompt', { message: '/permissions full-access' });
    const deadline = Date.now() + 15000;
    while (!events.some(event => event.method === 'select' && event.title?.startsWith('Enable full access?')) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 25));
    const risk = events.find(event => event.method === 'select' && event.title?.startsWith('Enable full access?'));
    assert.ok(risk, 'Full Access must require risk acknowledgment');
    rpc.respond({ id: risk.id, value: risk.options[0] });
    await enabling;
    assert.equal(permissionFromStatus(events.filter(event => permissionFromStatus(event)).at(-1)), 'full-access');
    await rpc.request('prompt', { message: '/permissions ask' });
    assert.equal(permissionFromStatus(events.filter(event => permissionFromStatus(event)).at(-1)), 'ask');
    assert.deepEqual((await rpc.request('get_messages')).messages, []);
    const models = await rpc.request('get_available_models'); assert.ok(Array.isArray(models.models));
    await rpc.request('set_session_name', { name: 'Integration test' });
    admin.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'), resolve('runtime/admin.mjs'), profile, env);
    const settings = await admin.request('settings', { cwd: workspace }); assert.equal(settings.account.loggedIn, false);
    assert.equal(settings.profiles.length, 4);
    await admin.request('mcp', { name: 'test-server', config: { command: 'node', args: ['server.js'], enabled: false }, secrets: { TOKEN: 'test-secret' } });
    const next = await admin.request('settings', { cwd: workspace }); assert.ok(next.mcp['test-server'].configuredSecrets.includes('TOKEN'));
    assert.equal(JSON.stringify(next).includes('test-secret'), false);
    assert.ok((await readFile(join(profile, 'config.toml'), 'utf8')).includes('test-server'));
    assert.ok(Array.isArray(await admin.request('sessions')));
  } finally { await rpc.stop(); await admin.stop(); }
});
