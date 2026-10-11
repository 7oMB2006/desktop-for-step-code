import type { Message } from './contracts';

export function isUserMessage(message: Message): boolean {
  return message.display !== false && (message.role === 'user'
    || message.role === 'custom' && message.customType === 'desktop-goal-input');
}
