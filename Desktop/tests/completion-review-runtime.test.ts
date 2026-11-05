import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RpcProcess, isolatedEnvironment } from '../electron/runtime';

const controller = () => import(pathToFileURL(resolve('runtime/step/dist/modes/rpc/desktop-completion-review.js')).href);
type Action = (phase: number, host: any, options: any, emit: (event: any) => void) => Promise<void>;
async function fixture(action?: Action, afterDelivery?: Action) {
  const { DesktopCompletionReview } = await controller();
  const listeners = new Set<(event: any) => void>(), events: any[] = [], prompts: any[] = [], history: any[] = [];
  const emit = (event: any) => { for (const listener of listeners) listener(event); };
  const host = {
    sessionId: 'session-1', model: { id: 'model', provider: 'fixture' }, thinkingLevel: 'medium',
    isStreaming: false, isCompacting: false, pendingMessageCount: 0,
    sessionManager: { getCwd: () => 'workspace', appendCustomEntry: (_: string, value: any) => history.push(structuredClone(value)) },
    subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    async sendCustomMessage(message: any) { history.push(message); },
    async prompt(text: string, options: any) {
      const phase = prompts.length;
      prompts.push({ text, options });
      if (action) await action(phase, host, options, emit);
      options.preflightResult?.(true);
      const message = options.customMessage ? { role: 'custom', content: text, ...options.customMessage } : { role: 'user', content: text };
      emit({ type: 'message_start', message });
      await afterDelivery?.(phase, host, options, emit);
      emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Done' }] } });
      emit({ type: 'agent_end' }); emit({ type: 'agent_settled' });
    },
  };
  let eligible = true;
  const review = new DesktopCompletionReview(() => host, (event: any) => events.push(structuredClone(event)), () => eligible);
  return { review, host, emit, prompts, events, history, ineligible: () => eligible = false };
}
const prompt = (value: Awaited<ReturnType<typeof fixture>>) => value.review.prompt('Ordinary task', { source: 'rpc' });
test('native review controller spends one prompt opportunity and uses upstream non-Git wording', async () => {
  const f = await fixture();
  await prompt(f);
  assert.equal(f.prompts.length, 2);
  assert.match(f.prompts[1].text, /Final self-review: Compare your work with the original visible task/);
  assert.match(f.prompts[1].text, /respect permission denials/);
  assert.ok(!f.prompts[1].text.includes('commit any remaining'));
  assert.equal(f.prompts[1].options.expandPromptTemplates, false);
  assert.equal(f.prompts[1].options.source, 'extension');
  assert.deepEqual(f.events.map(event => event.review.status), ['pending', 'reviewing', 'ended']);
  assert.equal(f.events.at(-1).review.sent, true);
  assert.equal(f.events.at(-1).completed, true);
  assert.equal(f.review.running, false);
});
test('terminal failure, denial and approval guards remain sticky across a later successful assistant', async () => {
  for (const [reason, event] of [
    ['failure', { type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [] } }],
    ['cancelled', { type: 'message_end', message: { role: 'assistant', stopReason: 'aborted', content: [] } }],
    ['denied', { type: 'tool_execution_end', isError: true, result: { terminate: true } }],
    ['approval', { type: 'tool_execution_end', toolName: 'exit_plan_mode', isError: false, result: { details: { outcome: 'external_approval_required' } } }],
  ] as const) {
    const f = await fixture(undefined, async (_phase, _host, _options, emit) => emit(event));
    await prompt(f);
    assert.equal(f.prompts.length, 1, reason);
    assert.equal(f.events.at(-1).review.reason, reason);
    assert.equal(f.events.at(-1).review.sent, false);
    assert.equal(f.events.at(-1).completed, false);
  }
});
test('new explicit input, changed model, queued input and intercepted input never start automatic review', async () => {
  const cases = ['input', 'model', 'queue', 'intercept'] as const;
  for (const kind of cases) {
    const f = await fixture(async (_phase, host, _options) => {
      if (kind === 'input') f.review.skip('input');
      if (kind === 'model') host.model = { id: 'next-model', provider: 'fixture' };
      if (kind === 'queue') host.pendingMessageCount = 1;
    });
    if (kind === 'intercept') f.host.prompt = async (_text: string, options: any) => {
      f.prompts.push({}); options.preflightResult?.(true);
    };
    await prompt(f);
    assert.equal(f.prompts.length, 1, kind);
    assert.equal(f.events.at(-1).review.status, 'skipped');
  }
});
test('cancel during automatic preflight cannot launch a late reviewer', async () => {
  const f = await fixture(async (phase) => { if (phase === 1) f.review.skip('cancelled'); });
  await assert.rejects(prompt(f), /cancelled before delivery/);
  assert.equal(f.events.at(-1).review.status, 'cancelled');
  assert.equal(f.events.at(-1).review.sent, false);
  assert.equal(f.review.running, false);
});
test('cancel during original preflight cannot start a late task or consume its submission', async () => {
  let accepted = false;
  const f = await fixture(async () => f.review.skip('cancelled'));
  await assert.rejects(f.review.prompt('task', { source: 'rpc', preflightResult: (success: boolean) => accepted ||= success }), /cancelled before delivery/);
  assert.equal(accepted, false);
  assert.equal(f.events.at(-1).review.status, 'cancelled');
  assert.equal(f.prompts.length, 1);
});
test('an accepted execution exception leaves an explicit persisted failure, not an invisible pending review', async () => {
  const f = await fixture();
  f.host.prompt = async (_text: string, options: any) => { options.preflightResult?.(true); throw new Error('execution failed'); };
  await assert.rejects(prompt(f), /execution failed/);
  assert.equal(f.events.at(-1).review.status, 'failed');
  assert.equal(f.history.find((entry: any) => entry.customType === 'desktop-completion-review-result')?.details.status, 'failed');
  assert.equal(f.review.running, false);
});
test('an execution exception overrides an earlier benign input skip', async () => {
  const f = await fixture(undefined, async () => { f.review.skip('input'); throw new Error('execution failed'); });
  await assert.rejects(prompt(f), /execution failed/);
  assert.equal(f.events.at(-1).review.status, 'failed');
  assert.equal(f.events.at(-1).review.reason, 'failure');
  assert.equal(f.events.at(-1).completed, false);
  assert.equal(f.review.running, false);
});
test('review delivery must match the structured identity and exact native text', async () => {
  const f = await fixture();
  const ordinary = f.host.prompt.bind(f.host);
  f.host.prompt = async (text: string, options: any) => ordinary(options.customMessage ? 'Transformed by extension' : text, options);
  await prompt(f);
  assert.equal(f.events.at(-1).review.sent, false);
  assert.equal(f.events.at(-1).review.reason, 'intercepted');
  assert.equal(f.events.at(-1).completed, false);
});
test('new input never masks a later cancellation, error, denial or approval handoff', async () => {
  for (const [reason, event] of [
    ['cancelled', { type: 'message_end', message: { role: 'assistant', stopReason: 'aborted', content: [] } }],
    ['failure', { type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [] } }],
    ['denied', { type: 'tool_execution_end', isError: true, result: { terminate: true } }],
    ['approval', { type: 'tool_execution_end', toolName: 'exit_plan_mode', isError: false, result: { details: { outcome: 'external_approval_required' } } }],
  ] as const) {
    const f = await fixture(undefined, async (_phase, _host, _options, emit) => {
      f.review.skip('input'); emit(event);
    });
    await prompt(f);
    assert.equal(f.prompts.length, 1);
    assert.equal(f.events.at(-1).review.reason, reason);
    assert.equal(f.events.at(-1).completed, false);
  }
  for (const reason of ['cancelled', 'rebound'] as const) {
    const f = await fixture(undefined, async () => { f.review.skip('input'); f.review.skip(reason); });
    await prompt(f);
    assert.equal(f.events.at(-1).review.status, 'cancelled');
    assert.equal(f.events.at(-1).review.reason, reason);
  }
});
test('history write failures release ownership with one failed terminal event, never completion', async () => {
  for (const target of ['pending', 'reviewing', 'ended', 'result'] as const) {
    const f = await fixture();
    const append = f.host.sessionManager.appendCustomEntry;
    f.host.sessionManager.appendCustomEntry = (type: string, value: any) => {
      if (target !== 'result' && value.status === target || value.reason === 'persistence') throw new Error('history unavailable');
      return append(type, value);
    };
    if (target === 'result') f.host.sendCustomMessage = async () => { throw new Error('history unavailable'); };
    await assert.rejects(prompt(f), /history unavailable/);
    const terminal = f.events.filter(event => !['pending', 'reviewing'].includes(event.review.status));
    assert.equal(terminal.length, 1, target);
    assert.equal(terminal[0].review.status, 'failed', target);
    assert.equal(terminal[0].review.reason, 'persistence', target);
    assert.equal(terminal[0].completed, false, target);
    assert.equal(f.review.running, false, target);
    assert.equal(f.prompts.length, target === 'pending' ? 0 : target === 'reviewing' ? 1 : 2, target);
  }
});

