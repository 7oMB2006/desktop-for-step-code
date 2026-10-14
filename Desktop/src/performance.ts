import type { RuntimeEvent, Usage } from './contracts';

export interface RunMetrics {
  phase?: 'thinking' | 'executing' | 'responding';
  startedAt: number;
  finishedAt?: number;
  firstTextAt?: number;
  turns: number;
  tools: number;
  toolTimeMs: number;
  activeTools: Record<string, number>;
  usage: Usage;
  liveUsage?: Usage;
  usageReported?: boolean;
  outputTiming?: { firstAt: number; lastAt: number };
  measuredOutputTokens?: number;
  measuredOutputMs?: number;
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

export function outputTokensPerSecond(run: RunMetrics | null): number | undefined {
  const tokens = run?.measuredOutputTokens;
  const ms = run?.measuredOutputMs;
  return tokens !== undefined && ms !== undefined && tokens > 0 && ms >= 100
    ? tokens * 1000 / ms : undefined;
}

export function updateRunMetrics(run: RunMetrics | null, event: RuntimeEvent, now: number): RunMetrics | null {
  if (event.type === 'agent_start') return {
    startedAt: now, phase: 'responding', turns: 0, tools: 0, toolTimeMs: 0, activeTools: {}, usage: emptyUsage(),
  };
  if (!run || run.finishedAt !== undefined) return run;
  switch (event.type) {
    case 'message_start':
      return event.message?.role === 'assistant' ? { ...run, phase: 'responding', outputTiming: undefined, liveUsage: undefined } : run;
    case 'turn_start':
      return { ...run, phase: Object.keys(run.activeTools).length ? 'executing' : 'responding', turns: run.turns + 1 };
    case 'tool_execution_start':
      return {
        ...run, phase: 'executing', tools: run.tools + 1,
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
      const hasOutput = ['text_delta', 'thinking_delta', 'toolcall_delta'].includes(delta?.type) && typeof delta.delta === 'string' && delta.delta.length > 0;
      return {
        ...run,
        phase: delta?.type === 'thinking_start' || delta?.type === 'thinking_delta' ? 'thinking'
          : ['text_start', 'text_delta', 'toolcall_start', 'toolcall_delta'].includes(delta?.type) ? 'executing' : run.phase,
        outputTiming: hasOutput ? { firstAt: run.outputTiming?.firstAt ?? now, lastAt: now } : run.outputTiming,
        firstTextAt: run.firstTextAt ?? (delta?.type === 'text_delta' && delta.delta ? now : undefined),
        liveUsage: event.usage ? { ...emptyUsage(), ...event.usage } : run.liveUsage,
        usageReported: run.usageReported || Boolean(event.usage),
      };
    }
    case 'message_end': {
      const elapsed = run.outputTiming ? run.outputTiming.lastAt - run.outputTiming.firstAt : 0;
      const tokens = amount(event.message?.usage?.output);
      // Measure received output only; never invent a tokenizer for missing usage.
      const measured = elapsed >= 100 && tokens > 0 && !['error', 'aborted', 'length'].includes(event.message?.stopReason);
      return event.message?.role === 'assistant'
        ? {
            ...run,
            phase: 'executing',
            firstTextAt: run.firstTextAt ?? (Array.isArray(event.message.content) && event.message.content.some((part: { type: string; text?: string }) => part.type === 'text' && part.text) ? now : undefined),
            usage: event.message.usage ? addUsage(run.usage, event.message.usage) : run.usage,
            usageReported: run.usageReported || Boolean(event.message.usage),
            liveUsage: undefined,
            outputTiming: undefined,
            measuredOutputTokens: (run.measuredOutputTokens ?? 0) + (measured ? tokens : 0),
            measuredOutputMs: (run.measuredOutputMs ?? 0) + (measured ? elapsed : 0),
          }
        : run;
    }
    case 'agent_end':
      return { ...run, finishedAt: now, activeTools: {}, outputTiming: undefined };
    default:
      return run;
  }
}
