import type { Content, Message, RuntimeEvent } from './contracts';

export function applyMessageEvent(messages: Message[], event: RuntimeEvent): Message[] {
  if (event.type === 'message_start') return event.message ? [...messages, event.message] : messages;
  if (event.type === 'message_end' || (event.type === 'message_update' && event.message)) {
    if (!event.message) return messages;
    const next = [...messages];
    if (next.at(-1)?.role === event.message.role) next[next.length - 1] = event.message;
    else next.push(event.message);
    return next;
  }
  if (event.type !== 'message_update') return messages;
  const delta = event.assistantMessageEvent;
  const index = delta?.contentIndex;
  const last = messages.at(-1);
  if (!last || last.role !== 'assistant' || !Number.isInteger(index) || index < 0 || index > 10000) return messages;
  const content: Content[] = Array.isArray(last.content) ? [...last.content] : [];
  const previous = content[index];
  switch (delta.type) {
    case 'text_start': content[index] = { type: 'text', text: '' }; break;
    case 'text_delta': content[index] = { type: 'text', text: (previous?.text ?? '') + (delta.delta ?? '') }; break;
    case 'text_end': content[index] = { type: 'text', text: delta.content ?? '' }; break;
    case 'thinking_start': content[index] = { type: 'thinking', thinking: '' }; break;
    case 'thinking_delta': content[index] = { type: 'thinking', thinking: (previous?.thinking ?? '') + (delta.delta ?? '') }; break;
    case 'thinking_end': content[index] = { type: 'thinking', thinking: delta.content ?? '' }; break;
    case 'toolcall_start': content[index] = { type: 'toolCall', id: delta.id, name: delta.toolName, arguments: {} }; break;
    case 'toolcall_end': content[index] = delta.toolCall; break;
    // Tool argument deltas are incomplete JSON. Render the authoritative object at toolcall_end.
    default: return messages;
  }
  return [...messages.slice(0, -1), { ...last, content }];
}
