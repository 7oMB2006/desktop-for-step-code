import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { CustomProvider, ProviderInfo, Model, ProviderApi, DiscoveredProviderModel } from '../src/contracts';

const FIELD = '__desktopCustomProviders';
const PREFIX = 'desktop-custom-';
const APIS: ProviderApi[] = ['openai-completions', 'openai-responses', 'anthropic-messages'];
type AuthData = Record<string, unknown>;
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const MODALITIES = ['text', 'image', 'audio', 'video', 'file'];
function stringSubset(raw: unknown, allowed: string[]): string[] | undefined {
  return Array.isArray(raw) && raw.length > 0 && raw.every(v => typeof v === 'string' && allowed.includes(v)) ? allowed.filter(v => raw.includes(v)) : undefined;
}
export function discoverModelMetadata(entry: Record<string, any>): Partial<DiscoveredProviderModel> {
  const result: Partial<DiscoveredProviderModel> = {};
  const input = stringSubset(entry.input_modalities ?? entry.architecture?.input_modalities, MODALITIES);
  const output = stringSubset(entry.output_modalities ?? entry.architecture?.output_modalities, MODALITIES);
  if (input) { result.declaredInput = input; result.vision = input.includes('image'); }
  if (output) result.declaredOutput = output;
  if (typeof entry.reasoning === 'boolean') result.reasoning = entry.reasoning;
  const levels = stringSubset(entry.thinking_levels ?? entry.supported_reasoning_efforts ?? entry.effort?.supported_levels, THINKING_LEVELS);
  if (levels) { result.thinkingLevels = levels; result.reasoning = levels.some(v => v !== 'off'); }
  if (levels && typeof entry.effort?.default_level === 'string' && levels.includes(entry.effort.default_level)) result.thinkingDefaultLevel = entry.effort.default_level;
  const context = entry.context_window ?? entry.context_length;
  const max = entry.max_output_tokens ?? entry.top_provider?.max_completion_tokens;
  if (Number.isSafeInteger(context) && context > 0 && context <= 10000000) result.contextWindow = context;
  if (Number.isSafeInteger(max) && max > 0 && max <= 10000000 && (result.contextWindow === undefined || max <= result.contextWindow)) result.maxTokens = max;
  return result;
}
export async function discoverProviderModels(auth: AuthData, raw: unknown, key?: unknown): Promise<DiscoveredProviderModel[]> {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid provider');
  const p = raw as CustomProvider;
  const url = new URL(text(p.baseUrl, 2048, 'Base URL'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !APIS.includes(p.api)) throw new Error('Invalid model endpoint');
  if (typeof p.keyless !== 'boolean') throw new Error('Invalid provider state');
  if (key !== undefined && (typeof key !== 'string' || key.length > 8192 || /[\r\n\u0000]/.test(key))) throw new Error('Invalid API key');
  const saved = providerList(auth).find(item => item.id === p.id);
  const credential = p.keyless ? undefined : (typeof key === 'string' && key.trim() ? key.trim() : saved ? (auth[saved.id] as { key?: string } | undefined)?.key : undefined);
  if (!p.keyless && !credential) throw new Error('API key is required');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (p.api === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
    if (credential) headers['x-api-key'] = credential;
  } else if (credential) headers.Authorization = `Bearer ${credential}`;
  try {
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Model discovery HTTP ${response.status}`);
    if (!response.body) throw new Error('Empty model response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new Error('Model response too large');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(body?.data)) throw new Error('Invalid model list');
    const result = new Map<string, DiscoveredProviderModel>();
    for (const entry of body.data) {
      if (typeof entry?.id !== 'string' || !entry.id.trim() || entry.id.length > 300 || /[\u0000-\u001f]/.test(entry.id)) continue;
      const id = entry.id.trim();
      const displayName = [entry.display_name, entry.name].find(value => typeof value === 'string' && value.trim() && value.length <= 200 && !/[\u0000-\u001f]/.test(value));
      const name = displayName?.trim() ?? id;
      result.set(id, { id, name, ...discoverModelMetadata(entry) });
      if (result.size >= 1000) break;
    }
    return [...result.values()];
  } catch (error) {
    if (error instanceof Error && /^Model discovery HTTP \d+$/.test(error.message)) throw error;
    throw new Error('Could not retrieve model list');
  }
}
function text(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || value.length > max || !value.trim() || /[\u0000-\u001f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function integer(value: unknown, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max) throw new Error('Invalid token limit');
  return value as number;
}
export function validateProvider(raw: unknown): CustomProvider {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid provider');
  const p = raw as CustomProvider;
  const id = p.id === '' ? `${PREFIX}${randomUUID()}` : text(p.id, 80, 'provider ID');
  if (!/^desktop-custom-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid provider ID');
  const url = new URL(text(p.baseUrl, 2048, 'Base URL'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) base address without credentials, query or fragment');
  if (!APIS.includes(p.api)) throw new Error('Unsupported API format');
  if (typeof p.enabled !== 'boolean' || typeof p.keyless !== 'boolean') throw new Error('Invalid provider state');
  if (!Array.isArray(p.models) || !p.models.length || p.models.length > 100) throw new Error('Add between 1 and 100 models');
  const ids = new Set<string>();
  const models = p.models.map(m => {
    const modelId = text(m?.id, 300, 'model ID');
    if (ids.has(modelId)) throw new Error('Duplicate model ID');
    ids.add(modelId);
    if (typeof m.reasoning !== 'boolean' || typeof m.vision !== 'boolean') throw new Error('Invalid model capabilities');
    const contextWindow = integer(m.contextWindow, 10000000);
    const maxTokens = integer(m.maxTokens, 10000000);
    if (maxTokens > contextWindow) throw new Error('Output limit exceeds context window');
    const thinkingLevels = m.thinkingLevels === undefined ? undefined : stringSubset(m.thinkingLevels, THINKING_LEVELS);
    if (m.thinkingLevels !== undefined && !thinkingLevels) throw new Error('Invalid thinking levels');
    if (thinkingLevels && thinkingLevels.some(v => v !== 'off') !== m.reasoning) throw new Error('Thinking levels do not match reasoning capability');
    const declaredThinkingLevels = m.declaredThinkingLevels === undefined ? undefined : stringSubset(m.declaredThinkingLevels, THINKING_LEVELS);
    if (m.declaredThinkingLevels !== undefined && !declaredThinkingLevels) throw new Error('Invalid declared thinking levels');
    let thinkingControl = m.thinkingControl;
    if (thinkingControl) {
      const levels = stringSubset(thinkingControl.levels, THINKING_LEVELS);
      if (!['upstream', 'manual'].includes(thinkingControl.source) || !levels) throw new Error('Invalid thinking control');
      const mapping = thinkingControl.mapping;
      if (mapping !== undefined && (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
          Object.keys(mapping).some(level => !levels.includes(level)) ||
          levels.some(level => typeof mapping[level] !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(mapping[level])))) throw new Error('Invalid thinking mapping');
      if (thinkingControl.source === 'upstream' && (mapping || !declaredThinkingLevels || JSON.stringify(levels) !== JSON.stringify(declaredThinkingLevels))) throw new Error('Invalid upstream thinking control');
      if (thinkingControl.adaptive !== undefined && (typeof thinkingControl.adaptive !== 'boolean' || p.api !== 'anthropic-messages' || thinkingControl.source !== 'manual')) throw new Error('Invalid adaptive thinking control');
      if (JSON.stringify(levels) !== JSON.stringify(thinkingLevels)) throw new Error('Thinking control does not match levels');
      if (thinkingControl.defaultLevel !== undefined && !levels.includes(thinkingControl.defaultLevel)) throw new Error('Invalid default thinking level');
      thinkingControl = { source: thinkingControl.source, levels, ...(thinkingControl.defaultLevel !== undefined ? { defaultLevel: thinkingControl.defaultLevel } : {}), ...(thinkingControl.adaptive !== undefined ? { adaptive: thinkingControl.adaptive } : {}), ...(mapping ? { mapping: Object.fromEntries(levels.map(level => [level, mapping[level]])) } : {}) };
    }
    const declaredInput = m.declaredInput === undefined ? undefined : stringSubset(m.declaredInput, MODALITIES);
    const declaredOutput = m.declaredOutput === undefined ? undefined : stringSubset(m.declaredOutput, MODALITIES);
    if ((m.declaredInput !== undefined && !declaredInput) || (m.declaredOutput !== undefined && !declaredOutput)) throw new Error('Invalid modalities');
    if (m.metadataSource !== undefined && !['manual', 'upstream'].includes(m.metadataSource)) throw new Error('Invalid metadata source');
    return { id: modelId, name: text(m.name || modelId, 200, 'model name'), reasoning: m.reasoning, vision: m.vision, contextWindow, maxTokens,
      ...(thinkingLevels ? { thinkingLevels } : {}), ...(thinkingControl ? { thinkingControl } : {}), ...(declaredThinkingLevels ? { declaredThinkingLevels } : {}), ...(declaredInput ? { declaredInput } : {}), ...(declaredOutput ? { declaredOutput } : {}), ...(m.metadataSource ? { metadataSource: m.metadataSource } : {}) };
  });
  return { id, name: text(p.name, 100, 'provider name'), baseUrl: url.href.replace(/\/$/, ''), api: p.api, enabled: p.enabled, keyless: p.keyless, models };
}
export function providerList(auth: AuthData): CustomProvider[] {
  if (auth[FIELD] === undefined) return [];
  if (!Array.isArray(auth[FIELD]) || auth[FIELD].length > 50) throw new Error('Invalid saved providers');
  return auth[FIELD].map(validateProvider);
}
export function providerInfos(auth: AuthData): ProviderInfo[] {
  return providerList(auth).map(p => ({ ...p, hasKey: Boolean((auth[p.id] as { key?: string } | undefined)?.key) }));
}
export function saveProviderAuth(auth: AuthData, raw: unknown, key?: unknown): AuthData {
  const provider = validateProvider(raw);
  const providers = providerList(auth);
  if (!providers.some(p => p.id === provider.id) && providers.length >= 50) throw new Error('Maximum 50 providers');
  const next = { ...auth };
  if (key !== undefined) {
    if (typeof key !== 'string' || key.length > 8192 || /[\r\n\u0000]/.test(key)) throw new Error('Invalid API key');
    if (key.trim()) next[provider.id] = { type: 'api_key', key: key.trim() };
    else delete next[provider.id];
  }
  if (!provider.keyless && !(next[provider.id] as { key?: string } | undefined)?.key) throw new Error('API key is required');
  next[FIELD] = providers.some(p => p.id === provider.id)
    ? providers.map(p => p.id === provider.id ? provider : p) : [...providers, provider];
  return next;
}
export function deleteProviderAuth(auth: AuthData, id: unknown): AuthData {
  const providers = providerList(auth);
  if (typeof id !== 'string' || !providers.some(p => p.id === id)) throw new Error('Unknown provider');
  const next: AuthData = { ...auth, [FIELD]: providers.filter(p => p.id !== id) };
  delete next[id];
  return next;
}
const keylessToken = (id: string) => `desktop-no-auth-${id}`;
export function keylessEndpoints(auth: AuthData) {
  return providerList(auth).filter(p => p.enabled && p.keyless).map(p => ({ baseUrl: p.baseUrl, token: keylessToken(p.id) }));
}
export function keylessEnvironment(auth: AuthData, bootstrap: string): NodeJS.ProcessEnv {
  const endpoints = keylessEndpoints(auth);
  return endpoints.length ? {
    STEPCODE_DESKTOP_KEYLESS_ENDPOINTS: JSON.stringify(endpoints),
    NODE_OPTIONS: `--require ${JSON.stringify(bootstrap.replace(/\\/g, '/'))}`,
  } : {};
}
// Only credentials reach the runtime. Desktop metadata stays in the encrypted vault.
export function runtimeAuth(auth: AuthData): AuthData {
  const next = { ...auth };
  delete next[FIELD];
  for (const p of providerList(auth)) {
    if (!p.enabled) delete next[p.id];
    else if (p.keyless) next[p.id] = { type: 'api_key', key: keylessToken(p.id) };
    else {
      const key = (auth[p.id] as { key?: string } | undefined)?.key;
      if (key) {
        // Upstream credentials support !commands/$templates; UI keys are always literals.
        const escaped = key.replace(/\$/g, '$$$$');
        next[p.id] = { type: 'api_key', key: escaped.startsWith('!') ? `$${escaped}` : escaped };
      }
    }
  }
  return next;
}
export function mergeRuntimeAuth(auth: AuthData, credentials: AuthData): AuthData {
  const next = { ...credentials };
  if (auth[FIELD] !== undefined) next[FIELD] = auth[FIELD];
  for (const p of providerList(auth)) {
    if (auth[p.id] !== undefined) next[p.id] = auth[p.id];
    else delete next[p.id];
  }
  return next;
}
export function providerModelNames(models: Model[], auth: AuthData): Model[] {
  const providers = new Map(providerList(auth).map(p => [p.id, p]));
  return models.map(m => {
    const p = providers.get(m.provider);
    const configured = p?.models.find(v => v.id === m.id);
    const controlled = configured?.thinkingLevels?.length && (p?.api !== 'anthropic-messages' || configured.thinkingControl?.adaptive === true);
    return p ? { ...m, providerName: p.name, ...(configured ? { thinkingServiceDefault: !controlled, thinkingLevels: controlled ? configured.thinkingLevels : [], input: configured.vision ? ['text', 'image'] : ['text'], contextWindow: configured.contextWindow, maxTokens: configured.maxTokens,
      declaredInput: configured.declaredInput, declaredOutput: configured.declaredOutput, metadataSource: configured.metadataSource ?? 'manual' } : {}) } : m;
  });
}
export async function projectProviders(root: string, auth: AuthData) {
  const providers = providerList(auth);
  const path = join(root, 'models.json');
  let config: Record<string, any> = {};
  try { config = JSON.parse(await readFile(path, 'utf8')); }
  catch (error: any) { if (error.code !== 'ENOENT') throw new Error('Cannot read model configuration'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config.providers !== undefined && (!config.providers || typeof config.providers !== 'object' || Array.isArray(config.providers)))) throw new Error('Invalid model configuration');
  const managed = Object.keys(config.providers ?? {}).some(id => id.startsWith(PREFIX));
  if (!providers.length && !managed) return;
  const entries = Object.fromEntries(Object.entries(config.providers ?? {}).filter(([id]) => !id.startsWith(PREFIX)));
  for (const p of providers.filter(p => p.enabled)) entries[p.id] = {
    baseUrl: p.baseUrl, api: p.api,
    models: p.models.map(m => ({ id: m.id, name: m.name, reasoning: Boolean(m.thinkingLevels?.length && (p.api !== 'anthropic-messages' || m.thinkingControl?.adaptive === true)), input: m.vision ? ['text', 'image'] : ['text'],
      thinkingLevelMap: Object.fromEntries(THINKING_LEVELS.map(level => [level, m.thinkingLevels?.includes(level) ? m.thinkingControl?.mapping?.[level] ?? level : null])),
      ...(p.api === 'anthropic-messages' && m.thinkingControl?.adaptive === true ? { compat: { forceAdaptiveThinking: true } } : {}),
      contextWindow: m.contextWindow, maxTokens: m.maxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
  };
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ ...config, providers: entries }, null, 2), { flag: 'wx' });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
