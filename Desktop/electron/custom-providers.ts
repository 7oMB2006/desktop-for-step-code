import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { SPEECH_FIELD } from './speech';
import { PLUGIN_HOST_ACCOUNT_FIELD } from './plugin-host-account';
import { WEB_SEARCH_FIELD } from './web-search-config';
import { enrichDiscoveredModel, officialModelCapabilities, officialResponsesRequired } from '../src/official-model-capabilities';
import type { CustomProvider, ProviderInfo, Model, ProviderApi, DiscoveredProviderModel } from '../src/contracts';
import { catalogProviders, resolveCatalogProvider } from '../src/provider-catalog';
import { providerBrandFor, providerCredentialIssue, providerPresetFor, sameProviderCredentialScope } from '../src/provider-presets';
import { THINKING_LEVELS, stringSubset, modelListing, parseModelListing, readModelJson, isArkChatModel } from './provider-discovery';
import type { ModelCatalog } from './model-catalog';
export { THINKING_LEVELS, discoverModelMetadata } from './provider-discovery';

const FIELD = '__desktopCustomProviders';
const PREFIX = 'desktop-custom-';
const APIS: ProviderApi[] = ['openai-completions', 'openai-responses', 'anthropic-messages'];
type AuthData = Record<string, unknown>;
const MODALITIES = ['text', 'image', 'audio', 'video', 'file'];
export function validateProviderCredential(provider: Pick<CustomProvider, 'baseUrl' | 'api' | 'presetId' | 'keyless'>, credential?: string) {
  const issue = providerCredentialIssue(provider, credential);
  if (issue === 'preset-mismatch') throw new Error('Provider preset does not match the API endpoint');
  if (issue === 'official-key') throw new Error('An official API key is required');
  if (issue === 'plan-key') throw new Error('A subscription API key is required for this preset');
  if (issue === 'usage-key') throw new Error('Use the subscription preset for this API key');
}

