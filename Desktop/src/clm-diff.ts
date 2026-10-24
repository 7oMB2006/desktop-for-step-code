import { parsePatch } from 'diff';

export interface ClmChange {
  id: string;
  role?: string;
  title: string;
  before: string;
  after: string;
  beforeLine: number;
  afterLine: number;
}

export function clmTextTitle(text: string, fallback: string): string {
  return text.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('[['))
    ?.replace(/^#{1,6}\s+/, '').slice(0, 80) || fallback;
}

// Saved unified diffs contain context fragments, not complete prior checkpoints.
export function clmChanges(diff: string): ClmChange[] {
  try {
    return parsePatch(diff).flatMap(patch => patch.hunks.flatMap((hunk, hunkIndex) => {
      const groups = new Map<string, { role?: string; before: string[]; after: string[]; changed: boolean }>();
      for (const side of ['before', 'after'] as const) {
        let id = `fragment-${hunkIndex}`;
        for (const line of hunk.lines) {
          const kind = line[0];
          if (![' ', '+', '-'].includes(kind) || side === 'before' && kind === '+' || side === 'after' && kind === '-') continue;
          const text = line.slice(1);
          const header = /^\[\[CTX_TURN\s+.*\]\]$/.test(text);
          if (header) {
            id = /\bid=([^\s\]]+)/.exec(text)?.[1] ?? id;
            if (!groups.has(id)) groups.set(id, { role: /\brole=([^\s\]]+)/.exec(text)?.[1], before: [], after: [], changed: false });
            continue;
          }
          if (/^\[\[LIVE_CONTEXT\s+.*\]\]$/.test(text)) continue;
          if (!groups.has(id)) groups.set(id, { before: [], after: [], changed: false });
          const group = groups.get(id)!;
          group[side].push(text);
          if (kind !== ' ') group.changed = true;
        }
      }
      return [...groups.entries()].flatMap(([id, group]) => {
        const before = group.before.join('\n').trim(), after = group.after.join('\n').trim();
        return group.changed && before !== after ? [{
          id: `${hunkIndex}:${id}`, role: group.role, title: clmTextTitle(after || before, ''),
          before, after, beforeLine: hunk.oldStart, afterLine: hunk.newStart,
        }] : [];
      });
    }));
  } catch {
    return [];
  }
}
