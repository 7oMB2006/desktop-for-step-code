import test from 'node:test';
import assert from 'node:assert/strict';
import { BtwRequests, btwUsage } from '../electron/btw';
import { SessionRuntimes, type SessionRuntime, type WorkerTransport } from '../electron/session-runtimes';
import { RpcCommandError } from '../electron/runtime';
import { quitReasons } from '../electron/quit-review';
import { appendBtwQuote, applyBtwEvent, btwPrompt, MAX_BTW_PROMPT_LENGTH, trimBtwHistory, type BtwEvent, type BtwExchange, type BtwInput } from '../src/btw';
import type { ChatQuote } from '../src/chat-quotes';

const input: BtwInput = { runtimeId: 'worker-1', sessionId: 'session-1', scopeId: 'scope-1', requestId: 'request-1', question: 'Why?' };
function fixture() {
  const calls: { type: string; args?: Record<string, unknown> }[] = [];
  const events: BtwEvent[] = [];
  const worker = { id: input.runtimeId, state: { sessionId: input.sessionId }, operations: 0,
    status: 'connected', busy: false, submissions: 0, pendingUI: new Map(), messages: [], cron: { jobs: [] } } as unknown as SessionRuntime;
  let request = async (_type: string, _args?: Record<string, unknown>) => ({});
  worker.rpc = { request: async (type: string, args?: Record<string, unknown>) => {
    calls.push({ type, args }); return request(type, args);
  } } as WorkerTransport;
  const pool = new SessionRuntimes(() => {});
  pool.workers.set(worker.id, worker);
  const controller = new BtwRequests(pool, event => events.push(event));
  const emit = (value: Partial<BtwEvent> = {}) => controller.event(worker, { ...input, type: 'desktop_btw', kind: 'done', text: 'Answer', ...value });
  return { controller, worker, pool, calls, events, emit,
    respond: (callback: typeof request) => { request = callback; } };
}

test('side question owns host/configuration but leaves foreground task and normal abort independent', async () => {
  const { controller, worker, pool, calls, emit } = fixture();
  try {
    await controller.ask({ ...input, question: ' Why? ', apiKey: 'never-forward', provider: 'wrong' });
    assert.equal(worker.btwActive, true); assert.equal(worker.operations, 1);
    assert.equal(pool.isBusy(worker), false);
    assert.equal(pool.running, true);
    assert.equal(quitReasons(pool, false).runningTasks, 1);
    await assert.rejects(pool.assertIdle(worker), /side question/);
    assert.deepEqual(calls[0], { type: 'desktop_btw', args: { action: 'ask', ...input } });
    await assert.rejects(controller.ask({ ...input, requestId: 'request-2' }), /already running/);
    emit(); emit();
    assert.equal(worker.operations, 0); assert.equal(worker.btwActive, false);
    assert.equal(pool.isBusy(worker), false);
    assert.ok(calls.every(call => call.type === 'desktop_btw'), 'No main prompt or abort is used');
  } finally { controller.dispose(worker); }
});

test('side question validates owners and allowlists events, usage and model metadata', async () => {
  const { controller, worker, events, emit } = fixture();
  try {
    for (const value of [null, {}, { ...input, scopeId: '../x' }, { ...input, sessionId: 'other' },
      { ...input, question: '' }, { ...input, question: 'x'.repeat(8001) }, { ...input, requestId: '\n' }])
      await assert.rejects(controller.ask(value));
    worker.mutating = true;
    await assert.rejects(controller.ask(input));
    worker.mutating = false;
    await controller.ask(input);
    emit({ scopeId: 'old' }); emit({ requestId: 'old' }); emit({ sessionId: 'old' });
    controller.event({ ...worker } as SessionRuntime, { ...input, kind: 'done' });
    assert.equal(events.length, 0);
    controller.event(worker, { ...input, kind: 'start', model: { id: 'actual', name: 'Actual', provider: 'applied', apiKey: 'secret' } });
    assert.deepEqual(events[0].model, { id: 'actual', name: 'Actual', provider: 'applied' });
    controller.event(worker, { ...input, kind: 'error', error: 'SECRET', usage: {
      input: 2, output: 3, cacheRead: 4, cacheWrite: 5, reasoning: 6, totalTokens: 14, cost: { total: 999 }, apiKey: 'secret',
    } });
    assert.deepEqual(events.at(-1)?.usage, { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, reasoning: 6, totalTokens: 14 });
    assert.ok(!JSON.stringify(events).includes('SECRET')); assert.ok(!JSON.stringify(events).includes('secret'));
    assert.equal(worker.operations, 0);
    assert.equal(btwUsage({ input: -1, output: 1, cacheRead: 0, cacheWrite: 0 }), undefined);
    assert.equal(btwUsage({ input: 1, output: NaN, cacheRead: 0, cacheWrite: 0 }), undefined);
    assert.equal(btwUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), undefined,
      'An aborted provider default without reported usage is unknown, not free');
    assert.equal(btwUsage({ input: Number.MAX_SAFE_INTEGER, output: 0, cacheRead: 1, cacheWrite: 0 }), undefined);
  } finally { controller.dispose(worker); }
});

