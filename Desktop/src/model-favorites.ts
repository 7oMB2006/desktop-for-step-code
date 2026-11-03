import type { Model } from './contracts';

export type ModelIdentity = Pick<Model, 'provider' | 'id'>;
export type ModelFavoriteChange = ModelIdentity & { favorite: boolean };
export const FAVORITE_MODEL_LIMIT = 100;
export const modelKey = (model: ModelIdentity) => JSON.stringify([model.provider, model.id]);

export function normalizeFavoriteModels(value: unknown): ModelIdentity[] {
  if (!Array.isArray(value)) return [];
  const result: ModelIdentity[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 1000)) {
    if (!item || typeof item !== 'object'
      || typeof item.provider !== 'string' || !item.provider.trim() || item.provider.length > 200
      || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 300) continue;
    const model = { provider: item.provider, id: item.id };
    const key = modelKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
    if (result.length === FAVORITE_MODEL_LIMIT) break;
  }
  return result;
}

export function changeFavoriteModel(value: unknown, change: unknown): ModelIdentity[] {
  if (!change || typeof change !== 'object' || !('favorite' in change) || typeof change.favorite !== 'boolean')
    throw new Error('Invalid model favorite');
  const [model] = normalizeFavoriteModels([change]);
  if (!model) throw new Error('Invalid model identity');
  const favorites = normalizeFavoriteModels(value);
  const key = modelKey(model);
  if (!change.favorite) return favorites.filter(item => modelKey(item) !== key);
  if (favorites.some(item => modelKey(item) === key)) return favorites;
  if (favorites.length >= FAVORITE_MODEL_LIMIT) throw new Error('Model favorite limit reached');
  return [...favorites, model];
}

export function modelListGroups(models: Model[], saved: unknown, query: string) {
  const catalog = new Map<string, Model>();
  for (const model of models) {
    const key = modelKey(model);
    if (!catalog.has(key)) catalog.set(key, model);
  }
  const favorites = normalizeFavoriteModels(saved).flatMap(model => {
    const available = catalog.get(modelKey(model));
    return available ? [available] : [];
  });
  const favoriteKeys = new Set(favorites.map(modelKey));
  const available = [...catalog.values()].filter(model => !favoriteKeys.has(modelKey(model)));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) return {
    favorites: [] as Model[],
    available: [...favorites, ...available].filter(model => {
      const text = [model.name, model.id, model.providerName, model.provider].filter(Boolean).join(' ').toLowerCase();
      return terms.every(term => text.includes(term));
    }),
  };
  return { favorites, available };
}
