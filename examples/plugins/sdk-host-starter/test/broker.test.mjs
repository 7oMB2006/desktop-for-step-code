import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter, once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HOST_ENV } from '../../host-client/protocol.mjs';

async function service(t, approved, options = {}) {
  const helper = await mkdtemp(join(tmpdir(), 'dfsc-host-sdk-service-'));
  const cleanups = [];
  let client;
  t.after(async () => {
    try { await client?.close(); }
    finally {
      try { for (const cleanup of cleanups.reverse()) await cleanup(); }
      finally { await rm(helper, { recursive: true, force: true, maxRetries: 5 }); }
    }
  });
  // Compile the actual main-process service, not the offline mock host.
  const entry = join(helper, 'service.mjs');
  await build({ entryPoints: [resolve('../../../Desktop/tests/fixtures/plugin-host-service.ts')],
    outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'node24' });
  const { hostService } = await import(pathToFileURL(entry).href);
  const { serverEntry, ...configuration } = options;
  const packageDirectory = serverEntry ? join(helper, 'speech-package') : resolve('plugins/dfsc-host-example');
  if (serverEntry) await build({ entryPoints: [serverEntry], outfile: join(packageDirectory, 'dist/server.mjs'),
    bundle: true, platform: 'node', format: 'esm', target: 'node24',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const fixture = await hostService({ after: cleanup => cleanups.push(cleanup) },
    { ...configuration, packageDirectory });
  fixture.state.approved = approved;
  const launch = await fixture.broker.issue(fixture.descriptor, fixture.worker);
  client = new Client({ name: 'dfsc-host-broker-acceptance', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, cwd: fixture.root,
    args: [join(fixture.directory, 'dist/server.mjs')], stderr: 'pipe',
    env: { [HOST_ENV]: JSON.stringify(launch) } });
  const messages = [], send = transport.send.bind(transport);
  transport.send = (message, ...options) => {
    messages.push(structuredClone(message));
    return send(message, ...options);
  };
  let stderr = '';
  transport.stderr?.on('data', bytes => { stderr += bytes.toString(); });
  await client.connect(transport);
  return { fixture, client, launch, messages, stderr: () => stderr };
}
test('actual SDK tools cross the main broker with explicit consent and fixed Step routing, without key readback', async t => {
  const { fixture, client, launch, stderr } = await service(t, true);
  assert.equal((await client.listTools()).tools.length, 2);
  const context = await client.callTool({ name: 'host_context', arguments: {} });
  assert.equal(JSON.parse(context.content[0].text).capabilities[0].model, 'step-5-preview');
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.state.confirmations.length, 0);
  const result = await client.callTool({ name: 'summarize_text', arguments: { text: 'offline fixture' } });
  assert.equal(result.content[0].text, 'host result');
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.state.confirmations.length, 1);
  assert.equal(fixture.calls[0].url, 'https://api.stepfun.com/step_plan/v1/chat/completions');
  fixture.broker.invalidate();
  const revoked = await client.callTool({ name: 'host_context', arguments: {} });
  assert.equal(revoked.content[0].text, 'dfsc-host:STALE_CONTEXT');
  assert.doesNotMatch(JSON.stringify([context, result, revoked, stderr()]),
    new RegExp(`${launch.broker.token}|fixture-main-private-key`));
});
test('declining the actual SDK tool confirmation makes no provider request and does not silently ask again', async t => {
  const { fixture, client } = await service(t, false);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.callTool({ name: 'summarize_text', arguments: { text: 'not uploaded' } });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'dfsc-host:DENIED');
  }
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.state.confirmations.length, 1);
});
test('actual SDK speech tool receives audio through the production adapter only after TTS consent', async t => {
  const bytes = Buffer.from('isolated audio fixture');
  const { fixture, client, launch, stderr } = await service(t, true, { capabilities: ['model.tts'],
    serverEntry: resolve('test/fixtures/speech-server.mjs'),
    request: async () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }) });
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['synthesize_speech']);
  assert.equal(fixture.calls.length, 0, 'MCP discovery is not a model request or a spending grant');
  for (const format of ['mp3', 'wav', 'pcm']) {
    const result = await client.callTool({ name: 'synthesize_speech',
      arguments: { text: 'isolated fixture', voice: 'cixingnansheng', format } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.content, [{ type: 'audio', data: bytes.toString('base64'),
      mimeType: { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm' }[format] }]);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(`${launch.broker.token}|fixture-main-private-key`));
  }
  assert.equal(fixture.state.confirmations.length, 1);
  assert.match(fixture.state.confirmations[0], /model.tts.*stepaudio-2.5-tts/su);
  assert.equal(fixture.calls.length, 3);
  assert.ok(fixture.calls.every(call => call.url === 'https://api.stepfun.com/step_plan/v1/audio/speech'));
  fixture.broker.invalidate();
  const stale = await client.callTool({ name: 'synthesize_speech',
    arguments: { text: 'not sent', voice: 'cixingnansheng', format: 'wav' } });
  assert.equal(stale.isError, true);
  assert.equal(stale.content[0].text, 'dfsc-host:STALE_CONTEXT');
  assert.equal(fixture.calls.length, 3);
  assert.equal(stderr(), '');
});
test('actual SDK speech tool cannot consume quota after declined authorization', async t => {
  const { fixture, client } = await service(t, false, { capabilities: ['model.tts'],
    serverEntry: resolve('test/fixtures/speech-server.mjs') });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.callTool({ name: 'synthesize_speech',
      arguments: { text: 'not sent', voice: 'cixingnansheng', format: 'wav' } });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'dfsc-host:DENIED');
  }
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.state.confirmations.length, 1);
});
test('MCP cancellation dismisses pending consent without a grant, and a new request requires fresh approval',
  { timeout: 15000 }, async t => {
    const { fixture, client, messages } = await service(t, true);
    const events = new EventEmitter();
    fixture.state.confirm = signal => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve(false), { once: true });
      events.emit('confirmation', signal);
    });
    const entered = once(events, 'confirmation', { signal: AbortSignal.timeout(5000) });
    const controller = new AbortController();
    const pending = client.callTool({ name: 'summarize_text', arguments: { text: 'cancel before approval' } },
      undefined, { signal: controller.signal, timeout: 10000 });
    const rejected = assert.rejects(pending, /fixture-mcp-cancel/);
    const [signal] = await entered;
    const cancelled = once(signal, 'abort', { signal: AbortSignal.timeout(5000) });
    controller.abort(new Error('fixture-mcp-cancel'));
    await rejected;
    await cancelled;
    assert.equal(signal.reason.code, 'CANCELLED');
    const call = messages.find(message => message.method === 'tools/call');
    const notice = messages.find(message => message.method === 'notifications/cancelled');
    assert.equal(notice.params.requestId, call.id);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.state.confirmations.length, 1);
    fixture.state.confirm = undefined;
    const result = await client.callTool({ name: 'summarize_text', arguments: { text: 'approve a new request' } });
    assert.equal(result.content[0].text, 'host result');
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.state.confirmations.length, 2);
  });
