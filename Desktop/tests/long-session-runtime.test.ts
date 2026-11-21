import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PendingMessages, promptNeedsQueue } from '../electron/pending-messages';
import { SessionRuntimes } from '../electron/session-runtimes';
import { isolatedEnvironment } from '../electron/runtime';
import type { RuntimeEvent } from '../src/contracts';

const packagedEntry = resolve('runtime/step/dist/bundle/step.js');
const candidate = process.env.DESKTOP_LONG_SESSION_ENTRY;
const entry = candidate ? resolve(candidate) : packagedEntry;
const index = join(dirname(entry), 'index.js');
// Keep the old pinned runtime usable as a control. An explicit candidate is
// always exercised; a missing or broken candidate must not turn into a skip.
const supportsV018 = async () => {
  const upstream = await import(pathToFileURL(index).href);
  return typeof upstream.SettingsManager.inMemory().getProviderRetrySettings().streamIdleTimeoutMs === 'number';
};

function sendEvent(response: ServerResponse, payload: unknown) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function complete(response: ServerResponse, text: string, api: string, inputTokens = 100) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (api === 'openai-responses') {
    const item = { type: 'message', id: 'msg_long_session', role: 'assistant' };
    sendEvent(response, { type: 'response.created', response: { id: 'resp_long_session' } });
    sendEvent(response, { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    sendEvent(response, { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text });
    sendEvent(response, { type: 'response.output_item.done', output_index: 0, item: {
      ...item, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }],
    } });
    sendEvent(response, { type: 'response.completed', response: { id: 'resp_long_session', status: 'completed',
      usage: { input_tokens: inputTokens, output_tokens: 5, total_tokens: inputTokens + 5, input_tokens_details: { cached_tokens: 0 } },
    } });
    return response.end();
  }
  sendEvent(response, { id: 'long-session', object: 'chat.completion.chunk', model: 'fixture',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: inputTokens, completion_tokens: 5, total_tokens: inputTokens + 5 },
  });
  return response.end('data: [DONE]\n\n');
}

type RecordedRequest = { body: string; response: ServerResponse };
const chinese = '\u4e0a\u4e0b\u6587\u7ed3\u679c';
const ambiguousError = 'The input you provided is invalid [trace_id=fixture code=30003]';
function rejectInput(response: ServerResponse) {
  response.writeHead(400, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { type: 'invalid_request_error', message: ambiguousError } }));
}

