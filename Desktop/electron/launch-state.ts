import { activeHistory, type HistoryEntry } from './session-branching';
import { emptyLaunch, goalStatuses, type GoalState, type LaunchState } from '../src/launch-state';

export function projectLaunch(entries: HistoryEntry[], leafId: string | null, sessionId: string, previous = emptyLaunch()): LaunchState {
  const next: LaunchState = { ...previous, plan: false, goal: undefined };
  let user: GoalState['completion'];
  const completions = new Map<string, NonNullable<GoalState['completion']>>();
  for (const entry of activeHistory(entries, leafId)) {
    const custom = entry as HistoryEntry & { customType?: string; data?: any; timestamp?: string; display?: boolean };
    if (entry.type === 'message' && entry.message?.role === 'user' && entry.message.display !== false)
      user = { userEntryId: entry.id, userTimestamp: entry.message.timestamp };
    if (entry.type === 'custom_message' && custom.customType === 'desktop-goal-input' && custom.display !== false) {
      const timestamp = Date.parse(custom.timestamp ?? '');
      user = { userEntryId: entry.id, ...(Number.isFinite(timestamp) ? { userTimestamp: timestamp } : {}) };
    }
    if (custom.type !== 'custom') continue;
    const value = custom.data;
    if (custom.customType === 'step-plan' && typeof value?.enabled === 'boolean') next.plan = value.enabled;
    if (custom.customType !== 'step-goal' || value?.sessionId !== sessionId) continue;
    if (value.cleared === true) { next.goal = undefined; completions.clear(); continue; }
    if (typeof value.id !== 'string' || typeof value.objective !== 'string' || value.objective.length > 16000
      || !goalStatuses.includes(value.status) || !['tokensUsed', 'timeUsedSeconds', 'iteration'].every(key =>
        Number.isSafeInteger(value[key]) && value[key] >= 0)
      || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))
      || value.tokenBudget !== undefined && (!Number.isSafeInteger(value.tokenBudget) || value.tokenBudget <= 0)) continue;
    next.goal = Object.fromEntries(['id', 'sessionId', 'objective', 'status', 'tokensUsed', 'timeUsedSeconds', 'iteration',
      'createdAt', 'updatedAt', 'tokenBudget'].filter(key => value[key] !== undefined).map(key => [key, value[key]])) as unknown as GoalState;
    if (value.status === 'complete') {
      if (!completions.has(value.id) && user) completions.set(value.id, user);
      const completion = completions.get(value.id);
      if (completion) next.goal.completion = completion;
    } else completions.delete(value.id);
    if (next.goal.objective.startsWith('ultracode: ')) {
      next.goal = { ...next.goal, objective: next.goal.objective.slice('ultracode: '.length), ultracode: true };
    }
  }
  if (next.goal && next.goal.status !== 'complete') next.goalArmed = false;
  return next;
}

export function ultracodeNotification(event: { method?: string; message?: string }): boolean | undefined {
  if (event.method !== 'notify') return;
  if (/^Ultra(?:code|loop) is on for the session\./.test(event.message ?? '') || /^Ultra(?:code|loop) session mode: on\.$/.test(event.message ?? '')) return true;
  if (/^Ultra(?:code|loop) session mode is off\./.test(event.message ?? '') || /^Ultra(?:code|loop) session mode: off\.$/.test(event.message ?? '')) return false;
}
