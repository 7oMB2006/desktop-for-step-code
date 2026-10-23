import type { Message } from './contracts';
import { conversationEntries } from './conversation-presentation';
import { cronMessage } from './cron-message';

export type ApprovedPlan = { path: string; content: string; title: string };
export type PlanExecutionState = 'running' | 'completed' | 'failed' | 'interrupted';

export function approvedPlan(message?: Message): ApprovedPlan | undefined {
  if (message?.desktopImported || message?.role !== 'toolResult' || message.toolName !== 'exit_plan_mode' || message.isError
    || message.details?.outcome !== 'approved') return;
  const { planFilePath: path, planContents: content } = message.details;
  if (typeof path !== 'string' || typeof content !== 'string' || !path.trim() || !content.trim()) return;
  const title = /^#\s+(.+)$/m.exec(content)?.[1]?.replace(/\r$/, '').trim() || path.split(/[\\/]/).at(-1) || 'Plan';
  return { path, content, title };
}

// Ordinary user turns end execution ownership; steering stays in the same run.
export function planExecution(messages: Message[], active: boolean) {
  let approvalIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (approvedPlan(messages[index])) { approvalIndex = index; break; }
  }
  if (approvalIndex < 0) return;
  const plan = approvedPlan(messages[approvalIndex])!;
  const last = messages.slice(approvalIndex + 1).reverse().find(message => message.role === 'assistant');
  const state: PlanExecutionState = active ? 'running' : last?.stopReason === 'error' ? 'failed'
    : last?.stopReason === 'stop' ? 'completed' : 'interrupted';
  return { plan, state };
}

export function planExecutionResponses(messages: Message[], busy: boolean) {
  const result = new Map<number, NonNullable<ReturnType<typeof planExecution>>>();
  let run: Message[] = [];
  let responseIndex: number | undefined;
  const flush = (active: boolean) => {
    const execution = planExecution(run, active);
    if (execution && responseIndex !== undefined) result.set(responseIndex, execution);
  };
  for (const entry of conversationEntries(messages)) {
    if (entry.type === 'user') {
      if (!entry.item.message.desktopSteered) { flush(false); run = []; responseIndex = undefined; }
    } else {
      if (cronMessage(entry.items[0].message)) {
        flush(false); run = []; responseIndex = undefined;
      }
      run.push(...entry.items.map(item => item.message));
      responseIndex = entry.index;
    }
  }
  flush(busy);
  return result;
}
