export interface ClmRevision {
  entryId: string;
  revision: number;
  timestamp: string;
  kind: 'edit' | 'reset' | 'compaction';
}
export interface ClmBlock { id: string; role: string; protected: boolean; text: string; truncated: boolean }
export interface ClmSnapshot {
  sessionId: string;
  leafId: string | null;
  enabled: boolean;
  revision?: number;
  tokens?: number;
  total: number;
  revisions: ClmRevision[];
  selected?: { entryId: string; blocks: ClmBlock[]; diff: string; truncated: boolean; diffTruncated: boolean };
  lastOutcome?: { accepted: boolean; revision: number; reason?: string; beforeTokens?: number; afterTokens?: number };
}
export type ClmAction = 'on' | 'off' | 'compact';
