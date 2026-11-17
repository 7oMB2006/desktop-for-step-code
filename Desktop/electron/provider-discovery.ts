import type { DiscoveredProviderModel, ProviderApi } from '../src/contracts';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const MODALITIES = ['text', 'image', 'audio', 'video', 'file'];
export function stringSubset(raw: unknown, allowed: string[]): string[] | undefined {
  return Array.isArray(raw) && raw.length > 0 && raw.every(v => typeof v === 'string' && allowed.includes(v)) ? allowed.filter(v => raw.includes(v)) : undefined;
}
const object = (raw: unknown): Record<string, any> | undefined =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : undefined;
const positive = (...values: unknown[]) => values.find(v => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 10000000) as number | undefined;

export function discoverModelMetadata(entry: Record<string, any>): Partial<DiscoveredProviderModel> {
  const result: Partial<DiscoveredProviderModel> = {};
  const input = stringSubset(entry.input_modalities ?? entry.architecture?.input_modalities ?? entry.modalities?.input ?? entry.capabilities?.input, MODALITIES);
  const output = stringSubset(entry.output_modalities ?? entry.architecture?.output_modalities ?? entry.modalities?.output ?? entry.capabilities?.output, MODALITIES);
  if (input) { result.declaredInput = input; result.vision = input.includes('image'); }
  if (output) result.declaredOutput = output;
  if (typeof entry.reasoning === 'boolean') result.reasoning = entry.reasoning;
  const rawLevels = entry.thinking_levels ?? entry.supported_reasoning_efforts ?? entry.effort?.supported_levels;
  const levels = Array.isArray(rawLevels) && rawLevels.every(v => typeof v === 'string')
    ? THINKING_LEVELS.filter(level => rawLevels.includes(level)) : [];
  if (levels.length && entry.reasoning !== false) {
    result.thinkingLevels = levels;
    result.reasoning = levels.some(v => v !== 'off');
  }
  if (typeof entry.effort?.default_level === 'string' && result.thinkingLevels?.includes(entry.effort.default_level)) result.thinkingDefaultLevel = entry.effort.default_level;
  const context = positive(entry.context_window, entry.contextWindow, entry.context_length, entry.max_input_tokens, entry.limit?.context);
  const max = positive(entry.max_output_tokens, entry.maxOutputTokens, entry.maxTokens, entry.max_tokens, entry.limit?.output, entry.top_provider?.max_completion_tokens);
  if (context !== undefined) result.contextWindow = context;
  if (max !== undefined && (context === undefined || max <= context)) result.maxTokens = max;
  return result;
}

// Listing and generation are separate contracts. No trial POSTs or alternate hosts.
export function modelListing(baseUrl: URL, api: ProviderApi, credential?: string) {
  const url = new URL(baseUrl);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const base = url.pathname.replace(/\/+$/, '');
  if (api === 'anthropic-messages') {
    url.pathname = `${base.replace(/\/v1$/, '')}/v1/models`;
    headers['anthropic-version'] = '2023-06-01';
    if (credential) headers['x-api-key'] = credential;
  } else {
    url.pathname = `${base}/models`;
    if (credential) headers.Authorization = `Bearer ${credential}`;
  }
  return { url, headers };
}

export function parseModelListing(body: unknown): DiscoveredProviderModel[] {
  const payload = object(body);
  const rows: { key?: string; value: unknown }[] = Array.isArray(body) ? body.map(value => ({ value }))
    : Array.isArray(payload?.data) ? payload.data.map((value: unknown) => ({ value }))
      : object(payload?.models) ? Object.entries(payload!.models).map(([key, value]) => ({ key, value })) : [];
  if (!Array.isArray(body) && !Array.isArray(payload?.data) && !object(payload?.models)) throw new Error('Invalid model list');
  const result = new Map<string, DiscoveredProviderModel>();
  for (const row of rows) {
    const entry = object(row.value);
    if (row.key !== undefined && !entry) continue;
    if (!entry && typeof row.value !== 'string') continue;
    const rawId = row.key || entry?.id || row.value;
    if (typeof rawId !== 'string' || !rawId.trim() || rawId.length > 300 || /[\u0000-\u001f]/.test(rawId)) continue;
    const id = rawId.trim();
    if (result.has(id)) continue;
    const name = [entry?.display_name, entry?.displayName, entry?.name].find(v => typeof v === 'string' && v.trim() && v.length <= 200 && !/[\u0000-\u001f]/.test(v))?.trim() ?? id;
    result.set(id, { id, name, ...entry ? discoverModelMetadata(entry) : {} });
    if (result.size >= 1000) break;
  }
  return [...result.values()];
}

export async function readModelJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new Error('Empty model response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Model response too large');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Model response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel(); }
}