async function withRuntime(t: TestContext, options: {
  api?: string; contextWindow?: number; maxTokens?: number; config?: string;
}, run: (fixture: {
  worker: Awaited<ReturnType<SessionRuntimes['open']>>;
  queue: PendingMessages;
  events: RuntimeEvent[];
  requests: RecordedRequest[];
  workspace: string;
  wait: (label: string, check: () => boolean) => Promise<void>;
  answer: (index: number, text: string, inputTokens?: number) => void;
}) => Promise<void>) {
  if (!candidate && (!existsSync(index) || !await supportsV018())) return t.skip('Requires a v0.1.8 runtime');
  assert.ok(await supportsV018(), 'Candidate bundle must provide the v0.1.8 stream idle setting');
  const root = await mkdtemp(join(tmpdir(), 'desktop-v018-long-session-'));
  const profile = join(root, 'profile'), workspace = join(root, 'workspace');
  const requests: RecordedRequest[] = [], events: RuntimeEvent[] = [], errors: unknown[] = [];
  const api = options.api ?? 'openai-completions';
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, 'Bearer v018-long-session-fixture');
      assert.equal(request.url, api === 'openai-responses' ? '/v1/responses' : '/v1/chat/completions');
      let body = '';
      for await (const chunk of request) body += chunk;
      JSON.parse(body);
      requests.push({ body, response });
    } catch (error) { errors.push(error); response.writeHead(500).end(); }
  });
  const queue = new PendingMessages(() => {}, (_worker, error) => errors.push(error));
  const pool = new SessionRuntimes(event => {
    events.push(event);
    const worker = pool.workers.get(event.runtimeId!);
    if (!worker) return;
    if (event.type === 'message_start' && event.message?.role === 'user' && Array.isArray(event.message.content))
      queue.delivered(worker, event.message.content.find((block: { type: string }) => block.type === 'text')?.text ?? '',
        event.message.timestamp);
    queue.runtimeEvent(worker, event);
  });
  const wait = async (label: string, check: () => boolean) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      t.signal.throwIfAborted();
      if (errors.length) throw errors[0];
      if (check()) return;
      await delay(15, undefined, { signal: t.signal });
    }
    const track = events.filter(event => /agent_|compaction|tool_execution/.test(event.type))
      .map(event => [event.type, event.reason, event.willRetry, event.failure?.kind]);
    assert.fail(`Waiting for ${label}; ${requests.length} provider requests; ${JSON.stringify(track)}`);
  };
  try {
    await mkdir(workspace); await mkdir(profile);
    let executable = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
    let cli = entry;
    if (candidate) {
      // Mirror the bundled layout so Windows starts the real process-tree guard.
      const step = join(root, 'runtime/step');
      await cp(resolve(entry, '../..'), join(step, 'dist'), { recursive: true });
      for (const name of ['package.json', 'README.md']) await cp(resolve(entry, '../../..', name), join(step, name));
      await cp(resolve('electron/windows-runtime-job.ps1'), join(root, 'runtime/windows-runtime-job.ps1'));
      cli = join(step, 'dist/bundle/step.js');
      executable = process.execPath;
    }
    await new Promise<void>((ready, reject) => server.once('error', reject).listen(0, '127.0.0.1', ready));
    await writeFile(join(profile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n'
      + 'permissionPreset = "approve-for-me"\n[telemetry]\nenabled = false\n'
      + '[mcp_servers.steppage__steppage]\nenabled = false\n' + (options.config ?? '[retry]\nenabled = false\n[retry.provider]\nmaxRetries = 0\n'));
    await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
      api, apiKey: 'v018-long-session-fixture',
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      models: [{ id: 'fixture', name: 'v018 fixture', contextWindow: options.contextWindow ?? 100000, maxTokens: options.maxTokens ?? 2048 }],
    } } }));
    const worker = await pool.open(executable, cli, workspace, isolatedEnvironment(profile));
    await run({ worker, events, requests, queue, workspace, wait,
      answer: (sequence, text, inputTokens) => complete(requests[sequence].response, text, api, inputTokens) });
    assert.deepEqual(errors, []);
  } finally {
    server.closeAllConnections();
    try { await pool.stopAll(); }
    finally {
      if (server.listening) await new Promise<void>(ready => server.close(() => ready()));
      await rm(root, { recursive: true, force: true });
    }
  }
}

test('an unnamed gateway rejection from a short request does not compact or drain Desktop drafts', { timeout: 30000 }, t =>
  withRuntime(t, {}, async ({ worker, queue, events, requests, wait }) => {
    await worker.rpc.request('prompt', { message: 'Short question' });
    await wait('the first request', () => requests.length === 1);
    queue.enqueue(worker, 'NEXT DRAFT', { message: 'NEXT DRAFT' });
    rejectInput(requests[0].response);
    await wait('native settlement', () => events.some(event => event.type === 'agent_settled'));
    assert.equal(worker.busy, false);
    assert.equal(worker.failed, true);
    assert.equal(requests.length, 1);
    assert.ok(!events.some(event => event.type === 'compaction_start' || event.type === 'desktop_task_completed'));
    assert.deepEqual(queue.list(worker).map(item => item.message), ['NEXT DRAFT']);
  }));

