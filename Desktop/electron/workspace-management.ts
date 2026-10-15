import type { Preferences, Session } from '../src/contracts';

export const workspaceKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function relocatedWorkspace(path: string, preferences: Preferences, sessionId: string): string {
  return preferences.workspaceSessionRedirects?.[sessionId] ?? path;
}

export function removeWorkspace(preferences: Preferences, path: string): Preferences {
  const key = workspaceKey(path);
  if (!preferences.workspaces.some(value => workspaceKey(value) === key)) throw new Error('Unknown workspace');
  const names = { ...preferences.workspaceNames };
  delete names[key];
  return { ...preferences, workspaces: preferences.workspaces.filter(value => workspaceKey(value) !== key),
    workspace: preferences.workspace && workspaceKey(preferences.workspace) === key ? undefined : preferences.workspace,
    workspaceNames: names, pinnedWorkspaces: preferences.pinnedWorkspaces?.filter(value => workspaceKey(value) !== key) };
}

export function relocateWorkspace(preferences: Preferences, path: string, destination: string,
  sessions: readonly Pick<Session, 'id' | 'cwd'>[]): Preferences {
  const key = workspaceKey(path);
  const nextKey = workspaceKey(destination);
  if (!preferences.workspaces.some(value => workspaceKey(value) === key)) throw new Error('Unknown workspace');
  if (key !== nextKey && preferences.workspaces.some(value => workspaceKey(value) === nextKey))
    throw new Error('Destination is already a project');
  const names = { ...preferences.workspaceNames };
  const name = names[key];
  delete names[key];
  if (name) names[nextKey] = name;
  // Bind existing histories, never future sessions created at a reused path.
  const redirects = Object.fromEntries(Object.entries(preferences.workspaceSessionRedirects ?? {})
    .map(([source, target]) => [source, workspaceKey(target) === key ? destination : target]));
  for (const session of sessions) {
    if (workspaceKey(session.cwd) === key) redirects[session.id] = destination;
  }
  return { ...preferences, workspaces: preferences.workspaces.map(value => workspaceKey(value) === key ? destination : value),
    workspace: preferences.workspace && workspaceKey(preferences.workspace) === key ? destination : preferences.workspace,
    workspaceNames: names, workspaceSessionRedirects: redirects,
    pinnedWorkspaces: preferences.pinnedWorkspaces?.map(value => workspaceKey(value) === key ? nextKey : value) };
}
