import type { Message, SummaryTask } from './contracts';
import { backgroundSubagentStates, conversationEntries, responsePresentation, subagentTasks, type SubagentTask } from './conversation-presentation';
import { workflowsFromMessages } from './workflow-state';
import { redactSensitiveText } from './subagent-redact';
import { isUserMessage } from './user-message';
import { cronMessage } from './cron-message';

export type SummaryAgent = {
  key: string; agent: string; task: string;
  status: SubagentTask['status'] | 'unknown' | 'cached';
  carried?: boolean;
  target: { type: 'subagent'; task: SubagentTask } | { type: 'workflow'; id: string };
};

/** Reuse structured timeline projections; never infer success from a parent tool. */
export function summaryAgents(messages: Message[], busy: boolean): SummaryAgent[] {
  const background = backgroundSubagentStates(messages);
  const entries = conversationEntries(messages);
  const lastTurn = messages.reduce((last, message, index) =>
    isUserMessage(message) || cronMessage(message) ? index : last, -1);
  const callOrigins = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.display === false || !Array.isArray(message.content)) return;
    for (const block of message.content) {
      if (block.type === 'toolCall' && block.id) callOrigins.set(block.id, index);
    }
  });
  messages.forEach((message, index) => {
    if (message.display !== false && message.role === 'toolResult'
      && message.toolCallId && !callOrigins.has(message.toolCallId)) callOrigins.set(message.toolCallId, index);
  });
  const records: SummaryAgent[] = [];
  entries.forEach((entry, position) => {
    if (entry.type !== 'response') return;
    const active = busy && position === entries.length - 1;
    for (const item of responsePresentation(entry.items).content) {
      if (item.type !== 'tool' || (item.call?.name ?? item.result?.toolName) !== 'subagent') continue;
      const results = Array.isArray(item.result?.details?.results)
        ? item.result.details.results.filter(record => record && typeof record === 'object') : [];
      subagentTasks(item.call, item.result, background).forEach((task, index) => {
        const raw = results[index] as { status?: unknown } | undefined;
        const registered = task.backgroundAgentId && background.has(task.backgroundAgentId);
        const explicit = ['queued', 'running', 'completed', 'failed', 'aborted', 'skipped'].includes(String(raw?.status));
        const status = registered || explicit ? task.status
          : item.result?.isError ? 'failed' : !item.result && active ? 'queued' : 'unknown';
        const callId = item.call?.id ?? item.result?.toolCallId;
        const carried = (callId ? callOrigins.get(callId) ?? item.index : item.index) < lastTurn;
        if (carried && !(registered && (status === 'running' || status === 'queued'))) return;
        records.push({ key: `subagent:${item.key}:${index}`, agent: redactSensitiveText(task.agent),
          task: redactSensitiveText(task.task), status, carried, target: { type: 'subagent', task } });
      });
    }
  });
  for (const flow of workflowsFromMessages(messages, busy)) {
    if ((callOrigins.get(flow.toolCallId) ?? -1) < lastTurn) continue;
    for (const agent of flow.agents) records.push({
      key: `workflow:${flow.toolCallId}:${agent.id}`, agent: agent.label, task: agent.task, status: agent.status,
      target: { type: 'workflow', id: flow.runId ?? flow.toolCallId },
    });
  }
  return records;
}

export function summaryActivity(tasks: SummaryTask[] | undefined, agents: SummaryAgent[], stale = false, busy = false) {
  if (busy) return 'running';
  if (stale || !tasks) return 'unknown';
  if (tasks.some(task => task.status === 'in_progress') || agents.some(agent => agent.status === 'running')) return 'running';
  if (agents.some(agent => agent.status === 'unknown')) return 'unknown';
  if ((tasks.length > 0 || agents.length > 0)
    && tasks.every(task => task.status === 'completed')
    && agents.every(agent => agent.status === 'completed' || agent.status === 'cached')) return 'completed';
  return 'idle';
}
