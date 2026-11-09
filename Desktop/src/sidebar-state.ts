import type { RuntimeSummary, Session } from './contracts';

export type SidebarActivity = RuntimeSummary['status'];

export function updateSidebarSessionNames(sessions: Session[], runtimes: RuntimeSummary[]): Session[] {
  const bySession = new Map<string, RuntimeSummary>();
  for (const runtime of runtimes) if (!bySession.has(runtime.sessionId)) bySession.set(runtime.sessionId, runtime);
  let changed = false;
  const next = sessions.map(session => {
    const runtime = bySession.get(session.id);
    const firstMessage = runtime?.firstMessage || session.firstMessage;
    const name = runtime?.name ?? session.name;
    if (firstMessage === session.firstMessage && name === session.name) return session;
    changed = true;
    return { ...session, firstMessage, name };
  });
  return changed ? next : sessions;
}

export function createSidebarActivityReader() {
  let previous = new Map<string, SidebarActivity>();
  return (runtimes: readonly RuntimeSummary[], saved: ReadonlyMap<string, SidebarActivity>, unread: readonly string[]) => {
    const statuses = new Map(saved);
    const current = new Set<string>();
    for (const runtime of runtimes) if (!current.has(runtime.sessionId)) {
      current.add(runtime.sessionId);
      statuses.set(runtime.sessionId, runtime.status);
    }
    const pending = new Set(unread);
    for (const id of pending) if (!statuses.has(id)) statuses.set(id, 'idle');
    const next = new Map<string, SidebarActivity>();
    for (const [id, status] of statuses) {
      const activity = status === 'idle' || status === 'completed' ? pending.has(id) ? 'completed' : 'idle' : status;
      if (activity !== 'idle') next.set(id, activity);
    }
    if (next.size !== previous.size || [...next].some(([id, status]) => previous.get(id) !== status)) previous = next;
    return previous;
  };
}
