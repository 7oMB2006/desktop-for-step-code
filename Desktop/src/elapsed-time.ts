import type { ElapsedTiming, Message, RuntimeEvent } from './contracts';

export function formatElapsedDuration(ms: number, language: 'zh' | 'en' = 'en'): string {
  const seconds = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const units = language === 'zh' ? ['小时', '分', '秒'] : ['h', 'm', 's'];
  return [
    hours ? `${hours}${units[0]}` : '',
    hours || minutes ? `${minutes}${units[1]}` : '',
    `${seconds % 60}${units[2]}`,
  ].filter(Boolean).join(' ');
}

export function elapsedTime(timing: ElapsedTiming, now: number): string {
  return formatElapsedDuration((timing.endedAt ?? now) - timing.startedAt);
}

export function applyElapsedTimings(messages: Message[], event: RuntimeEvent): Message[] {
  if (!event.desktopTimings) return messages;
  return messages.map(message => message.role === 'assistant' && message.timestamp !== undefined
    && event.desktopTimings[String(message.timestamp)]
    ? { ...message, desktopTiming: event.desktopTimings[String(message.timestamp)] } : message);
}
