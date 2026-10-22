import type { Message, SessionSummary, SummaryPlan, SummaryTask } from './contracts';
import { cronMessage } from './cron-message';
import { isUserMessage } from './user-message';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function summaryTasks(summary: SessionSummary | undefined, messages: Message[]) {
  const lastTurn = messages.reduce((last, message, index) =>
    isUserMessage(message) || cronMessage(message)?.kind === 'fire' ? index : last, -1);
  const input = messages[lastTurn];
  const turnTime = typeof input?.timestamp === 'number' && Number.isFinite(input.timestamp) && input.timestamp > 0 ? input.timestamp : undefined;
  const turnKey = JSON.stringify([input?.entryId, input?.timestamp, lastTurn]);
  const lastMutation = new Map<string, number>();
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
  // Old task snapshots may lack timestamps. Use successful structured tool results
  // as fallback evidence, never tool labels, prose or a failed mutation.
  messages.forEach((message, index) => {
    if (message.display === false) return;
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'toolCall' && block.id && ['task_create', 'task_update'].includes(block.name ?? '')) {
          calls.set(block.id, { name: block.name!, args: object(block.arguments) });
        }
      }
    }
    if (message.role !== 'toolResult' || message.isError || !message.toolCallId) return;
    const call = calls.get(message.toolCallId);
    const id = call?.name === 'task_update' ? call.args.taskId : call?.name === 'task_create' ? message.details?.id : undefined;
    if (typeof id === 'string') lastMutation.set(id, index);
  });
  const tasks: SummaryTask[] = [], retired: SummaryTask[] = [];
  for (const task of summary?.tasks ?? []) {
    const mutation = lastMutation.get(task.id);
    const old = lastTurn >= 0 && (turnTime !== undefined && task.updatedAt !== undefined
      ? task.updatedAt < turnTime : mutation !== undefined && mutation < lastTurn);
    (task.status === 'completed' && old ? retired : tasks).push(task);
  }
  const history: SummaryPlan[] = [...summary?.archivedPlans ?? []];
  if (retired.length) history.push({ id: summary?.plan?.id ?? 'legacy-plan', title: summary?.plan?.title ?? '', tasks: retired });
  return { tasks, history, turnKey };
}
