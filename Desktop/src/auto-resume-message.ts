import type { Message } from './contracts';

export function isAutoResumeMessage(message: Message): boolean {
  return message.role === 'custom' && message.customType === 'step-auto-resume'
    && message.details?.version === 1 && message.details.kind === 'resume' && message.details.source === 'autopilot';
}
