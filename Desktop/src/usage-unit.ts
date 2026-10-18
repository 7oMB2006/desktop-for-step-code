export type UsageUnit = 'default' | 'K' | 'M' | 'B';

const divisors = { K: 1e3, M: 1e6, B: 1e9 };
export function formatUsageTotal(value: number, unit: UsageUnit): string {
  if (unit === 'default') return value.toLocaleString('zh-CN');
  const scaled = value / divisors[unit];
  if (value > 0 && scaled < .01) return `<0.01${unit}`;
  return `${scaled.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`;
}
