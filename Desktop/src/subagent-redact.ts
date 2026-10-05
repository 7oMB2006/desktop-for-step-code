// Mirrors the main-process SENSITIVE_LINE filter in electron/runtime.ts so a subagent's own
// transcript cannot surface credentials, cookies or raw child-process environment values that
// the main conversation would not have shown separately. AGENTS.md forbids displaying them.

const SENSITIVE_LINE = /(api[-_.]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|secret|password|passwd|credential|cookie|authorization|bearer\s+[A-Za-z0-9._-]|['"]?(?:token|apiKey|api_key)['"]?\s*[:=]|^\s*(?:STEP|PI|AI_AGENT)[A-Z0-9_]*\s*=)/i;

const PLACEHOLDER = '[redacted]';

/** Drops lines that look credential-bearing. Callers show a note when anything was removed. */
export function redactSensitiveLines(text: string): { text: string; redacted: number } {
  if (!text) return { text, redacted: 0 };
  let redacted = 0;
  const lines = text.split('\n').map(line => {
    if (!line.trim() || !SENSITIVE_LINE.test(line)) return line;
    redacted += 1;
    return PLACEHOLDER;
  });
  return { text: lines.join('\n'), redacted };
}

export function redactSensitiveText(text: string): string {
  return redactSensitiveLines(text).text;
}

/**
 * Redacts a subagent's own messages before the panel renders them. Both surfaces are new when a
 * child transcript is shown individually: tool arguments (the main conversation never exposed a
 * child call's input) and result text. Returns redacted copies plus how many lines were removed.
 */
export function redactSubagentMessages<T extends { role: string; content: unknown }>(messages: T[]): { messages: T[]; redacted: number } {
  let redacted = 0;
  const next = messages.map(message => {
    if (typeof message.content === 'string') {
      const result = redactSensitiveLines(message.content);
      redacted += result.redacted;
      return { ...message, content: result.text };
    }
    if (!Array.isArray(message.content)) return message;
    const content = message.content.map(block => {
      if (!block || typeof block !== 'object') return block;
      const value = block as Record<string, unknown>;
      if (typeof value.text === 'string') {
        const result = redactSensitiveLines(value.text);
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

