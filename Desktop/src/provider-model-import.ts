import type { DiscoveredProviderModel, ProviderModel } from './contracts';

// Refresh explicit declarations without replacing a user's control override.
export function importProviderModel(discovered: DiscoveredProviderModel, existing?: ProviderModel): ProviderModel {
  const { thinkingDefaultLevel, thinkingMapping, catalogMatch: _catalogMatch, ...metadata } = discovered;
  const defaults = { contextWindow: 128000, maxTokens: 16384, vision: false };
  const next: ProviderModel = { reasoning: false, ...defaults, ...existing, ...metadata };
  next.catalogMetadata = discovered.catalogMetadata;
  next.officialDocumentation = discovered.officialDocumentation;
  next.capabilitySources = { contextWindow: 'default', maxTokens: 'default', vision: 'default', thinking: 'default', ...existing?.capabilitySources, ...discovered.capabilitySources };
  for (const field of ['contextWindow', 'maxTokens', 'vision'] as const) {
    if (discovered[field] === undefined && ['upstream', 'official', 'catalog'].includes(existing?.capabilitySources?.[field] ?? '')) {
      Object.assign(next, { [field]: defaults[field] });
      next.capabilitySources[field] = 'default';
    }
    if (discovered[field] !== undefined && !discovered.capabilitySources?.[field]) next.capabilitySources[field] = 'upstream';
    if (existing?.capabilitySources?.[field] === 'manual') {
      Object.assign(next, { [field]: existing[field] });
      next.capabilitySources[field] = 'manual';
    }
  }
  if (next.maxTokens > next.contextWindow) {
    next.maxTokens = next.contextWindow;
    next.capabilitySources.maxTokens = next.capabilitySources.contextWindow === 'manual' ? 'manual' : 'default';
  }
  next.declaredInput = discovered.declaredInput ?? (existing?.capabilitySources?.vision === 'manual' ? existing.declaredInput : undefined);
  if (existing?.capabilitySources?.vision === 'manual' && next.declaredInput) {
    next.declaredInput = existing.vision ? [...new Set([...next.declaredInput, 'image'])] : next.declaredInput.filter(value => value !== 'image');
    if (!next.declaredInput.length) next.declaredInput = ['text'];
  }
  next.declaredOutput = discovered.declaredOutput;
  const manualThinking = existing?.thinkingControl?.source === 'manual' || Boolean(existing?.thinkingLevels?.length && !existing.thinkingControl);
  next.declaredThinkingLevels = discovered.thinkingLevels;
  next.declaredThinkingSource = discovered.thinkingLevels ? discovered.capabilitySources?.thinking === 'catalog' ? 'catalog'
    : discovered.capabilitySources?.thinking === 'official' ? 'official' : 'upstream' : undefined;
  if (discovered.thinkingLevels) {
    const source = next.declaredThinkingSource!;
    next.declaredThinkingLevels = discovered.thinkingLevels;
    next.declaredThinkingSource = source;
    next.capabilitySources.thinking = source;
    if (!manualThinking) {
      next.thinkingControl = { source, levels: discovered.thinkingLevels, ...(thinkingDefaultLevel ? { defaultLevel: thinkingDefaultLevel } : {}), ...(thinkingMapping ? { mapping: thinkingMapping } : {}) };
    }
  } else if (!manualThinking) {
    next.thinkingLevels = undefined;
    next.thinkingControl = undefined;
    next.reasoning = discovered.reasoning ?? false;
    next.capabilitySources.thinking = discovered.reasoning === undefined ? 'default' : 'upstream';
  }
  if (manualThinking && existing) {
    next.thinkingLevels = existing.thinkingLevels;
    next.thinkingControl = existing.thinkingControl;
    next.reasoning = existing.reasoning;
    next.capabilitySources.thinking = 'manual';
  }
  if (existing) next.name = existing.name;
  next.metadataSource = Object.keys(discovered).length > 2 ? 'upstream' : existing?.metadataSource ?? 'manual';
  return next;
}
