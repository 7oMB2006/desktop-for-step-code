export function previewListenerPids(listeners: string) {
  const pids = listeners.trim().split(/\s+/).map(Number);
  if (pids.length > 128 || pids.some(pid => !Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff)) return;
  return [...new Set(pids)];
}

export function descendantListenersOwned(pids: number[], processes: string, root: number, startedAt: number) {
  if (!pids.length || pids.includes(root)) return false;
  const tree = new Map<number, { parent: number; started: number }>();
  for (const line of processes.split(/\r?\n/)) {
    const match = /^(\d+) (\d+) (\d+)$/.exec(line);
    if (!match) continue;
    const [, rawPid, rawParent, rawStarted] = match;
    const pid = Number(rawPid), parent = Number(rawParent), started = Number(rawStarted);
    if (!Number.isSafeInteger(started) || started <= 0) return false;
    const previous = tree.get(pid);
    if (previous && (previous.parent !== parent || previous.started !== started)) return false;
    tree.set(pid, { parent, started });
  }
  return pids.every(pid => {
    if ((tree.get(pid)?.started ?? 0) < startedAt * 1000) return false;
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