test('MCP cancellation aborts an in-flight provider request without changing routes or falling back',
  { timeout: 15000 }, async t => {
    const events = new EventEmitter();
    let requests = 0;
    const { fixture, client, messages } = await service(t, true, { request: async (_url, init) => {
      if (++requests > 1) return new Response(null, { status: 503 });
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        events.emit('provider', init.signal);
      });
    } });
    const entered = once(events, 'provider', { signal: AbortSignal.timeout(5000) });
    const controller = new AbortController();
    const pending = client.callTool({ name: 'summarize_text', arguments: { text: 'cancel after approval' } },
      undefined, { signal: controller.signal, timeout: 10000 });
    const rejected = assert.rejects(pending, /fixture-mcp-cancel/);
    const [signal] = await entered;
    const cancelled = once(signal, 'abort', { signal: AbortSignal.timeout(5000) });
    controller.abort(new Error('fixture-mcp-cancel'));
    await rejected;
    await cancelled;
    assert.equal(signal.reason.code, 'CANCELLED');
    const call = messages.find(message => message.method === 'tools/call');
    const notice = messages.find(message => message.method === 'notifications/cancelled');
    assert.equal(notice.params.requestId, call.id);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.state.confirmations.length, 1);
    const failed = await client.callTool({ name: 'summarize_text', arguments: { text: 'provider failure stays on its route' } });
    assert.equal(failed.isError, true);
    assert.equal(failed.content[0].text, 'dfsc-host:PROVIDER_FAILED');
    assert.equal(fixture.calls.length, 2);
    assert.ok(fixture.calls.every(call => call.url === 'https://api.stepfun.com/step_plan/v1/chat/completions'));
    assert.equal(fixture.state.confirmations.length, 1);
  });
