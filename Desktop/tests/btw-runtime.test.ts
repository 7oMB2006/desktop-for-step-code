import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

test('native side questions stream on the applied route, remain transient, and cancel independently of the main task', { timeout: 60000 }, async () => {
  const requests: { body: any; authorization?: string; url?: string }[] = [];
  let held: ServerResponse | undefined;
  const chunk = (response: ServerResponse, content: string, done = false) => {
    response.write(`data: ${JSON.stringify({ id: 'btw-fixture', object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, delta: { content }, finish_reason: done ? 'stop' : null }],
      ...(done ? { usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } } : {}),
    })}\n\n`);
    if (done) response.end('data: [DONE]\n\n');
  };
  const server = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part;
    const parsed = JSON.parse(body);
    requests.push({ body: parsed, authorization: request.headers.authorization, url: request.url });
    const last = parsed.messages.at(-1)?.content;
    const question = typeof last === 'string' ? last : JSON.stringify(last);
    if (question.includes('FAIL-SIDE')) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'PRIVATE-PROVIDER-ERROR-SECRET' } })); return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (question.includes('HOLD-MAIN')) { held = response; chunk(response, 'Main continues.'); return; }
    if (question.includes('HOLD-SIDE')) { chunk(response, 'Partial side answer.'); return; }
    chunk(response, 'Independent ');
    setTimeout(() => { if (!response.destroyed) chunk(response, 'side answer.', true); }, 30);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'desktop-btw-'));
  const workspace = join(profile, 'workspace'); await mkdir(workspace);
  await writeFile(join(profile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'isolated-btw-key',
    models: [{ id: 'fixture', name: 'Applied model', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const events: any[] = [];
  const rpc = new RpcProcess(event => events.push(event));
  const wait = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 15000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(predicate(), `${label}: ${JSON.stringify(events.slice(-3))}`);
  };
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'),
      resolve('runtime/step/dist/bundle/step.js'), workspace, isolatedEnvironment(profile), ['--include-live-events']);
    const state = await rpc.request('get_state');
    const ask = (requestId: string, question: string, scopeId = 'scope-1', sessionId = state.sessionId) =>
      rpc.request('desktop_btw', { action: 'ask', requestId, scopeId, sessionId, question });
    const terminal = (requestId: string) => events.find(event => event.type === 'desktop_btw' && event.requestId === requestId
      && ['done', 'error', 'cancelled'].includes(event.kind));
    await ask('request-1', 'SIDE-QUESTION-ONE');
    await wait(() => terminal('request-1'), 'First side answer finishes');
    const first = terminal('request-1');
    assert.equal(first.kind, 'done');
    assert.equal(first.text, 'Independent side answer.');
    assert.equal(first.usage.input, 42); assert.equal(first.usage.output, 7);
    assert.ok(events.some(event => event.type === 'desktop_btw' && event.kind === 'delta'));
    assert.equal(requests[0].authorization, 'Bearer isolated-btw-key');
    assert.equal(requests[0].url, '/v1/chat/completions');
    assert.equal(requests[0].body.model, 'fixture');
    assert.ok(!requests[0].body.tools?.length, 'Side question has no agent tools');
    assert.deepEqual((await rpc.request('get_messages')).messages, []);
    assert.ok(!events.some(event => ['agent_start', 'agent_end', 'message_start', 'message_update'].includes(event.type)));
    await ask('request-2', 'SIDE-FOLLOWUP');
    await wait(() => terminal('request-2'), 'Followup finishes');
    assert.match(JSON.stringify(requests[1].body.messages), /SIDE-QUESTION-ONE/);
    assert.match(JSON.stringify(requests[1].body.messages), /Independent side answer/);
    await rpc.request('desktop_btw', { action: 'clear', scopeId: 'scope-1' });
    await ask('request-3', 'SIDE-AFTER-CLEAR');
    await wait(() => terminal('request-3'), 'Cleared answer finishes');
    assert.ok(!JSON.stringify(requests[2].body.messages).includes('SIDE-QUESTION-ONE'));
    await assert.rejects(ask('bad-session', 'question', 'scope-1', 'foreign-session'));
    assert.equal(requests.length, 3);
    await rpc.request('prompt', { message: 'HOLD-MAIN' });
    await wait(() => Boolean(held), 'Main task starts');
    assert.equal((await rpc.request('get_state')).isStreaming, true);
    const mainEndCount = events.filter(event => event.type === 'agent_end').length;
    await ask('request-4', 'HOLD-SIDE');
    await wait(() => events.some(event => event.requestId === 'request-4' && event.kind === 'delta'), 'Side streams concurrently');
    assert.match(JSON.stringify(requests.at(-1)?.body.messages), /HOLD-MAIN/, 'Side receives the current main context snapshot');
    await rpc.request('desktop_btw', { action: 'cancel', scopeId: 'scope-1', requestId: 'request-4' });
    await wait(() => terminal('request-4'), 'Side cancellation settles');
    assert.equal(terminal('request-4').kind, 'cancelled');
    assert.equal((await rpc.request('get_state')).isStreaming, true);
    assert.equal(events.filter(event => event.type === 'agent_end').length, mainEndCount, 'Side cancel does not finish main task');
    chunk(held!, ' Main done.', true);
    await wait(() => events.filter(event => event.type === 'agent_end').length > mainEndCount, 'Main completes normally');
    const mainMessages = (await rpc.request('get_messages')).messages;
    assert.ok(!JSON.stringify(mainMessages).includes('SIDE-QUESTION'));
    assert.ok(!JSON.stringify(mainMessages).includes('HOLD-SIDE'));
    const file = (await rpc.request('get_state')).sessionFile;
    const persisted = await readFile(file, 'utf8');
    assert.ok(!persisted.includes('SIDE-QUESTION') && !persisted.includes('HOLD-SIDE'));
    await ask('request-5', 'AFTER-CANCEL');
    await wait(() => terminal('request-5'), 'Next answer after cancel');
    assert.ok(!JSON.stringify(requests.at(-1)?.body.messages).includes('HOLD-SIDE'));
    held = undefined;
    await rpc.request('prompt', { message: 'HOLD-MAIN-ABORT' });
    await wait(() => Boolean(held), 'Second main task starts');
    await ask('request-main-abort', 'HOLD-SIDE-MAIN-ABORT');
    await wait(() => events.some(event => event.requestId === 'request-main-abort' && event.kind === 'delta'), 'Side starts before main abort');
    const beforeAbort = events.filter(event => event.type === 'agent_end').length;
    await rpc.request('abort');
    await wait(() => events.filter(event => event.type === 'agent_end').length > beforeAbort, 'Main abort settles');
    assert.equal((await rpc.request('get_state')).isStreaming, false);
    assert.equal(terminal('request-main-abort'), undefined, 'Main abort does not cancel the independent side request');
    await rpc.request('desktop_btw', { action: 'cancel', scopeId: 'scope-1', requestId: 'request-main-abort' });
    await wait(() => terminal('request-main-abort'), 'Side can still be cancelled after main abort');
    assert.equal(terminal('request-main-abort').kind, 'cancelled');
    await ask('request-6', 'FAIL-SIDE');
    await wait(() => terminal('request-6'), 'Provider failure maps to stable error');
    assert.equal(terminal('request-6').kind, 'error');
    assert.ok(!JSON.stringify(events.filter(event => event.type === 'desktop_btw')).includes('PRIVATE-PROVIDER'));
    await ask('request-7', 'NEW-UI-SCOPE', 'scope-2');
    await wait(() => terminal('request-7'), 'New UI scope finishes');
    assert.ok(!JSON.stringify(requests.at(-1)?.body.messages).includes('SIDE-FOLLOWUP'));
    assert.ok(!JSON.stringify(requests.at(-1)?.body.messages).includes('FAIL-SIDE'));
    await rpc.request('new_session');
    const next = await rpc.request('get_state');
    await ask('request-8', 'NEW-SESSION', 'scope-2', next.sessionId);
    await wait(() => terminal('request-8'), 'New session finishes');
    assert.ok(!JSON.stringify(requests.at(-1)?.body.messages).includes('NEW-UI-SCOPE'));
  } finally {
    await rpc.stop(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
