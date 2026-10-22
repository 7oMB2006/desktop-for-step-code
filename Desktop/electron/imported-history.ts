import type { Message } from '../src/contracts';
import { activeHistory, type HistoryEntry } from './session-branching';

type Entry = HistoryEntry & {
  imported?: { source?: string; sessionId?: string; itemId?: string };
  customType?: string; content?: Message['content']; display?: boolean;
  details?: Message['details']; timestamp?: string; summary?: string;
};
const imported = (entry: Entry) => ['codex', 'claude-code'].includes(entry.imported?.source ?? '')
  && typeof entry.imported?.sessionId === 'string' && typeof entry.imported?.itemId === 'string';
const historicalCallId = (entry: Entry, id: string) => `desktop-import:${JSON.stringify([entry.imported?.source, entry.imported?.sessionId, id])}`;

// Context RPC intentionally textualizes historical tools. Display the original
// active-path entries, never that model-only projection or a flattened branch.
export function importedHistoryMessages(messages: Message[], entries: Entry[], leafId: string | null): Message[] {
  const path = activeHistory(entries, leafId) as Entry[];
  if (!path.some(imported)) return messages;
  return path.flatMap((entry): Message[] => {
    if (entry.type === 'message' && entry.message) {
      const historical = imported(entry);
      const message = entry.message;
      return [{
        ...message, entryId: entry.id,
        ...(historical ? {
          desktopImported: true, usage: undefined,
          ...(message.role === 'toolResult' && message.toolCallId
            ? { toolCallId: historicalCallId(entry, message.toolCallId) } : {}),
          ...(Array.isArray(message.content) ? { content: message.content.map(block =>
            block.type === 'toolCall' ? { ...block, historical: true,
              ...(block.id ? { id: historicalCallId(entry, block.id) } : {}) } : block) } : {}),
        } : {}),
      }];
    }
    if (entry.type === 'custom_message' && entry.customType) return [{
      role: 'custom', customType: entry.customType, content: entry.content ?? [],
      display: entry.display, details: entry.details, entryId: entry.id,
      timestamp: Date.parse(entry.timestamp ?? ''),
    }];
    if (entry.type === 'compaction' && entry.summary) return [{
      role: 'custom', customType: 'imported-compaction', content: entry.summary,
      desktopImported: true, entryId: entry.id, timestamp: Date.parse(entry.timestamp ?? ''),
    }];
    return [];
  });
}
