import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { SessionTitles } from '../electron/session-title';
import type { SessionRuntime } from '../electron/session-runtimes';
import { quotePrompt } from '../src/chat-quotes';

const model = { provider: 'step', id: 'step-3.5-flash-2603', name: 'Flash' };
const reply = (content = 'Inspect preview behavior', finish_reason = 'stop') =>
  Response.json({ choices: [{ finish_reason, message: { content } }] });
function fixture(fetch = async (_url: string, _init: RequestInit) => reply()) {
  const worker = {
    id: 'worker', rpc: {}, status: 'connected', models: [model],
    state: { sessionId: 'first', model: { ...model, id: 'step-5-preview' }, isStreaming: true },
  } as SessionRuntime;
  const state = {
    enabled: true, live: true, auth: { step: { type: 'oauth', access: 'fixture', expires: Date.now() + 180000, profile: 'step_plan' } },
  };
  const requests: { url: string; init: RequestInit }[] = [];
  const names: string[] = [];
  const titles = new SessionTitles({
    enabled: () => state.enabled, auth: () => state.auth, live: () => state.live,
    save: async (_worker, name) => { names.push(name); },
    fetch: async (url, init) => { requests.push({ url, init }); return fetch(url, init); },
  });
  return { worker, state, titles, requests, names };
}

test('generates once from bounded first text on the current Step billing route', async () => {
  const { worker, titles, requests, names } = fixture();
  titles.register(worker);
  titles.accepted(worker, '/init');
  titles.accepted(worker, '  ');
  titles.accepted(worker, `a${'\u4e2d'.repeat(200)}`);
  titles.accepted(worker, 'This is a later prompt.');
  assert.deepEqual(names, [], 'prompt acknowledgement is not blocked by title generation');
  await setImmediate();
  assert.deepEqual(names, ['Inspect preview behavior']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.stepfun.com/step_plan/v1/chat/completions');
  assert.equal(requests[0].init.redirect, 'error');
  const body = JSON.parse(String(requests[0].init.body));
  assert.deepEqual(Object.keys(body), ['model', 'reasoning_effort', 'max_tokens', 'messages']);
  assert.equal(body.model, model.id);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_tokens, 192);
  assert.equal(body.messages.length, 2);
  assert.deepEqual(body.messages[1], { role: 'user', content: `a${'\u4e2d'.repeat(127)}` });
});

test('does not charge for existing sessions, a disabled preference, or unavailable lightweight models', () => {
  const { worker, state, titles, requests } = fixture();
  titles.accepted(worker, 'Existing conversation');
  titles.register(worker);
  state.enabled = false;
  titles.accepted(worker, 'Opted out');
  state.enabled = true;
  titles.accepted(worker, 'Do not backfill after turning it on');
  titles.register(worker);
  worker.models = [worker.state!.model!];
  titles.accepted(worker, 'Missing lightweight model');
  titles.register(worker);
  worker.models = [model];
  worker.state!.model = { ...model, provider: 'custom' };
  titles.accepted(worker, 'Never cross provider boundaries');
  assert.equal(requests.length, 0);
});

test('does not include selected conversation excerpts or their annotations', async () => {
  const { worker, titles, requests } = fixture();
  const quote = { id: 'quote', messageIndex: 0, role: 'assistant' as const, text: 'Old context',
    markdown: 'Old context', annotation: 'My annotation on the context', startOffset: 0, endOffset: 11 };
  titles.register(worker);
  titles.accepted(worker, quotePrompt('', [quote], 'en'));
  titles.accepted(worker, quotePrompt('Inspect these settings', [quote], 'en'));
  await setImmediate();
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)).messages[1], { role: 'user', content: 'Inspect these settings' });
});

test('never writes a late result after manual naming, opting out, or switching identity', async () => {
  for (const invalidation of ['rename', 'disable', 'identity', 'account', 'disconnect'] as const) {
    let resolve!: (value: Response) => void;
    const { worker, state, titles, requests, names } = fixture(() => new Promise(done => { resolve = done; }));
    titles.register(worker);
    titles.accepted(worker, 'First prompt');
    if (invalidation === 'rename') titles.cancel(worker);
    if (invalidation === 'disable') {
      state.enabled = false;
      titles.cancelPending();
      state.enabled = true;
    }
    if (invalidation === 'identity') worker.state!.sessionId = 'different';
    if (invalidation === 'account') state.auth = { ...state.auth };
    if (invalidation === 'disconnect') state.live = false;
    if (['rename', 'disable'].includes(invalidation)) assert.equal(requests[0].init.signal?.aborted, true);
    resolve(reply());
    await setImmediate();
    assert.deepEqual(names, [], invalidation);
  }
});

test('failed, incomplete, and malformed generation keep the first-message fallback without retry', async () => {
  for (const failure of [
    () => new Response('Unavailable', { status: 403 }),
    () => reply('Looks plausible', 'length'),
    () => reply('Two\nlines'),
    () => new Response('x'.repeat(17 * 1024)),
  ]) {
    const { worker, titles, requests, names } = fixture(async () => failure());
    titles.register(worker);
    titles.accepted(worker, 'Use this fallback');
    await setImmediate();
    titles.accepted(worker, 'Do not retry');
    assert.equal(requests.length, 1);
    assert.deepEqual(names, []);
  }
});
