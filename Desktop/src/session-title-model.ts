import type { ProviderInfo, ProviderModel } from './contracts';
import type { ModelIdentity } from './model-favorites';

export function titleModelIdentity(value: unknown): ModelIdentity | undefined {
  if (!value || typeof value !== 'object') return;
  const { provider, id } = value as Partial<ModelIdentity>;
  if (typeof provider !== 'string' || !/^desktop-custom-[a-f0-9-]{36}$/.test(provider)
    || typeof id !== 'string' || !id.trim() || id.length > 300 || /[\u0000-\u001f]/.test(id)) return;
  return { provider, id };
}

export function supportsTitleModel(model: ProviderModel) {
  return (!model.declaredInput?.length || model.declaredInput.includes('text'))
    && (!model.declaredOutput?.length || model.declaredOutput.includes('text'));
}

export function titleModelProviders(providers: ProviderInfo[]) {
  return providers.filter(provider => provider.enabled && (provider.keyless || provider.hasKey))
    .map(provider => ({ ...provider, models: provider.models.filter(supportsTitleModel) }))
    .filter(provider => provider.models.length);
}
