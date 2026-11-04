/** Live transport state only; saved transcript records never own a process. */
export function hasBackgroundWork(worker: { status: string; backgroundActive?: boolean }) {
  return worker.status !== 'disconnected' && worker.backgroundActive === true;
}

export type BackgroundLaneState = { id: string; status: 'running' | 'settling' };
export function backgroundLaneStates(text: unknown): { parentActive: boolean; lanes: BackgroundLaneState[] } | undefined {
  try {
    if (typeof text !== 'string') return;
    const value = JSON.parse(text);
    if (value?.version !== 1 || !Array.isArray(value.lanes)
      || value.lanes.length > 24 || value.parentActive !== undefined && typeof value.parentActive !== 'boolean') return;
    const ids = new Set<string>();
    for (const lane of value.lanes) {
      if (!lane || typeof lane.id !== 'string' || !/^lane_[0-9a-f]{8}$/.test(lane.id)
        || !['running', 'settling'].includes(lane.status) || ids.has(lane.id)) return;
      ids.add(lane.id);
    }
    return { parentActive: value.parentActive === true, lanes: value.lanes.map(({ id, status }: BackgroundLaneState) => ({ id, status })) };
  } catch { return; }
}
export function backgroundState(text: unknown): { active: boolean; parentActive: boolean } {
  const value = backgroundLaneStates(text);
  return value ? { active: value.lanes.length > 0, parentActive: value.parentActive }
    : { active: true, parentActive: false };
}
