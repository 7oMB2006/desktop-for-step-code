import { parseUsageDate, usageDateKey } from './usage-range';

export function feedbackIncidentTime(date: string, time: string): string | undefined | null {
  date = date.trim();
  time = time.trim();
  if (!date && !time) return undefined;
  const local = parseUsageDate(date);
  if (!local || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(':').map(Number);
  local.setHours(hour, minute, 0, 0);
  if (usageDateKey(local) !== date || local.getHours() !== hour || local.getMinutes() !== minute) return null;
  return local.toISOString();
}
