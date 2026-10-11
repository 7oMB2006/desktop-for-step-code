import type { Message } from './contracts';
import { conversationEntries } from './conversation-presentation';

export interface GoalState {
  id: string; sessionId: string; objective: string;
  status: 'active' | 'paused' | 'blocked' | 'usage_limited' | 'budget_limited' | 'complete';
  tokensUsed: number; tokenBudget?: number; timeUsedSeconds: number; iteration: number;
  createdAt: string; updatedAt: string;
  ultracode?: boolean;
  completion?: { userEntryId: string; userTimestamp?: number };
}
export interface LaunchState { plan: boolean; planArmed?: boolean; ultracode: boolean; ultracodeArmed?: boolean; ultracodeTurn?: boolean; goalArmed: boolean; goal?: GoalState }
export type LaunchMode = 'plan' | 'goal' | 'ultracode';
export const emptyLaunch = (): LaunchState => ({ plan: false, ultracode: false, goalArmed: false });
export function draftLaunchChanges(current = emptyLaunch(), draft = emptyLaunch()): { mode: LaunchMode; enabled: boolean }[] {
  const changes: { mode: LaunchMode; enabled: boolean }[] = [];
  // Disarm an old Goal before applying the draft's mutually exclusive Plan choice.
  if (!draft.goalArmed && (current.goalArmed || current.goal?.status === 'active'))
    changes.push({ mode: 'goal', enabled: false });
  if (draft.plan || current.plan || current.planArmed)
    changes.push({ mode: 'plan', enabled: draft.plan });
  if (draft.ultracodeArmed || current.ultracodeArmed)
    changes.push({ mode: 'ultracode', enabled: Boolean(draft.ultracodeArmed) });
  if (draft.goalArmed) changes.push({ mode: 'goal', enabled: true });
  return changes;
}
export const goalStatuses = ['active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete'] as const;
export function goalCompletionResponse(messages: Message[], goal?: GoalState): number | undefined {
  if (goal?.status !== 'complete' || !goal.completion) return;
  const entries = conversationEntries(messages);
  const owners = entries.flatMap((entry, index) => entry.type === 'user' &&
    (entry.item.message.entryId ? entry.item.message.entryId === goal.completion!.userEntryId
      : goal.completion!.userTimestamp !== undefined && entry.item.message.timestamp === goal.completion!.userTimestamp) ? [index] : []);
  if (owners.length !== 1) return;
  let response: number | undefined;
  for (const entry of entries.slice(owners[0] + 1)) {
    if (entry.type === 'user') break;
    response = entry.index;
  }
  return response;
}
export function goalStatusLabel(status: GoalState['status'], zh: boolean) {
  return (zh ? { active: '持续推进', paused: '已暂停', blocked: '需要介入', usage_limited: '服务用量受限', budget_limited: '预算已耗尽', complete: '已完成' }
    : { active: 'Pursuing goal', paused: 'Paused', blocked: 'Needs input', usage_limited: 'Usage limited', budget_limited: 'Budget reached', complete: 'Completed' })[status];
}
