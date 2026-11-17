import type { CustomProvider, DiscoveredProviderModel } from '../src/contracts';
import { resolveCatalogProvider } from '../src/provider-catalog';
import { readModelJson, THINKING_LEVELS } from './provider-discovery';

const CATALOG_URL = 'https://models.dev/api.json';
const TTL = 10 * 60 * 1000;
const MAX_AGE = 24 * 60 * 60 * 1000;
type Catalog = Record<string, { models: Record<string, unknown> }>;
type Snapshot = { data: Catalog; at: number };
const record = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const limit = (v: unknown): number | undefined => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 10000000 ? v as number : undefined;
const modalities = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v) || !v.length || !v.every(item => typeof item === 'string' && ['text', 'image', 'audio', 'video', 'file', 'pdf'].includes(item))) return;
  return [...new Set(v.map(item => item === 'pdf' ? 'file' : item))];
};

// Public metadata is fetched separately: never forward provider keys or URLs.
export class ModelCatalog {
  private cached?: Snapshot;
  private inflight?: Promise<Snapshot>;
  constructor(private request: (url: string, init: RequestInit) => Promise<Response>, private now = Date.now) {}
  private async snapshot(): Promise<Snapshot> {
    if (this.cached && this.now() - this.cached.at < TTL) return this.cached;
    this.inflight ??= (async () => {
      const response = await this.request(CATALOG_URL, {
        headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Catalog unavailable'); }
      const data = await readModelJson(response, 16 * 1024 * 1024);
      if (!record(data) || !Object.values(data).some(p => record(p) && record(p.models))) throw new Error('Invalid catalog');
      return this.cached = { data: data as Catalog, at: this.now() };
    })().finally(() => { this.inflight = undefined; });
    try { return await this.inflight; }
    catch {
      if (this.cached && this.now() - this.cached.at <= MAX_AGE) return this.cached;
      throw new Error('Catalog unavailable');
    }
  }
  async enrich(provider: CustomProvider, models: DiscoveredProviderModel[]): Promise<DiscoveredProviderModel[]> {
    const id = resolveCatalogProvider(provider.baseUrl, provider.api, provider.catalogProvider);
    if (!id || !models.length) return models;
    let snapshot: Snapshot;
    try { snapshot = await this.snapshot(); }
    catch { return models.map(model => ({ ...model, catalogMatch: 'unavailable' })); }
    const entries = snapshot.data[id]?.models;
    return models.map(model => {
      // No prefix stripping, date guessing, global-name lookup or cross-provider fallback.
      const entry = record(entries) && Object.hasOwn(entries, model.id) ? entries[model.id] : undefined;
      if (!record(entry)) return { ...model, catalogMatch: 'none' };
      const next: DiscoveredProviderModel = { ...model, capabilitySources: { ...model.capabilitySources }, catalogMatch: 'exact',
        catalogMetadata: { provider: id, modelId: model.id, retrievedAt: new Date(snapshot.at).toISOString(), stale: this.now() - snapshot.at >= TTL } };
      const fill = (field: 'contextWindow' | 'maxTokens' | 'vision', value: number | boolean | undefined) => {
        if (next[field] === undefined && value !== undefined) {
          Object.assign(next, { [field]: value });
          next.capabilitySources![field] = 'catalog';
        }
      };
      fill('contextWindow', limit(entry.limit?.context));
      const max = limit(entry.limit?.output);
      if (max !== undefined && (next.contextWindow === undefined || max <= next.contextWindow)) fill('maxTokens', max);
      const input = modalities(entry.modalities?.input);
      fill('vision', input?.includes('image'));
      next.declaredInput ??= input;
      next.declaredOutput ??= modalities(entry.modalities?.output);
      // Only effort enums expressible by our current OpenAI adapters are adopted.
      // Boolean reasoning and Anthropic token budgets do not imply usable controls.
      const effort = Array.isArray(entry.reasoning_options) ? entry.reasoning_options.find((v: unknown) => record(v) && v.type === 'effort') : undefined;
      const values: unknown = effort?.values;
      if (!next.thinkingLevels && next.reasoning !== false && entry.reasoning !== false && provider.api !== 'anthropic-messages' &&
          Array.isArray(values) && values.length && values.every(v => typeof v === 'string' && (v === 'none' || THINKING_LEVELS.includes(v))) &&
          !(values.includes('none') && values.includes('off'))) {
        const levels = THINKING_LEVELS.filter(level => values.includes(level === 'off' && values.includes('none') ? 'none' : level));
        next.thinkingLevels = levels;
        next.thinkingMapping = Object.fromEntries(levels.map(level => [level, level === 'off' && values.includes('none') ? 'none' : level]));
        next.catalogMetadata!.thinkingMapping = next.thinkingMapping;
        next.reasoning = levels.some(level => level !== 'off');
        next.capabilitySources!.thinking = 'catalog';
      }
      return next;
    });
  }
}
