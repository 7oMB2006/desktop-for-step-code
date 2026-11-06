import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BvrBridge, bvrSelection } from '../electron/bvr-bridge';
import type { SessionRuntime, SessionRuntimes } from '../electron/session-runtimes';

const credential = (profile = 'step_plan') => ({ type: 'oauth', access: 'fixture-private-key', profile, expires: Number.MAX_SAFE_INTEGER });
function worker() {
  const source = { id: 'fixture-worker', rpc: { pid: 23456 }, status: 'connected', state: {
    sessionId: 'fixture-session', model: { provider: 'step', id: 'step-5-preview', input: ['text', 'image'] },
  } } as unknown as SessionRuntime;
  source.rpc.request = async () => source.state;
  return source;
}
async function fixture(t: test.TestContext, request: typeof fetch = async () => Response.json({ choices: [{ message: { content: 'research result' } }] })) {
  const root = await mkdtemp(join(tmpdir(), 'dfsc-bvr-'));
  const state = { auth: { step: credential() } as Record<string, unknown>, changing: false, approved: true, confirmations: 0, confirmationMessages: [] as string[] };
  const source = worker();
  const pool = { workers: new Map([[source.id, source]]), confirm: async (_worker: SessionRuntime, _title: string, message: string) => {
    state.confirmations++;
    state.confirmationMessages.push(message);
    return state.approved;
  } } as unknown as SessionRuntimes;
  await mkdir(join(root, 'bvr'));
  const config = join(root, 'bvr', 'config.json');
  await writeFile(config, JSON.stringify({ schemaVersion: 2, mode: 'dfsc', hostAccess: 'confirm' }));
  const bridge = new BvrBridge(root, pool, () => state.auth, () => state.changing, () => 'en', request);
  await bridge.start();
  t.after(async () => { await bridge.stop(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const host = JSON.parse(await readFile(join(root, 'bvr', 'host.json'), 'utf8'));
  const post = async (path: string, data: Record<string, unknown> = {}, headers: Record<string, string> = {}, signal?: AbortSignal) => {
    const response = await fetch(`${host.url}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ runtimePid: source.rpc.pid, ...data }), signal,
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const context = async () => (await post('/context')).body;
  return { root, config, bridge, source, pool, state, post, context, host };
}

test('BVR pairs active credentials with all four official profile endpoints', () => {
  const source = worker();
  for (const [profile, endpoint, channel, region] of [
    ['step_plan', 'https://api.stepfun.com/step_plan/v1', 'plan', 'cn'],
    ['step_plan_oversea', 'https://api.stepfun.ai/step_plan/v1', 'plan', 'global'],
    ['platform_cn', 'https://api.stepfun.com/v1', 'api', 'cn'],
    ['platform_oversea', 'https://api.stepfun.ai/v1', 'api', 'global'],
  ]) {
    const selection = bvrSelection({ step: credential(profile) }, source);
    assert.equal(selection.endpoint, endpoint);
    assert.equal(selection.channel, channel);
    assert.equal(selection.region, region);
    assert.equal(selection.key, 'fixture-private-key');
    assert.equal(selection.model, 'step-5-preview');
  }
  assert.equal(bvrSelection({ step: credential('step') }, source).channel, 'plan');
});

test('BVR rejects missing, expired, ambiguous and non-Step accounts rather than defaulting', () => {
  for (const auth of [{}, { step: { type: 'api_key', key: 'ambiguous' } }, { step: credential('unknown') },
    { step: { ...credential(), expires: 0 } }, { step: { ...credential(), access: '' } }])
    assert.throws(() => bvrSelection(auth, worker()));
  assert.throws(() => bvrSelection({ step: credential() }, worker(), true));
  const source = worker();
  source.state!.model!.provider = 'desktop-custom-fixture';
  assert.throws(() => bvrSelection({ step: credential() }, source), /official Step/);
});

test('BVR requires explicit opt-in, valid loopback token and a resident runtime', async t => {
  const { post, config } = await fixture(t);
  assert.equal((await post('/context', {}, { Authorization: 'Bearer wrong' })).status, 403);
  assert.equal((await post('/context', {}, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post('/context', { runtimePid: 98765 })).status, 403);
  assert.equal((await post('/other')).status, 403);
  await writeFile(config, JSON.stringify({ schemaVersion: 2, mode: 'independent' }));
  assert.equal((await post('/context')).status, 403);
});

test('BVR context is credential-free; approved completions remain on Plan and selected model', async t => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const { context, post, state } = await fixture(t, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ choices: [{ message: { content: 'Plan result' } }] });
  });
  const selected = await context();
  assert.doesNotMatch(JSON.stringify(selected), /fixture-private-key|access|Bearer|endpoint/);
  assert.equal(selected.capabilities.video, true);
  assert.equal(selected.capabilities.asr, true);
  assert.equal(state.confirmations, 0);
  for (const kind of ['text', 'video']) {
    const result = await post('/complete', { revision: selected.revision, kind, prompt: 'research',
      media: kind === 'video' ? { mimeType: 'video/mp4', data: 'YWJjZA==' } : undefined,
      model: 'ignored-attacker-model', endpoint: 'https://api.stepfun.com/v1' });
    assert.equal(result.status, 200);
    assert.equal(result.body.text, 'Plan result');
  }
  assert.equal(state.confirmations, 1);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.stepfun.com/step_plan/v1/chat/completions');
    assert.equal(call.init?.redirect, 'error');
    assert.equal(JSON.parse(String(call.init?.body)).model, 'step-5-preview');
    assert.equal(new Headers(call.init?.headers).get('Authorization'), 'Bearer fixture-private-key');
  }
});

test('BVR denial for text or ASR and unsupported video do not invoke the provider', async t => {
  let calls = 0;
  const { context, post, source, bridge, state } = await fixture(t, async () => { calls++; throw new Error('should not call'); });
  let selected = await context();
  state.approved = false;
  for (const kind of ['text', 'asr']) {
    assert.match((await post('/complete', { revision: selected.revision, kind, prompt: 'research',
      media: kind === 'asr' ? { mimeType: 'audio/wav', data: 'YWJjZA==' } : undefined })).body.error, /not approved/);
  }
  state.approved = true;
  bridge.detach(source);
  source.state!.model!.id = 'unknown-image-only-model';
  selected = await context();
  assert.equal(selected.capabilities.video, false);
  assert.match((await post('/complete', { revision: selected.revision, kind: 'video', prompt: 'research',
    media: { mimeType: 'video/mp4', data: 'YWJjZA==' } })).body.error, /no verified video/);
  assert.equal(calls, 0);
});

test('BVR never retries Plan failure on API and redacts provider error bodies', async t => {
  const urls: string[] = [];
  const { context, post } = await fixture(t, async url => {
    urls.push(String(url));
    return new Response('fixture-private-key raw provider diagnostics', { status: 401 });
  });
  const selected = await context();
  const result = await post('/complete', { revision: selected.revision, kind: 'text', prompt: 'research' });
  assert.match(result.body.error, /HTTP 401/);
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-key|raw provider/);
  assert.deepEqual(urls, ['https://api.stepfun.com/step_plan/v1/chat/completions']);
});

test('BVR rejects stale contexts after account, model, session or transport changes', async t => {
  let calls = 0;
  const { source, state, context, post, bridge } = await fixture(t, async () => { calls++; return Response.json({}); });
  for (const change of [
    () => { state.auth = { step: credential('platform_cn') }; },
    () => { source.state!.model!.id = 'another-model'; },
    () => { source.state!.sessionId = 'another-session'; },
    () => { bridge.detach(source); },
  ]) {
    const selected = await context();
    change();
    assert.equal((await post('/complete', { revision: selected.revision, kind: 'text', prompt: 'research' })).status, 409);
  }
  assert.equal(calls, 0);
});

test('BVR reads the live runtime model, not a stale Desktop snapshot or pending choice', async t => {
  const { context, post, source } = await fixture(t);
  const selected = await context();
  source.pendingModel = { model: { id: 'not-applied', provider: 'step', name: 'pending' } };
  assert.equal((await context()).model, 'step-5-preview');
  const live = { ...source.state, model: { ...source.state!.model!, id: 'step-3.7-flash' } };
  source.rpc.request = async () => live;
  assert.equal((await post('/complete', { revision: selected.revision, kind: 'text', prompt: 'research' })).status, 409);
  assert.equal((await context()).model, 'step-3.7-flash');
  assert.equal(source.state!.model!.id, 'step-5-preview');
});

test('BVR invalidation aborts an in-flight paid request and never returns its result', async t => {
  let entered!: () => void;
  const started = new Promise<void>(done => { entered = done; });
  let aborted = false;
  const { context, post, bridge } = await fixture(t, async (_url, init) => {
    entered();
    await new Promise<void>((_done, fail) => init!.signal!.addEventListener('abort', () => {
      aborted = true; fail(new Error('fixture-private-key transport failure'));
    }, { once: true }));
    throw new Error('unreachable');
  });
  const selected = await context();
  const pending = post('/complete', { revision: selected.revision, kind: 'text', prompt: 'research' });
  await started;
  bridge.invalidate();
  const result = await pending;
  assert.equal(aborted, true);
  assert.notEqual(result.status, 200);
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-key/);
  let accept!: () => void, arrived!: () => void;
  const received = new Promise<void>(done => { arrived = done; });
  const release = new Promise<void>(done => { accept = done; });
  const ignoredAbort = await fixture(t, async () => {
    arrived();
    await release;
    return Response.json({ choices: [{ message: { content: 'late paid result' } }] });
  });
  const prior = await ignoredAbort.context();
  const late = ignoredAbort.post('/complete', { revision: prior.revision, kind: 'text', prompt: 'research' });
  await received;
  ignoredAbort.bridge.invalidate();
  accept();
  const discarded = await late;
  assert.notEqual(discarded.status, 200);
  assert.doesNotMatch(JSON.stringify(discarded), /late paid result/);
});

test('BVR rechecks opt-in and account after confirmation and before returning a response', async t => {
  const { context, post, state, config, pool } = await fixture(t);
  (pool as any).confirm = async () => { await writeFile(config, '{}'); return true; };
  const selected = await context();
  assert.match((await post('/complete', { revision: selected.revision, kind: 'text', prompt: 'research' })).body.error, /revoked/);
  state.changing = true;
  assert.notEqual((await post('/context')).status, 200);
});

for (const [profile, endpoint] of [
  ['step_plan', 'https://api.stepfun.com/step_plan/v1'],
  ['step_plan_oversea', 'https://api.stepfun.ai/step_plan/v1'],
  ['platform_cn', 'https://api.stepfun.com/v1'],
  ['platform_oversea', 'https://api.stepfun.ai/v1'],
]) {
  test(`BVR ${profile} ASR uses its paired endpoint and dedicated model, then the current text model`, async t => {
    const calls: { url: string; init?: RequestInit; body: any }[] = [];
    const { state, post, context } = await fixture(t, async (url, init) => {
      calls.push({ url: String(url), init, body: JSON.parse(String(init!.body)) });
      return String(url).endsWith('/audio/asr/sse')
        ? new Response('data: {"type":"transcript.text.done","text":"fixture transcript"}\n\n')
        : Response.json({ choices: [{ message: { content: 'summary' } }] });
    });
    state.auth = { step: credential(profile) };
    const selected = await context();
    assert.equal(selected.capabilities.asr, true);
    const result = await post('/complete', { revision: selected.revision, kind: 'asr', prompt: 'transcribe',
      media: { mimeType: 'audio/wav', data: 'YWJjZA==' }, model: 'ignored-model', endpoint: 'https://example.invalid' });
    assert.equal(result.status, 200);
    assert.equal(result.body.text, 'fixture transcript');
    const summary = await post('/complete', { revision: selected.revision, kind: 'text', prompt: result.body.text });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.text, 'summary');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${endpoint}/audio/asr/sse`);
    assert.deepEqual(calls[0].body, { audio: { data: 'YWJjZA==', input: {
      transcription: { model: 'stepaudio-2.5-asr', language: 'zh', enable_itn: true }, format: { type: 'wav' },
    } } });
    assert.equal(calls[1].url, `${endpoint}/chat/completions`);
    assert.equal(calls[1].body.model, 'step-5-preview');
    for (const call of calls) {
      assert.equal(call.init?.redirect, 'error');
      assert.equal(new Headers(call.init?.headers).get('Authorization'), 'Bearer fixture-private-key');
    }
    assert.equal(state.confirmations, 1);
    assert.match(state.confirmationMessages[0], /same account and channel.*stepaudio-2\.5-asr/);
  });
}

for (const [profile, endpoint] of [
  ['step_plan', 'https://api.stepfun.com/step_plan/v1'],
  ['step_plan_oversea', 'https://api.stepfun.ai/step_plan/v1'],
]) {
  test(`BVR ${profile} ASR failure never retries on direct API`, async t => {
    const urls: string[] = [];
    const { state, post, context } = await fixture(t, async url => {
      urls.push(String(url));
      return new Response('fixture-private-key raw provider diagnostics', { status: 429 });
    });
    state.auth = { step: credential(profile) };
    const selected = await context();
    const result = await post('/complete', { revision: selected.revision, kind: 'asr', prompt: 'transcribe',
      media: { mimeType: 'audio/wav', data: 'YWJjZA==' } });
    assert.notEqual(result.status, 200);
    assert.match(result.body.error, /Step plan request failed \(HTTP 429\); no fallback was used/);
    assert.doesNotMatch(JSON.stringify(result), /fixture-private-key|raw provider/);
    assert.deepEqual(urls, [`${endpoint}/audio/asr/sse`]);
  });
}