test('cancel is exact-owner, idempotent, and retains host on unconfirmed cancellation', async () => {
  const { controller, worker, calls, events, respond } = fixture();
  try {
    await controller.ask(input);
    await controller.cancel({ ...input, scopeId: 'old' });
    assert.equal(calls.length, 1);
    respond(async () => { throw new Error('transport unavailable'); });
    await assert.rejects(controller.cancel(input));
    assert.equal(worker.operations, 1);
    assert.equal(worker.btwActive, true);
    respond(async () => ({}));
    await controller.cancel(input); await controller.cancel(input);
    assert.equal(worker.operations, 0);
    assert.equal(events.filter(event => event.kind === 'cancelled').length, 1);
  } finally { controller.dispose(worker); }
});

test('unsupported tools use only an allowlisted reason and discard invalid response markup', async () => {
  const { controller, worker, events } = fixture();
  try {
    await controller.ask(input);
    controller.event(worker, { ...input, kind: 'error', reason: 'tools_unavailable', error: 'PRIVATE-PROVIDER-ERROR' });
    assert.equal(events.at(-1)?.reason, 'tools_unavailable');
    assert.ok(!JSON.stringify(events).includes('PRIVATE-PROVIDER'));
    await controller.ask(input);
    controller.event(worker, { ...input, kind: 'error', reason: 'PRIVATE-PROVIDER-ERROR' });
    assert.equal(events.at(-1)?.reason, undefined);
    const exchange: BtwExchange = { requestId: input.requestId, question: 'Find it', answer: '<tool_call>...',
      state: 'running', startedAt: 1000 };
    const rejected = applyBtwEvent(exchange, { ...input, type: 'desktop_btw', kind: 'error', reason: 'tools_unavailable' }, 2000);
    assert.equal(rejected.state, 'error');
    assert.equal(rejected.reason, 'tools_unavailable');
    assert.equal(rejected.answer, '');
    assert.equal(rejected.endedAt, 2000);
    assert.equal(applyBtwEvent(rejected, { ...input, type: 'desktop_btw', kind: 'done', text: 'Late answer' }), rejected);
  } finally { controller.dispose(worker); }
});

test('ambiguous ask acknowledgement is cancelled before releasing ownership; disposal is terminal', async () => {
  const { controller, worker, events, respond } = fixture();
  respond(async () => { throw new Error('timeout with SECRET'); });
  await assert.rejects(controller.ask(input), /reconnect/);
  assert.equal(worker.operations, 1);
  controller.dispose(worker); controller.dispose(worker);
  assert.equal(worker.operations, 0);
  assert.equal(events.length, 1); assert.equal(events[0].kind, 'error');
  respond(async () => { throw new RpcCommandError('not supported'); });
  await assert.rejects(controller.ask(input), /unavailable/);
  assert.equal(worker.operations, 0, 'Deterministic native rejection cannot own an in-flight call');
});

test('clearing another scope cannot cancel an active side question and stale reducer results are ignored', async () => {
  const { controller, worker, calls, respond } = fixture();
  try {
    await controller.ask(input);
    await controller.clear({ ...input, scopeId: 'old' });
    assert.equal(calls.filter(call => call.args?.action === 'cancel').length, 0);
    await controller.clear(input);
    assert.equal(worker.operations, 0);
    assert.deepEqual(calls.slice(-2).map(call => call.args?.action), ['cancel', 'clear']);
    respond(async () => ({}));
  } finally { controller.dispose(worker); }
  const exchange: BtwExchange = { requestId: input.requestId, question: 'Why?', answer: '', state: 'running' };
  const event: BtwEvent = { ...input, type: 'desktop_btw', kind: 'delta', text: 'Part ' };
  assert.equal(applyBtwEvent(exchange, { ...event, requestId: 'old' }), exchange);
  const delta = applyBtwEvent(exchange, event);
  assert.equal(delta.answer, 'Part ');
  const done = applyBtwEvent(delta, { ...event, kind: 'done', text: 'Whole answer' });
  assert.equal(done.state, 'done'); assert.equal(done.answer, 'Whole answer');
  assert.equal(applyBtwEvent(done, { ...event, kind: 'error' }), done);
  assert.equal(applyBtwEvent(exchange, { ...event, text: 'x'.repeat(65000) }).answer.length, 64000);
});

