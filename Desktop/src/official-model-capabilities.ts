import type { DiscoveredProviderModel, ProviderApi } from './contracts';

// Exact IDs only. This is a dated documentation snapshot, not account entitlement
// or a claim that /models returned these fields. Relay endpoints never inherit it.
const reviewed: Record<string, { levels: string[]; defaultLevel?: string; requiresResponses: boolean }> = {
  'gpt-6.1-terra': { levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium', requiresResponses: true },
  'gpt-6.1-sol': { levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium', requiresResponses: true },
  'gpt-6-astra': { levels: ['low', 'medium', 'high', 'xhigh', 'max'], requiresResponses: true },
  'gpt-6-luna': { levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium', requiresResponses: false },
  'gpt-6-sol': { levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'medium', requiresResponses: false },
};
export function officialModelCapabilities(baseUrl: string, api: ProviderApi, id: string): DiscoveredProviderModel | undefined {
  try {
    const url = new URL(baseUrl);
    if (url.origin !== 'https://api.openai.com' || url.pathname.replace(/\/+$/, '') !== '/v1' ||
        url.username || url.password || url.search || url.hash || api === 'anthropic-messages') return;
  } catch { return; }
  if (!Object.hasOwn(reviewed, id)) return;
  const entry = reviewed[id];
  const levels = api === 'openai-completions' && !entry.requiresResponses ? ['off'] : [...entry.levels];
  return {
    id, name: id, reasoning: levels.some(level => level !== 'off'), vision: true,
    contextWindow: 1050000, maxTokens: 128000, declaredInput: ['text', 'image'], declaredOutput: ['text'],
    thinkingLevels: levels, thinkingDefaultLevel: entry.defaultLevel && levels.includes(entry.defaultLevel) ? entry.defaultLevel : levels.length === 1 ? levels[0] : undefined,
    thinkingMapping: Object.fromEntries(levels.map(level => [level, level === 'off' ? 'none' : level])),
    capabilitySources: { contextWindow: 'official', maxTokens: 'official', vision: 'official', thinking: 'official' },
    officialDocumentation: { url: `https://developers.openai.com/api/docs/models/${id}`, verifiedAt: '2026-11-16' },
  };
}
export function officialResponsesRequired(baseUrl: string, api: ProviderApi, id: string): boolean {
  return api === 'openai-completions' && Boolean(officialModelCapabilities(baseUrl, api, id) && reviewed[id]?.requiresResponses);
}
export function enrichDiscoveredModel(baseUrl: string, api: ProviderApi, discovered: DiscoveredProviderModel): DiscoveredProviderModel {
  const official = officialModelCapabilities(baseUrl, api, discovered.id);
  if (!official) return discovered;
  const merged = { ...official, ...discovered, capabilitySources: { ...official.capabilitySources } };
  for (const field of ['contextWindow', 'maxTokens', 'vision'] as const) {
    if (discovered[field] !== undefined) merged.capabilitySources[field] = 'upstream';
  }
  if (discovered.reasoning === false || discovered.thinkingLevels) {
    merged.capabilitySources.thinking = 'upstream';
    merged.thinkingMapping = undefined;
    merged.thinkingLevels = discovered.reasoning === false ? ['off'] : discovered.thinkingLevels;
    merged.thinkingDefaultLevel = discovered.reasoning === false ? 'off' : discovered.thinkingDefaultLevel;
  }
  return merged;
}
