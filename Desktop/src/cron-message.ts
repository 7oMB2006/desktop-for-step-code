import type { Message } from './contracts';

export type CronNotice = {
  kind: 'fire' | 'missed';
  prompt: string;
  original: string;
  timestamp?: number;
  id?: string;
  cron?: string;
  count?: number;
};

export function cronMessage(message: Message): CronNotice | undefined {
  if (message.role !== 'custom' || message.customType !== 'step-cron' || message.display === false) return;
  const original = typeof message.content === 'string' ? message.content
    : message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n\n');
  const details = message.details;
  const missed = details?.kind === 'missed';
  const timestamp = typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
    && !Number.isNaN(new Date(message.timestamp).getTime()) ? message.timestamp : undefined;
  return {
    kind: missed ? 'missed' : 'fire',
    prompt: original.startsWith('[cron] ') ? original.slice(7) : original,
    original, timestamp,
    id: typeof details?.id === 'string' ? details.id : undefined,
    cron: typeof details?.cron === 'string' ? details.cron : undefined,
    count: missed && typeof details?.count === 'number' && Number.isSafeInteger(details.count) && details.count > 0
      ? details.count : undefined,
  };
}
