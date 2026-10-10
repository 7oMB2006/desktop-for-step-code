import type { DiscoveredProviderModel, ProviderModel } from './contracts';

// Refresh explicit declarations without replacing a user's control override.
export function importProviderModel(discovered: DiscoveredProviderModel, existing?: ProviderModel): ProviderModel {
  const { thinkingDefaultLevel, ...metadata } = discovered;
  const next: ProviderModel = { reasoning: false, vision: false, contextWindow: 128000, maxTokens: 16384, ...existing, ...metadata };
  next.maxTokens = Math.min(next.maxTokens, next.contextWindow);
  next.declaredThinkingLevels = discovered.thinkingLevels;
  if (existing?.thinkingControl?.source === 'manual' || (existing?.thinkingLevels?.length && !existing.thinkingControl)) {
    next.thinkingLevels = existing.thinkingLevels;
    next.thinkingControl = existing.thinkingControl;
    next.reasoning = existing.reasoning;
  } else if (discovered.thinkingLevels) {
    next.thinkingControl = { source: 'upstream', levels: discovered.thinkingLevels, ...(thinkingDefaultLevel ? { defaultLevel: thinkingDefaultLevel } : {}) };
  } else {
    next.thinkingLevels = undefined;
    next.thinkingControl = undefined;
    next.reasoning = discovered.reasoning ?? false;
  }
  if (existing) next.name = existing.name;
  next.metadataSource = Object.keys(discovered).length > 2 ? 'upstream' : existing?.metadataSource ?? 'manual';
  return next;
}
