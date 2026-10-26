/** Live transport state only; saved transcript records never own a process. */
export function hasBackgroundWork(worker: { status: string; backgroundActive?: boolean }) {
  return worker.status !== 'disconnected' && worker.backgroundActive === true;
}

export function backgroundState(text: unknown): { active: boolean; parentActive: boolean } {
  const unknown = { active: true, parentActive: false };
  try {
    if (typeof text !== 'string') return unknown;
    const value = JSON.parse(text);
    if (value?.version !== 1 || !Array.isArray(value.lanes)
      || value.parentActive !== undefined && typeof value.parentActive !== 'boolean') return unknown;
    const ids = new Set<string>();
    for (const lane of value.lanes) {
      if (!lane || typeof lane.id !== 'string' || !/^lane_[0-9a-f]{8}$/.test(lane.id)
        || !['running', 'settling'].includes(lane.status) || ids.has(lane.id)) return unknown;
      ids.add(lane.id);
    }
    return { active: value.lanes.length > 0, parentActive: value.parentActive === true };
  } catch { return unknown; }
}
