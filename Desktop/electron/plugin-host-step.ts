import { createHmac, randomBytes } from 'node:crypto';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { stepHostRoute, type StepAccount } from './step-model-account';
import { pluginHostAccount } from './plugin-host-account';
import type { PluginHostAccountBinding } from './plugin-host-contract.mjs';
import type { PluginHostModels } from '../src/capabilities';
import { StepAsrError, transcribeStepAudio } from './step-asr';
import { synthesizeStepSpeech } from './step-tts';
import { stepHostUnavailable } from '../src/step-host-catalog';
import type { HostProvider, HostProviderSnapshot } from './plugin-host-broker';
import { CAPABILITIES, HostClientError, LIMITS } from '../../examples/plugins/host-client/protocol.mjs';
import type { Capability, Invocation, Results } from '../../examples/plugins/host-client/protocol.mjs';

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
  private accounts = new WeakMap<HostProviderSnapshot, StepAccount>();
  constructor(private pool: Pick<SessionRuntimes, 'workers'>,
    private auth: () => Record<string, unknown>, private changing: () => boolean,
    private request: typeof fetch = fetch,
    private recordImageFailure?: (details: ImageFailureDiagnostic) => void | Promise<void>) {}
  private selection() {
    const selected = !this.changing() && pluginHostAccount(this.auth());
    return selected || undefined;
  }
  private ticket(selection: NonNullable<ReturnType<StepPluginHostProvider['selection']>>) {
    return createHmac('sha256', this.salt).update(JSON.stringify(selection)).digest('hex');
  }
  choice() {
    const selection = this.selection();
    if (!selection) return;
    return { ...stepHostRoute(selection.account), ticket: this.ticket(selection) };
  }
  select(ticket: unknown) {
    const selection = this.selection();
    if (selection && ticket === this.ticket(selection)) return selection.binding;
  }
  accountStatus(binding: PluginHostAccountBinding) {
    if (this.changing()) return 'account-unavailable';
    const selected = pluginHostAccount(this.auth(), 0);
    if (!selected) return this.auth().step ? 'account-changed' : 'account-unavailable';
    if (selected.binding.id !== binding.id || selected.binding.region !== binding.region
      || selected.binding.channel !== binding.channel) return 'account-changed';
    if (selected.account.expires <= Date.now() + 1000) return 'account-expired';
  }
  async read(worker: SessionRuntime, models: PluginHostModels, binding?: PluginHostAccountBinding): Promise<HostProviderSnapshot> {
    if (this.pool.workers.get(worker.id) !== worker) return fail('STALE_CONTEXT');
    if (this.changing()) return fail('BUSY');
    const selection = this.selection();
    if (!binding || !selection || this.accountStatus(binding)) return fail('CAPABILITY_UNAVAILABLE');
    const { account } = selection;
    const source = stepHostRoute(account), unavailable: NonNullable<HostProviderSnapshot['unavailable']> = {};
    const capabilities = CAPABILITIES.map(id => {
      const model = models[id];
      const reason = stepHostUnavailable(id, source, model);
      if (model && !reason) return { id, available: true, model, ...source };
      unavailable[id] = reason ?? 'model-not-selected';
      return { id, available: false, reason: 'CAPABILITY_UNAVAILABLE' as const };
    });
    const snapshot: HostProviderSnapshot = {
      revision: createHmac('sha256', this.salt).update(JSON.stringify([selection, models])).digest('hex'),
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
    if (!supported?.model) return fail('CAPABILITY_UNAVAILABLE');
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
      payload = { model: supported.model, messages,
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
            capability: invocation.capability, model: supported.model, requestId: invocation.requestId,
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
