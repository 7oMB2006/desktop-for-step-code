import { createHmac, randomBytes } from 'node:crypto';
import type { RuntimeState } from '../src/contracts';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { stepModelAccount, type StepModelAccount } from './step-model-account';
import type { HostProvider, HostProviderSnapshot } from './plugin-host-broker';
import { HostClientError, LIMITS } from '../../examples/plugins/host-client/protocol.mjs';
import type { Capability, Invocation, ModelSelection, Results } from '../../examples/plugins/host-client/protocol.mjs';

const fail = (code: ConstructorParameters<typeof HostClientError>[0]) => { throw new HostClientError(code); };
async function body(response: Response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    fail('PROVIDER_FAILED');
  }
  const reader = response.body!.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.text) fail('TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
function transcription(raw: string) {
  const deltas: string[] = [], completed: string[] = [];
  for (const block of raw.split(/\r?\n\r?\n/u)) {
    const line = block.split(/\r?\n/u).find(value => value.startsWith('data:'));
    if (!line) continue;
    let event;
    try { event = JSON.parse(line.slice(5)); } catch { fail('PROVIDER_FAILED'); }
    if (event.type === 'error') fail('PROVIDER_FAILED');
    if (event.type === 'transcript.text.delta' && typeof event.delta === 'string') deltas.push(event.delta);
    if (event.type === 'transcript.text.done' && typeof event.text === 'string') completed.push(event.text);
  }
  const result = completed.join('') || deltas.join('');
  if (!result.trim()) fail('PROVIDER_FAILED');
  return result;
}

// No TTS route is guessed from an OAuth profile; that adapter still needs separate verification.
export class StepPluginHostProvider implements HostProvider {
  private salt = randomBytes(32);
  private accounts = new WeakMap<HostProviderSnapshot, StepModelAccount>();
  constructor(private pool: Pick<SessionRuntimes, 'workers'>,
    private auth: () => Record<string, unknown>, private changing: () => boolean,
    private request: typeof fetch = fetch) {}
  async read(worker: SessionRuntime, models: ModelSelection): Promise<HostProviderSnapshot> {
    const rpc = worker.rpc;
    let state: RuntimeState;
    try { state = await rpc.request('get_state', {}, 10000); }
    catch { return fail('HOST_UNAVAILABLE'); }
    if (this.pool.workers.get(worker.id) !== worker || worker.rpc !== rpc
      || state.sessionId !== worker.state?.sessionId) return fail('STALE_CONTEXT');
    let account: StepModelAccount;
    try { account = stepModelAccount(this.auth(), { ...worker, state }, this.changing() || worker.mutating); }
    catch { return fail('CAPABILITY_UNAVAILABLE'); }
    const model = models['model.asr'] ?? 'stepaudio-2.5-asr';
    const entry = (id: Capability, available: boolean, selected: string) => available
      ? { id, available: true, model: selected, channel: account.channel, region: account.region === 'global' ? 'oversea' as const : 'cn' as const }
      : { id, available: false, reason: 'CAPABILITY_UNAVAILABLE' as const };
    const snapshot: HostProviderSnapshot = {
      revision: createHmac('sha256', this.salt).update(JSON.stringify([account, models])).digest('hex'),
      expiresAt: account.expires,
      capabilities: [
        entry('model.text', true, account.model), entry('model.video', account.video, account.model),
        entry('model.asr', model === 'stepaudio-2.5-asr', model), entry('model.tts', false, ''),
      ],
    };
    this.accounts.set(snapshot, account);
    return snapshot;
  }
  async invoke(snapshot: HostProviderSnapshot, invocation: Invocation, signal: AbortSignal): Promise<Results[Capability]> {
    const account = this.accounts.get(snapshot);
    if (!account) return fail('STALE_CONTEXT');
    const supported = snapshot.capabilities.find(item => item.id === invocation.capability && item.available);
    if (!supported || invocation.capability === 'model.tts') return fail('CAPABILITY_UNAVAILABLE');
    const asr = invocation.capability === 'model.asr';
    let payload: unknown;
    if (invocation.capability === 'model.asr') {
      if (invocation.input.audio.mimeType !== 'audio/wav') return fail('CAPABILITY_UNAVAILABLE');
      payload = { audio: { data: invocation.input.audio.data, input: {
        transcription: { model: supported.model, language: 'zh', enable_itn: true }, format: { type: 'wav' },
      } } };
    } else {
      const input = invocation.input;
      const messages: Array<{ role: string; content: unknown }> = input.messages.map(message => ({ ...message }));
      if (invocation.capability === 'model.video') {
        let index = messages.length - 1;
        while (index >= 0 && messages[index].role !== 'user') index--;
        if (index < 0) return fail('INVALID_REQUEST');
        const video = invocation.input.video;
        messages[index].content = [
          { type: 'video_url', video_url: { url: `data:${video.mimeType};base64,${video.data}` } },
          { type: 'text', text: messages[index].content },
        ];
      }
      payload = { model: account.model, messages,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}) };
    }
    signal.throwIfAborted();
    try {
      const response = await this.request(`${account.endpoint}${asr ? '/audio/asr/sse' : '/chat/completions'}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${account.key}`, 'content-type': 'application/json',
          accept: asr ? 'text/event-stream' : 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await body(response);
      signal.throwIfAborted();
      const text = asr ? transcription(raw) : JSON.parse(raw)?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) return fail('PROVIDER_FAILED');
      return { type: 'text', text };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof HostClientError) throw error;
      return fail('PROVIDER_FAILED');
    }
  }
}
