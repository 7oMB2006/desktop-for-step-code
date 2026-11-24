export function descendantListenersOwned(listeners: string, processes: string, root: number, startedAt: number) {
  const pids = listeners.trim().split(/\s+/).map(Number);
  if (!pids.length || pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0 || pid === root)) return false;
  const tree = new Map<number, { parent: number; started: number }>();
  for (const line of processes.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line);
    if (!match) continue;
    const started = Date.parse(`${match[3]} UTC`);
    if (Number.isFinite(started)) tree.set(Number(match[1]), { parent: Number(match[2]), started });
  }
  return pids.every(pid => {
    if ((tree.get(pid)?.started ?? 0) < startedAt) return false;
    const seen = new Set<number>();
    while (pid !== root && !seen.has(pid)) {
      seen.add(pid);
      const child = tree.get(pid);
      const parent = child && tree.get(child.parent);
      if (!child || !parent || parent.started > child.started) return false;
      pid = child.parent;
    }
    return pid === root;
  });
}
