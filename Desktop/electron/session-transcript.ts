import type { Message } from '../src/contracts';
import { activeHistory, type HistoryEntry } from './session-branching';

type Entry = HistoryEntry & {
  imported?: { source?: string; sessionId?: string; itemId?: string };
  customType?: string; content?: Message['content']; display?: boolean;
  details?: Message['details']; timestamp?: string; summary?: string;
};
export const isImportedHistoryEntry = (entry: Entry) => ['codex', 'claude-code'].includes(entry.imported?.source ?? '')
  && typeof entry.imported?.sessionId === 'string' && typeof entry.imported?.itemId === 'string';
const historicalCallId = (entry: Entry, id: string) => `desktop-import:${JSON.stringify([entry.imported?.source, entry.imported?.sessionId, id])}`;

// The transcript follows the saved branch, not the model's compacted context.
export function sessionTranscript(entries: Entry[], leafId: string | null): Message[] {
  const path = activeHistory(entries, leafId);
  const imported = path.some(isImportedHistoryEntry);
  return path.flatMap((entry): Message[] => {
    if (entry.type === 'message' && entry.message) {
      const historical = isImportedHistoryEntry(entry);
      const message = entry.message;
      return [{
        ...message, content: message.content ?? [], entryId: entry.id,
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
    if (imported && entry.type === 'compaction' && entry.summary) return [{
      role: 'custom', customType: 'imported-compaction', content: entry.summary,
      desktopImported: true, entryId: entry.id, timestamp: Date.parse(entry.timestamp ?? ''),
    }];
    return [];
  });
}
