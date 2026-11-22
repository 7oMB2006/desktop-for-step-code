import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { SessionTitles } from '../electron/session-title';
import type { SessionRuntime } from '../electron/session-runtimes';
import { saveProviderAuth } from '../electron/custom-providers';
import { quotePrompt } from '../src/chat-quotes';
import type { ModelIdentity } from '../src/model-favorites';
import type { ProviderApi } from '../src/contracts';

const model = { provider: 'step', id: 'step-3.5-flash-2603', name: 'Flash' };
const reply = (content = 'Inspect preview behavior', finish_reason = 'stop') =>
  Response.json({ choices: [{ finish_reason, message: { content } }] });
function fixture(fetch = async (_url: string, _init: RequestInit) => reply()) {
  const worker = {
    id: 'worker', rpc: {}, status: 'connected', models: [model],
    state: { sessionId: 'first', model: { ...model, id: 'step-5-preview' }, isStreaming: true },
  } as SessionRuntime;
  const state: { enabled: boolean; live: boolean; selected?: ModelIdentity | null; auth: Record<string, unknown> & { step?: {
    type: string; access: string; expires: number; profile: string;
  } } } = {
    enabled: true, live: true, auth: { step: { type: 'oauth', access: 'fixture', expires: Date.now() + 180000, profile: 'step_plan' } },
  };
  const requests: { url: string; init: RequestInit }[] = [];
  const names: string[] = [];
  const titles = new SessionTitles({
    enabled: () => state.enabled, model: () => state.selected, auth: () => state.auth, live: () => state.live,
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

test('a signed-in Plan titles third-party chats without depending on the chat model catalog', async () => {
  for (const [profile, host] of [['step_plan', 'api.stepfun.com'], ['step_plan_oversea', 'api.stepfun.ai']]) {
    const { worker, state, titles, requests, names } = fixture();
    state.auth.step!.profile = profile;
    const chatModel = { provider: 'desktop-custom-fixture', id: 'third-party-chat', name: 'Third-party chat' };
    worker.state!.model = chatModel;
    worker.models = [chatModel];
    titles.register(worker);
    titles.accepted(worker, 'Generate a title on the account, not the chat model');
    titles.accepted(worker, 'Do not title a later prompt');
    await setImmediate();
    assert.deepEqual(names, ['Inspect preview behavior']);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `https://${host}/step_plan/v1/chat/completions`);
    assert.equal(new Headers(requests[0].init.headers).get('authorization'), 'Bearer fixture');
    assert.equal(JSON.parse(String(requests[0].init.body)).model, model.id);
    assert.equal(worker.state!.model, chatModel);
  }
});

test('keeps the existing Open Platform API behavior for official Step chats', async () => {
  const { worker, state, titles, requests, names } = fixture();
  state.auth.step!.profile = 'platform_oversea';
  titles.register(worker);
  titles.accepted(worker, 'Official Step chat using Open Platform');
  await setImmediate();
  assert.deepEqual(names, ['Inspect preview behavior']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.stepfun.ai/v1/chat/completions');
});

test('skips existing and disabled sessions, and keeps Open Platform billing scoped to supported Step chats', () => {
  const { worker, state, titles, requests } = fixture();
  titles.accepted(worker, 'Existing conversation');
  titles.register(worker);
  state.enabled = false;
  titles.accepted(worker, 'Opted out');
  state.enabled = true;
  titles.accepted(worker, 'Do not backfill after turning it on');
  state.auth.step!.profile = 'platform_cn';
  titles.register(worker);
  worker.models = [worker.state!.model!];
  titles.accepted(worker, 'Missing lightweight model');
  titles.register(worker);
  worker.models = [model];
  worker.state!.model = { ...model, provider: 'custom' };
  titles.accepted(worker, 'Do not bill Open Platform for a third-party chat');
  assert.equal(requests.length, 0);
});

test('a third-party chat never uses Plan without a current Plan login', () => {
  const { worker, state, titles, requests } = fixture();
  worker.state!.model = { ...model, provider: 'desktop-custom-fixture' };
  state.auth.step!.expires = Date.now() - 1;
  titles.register(worker);
  titles.accepted(worker, 'Plan login has expired');
  state.auth = {};
  titles.register(worker);
  titles.accepted(worker, 'No Step login');
  assert.equal(requests.length, 0);
});

const manual = { provider: 'desktop-custom-00000000-0000-4000-8000-000000000001', id: 'title-only' };
const titleProvider = (api: ProviderApi, enabled = true, keyless = false) => ({
  id: manual.provider, enabled, keyless, name: 'Title fixture', api, baseUrl: 'https://title-provider.test/prefix/v1',
  models: [{ id: manual.id, name: 'Title model', contextWindow: 4096, maxTokens: 128, reasoning: false, vision: false }],
});

test('manual titles use the exact provider, model, credential and API without a Step login', async () => {
  const cases = [
    ['openai-completions', 'chat/completions', 'authorization', 'Bearer title-key', 'max_tokens', reply()],
    ['openai-responses', 'responses', 'authorization', 'Bearer title-key', 'max_output_tokens',
      Response.json({ status: 'completed', output: [{ type: 'reasoning' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Inspect preview behavior' }] }] })],
    ['anthropic-messages', 'messages', 'x-api-key', 'title-key', 'max_tokens',
      Response.json({ role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'Hidden' },
        { type: 'text', text: 'Inspect preview behavior' }] })],
  ] as const;
  for (const [api, path, header, credential, limit, response] of cases) {
    const { worker, state, titles, requests, names } = fixture(async () => response);
    state.auth = saveProviderAuth({}, titleProvider(api), 'title-key');
    state.selected = manual;
    const chatModel = worker.state!.model;
    titles.register(worker);
    titles.accepted(worker, 'Title this excerpt');
    titles.accepted(worker, 'Do not name again');
    await setImmediate();
    assert.deepEqual(names, ['Inspect preview behavior'], api);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `https://title-provider.test/prefix/v1/${path}`);
    const { init } = requests[0];
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get(header), credential);
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, manual.id);
    assert.equal(body[limit], 128);
    if (api === 'openai-responses') {
      assert.equal(body.input, 'Title this excerpt');
      assert.equal(body.store, false);
    } else {
      assert.deepEqual(body.messages.at(-1), { role: 'user', content: 'Title this excerpt' });
    }
    assert.equal(worker.state!.model, chatModel);
  }
});

test('an unavailable manual model never falls back to Plan or to a same-named model elsewhere', () => {
  const { worker, state, titles, requests } = fixture();
  const provider = titleProvider('openai-completions');
  state.auth = saveProviderAuth(state.auth, { ...provider, id: provider.id.replace(/1$/, '2') }, 'other-key');
  state.selected = manual;
  for (const candidate of [
    undefined, { ...provider, enabled: false }, { ...provider, keyless: true,
      models: [{ ...provider.models[0], declaredOutput: ['image'] }] },
  ]) {
    if (candidate) state.auth = saveProviderAuth(state.auth, candidate, 'title-key');
    titles.register(worker);
    titles.accepted(worker, 'Do not send to any other provider or model');
  }
  assert.equal(requests.length, 0);
});

test('a changed model selection discards the pending result without retrying', async () => {
  let resolve!: (value: Response) => void;
  const { worker, state, titles, requests, names } = fixture(() => new Promise(done => { resolve = done; }));
  state.auth = saveProviderAuth(state.auth, titleProvider('openai-completions', true, true), 'do-not-send');
  state.selected = manual;
  titles.register(worker);
  titles.accepted(worker, 'First prompt');
  assert.equal(new Headers(requests[0].init.headers).has('authorization'), false);
  state.selected = null;
  resolve(reply());
  await setImmediate();
  titles.accepted(worker, 'Do not retry with Plan');
  assert.equal(requests.length, 1);
  assert.deepEqual(names, []);
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
    () => new Response('Title model unavailable', { status: 404 }),
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
