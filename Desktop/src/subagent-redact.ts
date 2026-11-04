import { decodeString } from 'micromark-util-decode-string';
import type { Message } from './contracts';

// Mirrors the main-process SENSITIVE_LINE filter in electron/runtime.ts so a subagent's own
// transcript cannot surface credentials, cookies or raw child-process environment values that
// the main conversation would not have shown separately. AGENTS.md forbids displaying them.

const SENSITIVE_LINE = /(api[-_.]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|secret|password|passwd|credential|cookie|authorization|bearer\s+[A-Za-z0-9._-]|['"]?(?:token|apiKey|api_key)['"]?\s*[:=]|^\s*(?:STEP|PI|AI_AGENT)[A-Z0-9_]*\s*=)/i;

const PLACEHOLDER = '[redacted]';

/** Decode only the matching view; safe displayed text keeps its original escaping. */
function sensitiveLine(line: string): boolean {
  let decoded = line;
  for (let pass = 0; pass < 8; pass++) {
    if (SENSITIVE_LINE.test(decoded)) return true;
    const next = decodeString(decoded);
    if (next === decoded) return false;
    decoded = next;
  }
  return SENSITIVE_LINE.test(decoded) || decodeString(decoded) !== decoded;
}

/** Replaces credential-bearing lines, preserving Markdown spacing and line endings. */
export function redactSensitiveLines(text: string): { text: string; redacted: number } {
  if (!text) return { text, redacted: 0 };
  let redacted = 0;
  const lines = text.split(/(\r\n|\n|\r)/u).map((line, index) => {
    if (index % 2 || !line.trim() || !sensitiveLine(line)) return line;
    redacted += 1;
    return PLACEHOLDER;
  });
  return { text: lines.join(''), redacted };
}

export function redactSensitiveText(text: string): string {
  return redactSensitiveLines(text).text;
}

/** The wrapper is structure, not an output line: its opener/closer can share sensitive lines. */
function redactNotificationLines(text: string): { text: string; redacted: number } {
  const wrapper = /^(\s*<agent-notification\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*)(<\/agent-notification>\s*)$/u.exec(text);
  if (!wrapper) return redactSensitiveLines(text);
  const body = redactSensitiveLines(wrapper[2]);
  let redacted = body.redacted;
  const header = wrapper[1].replace(/(\s+alias=)("[^"]*"|'[^']*')/gu, (_attribute, prefix: string, quoted: string) => {
    const alias = redactSensitiveLines(quoted.slice(1, -1));
    redacted += alias.redacted;
    return `${prefix}${quoted[0]}${alias.text}${quoted.at(-1)}`;
  });
  return { text: header + body.text + wrapper[3], redacted };
}

function safeArgumentValue(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const safe = redactSensitiveText(value);
    return { value: safe, changed: safe !== value };
  }
  if (Array.isArray(value)) {
    const items = value.map(safeArgumentValue);
    return { value: items.some(item => item.changed) ? items.map(item => item.value) : value,
      changed: items.some(item => item.changed) };
  }
  if (!value || typeof value !== 'object') return { value, changed: false };
  const entries = Object.entries(value).map(([key, entry]) => [key, safeArgumentValue(entry)] as const);
  const changed = entries.some(([, entry]) => entry.changed);
  return { value: changed ? Object.fromEntries(entries.map(([key, entry]) => [key, entry.value])) : value, changed };
}

export function subagentDisplayCall<T extends { type: string; name?: string; arguments?: unknown }>(call: T): T {
  if (call.type !== 'toolCall' || !['subagent', 'agent_send'].includes(call.name ?? '')) return call;
  const safe = safeArgumentValue(call.arguments);
  return safe.changed ? { ...call, arguments: safe.value } : call;
}

/**
 * History stays raw. Only typed notification / child-tool output gets a display copy; prose and
 * user/assistant messages cannot claim that identity with an XML-looking string. Tool IDs and
 * structured lifecycle fields are deliberately outside this projection.
 */
export function subagentDisplayMessage(message: Message, callName?: string): Message {
  const notification = message.role === 'custom' && message.customType === 'agent-notification';
  if (!notification && !(message.role === 'toolResult' && ['subagent', 'agent_send'].includes(message.toolName ?? callName ?? ''))) return message;
  const redact = notification ? (text: string) => redactNotificationLines(text).text : redactSensitiveText;
  const content = typeof message.content === 'string' ? redact(message.content)
    : message.content.map(block => block.type === 'text' && typeof block.text === 'string'
      ? { ...block, text: redact(block.text) } : block);
  const details = typeof message.details?.detail === 'string'
    ? { ...message.details, detail: redactSensitiveText(message.details.detail) } : message.details;
  return { ...message, content, ...(details ? { details } : {}) };
}

/**
 * Redacts a subagent's own messages before the panel renders them. Both surfaces are new when a
 * child transcript is shown individually: tool arguments (the main conversation never exposed a
 * child call's input) and result text. Returns redacted copies plus how many lines were removed.
 */
export function redactSubagentMessages<T extends { role: string; content: unknown; customType?: string }>(messages: T[]): { messages: T[]; redacted: number } {
  let redacted = 0;
  const next = messages.map(message => {
    const redact = message.role === 'custom' && message.customType === 'agent-notification'
      ? redactNotificationLines : redactSensitiveLines;
    if (typeof message.content === 'string') {
      const result = redact(message.content);
      redacted += result.redacted;
      return { ...message, content: result.text };
    }
    if (!Array.isArray(message.content)) return message;
    const content = message.content.map(block => {
      if (!block || typeof block !== 'object') return block;
      const value = block as Record<string, unknown>;
      if (typeof value.text === 'string') {
        const result = redact(value.text);
        redacted += result.redacted;
        return { ...value, text: result.text };
      }
      if (value.arguments !== undefined) {
        const raw = (() => { try { return JSON.stringify(value.arguments); } catch { return undefined; } })();
        if (raw === undefined) return value;
        const result = redactSensitiveLines(raw);
        if (result.redacted) redacted += result.redacted;
        return { ...value, arguments: result.redacted ? { redacted: PLACEHOLDER } : value.arguments };
      }
      return value;
    });
    return { ...message, content };
  });
  return { messages: next, redacted };
}

