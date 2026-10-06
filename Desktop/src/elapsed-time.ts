import type { ElapsedTiming, Message, RuntimeEvent } from './contracts';

export function elapsedTime(timing: ElapsedTiming, now: number): string {
  const seconds = Math.floor(Math.max(0, (timing.endedAt ?? now) - timing.startedAt) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${hours ? `${hours}h` : ''}${hours || minutes ? `${minutes}m` : ''}${seconds % 60}s`;
}

export function applyElapsedTimings(messages: Message[], event: RuntimeEvent): Message[] {
  if (!event.desktopTimings) return messages;
  return messages.map(message => message.role === 'assistant' && message.timestamp !== undefined
    && event.desktopTimings[String(message.timestamp)]
    ? { ...message, desktopTiming: event.desktopTimings[String(message.timestamp)] } : message);
}
