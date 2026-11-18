import { createHmac, randomBytes } from 'node:crypto';
import type { RuntimeState } from '../src/contracts';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { stepHostRoute, stepModelAccount, type StepModelAccount } from './step-model-account';
import { StepAsrError, transcribeStepAudio } from './step-asr';
import { synthesizeStepSpeech } from './step-tts';
import { STEP_ASR_MODEL, STEP_TTS_MODEL, stepHostUnavailable } from '../src/step-host-catalog';
import type { HostProvider, HostProviderSnapshot } from './plugin-host-broker';
import { CAPABILITIES, HostClientError, LIMITS } from '../../examples/plugins/host-client/protocol.mjs';
import type { Capability, Invocation, ModelSelection, Results } from '../../examples/plugins/host-client/protocol.mjs';

const fail = (code: ConstructorParameters<typeof HostClientError>[0]) => { throw new HostClientError(code); };
type ImageFailureStage = 'network' | 'http' | 'response-body' | 'response-json' | 'response-content';
export type ImageFailureDiagnostic = ReturnType<typeof stepHostRoute> & {
  capability: 'model.image'; model: string; requestId: string; stage: ImageFailureStage;
  httpStatus?: number; upstreamRequestId?: string;
};
function upstreamRequestId(response: Response, credential: string) {
  for (const name of ['x-request-id', 'request-id', 'x-stepfun-request-id']) {
    const id = response.headers.get(name);
    if (id && id !== credential
      && /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|req[-_][a-z0-9]{8,64})$/iu.test(id)) return id;
  }
}
async function body(response: Response) {
  if (!response.body) fail('PROVIDER_FAILED');
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
export class StepPluginHostProvider implements HostProvider {
  private salt = randomBytes(32);
  private accounts = new WeakMap<HostProviderSnapshot, StepModelAccount>();
  constructor(private pool: Pick<SessionRuntimes, 'workers'>,
    private auth: () => Record<string, unknown>, private changing: () => boolean,
    private request: typeof fetch = fetch,
    private recordImageFailure?: (details: ImageFailureDiagnostic) => void | Promise<void>) {}
  source(worker: SessionRuntime) {
    if (this.pool.workers.get(worker.id) !== worker) return;
    try { return stepHostRoute(stepModelAccount(this.auth(), worker, this.changing() || worker.mutating)); }
    catch { return; }
  }
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
    const source = stepHostRoute(account), unavailable: NonNullable<HostProviderSnapshot['unavailable']> = {};
    const capabilities = CAPABILITIES.map(id => {
      const model = id === 'model.asr' ? models[id] ?? STEP_ASR_MODEL
        : id === 'model.tts' ? models[id] ?? STEP_TTS_MODEL : account.model;
      const reason = stepHostUnavailable(id, source, model, account.video);
      if (!reason) return { id, available: true, model, ...source };
      unavailable[id] = reason;
      return { id, available: false, reason: 'CAPABILITY_UNAVAILABLE' as const };
    });
    const snapshot: HostProviderSnapshot = {
      revision: createHmac('sha256', this.salt).update(JSON.stringify([account, models])).digest('hex'),
      expiresAt: account.expires,
      source, unavailable, capabilities,
    };
    this.accounts.set(snapshot, account);
    return snapshot;
  }
  async invoke(snapshot: HostProviderSnapshot, invocation: Invocation, signal: AbortSignal): Promise<Results[Capability]> {
    const account = this.accounts.get(snapshot);
    if (!account) return fail('STALE_CONTEXT');
    const supported = snapshot.capabilities.find(item => item.id === invocation.capability && item.available);
    if (!supported) return fail('CAPABILITY_UNAVAILABLE');
    if (invocation.capability === 'model.tts')
      return synthesizeStepSpeech(account, invocation.input, signal, this.request, supported.model);
    if (invocation.capability === 'model.asr') {
      try {
        return { type: 'text', text: await transcribeStepAudio(account, invocation.input.audio, signal, this.request, supported.model) };
      } catch (error) {
        signal.throwIfAborted();
        return fail(error instanceof StepAsrError && error.code === 'unavailable' ? 'CAPABILITY_UNAVAILABLE'
          : error instanceof StepAsrError && error.code === 'too-large' ? 'TOO_LARGE' : 'PROVIDER_FAILED');
      }
    }
    let payload: unknown;
    {
      const input = invocation.input;
      const messages: Array<{ role: string; content: unknown }> = input.messages.map(message => ({ ...message }));
      if (invocation.capability === 'model.video' || invocation.capability === 'model.image') {
        let index = messages.length - 1;
        while (index >= 0 && messages[index].role !== 'user') index--;
        if (index < 0) return fail('INVALID_REQUEST');
        const isImage = invocation.capability === 'model.image';
        const media = isImage ? invocation.input.image : invocation.input.video;
        const type = isImage ? 'image_url' : 'video_url';
        messages[index].content = [
          { type, [type]: { url: `data:${media.mimeType};base64,${media.data}` } },
          { type: 'text', text: messages[index].content },
        ];
      }
      payload = { model: account.model, messages,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}) };
    }
    signal.throwIfAborted();
    let stage: ImageFailureStage = 'network';
    let response: Response | undefined;
    try {
      response = await this.request(`${account.endpoint}/chat/completions`, {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${account.key}`, 'content-type': 'application/json',
          accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        stage = 'http';
        await response.body?.cancel().catch(() => {});
        return fail('PROVIDER_FAILED');
      }
      stage = 'response-body';
      const raw = await body(response);
      signal.throwIfAborted();
      stage = 'response-json';
      const text = JSON.parse(raw)?.choices?.[0]?.message?.content;
      stage = 'response-content';
      if (typeof text !== 'string' || !text.trim()) return fail('PROVIDER_FAILED');
      return { type: 'text', text };
    } catch (error) {
      signal.throwIfAborted();
      if (invocation.capability === 'model.image' && this.recordImageFailure) {
        try {
          const id = response && upstreamRequestId(response, account.key);
          void Promise.resolve(this.recordImageFailure({
            capability: invocation.capability, model: account.model, requestId: invocation.requestId,
            ...stepHostRoute(account), stage,
            ...(response ? { httpStatus: response.status } : {}),
            ...(id ? { upstreamRequestId: id } : {}),
          })).catch(() => {});
        } catch { /* Diagnostics must not change the error sent to the plugin. */ }
      }
      if (error instanceof HostClientError) throw error;
      return fail('PROVIDER_FAILED');
    }
  }
}
