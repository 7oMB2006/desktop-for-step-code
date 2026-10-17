import { normalizedWorkspaceKey } from '../src/workspace-key';
import type { Preferences, Session } from '../src/contracts';

export const workspaceKey = (path: string, platform: string = process.platform) => normalizedWorkspaceKey(path, platform);

export function relocatedWorkspace(path: string, preferences: Preferences, sessionId: string): string {
  return preferences.workspaceSessionRedirects?.[sessionId] ?? path;
}

export function removeWorkspace(preferences: Preferences, path: string, platform: string = process.platform): Preferences {
  const identity = (path: string) => workspaceKey(path, platform);
  const key = identity(path);
  if (!preferences.workspaces.some(value => identity(value) === key)) throw new Error('Unknown workspace');
  const names = { ...preferences.workspaceNames };
  delete names[key];
  return { ...preferences, workspaces: preferences.workspaces.filter(value => identity(value) !== key),
    workspace: preferences.workspace && identity(preferences.workspace) === key ? undefined : preferences.workspace,
    workspaceNames: names, pinnedWorkspaces: preferences.pinnedWorkspaces?.filter(value => identity(value) !== key),
    collapsedWorkspaces: preferences.collapsedWorkspaces?.filter(value => identity(value) !== key) };
}

export function relocateWorkspace(preferences: Preferences, path: string, destination: string,
  sessions: readonly Pick<Session, 'id' | 'cwd'>[], platform: string = process.platform): Preferences {
  const identity = (path: string) => workspaceKey(path, platform);
  const key = identity(path);
  const nextKey = identity(destination);
  if (!preferences.workspaces.some(value => identity(value) === key)) throw new Error('Unknown workspace');
  if (key !== nextKey && preferences.workspaces.some(value => identity(value) === nextKey))
    throw new Error('Destination is already a project');
  const names = { ...preferences.workspaceNames };
  const name = names[key];
  delete names[key];
  if (name) names[nextKey] = name;
  // Bind existing histories, never future sessions created at a reused path.
  const redirects = Object.fromEntries(Object.entries(preferences.workspaceSessionRedirects ?? {})
    .map(([source, target]) => [source, identity(target) === key ? destination : target]));
  for (const session of sessions) {
    if (identity(session.cwd) === key) redirects[session.id] = destination;
  }
  return { ...preferences, workspaces: preferences.workspaces.map(value => identity(value) === key ? destination : value),
    workspace: preferences.workspace && identity(preferences.workspace) === key ? destination : preferences.workspace,
    workspaceNames: names, workspaceSessionRedirects: redirects,
    pinnedWorkspaces: preferences.pinnedWorkspaces?.map(value => identity(value) === key ? nextKey : value),
    collapsedWorkspaces: preferences.collapsedWorkspaces?.map(value => identity(value) === key ? nextKey : value) };
}

/** Retain metadata written by earlier Mac previews when its owner is unambiguous. */
export function migrateWorkspaceIdentity(preferences: Preferences, platform: string = process.platform): Preferences {
  if (platform === 'win32') return preferences;
  const keys = preferences.workspaces.map(path => workspaceKey(path, platform));
  const migrate = (key: string) => {
    if (keys.includes(key) || key === '__independent__') return key;
    const matches = keys.filter(path => path.toLowerCase() === key);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const names = { ...preferences.workspaceNames };
  for (const [key, name] of Object.entries(preferences.workspaceNames ?? {})) {
    const next = migrate(key);
    if (next === undefined) delete names[key];
    else if (next !== key) { if (!(next in names)) names[next] = name; delete names[key]; }
  }
  return { ...preferences, workspaceNames: names,
    pinnedWorkspaces: preferences.pinnedWorkspaces?.map(migrate).filter((key): key is string => key !== undefined),
    collapsedWorkspaces: preferences.collapsedWorkspaces?.map(migrate).filter((key): key is string => key !== undefined) };
}
