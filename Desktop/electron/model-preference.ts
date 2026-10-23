import type { Model } from '../src/contracts';
import { activeHistory, type HistoryEntry } from './session-branching';
import { isImportedHistoryEntry } from './imported-history';
import type { SessionRuntime } from './session-runtimes';

export type ModelPreference = Pick<Model, 'provider' | 'id' | 'name'>;

export function modelPreference(value: unknown): ModelPreference | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { provider, id, name } = value as Partial<ModelPreference>;
  if (typeof provider !== 'string' || !provider.trim() || provider.length > 200
    || typeof id !== 'string' || !id.trim() || id.length > 300) return undefined;
  return { provider, id, name: typeof name === 'string' && name.length <= 300 && name.trim() ? name : id };
}

export function preferredModel(models: Model[], preferred: ModelPreference | undefined, fallback?: Model): Model | undefined {
  if (!preferred) return fallback;
  return models.find(model => model.provider === preferred.provider && model.id === preferred.id) ?? preferred;
}

export function savedSessionModel(entries: HistoryEntry[], leafId: string | null): ModelPreference | undefined {
  const path = activeHistory(entries, leafId).filter(entry => !isImportedHistoryEntry(entry)).reverse();
  for (const entry of path) {
    if (entry.type === 'model_change') {
      const change = entry as HistoryEntry & { provider?: string; modelId?: string };
      const model = modelPreference({ provider: change.provider, id: change.modelId });
      if (model) return model;
    }
  }
  for (const entry of path) {
    if (entry.type === 'message' && entry.message?.role === 'assistant') {
      const model = modelPreference({ provider: entry.message.provider, id: entry.message.model });
      if (model) return model;
    }
  }
}

export class UnavailableModelError extends Error {}

export function unavailableModel(model: ModelPreference, language: 'zh' | 'en' = 'en') {
  return new UnavailableModelError(language === 'zh'
    ? `模型 ${model.provider}/${model.id} 当前不可用。请检查供应商配置或稍后重试，未自动切换到其他模型。`
    : `Model ${model.provider}/${model.id} is unavailable. Check its provider configuration or retry; no alternative model was selected.`);
}

export async function restoreSelectedModel(worker: SessionRuntime, expected?: ModelPreference, language: 'zh' | 'en' = 'en') {
  if (!expected || worker.state?.model?.provider === expected.provider && worker.state.model.id === expected.id) return;
  const selected = worker.models.find(model => model.provider === expected.provider && model.id === expected.id);
  if (!selected) throw unavailableModel(expected, language);
  await worker.rpc.request('set_model', { provider: selected.provider, modelId: selected.id });
  worker.state = await worker.rpc.request('get_state');
  if (worker.state?.model?.provider !== expected.provider || worker.state.model.id !== expected.id)
    throw unavailableModel(expected, language);
}
