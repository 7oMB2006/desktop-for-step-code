import type { Message } from '../src/contracts';

export interface HistoryEntry {
  id: string;
  parentId: string | null;
  type: string;
  message?: Message;
}

export function activeHistory(entries: HistoryEntry[], leafId: string | null) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const path: HistoryEntry[] = [];
  const visited = new Set<string>();
  let id = leafId;
  while (id) {
    if (visited.has(id)) throw new Error('Invalid session history');
    visited.add(id);
    const entry = byId.get(id);
    if (!entry) throw new Error('Incomplete session history');
    path.push(entry);
    id = entry.parentId;
  }
  return path.reverse();
}

// Match full user/assistant identity on the active path, never text or array position alone.
export function messagesWithEntryIds(messages: Message[], entries: HistoryEntry[], leafId: string | null): Message[] {
  const key = (message: Message) => {
    const inputId = message.role === 'custom' && message.customType === 'desktop-goal-input'
      ? message.details?.desktopGoalInputId : undefined;
    // Custom live messages and persisted entries have independent upstream clocks.
    if (typeof inputId === 'string' && inputId.length > 0 && inputId.length <= 128)
      return JSON.stringify(['desktop-goal-input', inputId, message.content]);
    return JSON.stringify([message.role, message.timestamp, message.content, message.customType]);
  };
  const matches = new Map<string, string[]>();
  for (const entry of activeHistory(entries, leafId)) {
    const custom = entry as HistoryEntry & { customType?: string; timestamp?: string; content?: Message['content']; display?: boolean; details?: Message['details'] };
    if (custom.type === 'custom_message' && custom.customType === 'desktop-goal-input' && custom.content !== undefined) {
      const timestamp = Date.parse(custom.timestamp ?? '');
      if (!Number.isFinite(timestamp)) continue;
      const identity = key({ role: 'custom', customType: custom.customType, content: custom.content, timestamp, details: custom.details });
      matches.set(identity, [...matches.get(identity) ?? [], entry.id]);
      continue;
    }
    if (entry.type !== 'message' || !entry.message || !['user', 'assistant'].includes(entry.message.role)) continue;
    const identity = key(entry.message);
    matches.set(identity, [...matches.get(identity) ?? [], entry.id]);
  }
  return messages.map(message => {
    const { entryId: _previousId, ...original } = message;
    const ids = matches.get(key(original));
    return ids?.length === 1 ? { ...original, entryId: ids[0] } : original;
  });
}

export type BranchOperation = {
  permissionPreset?: import('../src/contracts').PermissionPreset;
  name?: string;
} & ({
  kind: 'clone' | 'fork';
  entryId: string;
  leafId: string;
} | {
  kind: 'open-copy';
  sessionId: string;
});
