import type { Message } from '../src/contracts';

export function taskOutcome(messages: Message[]) {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return 'idle' as const;
  if (last.stopReason === 'stop') return 'completed' as const;
  if (['error', 'aborted', 'length'].includes(last.stopReason ?? '')) return 'interrupted' as const;
  return 'idle' as const;
}
