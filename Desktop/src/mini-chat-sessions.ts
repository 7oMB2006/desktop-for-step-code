import type { Preferences, Session } from './contracts';
import { orderSessions } from './sidebar-order';
import { filterSessions } from './session-search';
import { normalizedWorkspaceKey } from './workspace-key';

export const MINI_INDEPENDENT_PROJECT = '__independent__';
export type MiniChatProject = { id: string; name: string; path?: string };
export type MiniChatSession = {
  id: string; title: string; projectId: string; project?: string; branch?: string; path?: string; searchText?: string;
};
export type MiniChatGroup = { project: MiniChatProject; sessions: MiniChatSession[]; total: number; showPath: boolean };
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replaceAll('\\', '/');

export function miniChatCatalog(sessions: Session[], preferences: Preferences, platform = 'win32') {
  const zh = preferences.language === 'zh';
  const projects: MiniChatProject[] = [];
  for (const path of preferences.workspaces) {
    const id = normalizedWorkspaceKey(path, platform);
    if (!projects.some(project => project.id === id)) projects.push({
      id, path, name: preferences.workspaceNames?.[id] || path.split(/[\\/]/u).filter(Boolean).at(-1) || path,
    });
  }
  const pinned = new Map((preferences.pinnedWorkspaces ?? []).map((path, index) => [normalizedWorkspaceKey(path, platform), index]));
  projects.sort((a, b) => (pinned.get(a.id) ?? pinned.size) - (pinned.get(b.id) ?? pinned.size));
  projects.push({ id: MINI_INDEPENDENT_PROJECT, name: zh ? '独立会话' : 'Independent sessions' });
  const items: MiniChatSession[] = orderSessions(filterSessions(sessions, preferences, '', platform), preferences).map(session => {
    const path = session.workspacePath ?? session.cwd;
    const key = normalizedWorkspaceKey(path, platform);
    const independent = session.independent === true || !projects.some(project => project.id === key);
    const projectId = independent ? MINI_INDEPENDENT_PROJECT : key;
    return {
      id: session.id, title: session.name || session.firstMessage || (zh ? '新会话' : 'New session'),
      projectId, project: projects.find(project => project.id === projectId)?.name, path, searchText: session.firstMessage,
    };
  });
  return { projects, sessions: items };
}

export function miniChatGroups(projects: MiniChatProject[], sessions: MiniChatSession[], currentProject: string, query: string): MiniChatGroup[] {
  const terms = normalize(query).trim().split(/\s+/u).filter(Boolean);
  const matches = (fields: string[]) => terms.every(term => fields.some(field => normalize(field).includes(term)));
  return [...projects.filter(project => project.id === currentProject), ...projects.filter(project => project.id !== currentProject)]
    .flatMap(project => {
      const all = sessions.filter(session => session.projectId === project.id);
      const fields = [project.name, project.path ?? ''];
      const filtered = all.filter(session => matches([...fields, session.title, session.path ?? '', session.searchText ?? '', session.branch ?? '']));
      if (terms.length && !filtered.length && !matches(fields)) return [];
      return [{ project, sessions: filtered, total: all.length,
        showPath: Boolean(project.path && projects.some(other => other.id !== project.id && normalize(other.name) === normalize(project.name))) }];
    });
}
