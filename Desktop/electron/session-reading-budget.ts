import type { SessionReading } from '../src/contracts';

export const MAX_READING_BYTES = 24 * 1024 * 1024;
export const MAX_READING_MESSAGES = 2000;
export const MAX_READING_BLOCKS = 10000;

export function assertReadingBudget(reading: SessionReading) {
  const blocks = reading.messages.reduce((count, message) =>
    count + (Array.isArray(message.content) ? message.content.length : 1), 0);
  const reason = reading.messages.length > MAX_READING_MESSAGES || blocks > MAX_READING_BLOCKS ? 'node-limit'
    : Buffer.byteLength(JSON.stringify(reading), 'utf8') > MAX_READING_BYTES ? 'response-limit' : undefined;
  if (reason) throw Object.assign(new Error(`history:${reason}`), { reason });
}