test('unnamed overflow keeps the Desktop turn active through native summary and retry', { timeout: 45000 }, t =>
  withRuntime(t, { contextWindow: 48000, maxTokens: 8192,
    config: '[retry]\nenabled = false\n[retry.provider]\nmaxRetries = 0\n'
      + '[compaction]\ntriggerPolicy = "legacy"\nreserveTokens = 128\nkeepRecentTokens = 1000\n',
  }, async ({ worker, queue, events, requests, wait, answer }) => {
    for (let i = 0; i < 3; i++) {
      await worker.rpc.request('prompt', { message: `History ${i} ${chinese.repeat(3000)}` });
      await wait(`history request ${i}`, () => requests.length === i + 1);
      // Upstream uses the most recent provider usage plus unsent message size.
      answer(i, `Saved history ${i}`, (i + 1) * 11250);
      await wait(`history settlement ${i}`, () => events.filter(event => event.type === 'agent_settled').length === i + 1);
    }
    events.length = 0;
    await worker.rpc.request('prompt', { message: `OVERFLOW TARGET ${chinese.repeat(1100)}` });
    await wait('near-window request', () => requests.length === 4);
    assert.ok(Buffer.byteLength(requests[3].body) > 140000);
    queue.enqueue(worker, 'NEXT DRAFT', { message: 'NEXT DRAFT' });
    rejectInput(requests[3].response);
    await wait('native summary request', () => requests.length === 5 && events.some(event => event.type === 'compaction_start'));
    assert.ok(events.some(event => event.type === 'compaction_start' && event.reason === 'overflow'));
    assert.equal(promptNeedsQueue(worker), true);
    assert.equal(worker.busy, true, 'A rejected attempt is not the end of the Desktop turn');
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 0);
    answer(4, 'Condensed conversation history');
    await wait('native retry', () => requests.length === 6);
    assert.match(requests[5].body, /Condensed conversation history/u);
    assert.ok(Buffer.byteLength(requests[5].body) < Buffer.byteLength(requests[3].body));
    assert.doesNotMatch(requests[5].body, /NEXT DRAFT/u);
    assert.equal(queue.list(worker).length, 1);
    answer(5, 'Recovered long answer');
    await wait('next draft after recovery settlement', () => requests.length === 7);
    assert.match(requests[6].body, /NEXT DRAFT/u);
    assert.ok(events.some(event => event.type === 'agent_settled'));
    answer(6, 'Queued reply');
    await wait('queue drains exactly once', () => !worker.busy && queue.list(worker).length === 0
      && events.filter(event => event.type === 'agent_settled').length === 2);
    assert.equal(requests.length, 7);
  }));

test('a large final tool result triggers native compaction without replaying the tool or exposing trace entries', { timeout: 45000 }, t =>
  withRuntime(t, { contextWindow: 64000, maxTokens: 8192,
    config: '[retry]\nenabled = false\n[retry.provider]\nmaxRetries = 0\n[compaction]\nkeepRecentTokens = 1000\n',
  }, async ({ worker, events, requests, wait, answer, workspace }) => {
    const data = `TOOL-RESULT-MARKER\n${chinese.repeat(3300)}\n`;
    await writeFile(join(workspace, 'large.txt'), data);
    for (let i = 0; i < 2; i++) {
      await worker.rpc.request('prompt', { message: `Older turn ${i} ${chinese.repeat(3000)}` });
      await wait(`older request ${i}`, () => requests.length === i + 1);
      answer(i, `Older reply ${i}`, (i + 1) * 11250);
      await wait(`older settlement ${i}`, () => events.filter(event => event.type === 'agent_settled').length === i + 1);
    }
    events.length = 0;
    await worker.rpc.request('prompt', { message: `READ LARGE RESULT ${chinese.repeat(5900)}` });
    await wait('tool prompt', () => requests.length === 3);
    const response = requests[2].response;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    sendEvent(response, { id: 'large-result', object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, finish_reason: 'tool_calls', delta: { role: 'assistant', tool_calls: [{
        index: 0, id: 'call_large_result', type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'large.txt', max_chars: 25000 }) },
      }] } }],
      usage: { prompt_tokens: 46000, completion_tokens: 50, total_tokens: 46050 },
    });
    response.end('data: [DONE]\n\n');
    await wait('large result and threshold summary', () => requests.length === 4
      && events.some(event => event.type === 'compaction_start' && event.reason === 'threshold'));
    const tools = events.filter(event => event.type === 'tool_execution_end');
    assert.equal(tools.length, 1);
    assert.equal(tools[0].toolName, 'read_file');
    assert.equal(tools[0].isError, false);
    assert.ok(Buffer.byteLength(tools[0].result.content[0].text) > 48000);
    assert.equal(worker.busy, true);
    assert.ok(requests[3].body.includes('context summarization assistant'));
    answer(3, 'Condensed history before the tool');
    // This fixture cuts inside the active turn: history and the turn prefix
    // are summarized separately, then merged before the actor resumes.
    await wait('split-turn prefix summary', () => requests.length === 5);
    assert.ok(requests[4].body.includes('context summarization assistant'));
    answer(4, 'Summary preserving the large tool result');
    await wait('continuation after the threshold summary', () => requests.length === 6);
    assert.ok(requests[5].body.includes('Condensed history before the tool'));
    assert.ok(requests[5].body.includes('Summary preserving the large tool result'));
    assert.ok(requests[5].body.includes('TOOL-RESULT-MARKER'));
    answer(5, 'Read completed after compaction');
    await wait('final tool turn settles', () => events.some(event => event.type === 'agent_settled'));
    assert.equal(worker.busy, false);
    assert.equal(requests.length, 6);
    assert.equal(events.filter(event => event.type === 'tool_execution_start').length, 1);
    assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, 1);
    const journal = (await readFile(worker.state!.sessionFile!, 'utf8')).trim().split(/\r?\n/u).map(line => JSON.parse(line));
    const trace = journal.filter(item => item.type === 'custom' && item.customType === 'step.tool_execution');
    assert.deepEqual(trace.map(item => item.data.phase), ['start', 'end']);
    assert.ok(journal.some(item => item.type === 'custom' && item.customType === 'step.turn'));
    for (const request of requests)
      assert.ok(!/step\.tool_execution|step\.turn|assistantEntryId/u.test(request.body), 'Trace metadata stays out of model input');
  }));

