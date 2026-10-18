export type UsageRange = { start: string; end: string };
export const usageDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function parseUsageDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return usageDateKey(date) === value ? date : undefined;
}
export function validUsageRange(range: UsageRange, min: string, max: string): boolean {
  return Boolean(parseUsageDate(range.start) && parseUsageDate(range.end)
    && range.start >= min && range.end <= max && range.start <= range.end);
}
export function usageRange<T extends { date: string }>(days: T[], range: UsageRange): T[] {
  return days.filter(day => day.date >= range.start && day.date <= range.end);
}
