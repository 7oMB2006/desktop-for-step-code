import type { StepAccount } from './step-model-account';

export const STEP_ASR_MODEL = 'stepaudio-2.5-asr';
export class StepAsrError extends Error {
  constructor(readonly code: 'unavailable' | 'failed' | 'too-large', readonly status?: number) {
    super('Step audio recognition failed');
  }
}

// Shared by native dictation and plugin consumers. Authorization belongs to the caller.
export async function transcribeStepAudio(account: StepAccount, audio: { data: string; mimeType: string },
  signal: AbortSignal, request: typeof fetch = fetch, model = STEP_ASR_MODEL, language = 'zh'): Promise<string> {
  if (model !== STEP_ASR_MODEL || audio.mimeType !== 'audio/wav') throw new StepAsrError('unavailable');
  signal.throwIfAborted();
  if (account.expires <= Date.now() + 1000) throw new StepAsrError('unavailable');
  try {
    const response = await request(`${account.endpoint}/audio/asr/sse`, {
      method: 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${account.key}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ audio: { data: audio.data, input: {
        transcription: { model, ...(language ? { language } : {}), enable_itn: true }, format: { type: 'wav' },
      } } }),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new StepAsrError('failed', response.status);
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new StepAsrError('too-large');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const deltas: string[] = [], completed: string[] = [];
    for (const block of Buffer.concat(chunks).toString('utf8').split(/\r?\n\r?\n/u)) {
      const data = block.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data);
      if (event.type === 'error') throw new StepAsrError('failed');
      if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') deltas.push(event.delta);
      if (event.type === 'transcript.text.done' && typeof event.text === 'string') completed.push(event.text);
    }
    signal.throwIfAborted();
    const text = completed.join('') || deltas.join('');
    if (!text.trim()) throw new StepAsrError('failed');
    return text;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof StepAsrError) throw error;
    throw new StepAsrError('failed');
  }
}