test('visible success retention matches the native followup window even after repeated errors', () => {
  const good = Array.from({ length: 24 }, (_, index): BtwExchange => ({
    requestId: `done-${index}`, question: 'question', answer: 'answer', state: 'done',
  }));
  const bad = Array.from({ length: 24 }, (_, index): BtwExchange => ({
    requestId: `error-${index}`, question: 'question', answer: '', state: 'error',
  }));
  const retained = trimBtwHistory([...good, ...bad]);
  assert.equal(retained.filter(item => item.state === 'done').length, 20);
  assert.equal(retained.filter(item => item.state === 'error').length, 5);
  assert.equal(retained[0].requestId, 'done-4');
  assert.equal(trimBtwHistory(good.map(item => ({ ...item, answer: 'a'.repeat(32000) }))).length, 1);
});

test('side response timing observes only its request and remains settled after late events', () => {
  const exchange: BtwExchange = { requestId: input.requestId, question: 'Why?', answer: '', state: 'running', startedAt: 1000 };
  const event: BtwEvent = { ...input, type: 'desktop_btw', kind: 'delta', text: 'Partial' };
  const delta = applyBtwEvent(exchange, event, 2000);
  assert.equal(delta.startedAt, 1000);
  assert.equal(delta.endedAt, undefined);
  for (const kind of ['done', 'error', 'cancelled'] as const) {
    const settled = applyBtwEvent(delta, { ...event, kind, text: 'Whole answer' }, 3500);
    assert.equal(settled.startedAt, 1000);
    assert.equal(settled.endedAt, 3500);
    assert.equal(settled.answer, kind === 'done' ? 'Whole answer' : 'Partial');
    assert.equal(applyBtwEvent(settled, event, 4000), settled);
  }
});

const quote: ChatQuote = { id: 'quote-1', messageIndex: 3, entryId: 'entry-original', role: 'assistant',
  text: 'Keep this code', markdown: '**Keep** this code\n```ts\nconst x = 1;\n```', startOffset: 0, endOffset: 14 };

test('side quote prompt preserves Markdown and separates references from the actual question', () => {
  for (const language of ['zh', 'en'] as const) {
    const prompt = btwPrompt('  Explain the code  ', [quote], language);
    assert.ok(prompt.includes('> **Keep** this code\n> ```ts\n> const x = 1;\n> ```'));
    assert.ok(prompt.endsWith('Explain the code'));
    for (const hidden of ['entry-original', 'entryId', 'startOffset', 'messageIndex', 'quote-1'])
      assert.ok(!prompt.includes(hidden), 'Only the selected source text is sent, not UI metadata');
  }
  assert.equal(btwPrompt(' Why? ', [], 'en'), 'Why?');
});

test('side quotes deduplicate without modifying the main quote array and enforce combined transport bounds', () => {
  const main = [quote];
  const first = appendBtwQuote([], quote, '', 'en');
  assert.deepEqual(first.quotes, main);
  assert.notEqual(first.quotes, main);
  const duplicate = appendBtwQuote(first.quotes!, { ...quote, id: 'duplicate' }, 'A draft', 'en');
  assert.equal(duplicate.quotes, first.quotes);
  const limit = Array.from({ length: 8 }, (_, index) => ({ ...quote, id: `q${index}`, text: `Quote ${index}` }));
  assert.equal(appendBtwQuote(limit, { ...quote, text: 'New quote' }, '', 'en').error, 'count');
  const overhead = btwPrompt('?', [{ ...quote, markdown: '' }], 'en').length;
  const full = { ...quote, markdown: 'x'.repeat(MAX_BTW_PROMPT_LENGTH - overhead) };
  assert.equal(btwPrompt('?', [full], 'en').length, MAX_BTW_PROMPT_LENGTH);
  assert.ok(appendBtwQuote([], full, '?', 'en').quotes);
  assert.equal(appendBtwQuote([], full, '??', 'en').error, 'length');
  assert.equal(appendBtwQuote([], { ...quote, markdown: 'x'.repeat(20000) }, '', 'en').error, 'length');
  assert.deepEqual(main, [quote]);
});

test('quote identity separates main and side sources, roles, and stable entries after history shifts', () => {
  const side: ChatQuote = { ...quote, origin: 'btw', entryId: 'btw-answer-1' };
  const main = [quote];
  assert.equal(appendBtwQuote(main, side, '', 'en').quotes?.length, 2);
  assert.equal(appendBtwQuote([side], { ...side, messageIndex: 999 }, '', 'en').quotes?.length, 1,
    'Retained entries deduplicate even when earlier exchanges are trimmed');
  assert.equal(appendBtwQuote([side], { ...side, entryId: 'btw-answer-2' }, '', 'en').quotes?.length, 2);
  assert.equal(appendBtwQuote([side], { ...side, role: 'user' }, '', 'en').quotes?.length, 2);
});

test('quoted side exchanges retain the same complete prompt-size history budget as native followups', () => {
  const items = Array.from({ length: 12 }, (_, index): BtwExchange => ({
    requestId: `quoted-${index}`, question: '?', quotes: [quote], promptLength: 8000, answer: 'a', state: 'done',
  }));
  const kept = trimBtwHistory(items);
  assert.equal(kept.length, 7);
  assert.equal(kept[0].requestId, 'quoted-5');
});
