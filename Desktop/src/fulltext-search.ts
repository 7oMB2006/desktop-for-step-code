export interface FulltextQuery {
  id: string;
  text: string;
  project?: string;
  since?: number;
  includeArchived?: boolean;
}

export interface FulltextHit {
  sessionId: string;
  entryId: string | null;
  entryType?: string;
  role?: string;
  timestamp: number;
  snippet: string;
}

export interface SearchLocation {
  sessionId: string;
  entryId: string | null;
  text: string;
}

export interface SearchTextTarget extends Pick<SearchLocation, 'entryId' | 'text'> {
  requestId: number;
}

export interface FulltextResult {
  id: string;
  hits: FulltextHit[];
  index: { state: 'ready' | 'backfilling' | 'degraded'; indexed: number; total: number; pending: number; errors: number };
  limited: boolean;
  limit: number;
  shortQuery: boolean;
  sessionOnly: boolean;
  cancelled?: boolean;
}

export function searchTerms(text: string): string[] {
  return [...new Set(text.trim().toLowerCase().split(/\s+/u).filter(Boolean))];
}

export function searchPattern(query: string): RegExp | undefined {
  const terms = searchTerms(query).map(term => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  return terms.length ? new RegExp(terms.join('|'), 'giu') : undefined;
}

export function searchTextMatch(text: string, query: string): RegExpExecArray | null {
  return searchPattern(query)?.exec(text) ?? null;
}

export function snippetParts(text: string): { text: string; matched: boolean }[] {
  let matched = false;
  return text.split(/([\u0002\u0003])/u).flatMap(part => {
    if (part === '\u0002') { matched = true; return []; }
    if (part === '\u0003') { matched = false; return []; }
    return part ? [{ text: part, matched }] : [];
  });
}
