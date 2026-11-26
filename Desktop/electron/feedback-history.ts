import type { FeedbackToolResult, Message } from '../src/contracts';
import { activeHistory, feedbackRequestsOnPath, type HistoryEntry } from './session-branching';

const toolResults = new Set<unknown>(['ok', 'error', 'timeout', 'aborted', 'denied', 'blocked', 'not_run']);
type ToolTrace = { at: number; position: number; result: FeedbackToolResult | 'started' };
type ToolCall = { reply: string; traces: ToolTrace[] };

function toolResultIdentity(message: Message) {
  return JSON.stringify([message.toolCallId, message.toolName, message.timestamp, message.isError]);
}

export function feedbackHistory(entries: HistoryEntry[], leafId: string | null, sessionId: string, messages: Message[] = []) {
  const path = activeHistory(entries, leafId);
  const positions = new Map(path.map((item, position) => [item.id, position]));
  const calls = new Map<string, ToolCall | null>();
  const matchedResults = new Map<string, string>();
  const pendingEnds = new Map<string, FeedbackToolResult>();
  const storedResults = new Map<string, HistoryEntry | null>();
  const steering = new Set<string>();
  let openTurn: string | undefined;
  const pendingUsers: string[] = [];

  for (const item of path) {
    if (item.message?.role !== 'assistant' || !Array.isArray(item.message.content)) continue;
    for (const block of item.message.content) {
      if ((block?.type === 'toolCall' || block?.type === 'tool_use') && typeof block.id === 'string' && block.id) {
        calls.set(block.id, calls.has(block.id) ? null : { reply: item.id, traces: [] });
      }
    }
  }
  for (const [position, item] of path.entries()) {
    const entry = item as HistoryEntry & { customType?: string; data?: Record<string, unknown> };
    const data = entry.data;
    if (entry.type === 'custom' && entry.customType === 'step.turn' && data?.version === 1 && typeof data.turnId === 'string') {
      if (data.phase === 'start') { openTurn = data.turnId; pendingUsers.length = 0; }
      else if (data.phase === 'end' && data.turnId === openTurn) {
        for (const id of pendingUsers) steering.add(id);
        openTurn = undefined;
        pendingUsers.length = 0;
      }
    }
    if (item.message?.role === 'user' && openTurn) pendingUsers.push(item.id);
    if (entry.type === 'custom' && entry.customType === 'step.tool_execution' && data?.version === 1 && typeof data.toolCallId === 'string') {
      const call = calls.get(data.toolCallId);
      if (!call || positions.get(call.reply)! >= position) continue;
      if (data.phase === 'start' && typeof data.startedAt === 'number' && Number.isFinite(data.startedAt)
        && (data.assistantEntryId === undefined || data.assistantEntryId === call.reply)) {
        call.traces.push({ position, at: data.startedAt, result: 'started' });
        pendingEnds.delete(data.toolCallId);
      } else if (data.phase === 'end' && typeof data.endedAt === 'number' && Number.isFinite(data.endedAt) && toolResults.has(data.outcome)) {
        const result = data.outcome as FeedbackToolResult;
        call.traces.push({ position, at: data.endedAt, result });
        pendingEnds.set(data.toolCallId, result);
      }
    }
    const message = item.message;
    if (message?.role === 'toolResult' && message.toolCallId) {
      const key = toolResultIdentity(message);
      storedResults.set(key, storedResults.has(key) ? null : item);
    }
    if (message?.role === 'toolResult' && message.toolCallId && pendingEnds.has(message.toolCallId)) {
      // The runtime writes the execution end before persisting its result message.
      const end = pendingEnds.get(message.toolCallId);
      if (end !== 'ok' || !message.isError) matchedResults.set(item.id, message.toolCallId);
      pendingEnds.delete(message.toolCallId);
    }
  }
  // Match committed tool results privately; do not change their renderer or branch identities.
  const resultEntries = new WeakMap<Message, string>();
  for (const message of messages) {
    if (message.role !== 'toolResult' || !message.toolCallId || message.desktopImported) continue;
    const stored = storedResults.get(toolResultIdentity(message));
    if (stored?.message && JSON.stringify(stored.message.content) === JSON.stringify(message.content))
      resultEntries.set(message, stored.id);
  }
  return { positions, calls, matchedResults, resultEntries, steering, requests: feedbackRequestsOnPath(path, sessionId) };
}

export type FeedbackHistory = ReturnType<typeof feedbackHistory>;