export async function discoverProviderModels(auth: AuthData, raw: unknown, key?: unknown,
  request: (url: string, init: RequestInit) => Promise<Response> = globalThis.fetch,
  catalog?: Pick<ModelCatalog, 'enrich'>): Promise<DiscoveredProviderModel[]> {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid provider');
  const p = raw as CustomProvider;
  const url = new URL(text(p.baseUrl, 2048, 'Base URL'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !APIS.includes(p.api)) throw new Error('Invalid model endpoint');
  if (typeof p.keyless !== 'boolean') throw new Error('Invalid provider state');
  if (p.catalogProvider !== undefined && p.catalogProvider !== 'none' && !catalogProviders.some(item => item.id === p.catalogProvider)) throw new Error('Invalid catalog provider');
  if (key !== undefined && (typeof key !== 'string' || key.length > 8192 || /[\r\n\u0000]/.test(key))) throw new Error('Invalid API key');
  const saved = providerList(auth).find(item => item.id === p.id);
  const credential = p.keyless ? undefined : typeof key === 'string' && key.trim() ? key.trim()
    : saved && sameProviderCredentialScope(saved, p) ? (auth[saved.id] as { key?: string } | undefined)?.key : undefined;
  if (!p.keyless && !credential) throw new Error('API key is required');
  validateProviderCredential(p, credential);
  const brand = providerBrandFor(p);
  const listing = modelListing(url, p.api, credential);
  if (brand === 'siliconflow') listing.url.searchParams.set('sub_type', 'chat');
  const timeout = AbortSignal.timeout(15000);
  try {
    const response = await request(listing.url.href, { headers: listing.headers, redirect: 'error', signal: timeout, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Model discovery HTTP ${response.status}`);
    }
    const models = parseModelListing(await readModelJson(response, 2 * 1024 * 1024), brand === 'ark' ? isArkChatModel : undefined)
      .map(model => enrichDiscoveredModel(p.baseUrl, p.api, model));
    return catalog ? await catalog.enrich(p, models) : models;
  } catch (error) {
    if (error instanceof Error && /^Model discovery HTTP \d+$/.test(error.message)) throw error;
    if (timeout.aborted) throw new Error('Model discovery timed out');
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
  if (p.presetId !== undefined && !providerPresetFor(p)) throw new Error('Provider preset does not match the API endpoint');
  if (typeof p.enabled !== 'boolean' || typeof p.keyless !== 'boolean') throw new Error('Invalid provider state');
  if (p.catalogProvider !== undefined && p.catalogProvider !== 'none' && !catalogProviders.some(item => item.id === p.catalogProvider)) throw new Error('Invalid catalog provider');
  if (!Array.isArray(p.models) || !p.models.length || p.models.length > 100) throw new Error('Add between 1 and 100 models');
  const ids = new Set<string>();
  const models = p.models.map(m => {
    const modelId = text(m?.id, 300, 'model ID');
    if (ids.has(modelId)) throw new Error('Duplicate model ID');
    ids.add(modelId);
    const official = officialModelCapabilities(p.baseUrl, p.api, modelId);
    const catalog = m.catalogMetadata;
    if (catalog && (catalog.provider !== resolveCatalogProvider(p.baseUrl, p.api, p.catalogProvider) ||
        catalog.modelId !== modelId || typeof catalog.retrievedAt !== 'string' ||
        !Number.isFinite(Date.parse(catalog.retrievedAt)) || catalog.retrievedAt.length > 40 || typeof catalog.stale !== 'boolean')) throw new Error('Invalid catalog metadata');
    if (catalog?.thinkingMapping && (p.api === 'anthropic-messages' || typeof catalog.thinkingMapping !== 'object' || Array.isArray(catalog.thinkingMapping) ||
        Object.entries(catalog.thinkingMapping).some(([level, wire]) => !THINKING_LEVELS.includes(level) || wire !== level && !(level === 'off' && wire === 'none')))) throw new Error('Invalid catalog thinking mapping');
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
      if (!['upstream', 'official', 'catalog', 'manual'].includes(thinkingControl.source) || !levels) throw new Error('Invalid thinking control');
      const mapping = thinkingControl.mapping;
      if (mapping !== undefined && (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
          Object.keys(mapping).some(level => !levels.includes(level)) ||
          levels.some(level => typeof mapping[level] !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(mapping[level])))) throw new Error('Invalid thinking mapping');
      if (thinkingControl.source === 'upstream' && (mapping || !declaredThinkingLevels || JSON.stringify(levels) !== JSON.stringify(declaredThinkingLevels))) throw new Error('Invalid upstream thinking control');
      if (thinkingControl.source === 'catalog' && (!catalog || p.api === 'anthropic-messages' || !mapping ||
          !declaredThinkingLevels || JSON.stringify(levels) !== JSON.stringify(declaredThinkingLevels) ||
          levels.some(level => mapping[level] !== catalog.thinkingMapping?.[level]))) throw new Error('Invalid catalog thinking control');
      if (thinkingControl.source === 'official' && (!official || JSON.stringify(levels) !== JSON.stringify(official.thinkingLevels) ||
          !mapping || levels.some(level => mapping[level] !== official.thinkingMapping?.[level]))) throw new Error('Invalid official thinking control');
      if (thinkingControl.adaptive !== undefined && (typeof thinkingControl.adaptive !== 'boolean' || p.api !== 'anthropic-messages' || thinkingControl.source !== 'manual')) throw new Error('Invalid adaptive thinking control');
      if (JSON.stringify(levels) !== JSON.stringify(thinkingLevels)) throw new Error('Thinking control does not match levels');
      if (thinkingControl.defaultLevel !== undefined && !levels.includes(thinkingControl.defaultLevel)) throw new Error('Invalid default thinking level');
      thinkingControl = { source: thinkingControl.source, levels, ...(thinkingControl.defaultLevel !== undefined ? { defaultLevel: thinkingControl.defaultLevel } : {}), ...(thinkingControl.adaptive !== undefined ? { adaptive: thinkingControl.adaptive } : {}), ...(mapping ? { mapping: Object.fromEntries(levels.map(level => [level, mapping[level]])) } : {}) };
    }
    const declaredInput = m.declaredInput === undefined ? undefined : stringSubset(m.declaredInput, MODALITIES);
    const declaredOutput = m.declaredOutput === undefined ? undefined : stringSubset(m.declaredOutput, MODALITIES);
    if ((m.declaredInput !== undefined && !declaredInput) || (m.declaredOutput !== undefined && !declaredOutput)) throw new Error('Invalid modalities');
    if (m.metadataSource !== undefined && !['manual', 'upstream'].includes(m.metadataSource)) throw new Error('Invalid metadata source');
    if (m.capabilitySources && (typeof m.capabilitySources !== 'object' || Array.isArray(m.capabilitySources) ||
        Object.entries(m.capabilitySources).some(([field, source]) => !['contextWindow', 'maxTokens', 'vision', 'thinking'].includes(field) ||
          !['upstream', 'official', 'catalog', 'manual', 'default'].includes(source) || source === 'official' && !official || source === 'catalog' && !catalog))) throw new Error('Invalid capability sources');
    if (m.officialDocumentation && (!official || m.officialDocumentation.url !== official.officialDocumentation?.url ||
        m.officialDocumentation.verifiedAt !== official.officialDocumentation?.verifiedAt)) throw new Error('Invalid official documentation');
    if (m.declaredThinkingSource !== undefined && !['upstream', 'official', 'catalog'].includes(m.declaredThinkingSource)) throw new Error('Invalid declaration source');
    if (m.declaredThinkingSource === 'official' && !official) throw new Error('Invalid official declaration');
    if (m.declaredThinkingSource === 'catalog' && !catalog) throw new Error('Invalid catalog declaration');
    return { id: modelId, name: text(m.name || modelId, 200, 'model name'), reasoning: m.reasoning, vision: m.vision, contextWindow, maxTokens,
      ...(m.capabilitySources ? { capabilitySources: { ...m.capabilitySources } } : {}),
      ...(m.officialDocumentation ? { officialDocumentation: { ...m.officialDocumentation } } : {}),
      ...(catalog ? { catalogMetadata: { provider: catalog.provider, modelId, retrievedAt: catalog.retrievedAt, stale: catalog.stale,
        ...(catalog.thinkingMapping ? { thinkingMapping: { ...catalog.thinkingMapping } } : {}) } } : {}),
      ...(m.declaredThinkingSource ? { declaredThinkingSource: m.declaredThinkingSource } : {}),
      ...(thinkingLevels ? { thinkingLevels } : {}), ...(thinkingControl ? { thinkingControl } : {}), ...(declaredThinkingLevels ? { declaredThinkingLevels } : {}), ...(declaredInput ? { declaredInput } : {}), ...(declaredOutput ? { declaredOutput } : {}), ...(m.metadataSource ? { metadataSource: m.metadataSource } : {}) };
  });
  return { id, name: text(p.name, 100, 'provider name'), baseUrl: url.href.replace(/\/$/, ''), api: p.api, enabled: p.enabled, keyless: p.keyless,
    ...(p.presetId !== undefined ? { presetId: p.presetId } : {}),
    ...(p.catalogProvider !== undefined ? { catalogProvider: p.catalogProvider } : {}), models };
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
  if (provider.models.some(model => officialResponsesRequired(provider.baseUrl, provider.api, model.id))) throw new Error('This model requires Responses API for tools');
  const providers = providerList(auth);
  const previous = providers.find(p => p.id === provider.id);
  if (!previous && providers.length >= 50) throw new Error('Maximum 50 providers');
  const next = { ...auth };
  if (previous && !sameProviderCredentialScope(previous, provider)) delete next[provider.id];
  if (key !== undefined) {
    if (typeof key !== 'string' || key.length > 8192 || /[\r\n\u0000]/.test(key)) throw new Error('Invalid API key');
    if (key.trim()) next[provider.id] = { type: 'api_key', key: key.trim() };
    else delete next[provider.id];
  }
  if (!provider.keyless && !(next[provider.id] as { key?: string } | undefined)?.key) throw new Error('API key is required');
  validateProviderCredential(provider, (next[provider.id] as { key?: string } | undefined)?.key);
  next[FIELD] = previous
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
  delete next[SPEECH_FIELD];
  delete next[WEB_SEARCH_FIELD];
  delete next[PLUGIN_HOST_ACCOUNT_FIELD];
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
  delete next[SPEECH_FIELD];
  delete next[WEB_SEARCH_FIELD];
  delete next[PLUGIN_HOST_ACCOUNT_FIELD];
  if (auth[SPEECH_FIELD] !== undefined) next[SPEECH_FIELD] = auth[SPEECH_FIELD];
  if (auth[WEB_SEARCH_FIELD] !== undefined) next[WEB_SEARCH_FIELD] = auth[WEB_SEARCH_FIELD];
  if (auth[FIELD] !== undefined) next[FIELD] = auth[FIELD];
  for (const p of providerList(auth)) {
    if (auth[p.id] !== undefined) next[p.id] = auth[p.id];
    else delete next[p.id];
  }
  return next;
}
export function providerModelNames(models: Model[], auth: AuthData): Model[] {
  const providers = new Map(providerList(auth).map(p => [p.id, { provider: p, brand: providerBrandFor(p), billing: providerPresetFor(p)?.billing }]));
  return models.map(m => {
    const connection = providers.get(m.provider);
    if (!connection) return m;
    const { provider, brand, billing } = connection;
    const configured = provider.models.find(v => v.id === m.id);
    const controlled = configured?.thinkingLevels?.length && (provider.api !== 'anthropic-messages' || configured.thinkingControl?.adaptive === true);
    return { ...m, providerName: provider.name, providerBilling: billing, providerBrand: brand, ...(configured ? { thinkingServiceDefault: !controlled, thinkingLevels: controlled ? configured.thinkingLevels : [], input: configured.vision ? ['text', 'image'] : ['text'], contextWindow: configured.contextWindow, maxTokens: configured.maxTokens,
      declaredInput: configured.declaredInput, declaredOutput: configured.declaredOutput, capabilitySources: configured.capabilitySources,
      officialDocumentation: configured.officialDocumentation, metadataSource: configured.metadataSource ?? 'manual' } : {}) };
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
  for (const p of providers.filter(p => p.enabled)) {
    const brand = providerBrandFor(p);
    const chatCompat = p.api === 'openai-completions' && (brand === 'bailian' || brand === 'minimax')
      ? { maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false }
      : undefined;
    entries[p.id] = {
      baseUrl: p.baseUrl, api: p.api,
      models: p.models.map(m => ({ id: m.id, name: m.name, reasoning: Boolean(m.thinkingLevels?.length && (p.api !== 'anthropic-messages' || m.thinkingControl?.adaptive === true)), input: m.vision ? ['text', 'image'] : ['text'],
        thinkingLevelMap: Object.fromEntries(THINKING_LEVELS.map(level => [level, m.thinkingLevels?.includes(level) ? m.thinkingControl?.mapping?.[level] ?? level : null])),
        ...(chatCompat ? { compat: chatCompat } : p.api === 'anthropic-messages' && m.thinkingControl?.adaptive === true ? { compat: { forceAdaptiveThinking: true } } : {}),
        contextWindow: m.contextWindow, maxTokens: m.maxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
    };
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ ...config, providers: entries }, null, 2), { flag: 'wx' });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
