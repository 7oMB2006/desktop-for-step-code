import type { Preferences, Session } from './contracts';
import { normalizedWorkspaceKey } from './workspace-key';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replaceAll('\\', '/');

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function sessionSearchParts(text: string, query: string): { text: string; match: boolean }[] {
  const terms = [...new Set(normalize(query).trim().split(/\s+/u).filter(Boolean))];
  if (!terms.length || !text) return [{ text, match: false }];
  const normalized = normalize(text), hits = new Uint8Array(normalized.length);
  for (const term of terms) {
    let index = normalized.indexOf(term);
    while (index !== -1) {
      hits.fill(1, index, index + term.length);
      index = normalized.indexOf(term, index + 1);
    }
  }
  // Map normalized matches back to intact original graphemes, including NFKC expansions.
  const parts: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (const { segment } of graphemes.segment(text)) {
    const end = offset + normalize(segment).length;
    const match = hits.subarray(offset, end).some(Boolean), previous = parts.at(-1);
    if (previous?.match === match) previous.text += segment;
    else parts.push({ text: segment, match });
    offset = end;
  }
  return parts;
}

export function filterSessions(sessions: readonly Session[], preferences: Pick<Preferences,
  'archivedSessionIds' | 'workspaces' | 'workspaceNames' | 'language'>, query: string, platform = 'win32'): Session[] {
  const archived = new Set(preferences.archivedSessionIds ?? []);
  const terms = normalize(query).trim().split(/\s+/u).filter(Boolean);
  const projects = new Set(preferences.workspaces.map(path => normalizedWorkspaceKey(path, platform)));
  return sessions.filter(session => {
    if (archived.has(session.id)) return false;
    if (!terms.length) return true;
    const path = session.workspacePath ?? session.cwd;
    const key = normalizedWorkspaceKey(path, platform);
    const independent = session.independent ?? !projects.has(key);
    const project = independent ? preferences.language === 'zh' ? '独立会话' : 'Independent sessions'
      : preferences.workspaceNames?.[key] ?? '';
    const title = session.name || session.firstMessage || (preferences.language === 'zh' ? '新会话' : 'New session');
    const fields = [title, session.firstMessage, project, path, session.cwd].map(normalize);
    return terms.every(term => fields.some(field => field.includes(term)));
  });
}
