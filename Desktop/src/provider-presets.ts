import type { ProviderApi, ProviderInfo } from './contracts';
import { resolveCatalogProvider } from './provider-catalog';

export type ProviderBrandId = 'deepseek' | 'kimi' | 'zhipu' | 'bailian' | 'minimax' | 'openai' | 'anthropic' | 'gemini' | 'siliconflow' | 'ark';
export type ProviderBilling = 'usage' | 'subscription';
export const providerBillingLabels: Record<ProviderBilling, readonly [string, string]> = {
  usage: ['按量', 'Pay as you go'],
  subscription: ['套餐', 'Subscription'],
};
type Localized = readonly [zh: string, en: string];
type Preset = {
  id: string;
  brand: ProviderBrandId;
  name: Localized;
  label: Localized;
  billing: ProviderBilling;
  baseUrl: string;
  api: ProviderApi;
  recommendations?: readonly string[];
  listFromEndpoint?: false;
  officialApiOnly?: true;
  subscriptionKeyPrefix?: string;
  interactiveOnly?: true;
};

const miniMaxUrl = 'https://api.minimax.cn/v1';

export const providerPresets: readonly Preset[] = [
  {
    id: 'deepseek-api', brand: 'deepseek', name: ['DeepSeek', 'DeepSeek'], label: ['开放平台 · 按量', 'API · Pay as you go'], billing: 'usage',
    baseUrl: 'https://api.deepseek.com', api: 'openai-completions', recommendations: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'kimi-api-cn', brand: 'kimi', name: ['Kimi 开放平台', 'Kimi Open Platform'],
    label: ['国内 · 开放平台 API Key', 'China · Open Platform API key'], billing: 'usage',
    baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions',
  },
  {
    id: 'kimi-code-cn', brand: 'kimi', name: ['Kimi Code', 'Kimi Code'],
    label: ['国内 · Kimi Code API Key', 'China · Kimi Code API key'], billing: 'subscription',
    baseUrl: 'https://api.kimi.com/coding/v1', api: 'openai-responses', listFromEndpoint: false,
    recommendations: ['kimi-for-coding', 'k3.1-pro'],
  },
  {
    id: 'zhipu-api-cn', brand: 'zhipu', name: ['智谱 GLM', 'Zhipu GLM'],
    label: ['通用 API · 按量', 'Standard API · Pay as you go'], billing: 'usage', officialApiOnly: true,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', listFromEndpoint: false,
    recommendations: ['glm-5.3'],
  },
  {
    id: 'bailian-api-cn', brand: 'bailian', name: ['阿里云百炼', 'Alibaba Cloud Model Studio'],
    label: ['北京 · 按量 API', 'Beijing · Pay as you go'], billing: 'usage', officialApiOnly: true,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', listFromEndpoint: false,
    recommendations: ['qwen-plus'],
  },
  {
    id: 'bailian-token-plan-cn', brand: 'bailian', name: ['百炼 Token Plan', 'Bailian Token Plan'],
    label: ['北京 · Token Plan 专属 Key', 'Beijing · Token Plan API key'], billing: 'subscription', officialApiOnly: true,
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions',
    listFromEndpoint: false, recommendations: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus'],
    subscriptionKeyPrefix: 'sk-sp-', interactiveOnly: true,
  },
  {
    id: 'minimax-api-cn', brand: 'minimax', name: ['MiniMax', 'MiniMax'],
    label: ['国内 · 开放平台 API Key', 'China · Open Platform API key'], billing: 'usage', officialApiOnly: true,
    baseUrl: miniMaxUrl, api: 'openai-completions',
  },
  {
    id: 'minimax-m-plan-cn', brand: 'minimax', name: ['MiniMax M Plan', 'MiniMax M Plan'],
    label: ['国内 · M Plan 订阅 Key', 'China · M Plan subscription key'], billing: 'subscription', officialApiOnly: true,
    baseUrl: miniMaxUrl, api: 'openai-completions',
    listFromEndpoint: false, recommendations: ['MiniMax-M3.1-Flash'], subscriptionKeyPrefix: 'sk-cp-',
  },
  {
    id: 'openai-api', brand: 'openai', name: ['OpenAI', 'OpenAI'],
    label: ['官方 API Key', 'Official API key'], billing: 'usage', officialApiOnly: true,
    baseUrl: 'https://api.openai.com/v1', api: 'openai-responses',
  },
  {
    id: 'anthropic-api', brand: 'anthropic', name: ['Anthropic', 'Anthropic'],
    label: ['Claude 官方 API Key', 'Official Claude API key'], billing: 'usage', officialApiOnly: true,
    baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages',
  },
  {
    id: 'gemini-api', brand: 'gemini', name: ['Gemini', 'Gemini'],
    label: ['官方 API Key', 'Official API key'], billing: 'usage', officialApiOnly: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', api: 'openai-completions',
  },
  {
    id: 'siliconflow-api-cn', brand: 'siliconflow', name: ['硅基流动', 'SiliconFlow'],
    label: ['国内 · 官方 API Key', 'China · Official API key'], billing: 'usage', officialApiOnly: true,
    baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions',
  },
  {
    id: 'ark-api-cn', brand: 'ark', name: ['火山方舟', 'Volcengine Ark'],
    label: ['北京 · 官方 API Key', 'Beijing · Official API key'], billing: 'usage', officialApiOnly: true,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions',
  },
];

