import type { Preferences, Session } from './contracts';
import { normalizedWorkspaceKey } from './workspace-key';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replaceAll('\\', '/');

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
