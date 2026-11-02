import { resolve } from 'node:path';
import type { Preferences, Session } from '../src/contracts';
import type { FulltextQuery, FulltextResult } from '../src/fulltext-search';
import { normalizedWorkspaceKey } from '../src/workspace-key';
import { isChildSession } from './session-visibility';

export function parseFulltextQuery(value: unknown): FulltextQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid search request');
  const request = value as Record<string, unknown>;
  if (typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/u.test(request.id)
    || typeof request.text !== 'string' || !request.text.trim() || [...request.text].length > 500
    || request.project !== undefined && (typeof request.project !== 'string' || request.project.length > 4096)
    || request.since !== undefined && (typeof request.since !== 'number' || !Number.isFinite(request.since) || request.since < 0)
    || request.includeArchived !== undefined && typeof request.includeArchived !== 'boolean')
    throw new Error('Invalid search request');
  return { id: request.id, text: request.text.trim(), project: request.project as string | undefined,
    since: request.since as number | undefined, includeArchived: request.includeArchived as boolean | undefined };
}

export function projectFulltextResult(raw: any, query: FulltextQuery, sessions: readonly Session[],
  preferences: Pick<Preferences, 'archivedSessionIds'>, platform = process.platform): FulltextResult {
  if (raw?.id !== query.id || !Array.isArray(raw.hits)
    || !['ready', 'backfilling', 'degraded'].includes(raw.index?.state)) throw new Error('Invalid search response');
  const known = new Map(sessions.map(session => [session.id, session]));
  const archived = new Set(preferences.archivedSessionIds);
  const key = (path: string) => normalizedWorkspaceKey(resolve(path), platform);
  const seen = new Set<string>();
  const hits = raw.hits.slice(0, 100).flatMap((hit: any) => {
    const session = known.get(hit?.sessionId);
    if (!session?.path || isChildSession(session.id) || typeof hit.sessionPath !== 'string'
      || key(session.path) !== key(hit.sessionPath)
      || !query.includeArchived && archived.has(session.id)
      || query.project && key(session.workspacePath ?? session.cwd) !== key(query.project)
      || hit.entryId !== null && (typeof hit.entryId !== 'string' || hit.entryId.length > 256)
      || typeof hit.snippet !== 'string' || !Number.isFinite(hit.ts)) return [];
    const identity = JSON.stringify([session.id, hit.entryId]);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ sessionId: session.id, entryId: hit.entryId,
      entryType: typeof hit.entryType === 'string' ? hit.entryType.slice(0, 50) : undefined,
      role: ['user', 'assistant'].includes(hit.role) ? hit.role : undefined,
      timestamp: hit.ts, snippet: hit.snippet.slice(0, 2000) }];
  });
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return { id: query.id, hits, index: { state: raw.index.state,
    indexed: count(raw.index.indexed), total: count(raw.index.total), pending: count(raw.index.pending), errors: count(raw.index.errors) },
    limited: Boolean(raw.limited), limit: raw.limit === 50 ? 50 : 100, shortQuery: Boolean(raw.shortQuery),
    sessionOnly: Boolean(raw.sessionOnly), ...(raw.cancelled ? { cancelled: true } : {}) };
}