export function sameProviderEndpoint(left: string, right: string): boolean {
  try {
    return new URL(left).href.replace(/\/+$/, '') === new URL(right).href.replace(/\/+$/, '');
  } catch { return false; }
}

type PresetRoute = Pick<ProviderInfo, 'baseUrl' | 'api' | 'presetId'>;

function matchingPresets(provider: PresetRoute) {
  return providerPresets.filter(item => item.api === provider.api && sameProviderEndpoint(item.baseUrl, provider.baseUrl));
}

export function providerPresetFor(provider: PresetRoute) {
  const matches = matchingPresets(provider);
  return provider.presetId !== undefined ? matches.find(item => item.id === provider.presetId)
    : matches.length === 1 ? matches[0] : undefined;
}

export function providerBrandFor(provider: PresetRoute): ProviderBrandId | undefined {
  const brand = matchingPresets(provider)[0]?.brand;
  if (brand) return brand;
  const official = resolveCatalogProvider(provider.baseUrl, provider.api);
  if (official === 'deepseek' || official === 'openai' || official === 'anthropic') return official;
}

export function providerRequiresOfficialKey(provider: PresetRoute) {
  return matchingPresets(provider).some(preset => preset.officialApiOnly);
}

export function sameProviderCredentialScope(left: PresetRoute, right: PresetRoute) {
  return left.presetId === right.presetId && sameProviderEndpoint(left.baseUrl, right.baseUrl)
    && (left.presetId === undefined || left.api === right.api);
}

export function providerCredentialIssue(provider: PresetRoute & { keyless: boolean }, key?: string) {
  const matches = matchingPresets(provider);
  const preset = providerPresetFor(provider);
  if (provider.presetId !== undefined && !preset) return 'preset-mismatch';
  if (providerRequiresOfficialKey(provider) &&
      (provider.keyless || !key || (matches[0]?.brand === 'anthropic' && key.includes('sk-ant-oat')))) return 'official-key';
  if (preset?.subscriptionKeyPrefix && !key?.startsWith(preset.subscriptionKeyPrefix)) return 'plan-key';
  if (preset?.billing === 'usage' && key && providerPresets.some(item =>
      item.brand === preset.brand && item.subscriptionKeyPrefix && key.startsWith(item.subscriptionKeyPrefix))) return 'usage-key';
  return undefined;
}

export function providerPresetDraft(preset: Preset, language: string): ProviderInfo {
  return {
    id: '', name: preset.name[language === 'en' ? 1 : 0], baseUrl: preset.baseUrl, api: preset.api,
    presetId: preset.id, keyless: false, enabled: true, hasKey: false, models: [],
  };
}
