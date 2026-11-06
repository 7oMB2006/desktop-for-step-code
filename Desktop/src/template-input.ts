import type { Message } from './contracts';

// Only runtime-recorded expansion metadata can replace a visible user input.
export function originalTemplateInput(message: Message): string | undefined {
  const input = message.desktopInput;
  return message.role === 'user' && input?.version === 1 && typeof input.text === 'string'
    && input.text.startsWith('/') && input.text.length <= 128 * 1024 ? input.text : undefined;
}

export function submittedInputContent(message: Message): Message['content'] {
  const original = originalTemplateInput(message);
  return original === undefined ? message.content : original;
}
