import type { Content, Message } from './contracts';

const prefix = 'ultracode:\n\n';
export const isUltracodeInput = (text: string) => text.startsWith(prefix);
export const ultracodeInput = (text: string) => isUltracodeInput(text) ? text : `${prefix}${text}`;
export const originalUltracodeInput = (text: string) => isUltracodeInput(text) ? text.slice(prefix.length) : text;
export function visibleInputBlocks(message: Message): Content[] {
  const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
  if (message.role !== 'user') return blocks;
  let firstText = true;
  return blocks.map(block => {
    if (block.type !== 'text' || !firstText) return block;
    firstText = false;
    return { ...block, text: originalUltracodeInput(block.text ?? '') };
  });
}
