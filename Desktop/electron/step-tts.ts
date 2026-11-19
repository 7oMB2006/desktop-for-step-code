import { stepHostRoute, type StepAccount } from './step-model-account';
import { STEP_TTS_MODEL, stepTtsUnavailable } from '../src/step-host-catalog';
import { HostClientError, LIMITS } from '../../examples/plugins/host-client/protocol.mjs';
import type { Inputs, Results } from '../../examples/plugins/host-client/protocol.mjs';

export { STEP_TTS_MODEL };
const formats = { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm' } as const;
const fail = (code: ConstructorParameters<typeof HostClientError>[0]): never => { throw new HostClientError(code); };

// These are documented routes, not a probe of the account's paid entitlement.
export function supportsStepTts(account: Pick<StepAccount, 'channel' | 'region'>, model: string): boolean {
  return !stepTtsUnavailable(stepHostRoute(account), model);
}

export async function synthesizeStepSpeech(account: StepAccount, input: Inputs['model.tts'],
  signal: AbortSignal, request: typeof fetch = fetch, model = STEP_TTS_MODEL): Promise<Results['model.tts']> {
  signal.throwIfAborted();
  if (!supportsStepTts(account, model) || account.expires <= Date.now() + 1000) fail('CAPABILITY_UNAVAILABLE');
  const mimeType = formats[input.format];
  if (!mimeType || !input.text.trim() || Array.from(input.text).length > 1000
    || !input.voice.trim() || input.voice.length > 128 || /[\u0000-\u001f\u007f]/u.test(input.voice)) fail('INVALID_REQUEST');
  try {
    const response = await request(`${account.endpoint}/audio/speech`, {
      method: 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${account.key}`, 'content-type': 'application/json', accept: mimeType },
      body: JSON.stringify({ model, input: input.text, voice: input.voice,
        response_format: input.format, stream: false, return_url: false }),
    });
    try {
      if (!response.ok || response.redirected || !response.body) fail('PROVIDER_FAILED');
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const aliases = input.format === 'mp3' ? ['audio/mp3'] : input.format === 'wav' ? ['audio/x-wav', 'audio/wave'] : [];
      if (type !== mimeType && type !== 'application/octet-stream' && !aliases.includes(type ?? '')) fail('PROVIDER_FAILED');
      const length = response.headers.get('content-length');
      if (length !== null) {
        if (!/^\d+$/u.test(length)) fail('PROVIDER_FAILED');
        if (Number(length) > LIMITS.audio) fail('TOO_LARGE');
      }
      const reader = response.body!.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > LIMITS.audio) fail('TOO_LARGE');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      signal.throwIfAborted();
      if (!size) fail('PROVIDER_FAILED');
      return { type: 'audio', mimeType, data: Buffer.concat(chunks, size).toString('base64') };
    } finally {
      if (!response.body?.locked) await response.body?.cancel().catch(() => {});
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof HostClientError) throw error;
    return fail('PROVIDER_FAILED');
  }
}
