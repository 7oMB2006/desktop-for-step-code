export type UsageSource = 'official' | 'custom' | 'unknown';
export type UsageSample = {
  source: UsageSource;
  model: string;
  hour: number;
  input: number;
  output: number;
  cached: number;
  written: number;
  total: number;
};
export type UsageDay = {
  date: string;
  official: number;
  custom: number;
  unknown: number;
  chats: number;
  officialChats: number;
  customChats: number;
  samples: UsageSample[];
  plan: number | null;
  api: number | null;
  usd: number | null;
};
export type UsageOverview = {
  days: UsageDay[];
  chats: { all: number; official: number; custom: number };
  scannedAt: number;
  limited: string[];
  estimates?: { recorded: number; unknown: number; limited: boolean };
};
export function usageDates(now = new Date()): string[] {
  return Array.from({ length: 365 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364 + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}
export function emptyUsageOverview(): UsageOverview {
  return { days: usageDates().map(date => ({ date, official: 0, custom: 0, unknown: 0,
    chats: 0, officialChats: 0, customChats: 0, samples: [], plan: null, api: null, usd: null })),
  chats: { all: 0, official: 0, custom: 0 }, scannedAt: 0, limited: [] };
}
