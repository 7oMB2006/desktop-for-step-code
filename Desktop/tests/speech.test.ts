import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeSpeech, saveSpeech, speechSettings, SpeechService, SPEECH_FIELD, validateSpeechConfig, validateSpeechWav } from '../electron/speech';
import { runtimeAuth, mergeRuntimeAuth } from '../electron/custom-providers';
import { stepAccount } from '../electron/step-model-account';
import { STEP_ASR_MODEL, transcribeStepAudio } from '../electron/step-asr';
import { pcmWav } from '../src/speech-audio';
import type { SpeechConfig } from '../src/speech';

const config: SpeechConfig = { source: 'custom', endpoint: 'https://asr.example/v1/audio/transcriptions', model: 'test-asr', language: 'zh' };
const follow: SpeechConfig = { source: 'follow', endpoint: '', model: STEP_ASR_MODEL, language: 'zh' };
const account = (profile = 'step_plan') => ({ step: { type: 'oauth', profile, access: 'fixture-account-secret', expires: Date.now() + 3600000 } });
const save = (data: Record<string, unknown>, value = config, key?: string) => saveSpeech(data, value, speechSettings(data).revision, key);
const acknowledge = (data: Record<string, unknown>) => acknowledgeSpeech(data, speechSettings(data).revision);
const auth = () => acknowledge(save({}, config, 'fixture-custom-secret'));
const wav = () => pcmWav(new Float32Array(16000).fill(0.25));

