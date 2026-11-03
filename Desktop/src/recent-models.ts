import type { Model } from './contracts';

export type RecentModel = Pick<Model, 'provider' | 'id'>;
export const RECENT_MODEL_LIMIT = 5;
export const modelKey = (model: RecentModel) => JSON.stringify([model.provider, model.id]);

export function normalizeRecentModels(value: unknown): RecentModel[] {
  if (!Array.isArray(value)) return [];
  const result: RecentModel[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 100)) {
    if (!item || typeof item !== 'object'
      || typeof item.provider !== 'string' || !item.provider.trim() || item.provider.length > 200
      || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 300) continue;
    const model = { provider: item.provider, id: item.id };
    const key = modelKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
    if (result.length === RECENT_MODEL_LIMIT) break;
  }
  return result;
}

export function rememberRecentModel(history: unknown, model: RecentModel): RecentModel[] {
  return normalizeRecentModels([model, ...normalizeRecentModels(history)]);
}

export function modelListGroups(models: Model[], history: unknown, query: string) {
  const catalog = new Map<string, Model>();
  for (const model of models) {
    const key = modelKey(model);
    if (!catalog.has(key)) catalog.set(key, model);
  }
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) return {
    recent: [] as Model[],
    available: [...catalog.values()].filter(model => {
      const text = [model.name, model.id, model.providerName, model.provider].filter(Boolean).join(' ').toLowerCase();
      return terms.every(term => text.includes(term));
    }),
  };
  const recent = normalizeRecentModels(history).flatMap(model => {
    const available = catalog.get(modelKey(model));
    return available ? [available] : [];
  });
  const recentKeys = new Set(recent.map(modelKey));
  return { recent, available: [...catalog.values()].filter(model => !recentKeys.has(modelKey(model))) };
}
