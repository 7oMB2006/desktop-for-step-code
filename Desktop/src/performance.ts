import type { RuntimeEvent, Usage } from './contracts';

export interface RunMetrics {
  startedAt: number;
  finishedAt?: number;
  firstTextAt?: number;
  turns: number;
  tools: number;
  toolTimeMs: number;
  activeTools: Record<string, number>;
  usage: Usage;
  liveUsage?: Usage;
}

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

export function addUsage(total: Usage, value: Usage): Usage {
  return {
    input: total.input + amount(value.input),
    output: total.output + amount(value.output),
    cacheRead: total.cacheRead + amount(value.cacheRead),
    cacheWrite: total.cacheWrite + amount(value.cacheWrite),
  };
}

export function displayedUsage(run: RunMetrics): Usage {
  return run.liveUsage ? addUsage(run.usage, run.liveUsage) : run.usage;
}

export function cacheHitRate(usage: Usage): number | undefined {
  const read = amount(usage.cacheRead);
  const written = amount(usage.cacheWrite);
  const total = amount(usage.input) + read + written;
  return read + written > 0 && total > 0 ? read / total : undefined;
}

export function updateRunMetrics(run: RunMetrics | null, event: RuntimeEvent, now: number): RunMetrics | null {
  if (event.type === 'agent_start') return {
    startedAt: now, turns: 0, tools: 0, toolTimeMs: 0, activeTools: {}, usage: emptyUsage(),
  };
  if (!run || run.finishedAt !== undefined) return run;
  switch (event.type) {
    case 'turn_start':
      return { ...run, turns: run.turns + 1 };
    case 'tool_execution_start':
      return {
        ...run, tools: run.tools + 1,
        activeTools: { ...run.activeTools, [String(event.toolCallId)]: now },
      };
    case 'tool_execution_end': {
      const id = String(event.toolCallId);
      const started = run.activeTools[id];
      const activeTools = { ...run.activeTools };
      delete activeTools[id];
      return { ...run, activeTools, toolTimeMs: run.toolTimeMs + (started === undefined ? 0 : Math.max(0, now - started)) };
    }
    case 'message_update': {
      const delta = event.assistantMessageEvent;
      return {
        ...run,
        firstTextAt: run.firstTextAt ?? (delta?.type === 'text_delta' && delta.delta ? now : undefined),
        liveUsage: event.usage ? { ...emptyUsage(), ...event.usage } : run.liveUsage,
      };
    }
    case 'message_end':
      return event.message?.role === 'assistant'
        ? {
            ...run,
            firstTextAt: run.firstTextAt ?? (Array.isArray(event.message.content) && event.message.content.some((part: { type: string; text?: string }) => part.type === 'text' && part.text) ? now : undefined),
            usage: event.message.usage ? addUsage(run.usage, event.message.usage) : run.usage,
            liveUsage: undefined,
          }
        : run;
    case 'agent_end':
      return { ...run, finishedAt: now, activeTools: {} };
    default:
      return run;
  }
}
