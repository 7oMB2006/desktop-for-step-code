import type { Preferences, Session } from './contracts';

export function reconcileSessionOrder(order: readonly string[], sessions: readonly Pick<Session, 'id'>[]): string[] {
  const known = new Set(sessions.map(session => session.id));
  const retained = [...new Set(order)].filter(id => known.has(id));
  const saved = new Set(retained);
  return [...sessions.filter(session => !saved.has(session.id)).map(session => session.id), ...retained];
}

export function orderSessions(sessions: readonly Session[], preferences: Pick<Preferences, 'sessionSort' | 'sessionOrder'>): Session[] {
  if (preferences.sessionSort === 'updated') {
    return [...sessions].sort((a, b) => b.modified.localeCompare(a.modified) || a.id.localeCompare(b.id));
  }
  const order = reconcileSessionOrder(preferences.sessionOrder ?? [], sessions);
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...sessions].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
}

export function moveSession(order: readonly string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !order.includes(id) || !order.includes(target)) return [...order];
  const next = order.filter(value => value !== id);
  next.splice(next.indexOf(target) + Number(after), 0, id);
  return next;
}

export function validateSidebarPreferences(patch: Partial<Preferences>, sessions: readonly Session[], workspaces: readonly string[], pathKey: (path: string) => string): Partial<Preferences> {
  const result: Partial<Preferences> = {};
  if (patch.sessionSort !== undefined) {
    if (patch.sessionSort !== 'manual' && patch.sessionSort !== 'updated') throw new Error('Invalid session sort');
    result.sessionSort = patch.sessionSort;
  }
  if (patch.sessionOrder !== undefined) {
    if (!Array.isArray(patch.sessionOrder) || patch.sessionOrder.length > 10000 || patch.sessionOrder.some(id => typeof id !== 'string' || id.length > 200)) throw new Error('Invalid session order');
    result.sessionOrder = reconcileSessionOrder(patch.sessionOrder, sessions);
  }
  if (patch.pinnedWorkspaces !== undefined) {
    if (!Array.isArray(patch.pinnedWorkspaces) || patch.pinnedWorkspaces.length > workspaces.length || patch.pinnedWorkspaces.some(path => typeof path !== 'string' || !workspaces.some(workspace => pathKey(workspace) === pathKey(path)))) throw new Error('Invalid pinned workspaces');
    result.pinnedWorkspaces = [...new Set(patch.pinnedWorkspaces.map(pathKey))];
  }
  if (patch.workspaces !== undefined) {
    if (!Array.isArray(patch.workspaces) || patch.workspaces.length !== workspaces.length ||
      patch.workspaces.some(path => typeof path !== 'string') ||
      new Set(patch.workspaces.map(pathKey)).size !== workspaces.length ||
      patch.workspaces.some(path => !workspaces.some(workspace => pathKey(workspace) === pathKey(path)))) throw new Error('Invalid workspace order');
    result.workspaces = patch.workspaces.map(path => workspaces.find(workspace => pathKey(workspace) === pathKey(path))!);
  }
  return result;
}
