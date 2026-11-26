export const webSearchProviders = {
  step: { name: ['阶跃搜索', 'Step Search'], note: ['阶跃账户', 'Step account'] },
  tavily: { name: ['Tavily', 'Tavily'], note: ['AI 搜索 · API Key', 'AI search · API key'] },
  exa: { name: ['Exa', 'Exa'], note: ['语义搜索 · API Key', 'Semantic search · API key'] },
  brave: { name: ['Brave Search', 'Brave Search'], note: ['网页搜索 · API Key', 'Web search · API key'] },
  bocha: { name: ['博查', 'Bocha'], note: ['中文搜索 · API Key', 'Chinese web search · API key'] },
  searxng: { name: ['SearXNG', 'SearXNG'], note: ['自托管 · 实例地址', 'Self-hosted · instance URL'] },
} as const;

export type WebSearchProvider = keyof typeof webSearchProviders;
export const webSearchIds = Object.keys(webSearchProviders) as WebSearchProvider[];
export const isWebSearchProvider = (value: unknown): value is WebSearchProvider =>
  typeof value === 'string' && Object.hasOwn(webSearchProviders, value);
export const webSearchOutcomes = {
  success: ['成功', 'Succeeded'], empty: ['无结果', 'No results'],
  timeout: ['请求超时', 'Timed out'], rate: ['服务限流', 'Rate limited'], quota: ['额度不足', 'Quota exhausted'],
  auth: ['凭据无效', 'Invalid credentials'], unavailable: ['服务不可用', 'Service unavailable'],
} as const;
export type WebSearchOutcome = keyof typeof webSearchOutcomes;
export type WebSearchAttempt = { provider: WebSearchProvider; outcome: WebSearchOutcome };
export interface WebSearchSettings {
  revision: number;
  enabled: boolean;
  fallback: boolean;
  step?: 'plan' | 'api';
  stepRegion?: 'cn' | 'oversea';
  order: WebSearchProvider[];
  configured: WebSearchProvider[];
  instance?: string;
}
export type WebSearchEdit =
  | { action: 'policy'; field: 'enabled' | 'fallback'; value: boolean }
  | { action: 'order'; order: WebSearchProvider[] }
  | { action: 'service'; id: WebSearchProvider; enabled: boolean; credential?: string }
  | { action: 'remove'; id: Exclude<WebSearchProvider, 'step'> };

export interface WebSearchBridge {
  webSearchSettings(): Promise<WebSearchSettings>;
  saveWebSearch(revision: number, edit: WebSearchEdit): Promise<WebSearchSettings>;
}
