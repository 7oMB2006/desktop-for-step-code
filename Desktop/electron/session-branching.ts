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
  const key = (message: Message) => JSON.stringify([message.role, message.timestamp, message.content]);
  const matches = new Map<string, string[]>();
  for (const entry of activeHistory(entries, leafId)) {
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
  kind: 'clone' | 'fork';
  entryId: string;
  leafId: string;
  permissionPreset?: import('../src/contracts').PermissionPreset;
  name?: string;
};
