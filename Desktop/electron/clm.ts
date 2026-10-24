import type { ClmSnapshot, ClmRevision } from '../src/clm';
import { redactSensitiveText } from '../src/subagent-redact';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const amount = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const clean = (value: unknown, length = 16000): string => typeof value === 'string'
  ? redactSensitiveText(value.slice(0, length).replace(/\bsk-[a-z0-9_-]{8,}/gi, '[redacted]')) : '';

// Paths and checkpoint metadata never cross the preload boundary.
export function clmSnapshot(value: unknown, sessionId: string): ClmSnapshot {
  const raw = object(value);
  if (raw.sessionId !== sessionId || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.revisions))
    throw new Error('CLM data unavailable or session changed');
  const revisions: ClmRevision[] = [];
  const seen = new Set<string>();
  for (const item of raw.revisions.slice(-2000)) {
    const row = object(item);
    if (typeof row.entryId !== 'string' || row.entryId.length > 200 || seen.has(row.entryId) || amount(row.revision) === undefined ||
      !['edit', 'reset', 'compaction'].includes(row.kind)) continue;
    seen.add(row.entryId);
    revisions.push({ entryId: row.entryId, revision: row.revision, kind: row.kind, timestamp: clean(row.timestamp, 100) });
  }
  const selected = object(raw.selected);
  const outcome = object(raw.lastOutcome);
  return {
    sessionId, leafId: typeof raw.leafId === 'string' ? raw.leafId.slice(0, 200) : null,
    enabled: raw.enabled, revision: amount(raw.revision), tokens: amount(raw.tokens),
    total: Math.max(revisions.length, amount(raw.total) ?? 0), revisions,
    selected: seen.has(selected.entryId) ? {
      entryId: selected.entryId, diff: clean(selected.diff, 128000),
      diffTruncated: selected.diffTruncated === true,
      truncated: selected.truncated === true,
      blocks: (Array.isArray(selected.blocks) ? selected.blocks.slice(0, 200) : []).map((item: unknown) => {
        const block = object(item);
        return { id: clean(block.id, 200), role: clean(block.role, 100), protected: block.protected === true,
          text: clean(block.text), truncated: block.truncated === true };
      }),
    } : undefined,
    lastOutcome: typeof outcome.accepted === 'boolean' && amount(outcome.revision) !== undefined ? {
      accepted: outcome.accepted, revision: outcome.revision, reason: clean(outcome.reason, 2000),
      beforeTokens: amount(outcome.beforeTokens), afterTokens: amount(outcome.afterTokens),
    } : undefined,
  };
}
