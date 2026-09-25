import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JsonLines, RpcProcess, isolatedEnvironment } from '../electron/runtime';
import { createServer } from 'node:http';

test('JSONL preserves split multibyte characters and CRLF frames', () => {
  const values: any[] = []; const parser = new JsonLines(v => values.push(v));
  const bytes = Buffer.from('{"text":"中文"}\r\n\n{"n":2}\n');
  for (const byte of bytes) parser.push(Buffer.from([byte]));
  assert.deepEqual(values, [{ text: '中文' }, { n: 2 }]);
  assert.throws(() => parser.push(Buffer.from('bad\n')), /Invalid/);
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
    rpc.start(resolve('runtime/node/node.exe'), resolve('runtime/step/dist/bundle/step.js'), dir, env);
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
    admin.start(resolve('runtime/node/node.exe'), resolve('runtime/admin.mjs'), profile, env);
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
test('staged runtime answers RPC and management uses isolated sessions and configuration', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-step-test-'));
  const workspace = join(dir, '项目 with spaces'); await mkdir(workspace);
  const profile = join(dir, 'profile'); await mkdir(join(profile, 'sessions'), { recursive: true });
  await writeFile(join(profile, 'config.toml'), '[telemetry]\nenabled = false\n');
  const env = isolatedEnvironment(profile); const events: any[] = [];
  const rpc = new RpcProcess(e => events.push(e)); const admin = new RpcProcess(() => {});
  try {
    rpc.start(resolve('runtime/node/node.exe'), resolve('runtime/step/dist/bundle/step.js'), workspace, env);
    const state = await rpc.request('get_state', {}, 60000); assert.equal(state.isStreaming, false); assert.ok(state.sessionId);
    assert.deepEqual((await rpc.request('get_messages')).messages, []);
    const models = await rpc.request('get_available_models'); assert.ok(Array.isArray(models.models));
    await rpc.request('set_session_name', { name: 'Integration test' });
    admin.start(resolve('runtime/node/node.exe'), resolve('runtime/admin.mjs'), profile, env);
    const settings = await admin.request('settings', { cwd: workspace }); assert.equal(settings.account.loggedIn, false);
    assert.equal(settings.profiles.length, 4);
    await admin.request('mcp', { name: 'test-server', config: { command: 'node', args: ['server.js'], enabled: false }, secrets: { TOKEN: 'test-secret' } });
    const next = await admin.request('settings', { cwd: workspace }); assert.ok(next.mcp['test-server'].configuredSecrets.includes('TOKEN'));
    assert.equal(JSON.stringify(next).includes('test-secret'), false);
    assert.ok((await readFile(join(profile, 'config.toml'), 'utf8')).includes('test-server'));
    assert.ok(Array.isArray(await admin.request('sessions')));
  } finally { await rpc.stop(); await admin.stop(); }
});
