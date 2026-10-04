import type { Message } from './contracts';

export type MessageFilter = 'all' | 'user' | 'assistant' | 'toolResult';
export const finiteAmount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export function contextCapacityColors(value: unknown) {
  const amount = finiteAmount(value);
  if (amount === undefined || amount === 0) return undefined;
  const percent = Math.min(100, amount);
  // Fixed capacity scale: quiet green, neutral middle, increasing red pressure.
  const pressure = Math.max(0, (percent - 60) / 40);
  const chroma = percent < 40 ? .065 * (1 - percent / 40) : .20 * pressure;
  const hue = percent < 40 ? 158 : 25;
  return {
    light: `oklch(0.48 ${chroma.toFixed(4)} ${hue})`,
    dark: `oklch(${(.76 - .06 * pressure).toFixed(4)} ${chroma.toFixed(4)} ${hue})`,
  };
}

export function contextMessageCounts(messages: Message[]) {
  return {
    all: messages.length,
    user: messages.filter(message => message.role === 'user').length,
    assistant: messages.filter(message => message.role === 'assistant').length,
    toolResult: messages.filter(message => message.role === 'toolResult').length,
  };
}

export function contextMessagePreview(message: Message): string {
  const parts = Array.isArray(message.content) ? message.content : [];
  const text = typeof message.content === 'string' ? message.content :
    parts.find(part => part.type === 'text')?.text ??
    parts.find(part => part.type === 'thinking')?.thinking ??
    parts.find(part => part.type === 'toolCall')?.name ?? message.summary ?? message.command ?? message.toolName ?? message.role;
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

const hiddenKey = /^(?:data|.*signature|authorization|cookie|set-cookie|api[-_]?key|.*token|password|secret|credentials|env)$/i;
function inspectValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth limit]';
  if (typeof value === 'string') {
    const safe = value.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]');
    return safe.length > 6000 ? `${safe.slice(0, 6000)} [truncated]` : safe;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => inspectValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100)
    .map(([key, item]) => [key, hiddenKey.test(key) ? '[omitted]' : inspectValue(item, depth + 1)]));
  return value;
}

// Only session-message fields are exposed, never RPC envelopes or process state.
export function contextMessageJson(message: Message): string {
  const { role, timestamp, provider, model, stopReason, toolCallId, toolName, isError, content, usage, summary, command, output, excludeFromContext } = message;
  const projected = { role, timestamp, provider, model, stopReason, toolCallId, toolName, isError,
    content: inspectValue(content), summary: inspectValue(summary), command: inspectValue(command), output: inspectValue(output), excludeFromContext, usage };
  const json = JSON.stringify(projected, null, 2);
  return json.length > 24000 ? `${json.slice(0, 24000)}\n[display limit]` : json;
}
