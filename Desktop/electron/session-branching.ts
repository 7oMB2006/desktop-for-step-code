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

export interface FeedbackRequestEvidence {
  requestId?: unknown;
  responseProvider?: unknown;
  responseModel?: unknown;
  requestedProvider?: unknown;
  requestedModel?: unknown;
  statusCode?: unknown;
  outcome?: unknown;
  transportAttempts?: unknown;
}

export function feedbackRequestsOnPath(path: HistoryEntry[], sessionId: string) {
  const requests = new Map<string, FeedbackRequestEvidence>();
  const ambiguous = new Set<string>();
  const replies = new Set<string>();
  for (const item of path) {
    if (item.type === 'message' && item.message?.role === 'assistant') replies.add(item.id);
    const entry = item as HistoryEntry & { customType?: string; data?: FeedbackRequestEvidence & {
      usageEntryId?: unknown; purpose?: unknown; originSessionId?: unknown; sessionId?: unknown;
    } };
    const data = entry.data;
    if (entry.type !== 'custom' || entry.customType !== 'step.usage_provenance' || !data
      || data.purpose !== undefined || data.sessionId !== sessionId || data.originSessionId !== sessionId
      || typeof data.usageEntryId !== 'string' || !replies.has(data.usageEntryId)) continue;
    const id = data.usageEntryId;
    if (ambiguous.has(id)) continue;
    if (requests.has(id)) { requests.delete(id); ambiguous.add(id); continue; }
    requests.set(id, data);
  }
  return requests;
}

export function feedbackRequestsOnBranch(entries: HistoryEntry[], leafId: string | null, sessionId: string) {
  return feedbackRequestsOnPath(activeHistory(entries, leafId), sessionId);
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