test('dictation defaults to the applied account, without an entitlement claim or exposed secrets', () => {
  const empty = speechSettings({});
  assert.equal(empty.source, 'follow'); assert.equal(empty.acknowledged, false); assert.equal(empty.followAvailable, false);
  assert.equal(empty.model, STEP_ASR_MODEL);
  const settings = speechSettings(account());
  assert.equal(settings.followAvailable, true);
  assert.equal(settings.followChannel, 'plan');
  assert.doesNotMatch(JSON.stringify(settings), /fixture-account-secret|Bearer|endpoint.*stepfun/);
  assert.equal(speechSettings(auth()).hasKey, true);
  assert.doesNotMatch(JSON.stringify(speechSettings(auth())), /fixture-custom-secret/);
});
test('passive settings use applied credentials and mark pending/expired/unprofiled accounts unavailable', () => {
  assert.equal(speechSettings(account(), {}, false).followAvailable, false);
  assert.equal(speechSettings(account(), account(), true).followAvailable, false);
  for (const step of [
    { ...account().step, expires: Date.now() - 1000 },
    { ...account().step, profile: undefined }, { ...account().step, type: 'api_key' },
  ]) assert.equal(speechSettings({ step }).followAvailable, false);
});
test('speech settings enforce revision-CAS and changing destination cannot silently retain a key', () => {
  const first = auth();
  assert.throws(() => saveSpeech(first, config, 'unconfigured', 'new'), /speech:conflict/);
  assert.throws(() => acknowledgeSpeech(first, 'unconfigured'), /speech:conflict/);
  assert.throws(() => save(first, { ...config, endpoint: 'https://other.example/asr' }));
  assert.equal(speechSettings(save(first, { ...config, model: 'another' })).hasKey, true);
  assert.equal(speechSettings(save(first, follow)).hasKey, false);
  assert.equal(speechSettings(acknowledge({})).acknowledged, true);
});
test('the old after-stop consent cannot authorize uploads during continuous recording', () => {
  const old = { [SPEECH_FIELD]: { config: follow, revision: 'legacy', acknowledged: true }, ...account() };
  assert.equal(speechSettings(old).acknowledged, false);
  assert.throws(() => new SpeechService().begin(old), /acknowledgement/);
  assert.equal(speechSettings(acknowledge(old)).acknowledged, true);
  assert.equal(speechSettings(save(old, follow)).acknowledged, false);
});
test('settings allow an explicit independent/local model but never an arbitrary model on a host account', () => {
  for (const endpoint of ['http://remote.example/asr', 'file:///tmp/asr', 'https://user:pass@asr.example/asr', 'https://asr.example/asr?key=test', 'https://asr.example/asr#secret'])
    assert.throws(() => validateSpeechConfig({ ...config, endpoint }));
  assert.throws(() => validateSpeechConfig({ ...config, source: 'local' }));
  assert.equal(validateSpeechConfig({ ...config, source: 'local', endpoint: 'http://127.0.0.1:8080/asr' }).source, 'local');
  assert.throws(() => validateSpeechConfig({ ...follow, model: 'unknown-model' }));
  assert.throws(() => save({}, config, 'bad\nkey'));
  assert.throws(() => save({}, config));
  assert.equal(validateSpeechConfig({ ...config, model: 'my-local-model' }).model, 'my-local-model');
});
test('private metadata never reaches runtime auth and cannot be injected through runtime responses', () => {
  const data = auth();
  assert.equal(runtimeAuth(data)[SPEECH_FIELD], undefined);
  assert.deepEqual(mergeRuntimeAuth(data, {})[SPEECH_FIELD], data[SPEECH_FIELD]);
  assert.deepEqual(mergeRuntimeAuth(data, { [SPEECH_FIELD]: 'forged' })[SPEECH_FIELD], data[SPEECH_FIELD]);
  assert.equal(mergeRuntimeAuth({}, { [SPEECH_FIELD]: 'forged' })[SPEECH_FIELD], undefined);
});
test('canonical PCM WAV has strict format, size and duration bounds', () => {
  const bytes = pcmWav(new Float32Array([-2, -1, 0, 1, 2]));
  assert.deepEqual(Buffer.from(validateSpeechWav(bytes)), Buffer.from(bytes));
  assert.equal(new DataView(bytes.buffer).getInt16(44, true), -32768);
  assert.equal(new DataView(bytes.buffer).getInt16(52, true), 32767);
  assert.throws(() => validateSpeechWav(new Uint8Array(44)));
  assert.throws(() => validateSpeechWav(pcmWav(new Float32Array(16000 * 61))));
  const corrupt = wav(); corrupt[24] = 0;
  assert.throws(() => validateSpeechWav(corrupt));
});
test('consent, a matching operation, bounded microphone grant and current context are required', context => {
  let now = Date.now(), current = true;
  context.mock.method(Date, 'now', () => now);
  const service = new SpeechService();
  assert.throws(() => service.begin(save({}, config, 'key')));
  assert.equal(service.allowMicrophone(), false);
  const { id } = service.begin(auth(), {}, () => current);
  assert.equal(service.allowMicrophone(), true);
  assert.throws(() => service.begin(auth()));
  service.cancel('stale-id');
  assert.equal(service.allowMicrophone(), true);
  current = false;
  assert.equal(service.allowMicrophone(), false);
  current = true; now += 15001;
  assert.equal(service.allowMicrophone(), false);
  service.cancel(id);
});
test('malformed recordings and stale scopes never contact a provider', async () => {
  let count = 0, current = true;
  const service = new SpeechService(async () => { count++; return Response.json({ text: 'no' }); });
  let operation = service.begin(auth());
  await assert.rejects(service.transcribe(operation.id, new Uint8Array(60)));
  operation = service.begin(auth(), {}, () => current);
  current = false;
  await assert.rejects(service.transcribe(operation.id, wav()));
  assert.equal(count, 0); assert.equal(service.allowMicrophone(), false);
});
for (const [profile, endpoint, channel, region] of [
  ['step_plan', 'https://api.stepfun.com/step_plan/v1', 'plan', 'cn'],
  ['step_plan_oversea', 'https://api.stepfun.ai/step_plan/v1', 'plan', 'global'],
  ['platform_cn', 'https://api.stepfun.com/v1', 'api', 'cn'],
  ['platform_oversea', 'https://api.stepfun.ai/v1', 'api', 'global'],
]) {
  test(`native dictation reuses the shared ${profile} ASR route without a conversation worker`, async () => {
    const data = acknowledge(account(profile));
    const calls: string[] = [];
    const service = new SpeechService(async (url, options) => {
      calls.push(String(url));
      assert.equal(url, `${endpoint}/audio/asr/sse`);
      assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer fixture-account-secret');
      assert.deepEqual(JSON.parse(String(options?.body)), { audio: { data: Buffer.from(wav()).toString('base64'), input: {
        transcription: { model: STEP_ASR_MODEL, language: 'zh', enable_itn: true }, format: { type: 'wav' },
      } } });
      return new Response('data: {"type":"transcript.text.delta","delta":"partial"}\n\ndata: {"type":"transcript.text.done","text":"final transcript"}\n\ndata: [DONE]\n\n');
    });
    const settings = speechSettings(data);
    assert.equal(settings.followChannel, channel); assert.equal(settings.followRegion, region);
    const { id } = service.begin(data);
    assert.equal(await service.transcribe(id, wav()), 'final transcript');
    assert.equal(calls.length, 1);
  });
}
test('the shared ASR adapter handles split UTF-8 SSE and language without exposing transport errors', async () => {
  const stream = 'data: {"type":"transcript.text.delta","delta":"语音"}\r\n\r\ndata: {"type":"transcript.text.done","text":"语音转写"}\r\n\r\n';
  const encoded = new TextEncoder().encode(stream);
  const text = await transcribeStepAudio(stepAccount(account()), { data: 'YWJjZA==', mimeType: 'audio/wav' },
    new AbortController().signal, async (_url, options) => {
      assert.equal(JSON.parse(String(options?.body)).audio.input.transcription.language, 'en');
      return new Response(new ReadableStream({ start(controller) {
        for (let index = 0; index < encoded.length; index += 3) controller.enqueue(encoded.slice(index, index + 3));
        controller.close();
      } }));
    }, STEP_ASR_MODEL, 'en');
  assert.equal(text, '语音转写');
});
test('account ASR HTTP failures never retry or fall back to a direct API/custom endpoint', async () => {
  for (const status of [401, 403, 429, 500]) {
    const calls: string[] = [];
    const service = new SpeechService(async url => {
      calls.push(String(url)); return new Response('fixture-account-secret raw diagnostics', { status });
    });
    const { id } = service.begin(acknowledge(account()));
    await assert.rejects(service.transcribe(id, wav()), new RegExp(`Speech service HTTP ${status}`));
    assert.deepEqual(calls, ['https://api.stepfun.com/step_plan/v1/audio/asr/sse']);
  }
});
test('independent services get multipart WAV and only their own literal key/model', async () => {
  const service = new SpeechService(async (url, options) => {
    assert.equal(url, config.endpoint);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer fixture-custom-secret');
    const form = options?.body as FormData;
    assert.equal(form.get('model'), config.model); assert.equal(form.get('language'), 'zh');
    assert.equal(form.get('response_format'), 'json');
    assert.equal((form.get('file') as File).size, wav().length);
    return Response.json({ text: ' independent dictation ' });
  });
  const data = { ...account(), ...auth() };
  const { id } = service.begin(data);
  assert.equal(await service.transcribe(id, wav()), 'independent dictation');
});
test('local adapters get no account or independent-service authorization', async () => {
  const service = new SpeechService(async (_url, options) => {
    assert.deepEqual(options?.headers, {}); return Response.json({ text: 'local speech' });
  });
  const data = acknowledge(save({ ...account(), ...auth() }, { ...config, source: 'local', endpoint: 'http://localhost:8080/asr' }));
  const { id } = service.begin(data);
  assert.equal(await service.transcribe(id, wav()), 'local speech');
});
test('provider errors, malformed SSE/JSON, empty text and large responses stay bounded and redacted', async () => {
  for (const [data, responses] of [
    [auth(), ['not json', JSON.stringify({ text: '' }), 'x'.repeat(270000)]],
    [acknowledge(account()), ['data: invalid\n\n', 'data: {"type":"error","message":"fixture-account-secret"}\n\n', 'data: {"type":"transcript.text.done","text":""}\n\n', 'x'.repeat(2 * 1024 * 1024 + 1)]],
  ] as const) for (const body of responses) {
    const service = new SpeechService(async () => new Response(body));
    const { id } = service.begin(data);
    await assert.rejects(service.transcribe(id, wav()), error => {
      assert.doesNotMatch(String(error), /fixture-account-secret|fixture-custom-secret/); return true;
    });
    assert.equal(service.allowMicrophone(), false);
  }
});
test('late account/scope results and cancelled operations cannot overwrite a draft or cancel a newer recording', async () => {
  let resolve!: (response: Response) => void, current = true;
  const service = new SpeechService(() => new Promise<Response>(done => { resolve = done; }));
  const first = service.begin(auth(), {}, () => current);
  const pending = service.transcribe(first.id, wav());
  await assert.rejects(service.transcribe(first.id, wav()));
  current = false;
  resolve(Response.json({ text: 'stale result' }));
  await assert.rejects(pending);
  current = true;
  const old = service.begin(auth());
  const oldPending = service.transcribe(old.id, wav());
  service.cancel(old.id);
  const next = service.begin(auth());
  resolve(Response.json({ text: 'cancelled result' }));
  await assert.rejects(oldPending, /cancelled/);
  assert.equal(service.allowMicrophone(), true);
  service.cancel(next.id);
});
test('continuous segments use one recording lease and exact sequence, without automatic retries', async () => {
  let calls = 0;
  const service = new SpeechService(async () => { calls++; return Response.json({ text: `phrase ${calls}` }); });
  const { id } = service.begin(auth());
  await assert.rejects(service.transcribe(id, wav(), 1), /sequence/);
  assert.equal(calls, 0);
  assert.equal(await service.transcribe(id, wav(), 0), 'phrase 1');
  await assert.rejects(service.transcribe(id, wav(), 0), /sequence/);
  assert.equal(await service.transcribe(id, wav(), 1), 'phrase 2');
  assert.equal(calls, 2);
  service.finish(id);
  await assert.rejects(service.transcribe(id, wav(), 2), /No matching/);
});
test('continuous recording bounds each segment, total duration and total text, and stops on failure', async () => {
  let calls = 0;
  const service = new SpeechService(async () => { calls++; return Response.json({ text: 'phrase' }); });
  let operation = service.begin(auth());
  await assert.rejects(service.transcribe(operation.id, pcmWav(tone(4.1)), 0));
  assert.equal(calls, 0);
  operation = service.begin(auth());
  for (let index = 0; index < 15; index++)
    assert.equal(await service.transcribe(operation.id, pcmWav(tone(4)), index), 'phrase');
  await assert.rejects(service.transcribe(operation.id, wav(), 15));
  assert.equal(calls, 15);
  const huge = new SpeechService(async () => Response.json({ text: 'a'.repeat(30000) }));
  operation = huge.begin(auth());
  await huge.transcribe(operation.id, wav(), 0);
  await assert.rejects(huge.transcribe(operation.id, wav(), 1));
  const failure = new SpeechService(async () => { calls++; return new Response('private error', { status: 429 }); });
  operation = failure.begin(auth());
  await assert.rejects(failure.transcribe(operation.id, wav(), 0), /HTTP 429/);
  await assert.rejects(failure.transcribe(operation.id, wav(), 1), /No matching/);
  assert.equal(calls, 16);
});
test('continuous Finish refuses an in-flight upload, cancellation rejects late results and a silent recording can finish', async () => {
  let resolve!: (value: Response) => void;
  const service = new SpeechService(() => new Promise<Response>(done => { resolve = done; }));
  const { id } = service.begin(auth());
  const pending = service.transcribe(id, wav(), 0);
  assert.throws(() => service.finish(id), /No matching/);
  service.cancel(id);
  const next = service.begin(auth());
  resolve(Response.json({ text: 'cancelled phrase' }));
  await assert.rejects(pending, /cancelled/);
  assert.equal(service.allowMicrophone(), true);
  service.finish(next.id);
  assert.equal(service.allowMicrophone(), false);
});
function tone(seconds: number) { return new Float32Array(seconds * 16000).fill(0.2); }