for (const cancel of [false, true]) {
  test(`idle Responses stream ${cancel ? 'stops on cancellation' : 'retries'} without executing an unfinished tool`, { timeout: 30000 }, t =>
    withRuntime(t, { api: 'openai-responses',
      config: `[retry]\nmaxRetries = 1\nbaseDelayMs = 30\n[retry.provider]\nmaxRetries = 0\nstreamIdleTimeoutMs = ${cancel ? 5000 : 650}\n`,
    }, async ({ worker, events, requests, wait, answer, workspace }) => {
      await worker.rpc.request('prompt', { message: 'IDLE RESPONSES' });
      await wait('Responses request', () => requests.length === 1);
      const response = requests[0].response;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      sendEvent(response, { type: 'response.created', response: { id: 'resp_partial' } });
      sendEvent(response, { type: 'response.output_item.added', output_index: 0, item: {
        type: 'function_call', id: 'fc_idle', call_id: 'call_idle', name: 'write_file', status: 'in_progress', arguments: '',
      } });
      sendEvent(response, { type: 'response.function_call_arguments.delta', item_id: 'fc_idle', output_index: 0,
        delta: JSON.stringify({ path: 'must-not-exist.txt', content: 'unexpected execution' }),
      });
      await wait('partial tool reaches Desktop', () => events.some(event => event.type === 'message_update'
        && event.assistantMessageEvent?.type === 'toolcall_delta'));
      if (cancel) {
        worker.interrupted = true;
        await worker.rpc.request('abort');
      } else {
        await wait('one native retry after stream idle', () => requests.length === 2);
        assert.equal(worker.busy, true);
        assert.doesNotMatch(requests[1].body, /call_idle|must-not-exist\.txt/u);
        answer(1, 'Recovered from idle stream');
      }
      await wait('idle scenario settles', () => events.some(event => event.type === 'agent_settled'));
      assert.equal(worker.busy, false);
      assert.equal(requests.length, cancel ? 1 : 2);
      assert.equal(events.filter(event => event.type === 'desktop_task_completed').length, cancel ? 0 : 1);
      assert.equal(events.filter(event => event.type === 'tool_execution_start').length, 0);
      await assert.rejects(readFile(join(workspace, 'must-not-exist.txt')), { code: 'ENOENT' });
    }));
}
