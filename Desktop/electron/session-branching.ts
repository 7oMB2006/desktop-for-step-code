import type { Message } from '../src/contracts';

export interface HistoryEntry {
  id: string;
  parentId: string | null;
  type: string;
  message?: Message;
}

export function activeHistory<Entry extends HistoryEntry>(entries: Entry[], leafId: string | null) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const path: Entry[] = [];
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