test('pinned RPC performs one same-route review with tools, persists provenance, and respects queue and cancellation', { timeout: 90000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-review-'));
  const workspace = join(profile, 'workspace'); await mkdir(workspace);
  await writeFile(join(workspace, 'evidence.txt'), 'Review verification evidence');
  const requests: { body: any; auth?: string }[] = [];
  const events: any[] = [];
  let held: ServerResponse | undefined;
  const answer = (response: ServerResponse, delta: any, finish: string | null) => {
    response.write(`data: ${JSON.stringify({ id: 'review-fixture', object: 'chat.completion.chunk', model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(finish ? { usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } } : {}),
    })}\n\n`);
    if (finish) response.end('data: [DONE]\n\n');
  };
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); requests.push({ body, auth: request.headers.authorization });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const content = JSON.stringify(body.messages.at(-1));
    if (content.includes('HOLD-ORIGINAL')) { held = response; answer(response, { content: 'Working' }, null); return; }
    if (content.includes('Final self-review:')) {
      answer(response, { tool_calls: [{ index: 0, id: 'review-read', type: 'function',
        function: { name: 'read', arguments: JSON.stringify({ path: join(workspace, 'evidence.txt') }) } }] }, 'tool_calls');
    } else answer(response, { content: content.includes('Review verification evidence') ? 'Reviewed after reading evidence.' : 'Initial result.' }, 'stop');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(join(profile, 'config.toml'), 'defaultProvider = "fixture"\ndefaultModel = "fixture"\n[telemetry]\nenabled = false\n');
  await writeFile(join(profile, 'models.json'), JSON.stringify({ providers: { fixture: {
    api: 'openai-completions', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    apiKey: 'isolated-review-key', models: [{ id: 'fixture', name: 'Review fixture', contextWindow: 100000, maxTokens: 2048 }],
  } } }));
  const rpc = new RpcProcess(event => events.push(event));
  const wait = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 15000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(predicate(), label);
  };
  const terminals = () => events.filter(event => event.type === 'desktop_completion_review' && !['pending', 'reviewing'].includes(event.review.status));
  const userText = (request: { body: any }) => JSON.stringify(request.body.messages.at(-1));
  try {
    rpc.start(resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node'),
      resolve('runtime/step/dist/bundle/step.js'), workspace, isolatedEnvironment(profile), ['--include-live-events']);
    const state = await rpc.request('get_state');
    assert.equal(state.desktopCompletionReview, 1);
    await rpc.request('set_auto_retry', { enabled: false });
    await rpc.request('prompt', { message: 'DEFAULT-OFF' });
    await wait(() => events.some(event => event.type === 'agent_settled'), 'Default task settles');
    assert.equal(requests.length, 1);
    assert.equal(terminals().length, 0);
    await rpc.request('prompt', { message: 'REVIEW-THIS-TASK', completionReview: true });
    await wait(() => terminals().length === 1, 'Review and tool loop finish');
    assert.equal(terminals()[0].review.status, 'ended');
    assert.equal(terminals()[0].review.sent, true);
    assert.equal(requests.length, 4, 'One original, one review input, one tool continuation');
    assert.equal(requests.filter(request => userText(request).includes('Final self-review:')).length, 1);
    assert.ok(requests.every(request => request.body.model === 'fixture' && request.auth === 'Bearer isolated-review-key'));
    assert.ok(events.some(event => event.type === 'tool_execution_end' && event.toolName === 'read'));
    const stats = await rpc.request('get_session_stats');
    assert.equal(stats.tokens.input, 42 * requests.length);
    assert.equal(stats.tokens.output, 7 * requests.length);
    assert.equal(stats.tokens.total, 49 * requests.length, 'Original, review and tool continuation are counted exactly once');
    const { messages } = await rpc.request('get_messages');
    assert.equal(messages.filter((message: any) => message.role === 'custom' && message.customType === 'desktop-completion-review-input').length, 1);
    const persisted = await readFile((await rpc.request('get_state')).sessionFile, 'utf8');
    assert.match(persisted, /desktop-completion-review-input/);
    assert.match(persisted, /desktop-completion-review-result/);
    assert.match(persisted, /"sent":true/);
    await rpc.request('prompt', { message: 'HOLD-ORIGINAL-QUEUE', completionReview: true });
    await wait(() => Boolean(held), 'Original held before new queued input');
    assert.equal((await rpc.request('get_state')).isStreaming, true);
    await assert.rejects(rpc.request('set_model', { provider: 'fixture', modelId: 'fixture' }), /review/);
    await rpc.request('desktop_completion_review_skip');
    answer(held!, { content: ' done.' }, 'stop');
    await wait(() => terminals().length === 2, 'New input skips pending review');
    assert.equal(terminals()[1].review.reason, 'input');
    assert.equal(terminals()[1].review.sent, false);
    held = undefined;
    await rpc.request('prompt', { message: 'HOLD-ORIGINAL-CANCEL', completionReview: true });
    await wait(() => Boolean(held), 'Cancellable original starts');
    const count = requests.length;
    await rpc.request('abort');
    await wait(() => terminals().length === 3, 'Cancelled review settles');
    assert.equal(terminals()[2].review.status, 'cancelled');
    assert.equal(requests.length, count, 'Cancellation never sends an extra review');
    await assert.rejects(rpc.request('prompt', { message: '/usage', completionReview: true }), /ordinary/);
    await assert.rejects(rpc.request('prompt', { message: 'task', completionReview: false }), /Invalid/);
  } finally {
    await rpc.stop(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(profile, { recursive: true, force: true });
  }
});
