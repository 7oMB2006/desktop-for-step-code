import type { ProviderApi } from './contracts';

export const catalogProviders = [
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1', apis: ['openai-completions', 'openai-responses'] },
  { id: 'anthropic', label: 'Anthropic', endpoint: 'https://api.anthropic.com', apis: ['anthropic-messages'] },
  { id: 'deepseek', label: 'DeepSeek', endpoint: 'https://api.deepseek.com', apis: ['openai-completions'] },
  { id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', apis: ['openai-completions'] },
  { id: 'xai', label: 'xAI', endpoint: 'https://api.x.ai/v1', apis: ['openai-completions', 'openai-responses'] },
  { id: 'mistral', label: 'Mistral', endpoint: 'https://api.mistral.ai/v1', apis: ['openai-completions'] },
] as const;
export type CatalogProvider = typeof catalogProviders[number]['id'];
export type CatalogSelection = CatalogProvider | 'none';

export function resolveCatalogProvider(baseUrl: string, api: ProviderApi, selection?: CatalogSelection): CatalogProvider | undefined {
  if (selection === 'none') return;
  if (selection !== undefined) return catalogProviders.find(p => p.id === selection)?.id;
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash) return;
    const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    return catalogProviders.find(p => (p.apis as readonly string[]).includes(api) &&
      (p.endpoint === endpoint || ['anthropic', 'deepseek'].includes(p.id) && `${p.endpoint}/v1` === endpoint))?.id;
  } catch { return; }
}
