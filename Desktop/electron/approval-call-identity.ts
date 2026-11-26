import type { Content, Message } from '../src/contracts';

/** Remote approval requires one exact, unresolved native call in this session. */
export function uniquePendingApprovalCall(messages: readonly Message[], toolName: string, callId?: string): Content | undefined {
  if (callId === '') return;
  const finished = new Set(messages.filter(message => message.role === 'toolResult').map(message => message.toolCallId));
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  const candidates: Content[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== 'toolCall' || !block.id || (callId !== undefined && block.id !== callId)) continue;
      if (seen.has(block.id)) ambiguous.add(block.id);
      seen.add(block.id);
      if (block.name === toolName && !finished.has(block.id) && !message.desktopImported && !block.historical) candidates.push(block);
    }
  }
  if (candidates.length === 1 && !ambiguous.has(candidates[0].id!)) return candidates[0];
}
