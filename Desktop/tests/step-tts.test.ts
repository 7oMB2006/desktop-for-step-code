import assert from 'node:assert/strict';
import test from 'node:test';
import { STEP_TTS_MODEL, supportsStepTts, synthesizeStepSpeech } from '../electron/step-tts';
import { HostClientError, LIMITS } from '../../examples/plugins/host-client/protocol.mjs';
import type { StepAccount } from '../electron/step-model-account';
import type { Inputs } from '../../examples/plugins/host-client/protocol.mjs';

const account = (): StepAccount => ({ key: 'fixture-private-key', expires: Date.now() + 3600000,
  channel: 'plan', region: 'cn', endpoint: 'https://api.stepfun.com/step_plan/v1' });
const input: Inputs['model.tts'] = { text: 'fixture speech', voice: 'cixingnansheng', format: 'wav' };
const signal = () => new AbortController().signal;
const audio = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
const response = () => new Response(audio, { headers: { 'content-type': 'audio/wav' } });

test('TTS model allowlist follows documented regions without deprecated or guessed model aliases', () => {
  for (const region of ['cn', 'global'] as const) {
    for (const model of [STEP_TTS_MODEL, 'stepaudio-3-tts'])
      assert.equal(supportsStepTts({ region }, model), true);
    for (const model of ['step-tts-2', 'step-tts-mini'])
      assert.equal(supportsStepTts({ region }, model), region === 'cn');
    for (const model of ['step-5-preview', 'step-tts-vivid', 'unknown', ''])
      assert.equal(supportsStepTts({ region }, model), false);
  }
});
test('TTS maps only the narrow input to the selected account route and returns unchanged inline bytes', async () => {
  let calls = 0;
  const result = await synthesizeStepSpeech(account(), input, signal(), async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.stepfun.com/step_plan/v1/audio/speech');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-private-key');
    assert.equal(new Headers(init?.headers).get('accept'), 'audio/wav');
    assert.deepEqual(JSON.parse(String(init?.body)), { model: STEP_TTS_MODEL, input: input.text,
      voice: input.voice, response_format: 'wav', stream: false, return_url: false });
    return response();
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { type: 'audio', mimeType: 'audio/wav', data: Buffer.from(audio).toString('base64') });
});
test('TTS accepts supported binary MIME aliases but never relabels another audio format or JSON as audio', async () => {
  for (const [format, types] of [
    ['wav', ['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream']],
    ['mp3', ['audio/mpeg', 'audio/mp3', 'application/octet-stream']],
    ['pcm', ['audio/pcm', 'application/octet-stream']],
  ] as const) {
    for (const type of types) {
      const result = await synthesizeStepSpeech(account(), { ...input, format }, signal(),
        async () => new Response(audio, { headers: { 'content-type': `${type}; charset=binary` } }));
      assert.equal(result.mimeType, { wav: 'audio/wav', mp3: 'audio/mpeg', pcm: 'audio/pcm' }[format]);
    }
  }
  for (const type of ['application/json', 'text/html', 'audio/mpeg', 'audio/pcm', 'text/plain']) {
    await assert.rejects(synthesizeStepSpeech(account(), input, signal(),
      async () => new Response('private-provider-diagnostic', { headers: { 'content-type': type } })),
    error => error instanceof HostClientError && error.code === 'PROVIDER_FAILED'
      && !error.message.includes('private-provider'));
  }
});
test('TTS rejects unsupported models, expired accounts, blank/control inputs and oversized text before fetch', async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return response(); };
  await assert.rejects(synthesizeStepSpeech(account(), input, signal(), request, 'unknown'), /CAPABILITY_UNAVAILABLE/);
  await assert.rejects(synthesizeStepSpeech({ ...account(), expires: Date.now() }, input, signal(), request), /CAPABILITY_UNAVAILABLE/);
  await assert.rejects(synthesizeStepSpeech({ ...account(), region: 'global' }, input, signal(), request, 'step-tts-mini'), /CAPABILITY_UNAVAILABLE/);
  for (const value of [
    { ...input, text: 'x'.repeat(1001) }, { ...input, text: ' \n' }, { ...input, voice: ' ' },
    { ...input, voice: 'x'.repeat(129) }, { ...input, voice: 'voice\ninjected' },
  ]) await assert.rejects(synthesizeStepSpeech(account(), value, signal(), request), /INVALID_REQUEST/);
  assert.equal(calls, 0, 'No split requests, retries or alternate billing route');
  for (const text of ['x'.repeat(1000), String.fromCodePoint(0x1f600).repeat(1000)])
    await synthesizeStepSpeech(account(), { ...input, text }, signal(), request);
  assert.equal(calls, 2);
});
test('TTS HTTP, empty, redirected and broken streams expose only normalized errors and cancel bodies', async () => {
  let cancelled = 0;
  const broken = new Response(new ReadableStream({
    start(controller) { controller.error(new Error('fixture-private-key')); },
  }), { headers: { 'content-type': 'audio/wav' } });
  const redirected = response();
  Object.defineProperty(redirected, 'redirected', { value: true });
  const invalid = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('private-error')); },
    cancel() { cancelled++; },
  }), { status: 401 });
  for (const value of [invalid, new Response(null, { status: 204 }), redirected, broken,
    new Response(new Uint8Array(), { headers: { 'content-type': 'audio/wav' } })]) {
    let calls = 0;
    await assert.rejects(synthesizeStepSpeech(account(), input, signal(), async () => { calls++; return value; }),
      error => error instanceof HostClientError && error.message === 'dfsc-host:PROVIDER_FAILED');
    assert.equal(calls, 1);
  }
  assert.equal(cancelled, 1);
});
test('TTS bounds declared and streamed audio before base64 encoding and cancels oversized streams', async () => {
  for (const declared of [true, false]) {
    let reads = 0, cancelled = 0;
    await assert.rejects(synthesizeStepSpeech(account(), input, signal(), async () =>
      new Response(new ReadableStream({
        pull(controller) { reads++; controller.enqueue(new Uint8Array(LIMITS.audio + 1)); },
        cancel() { cancelled++; },
      }, { highWaterMark: 0 }), { headers: { 'content-type': 'audio/wav',
        ...(declared ? { 'content-length': String(LIMITS.audio + 1) } : {}) } })), /TOO_LARGE/);
    assert.equal(reads, declared ? 0 : 1);
    assert.equal(cancelled, 1);
  }
  for (const length of ['-1', 'NaN']) await assert.rejects(synthesizeStepSpeech(account(), input, signal(),
    async () => new Response(audio, { headers: { 'content-type': 'audio/wav', 'content-length': length } })), /PROVIDER_FAILED/);
});
test('TTS preserves cancellation before dispatch and during provider work without retrying', async () => {
  const controller = new AbortController();
  controller.abort(new Error('fixture-cancelled'));
  await assert.rejects(synthesizeStepSpeech(account(), input, controller.signal, async () => {
    assert.fail('Cancelled request must not be sent');
  }), /fixture-cancelled/);
  const running = new AbortController();
  let calls = 0;
  await assert.rejects(synthesizeStepSpeech(account(), input, running.signal, async (_url, init) => {
    calls++;
    assert.equal(init?.signal, running.signal);
    running.abort(new Error('fixture-inflight-cancelled'));
    throw new Error('private-provider-details');
  }), /fixture-inflight-cancelled/);
  assert.equal(calls, 1);
});
