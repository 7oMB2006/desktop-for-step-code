import type { Usage } from './contracts';

export interface EstimateRules { planProtected: boolean; apiLegacyCache: boolean }
export interface EstimateSettings {
  available: boolean; accountRef?: string; mode?: 'plan' | 'api'; region?: 'cn' | 'global'; rules: EstimateRules;
}
export interface EstimateGroup {
  id: string; mode: 'plan' | 'api'; region: 'cn' | 'global'; currency: 'CNY' | 'USD';
  amount: number; responses: number; unknown: number; currentAccount?: boolean;
}
export interface SessionEstimate {
  settings: EstimateSettings; active?: EstimateGroup; groups: EstimateGroup[];
  historicalUnknown: boolean; storageError?: boolean;
}
export interface EstimateContext {
  account: string; mode: 'plan' | 'api'; region: 'cn' | 'global'; rules: EstimateRules;
}
export const defaultEstimateRules: EstimateRules = { planProtected: false, apiLegacyCache: false };
export const PRICE_VERSION = 'step-official-2026-10-17';

// Input is already cache-exclusive in the runtime's normalized Usage contract.
// Rates are per million tokens; reasoning is included in output, never added twice.
const cn: Record<string, readonly [number, number, number]> = {
  'step-5-preview': [7, .70, 20],
  'step-3.7-flash': [1.35, .27, 8.1],
  'step-3.5-flash': [.7, .14, 2.1],
  'step-3.5-flash-2603': [.7, .14, 2.1],
};
const global: Record<string, readonly [number, number, number]> = {
  'step-5-preview': [1, .1, 2.7],
  'step-3.7-flash': [.2, .04, 1.15],
  'step-3.5-flash': [.1, .02, .3],
  'step-3.5-flash-2603': [.1, .02, .3],
};
export function isPeakTime(at: number): boolean {
  const beijing = new Date(at + 8 * 3600000);
  const weekday = beijing.getUTCDay(), hour = beijing.getUTCHours();
  return weekday >= 1 && weekday <= 5 && (hour >= 9 && hour < 12 || hour >= 14 && hour < 18);
}
export function estimateResponse(context: EstimateContext, model: string, usage: Usage, at: number): number | undefined {
  if (!Number.isFinite(at) || !['input', 'output', 'cacheRead', 'cacheWrite'].every(key =>
    Number.isSafeInteger(usage[key as keyof Usage]) && (usage[key as keyof Usage] as number) >= 0)) return;
  if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite === 0) return;
  // The international Plan conversion is not published in the verified price table.
  if (context.mode === 'plan' && context.region !== 'cn') return;
  const rates = (context.region === 'cn' ? cn : global)[model];
  if (!rates) return; // Routers, unknown models and non-text billing must not look free.
  let [input, cache, output] = rates;
  if (model === 'step-5-preview' && context.region === 'cn'
    && (context.mode === 'plan' || context.rules.apiLegacyCache)) cache = .35;
  const multiplier = context.mode === 'plan' && model === 'step-5-preview'
    && !context.rules.planProtected && isPeakTime(at) ? 2 : 1;
  const value = ((usage.input + usage.cacheWrite) * input + usage.cacheRead * cache + usage.output * output) / 1e6 * multiplier;
  return Number.isFinite(value) ? value : undefined;
}
export function formatEstimate(group: EstimateGroup, language: string): string {
  const amount = group.amount.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', {
    minimumFractionDigits: 4, maximumFractionDigits: 4,
  });
  return group.responses === 0 || group.unknown === group.responses ? '--'
    : group.mode === 'plan' ? `${amount}M` : `${group.currency === 'CNY' ? '¥' : '$'}${amount}`;
}
