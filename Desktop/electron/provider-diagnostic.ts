import type { CustomProvider, ProviderDiagnostic } from '../src/contracts';
import { providerList } from './custom-providers';

// Diagnostics are isolated HTTP requests, not agent prompts or saved configuration.
export async function testProvider(auth: Record<string, unknown>, raw: unknown, modelId: unknown, key: unknown, signal?: AbortSignal): Promise<ProviderDiagnostic> {
  const started = performance.now();
  let status: number | undefined;
  let endpoint = '';
  let api: ProviderDiagnostic['api'] = 'openai-completions';
  let model = '';
  let credential: string | undefined;
  const finish = (outcome: ProviderDiagnostic['outcome']): ProviderDiagnostic => ({
    ok: outcome === 'reply', outcome, elapsedMs: Math.round(performance.now() - started), status,
    model: credential ? model.split(credential).join('[redacted]') : model, api, endpoint,
  });
  let url: URL;
  let body: Record<string, unknown>;
  let headers: Record<string, string>;
  try {
    if (!raw || typeof raw !== 'object') return finish('invalid-config');
    const p = raw as CustomProvider;
    if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(p.api)) return finish('invalid-config');
    api = p.api;
    url = new URL(p.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || p.baseUrl.length > 2048) return finish('invalid-config');
    if (typeof modelId !== 'string' || !modelId.trim() || modelId.length > 300 || /[\u0000-\u001f]/.test(modelId)) return finish('invalid-config');
    if (!Array.isArray(p.models) || !p.models.some(m => m?.id?.trim() === modelId.trim())) return finish('invalid-config');
    model = modelId.trim();
    if (typeof p.keyless !== 'boolean' || (key !== undefined && (typeof key !== 'string' || key.length > 8192 || /[\r\n\u0000]/.test(key)))) return finish('invalid-config');
    const saved = providerList(auth).find(item => item.id === p.id);
    credential = p.keyless ? undefined : typeof key === 'string' && key.trim() ? key.trim() : saved ? (auth[saved.id] as { key?: string } | undefined)?.key : undefined;
    if (!p.keyless && !credential) return finish('invalid-config');
    const route = api === 'openai-completions' ? 'chat/completions' : api === 'openai-responses' ? 'responses' : 'messages';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${route}`;
    // Custom path segments may contain secrets; report only the origin and known route.
    endpoint = `${url.origin}/.../${route}`;
    if (credential) endpoint = endpoint.split(credential).join('[redacted]');
    headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (api === 'anthropic-messages') {
      headers['anthropic-version'] = '2023-06-01';
      if (credential) headers['x-api-key'] = credential;
    } else if (credential) headers.Authorization = `Bearer ${credential}`;
    const prompt = 'Reply with OK only.';
    body = api === 'openai-responses'
      ? { model, input: prompt, stream: false, store: false, max_output_tokens: 256 }
      : { model, messages: [{ role: 'user', content: prompt }], stream: false, ...(api === 'anthropic-messages' ? { max_tokens: 256 } : { max_completion_tokens: 256 }) };
  } catch { return finish('invalid-config'); }
  const timeout = AbortSignal.timeout(30000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: combined });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      return finish(status === 401 || status === 403 ? 'authentication' : status === 404 ? 'not-found' : status === 429 ? 'rate-limit' : 'http-error');
    }
    if (!response.body) return finish('invalid-response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 1024 * 1024) return finish('invalid-response');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    let data: any;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return finish('invalid-response'); }
    const validText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    const validParts = (value: unknown, type: string) => Array.isArray(value) && value.some(p => p?.type === type && validText(p.text));
    const valid = !data?.error && (api === 'openai-completions'
      ? Array.isArray(data?.choices) && data.choices.some((c: any) => c?.message?.role === 'assistant' && (validText(c.message.content) || validParts(c.message.content, 'text')))
      : api === 'anthropic-messages'
        ? data?.type === 'message' && data?.role === 'assistant' && validParts(data.content, 'text')
        : data?.object === 'response' && data?.status === 'completed' && Array.isArray(data.output) && data.output.some((o: any) => o?.type === 'message' && o?.role === 'assistant' && validParts(o.content, 'output_text')));
    return finish(valid ? 'reply' : 'invalid-response');
  } catch {
    return finish(signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'network');
  }
}
