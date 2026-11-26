import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { AppBuildInfo, FeedbackOptions, Message } from '../src/contracts';
import { attachmentPresentation } from '../src/attachment-references';
import { sanitizeTerminalText } from './feedback-upstream/sanitize-terminal.ts';
import { createBoundedSecretRedactor, redactSecretString, type BoundedSecretRedactor } from './feedback-upstream/secret-redaction.ts';
import { redactDiagnosticPii } from './feedback-upstream/redact-diagnostics.ts';

// Pure redactors copied from Step Code 5309624e. Never invoke feedback submission or bundle collection.
function excerpt(redactor: BoundedSecretRedactor, value: string, limit: number, partial = false) {
  if (value.length > 32768) return { text: '', truncated: true };
  const result = redactor.redact(sanitizeTerminalText(value));
  if (result.status !== 'ready') return { text: '[redacted]', truncated: true };
  const safe = redactDiagnosticPii(result.value)
    .replace(/^.*\b[A-Z_][A-Z_0-9]*\s*=.*$/gm, '[redacted]')
    .replace(/^.*(?:cookie|authorization)\s*[:=].*$/gim, '[redacted]');
  const end = partial ? Math.min(limit, Math.floor(safe.length / 2)) : limit;
  return { text: safe.slice(0, end), truncated: safe.length > end };
}

export function feedbackReport(options: FeedbackOptions, messages: Message[], context: {
  desktop: string; stepCode: AppBuildInfo['runtime']; platform: string; arch: string;
}, requestId?: string) {
  const failed = (m: Message) => m.isError || m.stopReason === 'error';
  const failures = messages.filter(failed);
  const lastError = failures.at(-1);
  const time = new Date(options.errorAt ?? lastError?.timestamp ?? NaN);
  if (options.errorAt && (!Number.isFinite(time.getTime()) || time.toISOString() !== options.errorAt))
    throw new Error('Invalid incident time');
  const candidates = messages.filter(m => (options.conversation && ['user', 'assistant'].includes(m.role))
    || (options.tools && m.role === 'toolResult' && m.isError));
  const fields = candidates.slice(-4).map(m => {
    const block = Array.isArray(m.content) ? m.content.find(b => b.type === 'text') : undefined;
    const text = typeof m.content === 'string' ? m.content : block?.text ?? '';
    return { role: m.role, value: m.role === 'user' && text.length <= 32768
      ? attachmentPresentation(text)?.draft ?? text : text };
  });
  // Discover labelled secrets across the chosen fields before redacting echoes in any one field.
  const redactor = createBoundedSecretRedactor();
  for (const field of [options.expected, options.actual, ...fields.map(f => f.value)]) {
    if (field.length <= 32768) redactor.redact(sanitizeTerminalText(field));
    else redactor.invalidate();
  }
  const excerpts = fields.map(({ role, value }) => ({
    role, ...excerpt(redactor, value, role === 'toolResult' ? 160 : 320, role === 'toolResult'),
  }));
  return JSON.stringify({ format: 'dfsc-local-feedback-v1', at: new Date().toISOString(), context,
    request: requestId && /^[a-zA-Z0-9_.:-]{1,128}$/.test(requestId) && redactSecretString(requestId) === requestId && excerpt(redactor, requestId, 128).text === requestId ? { requestId } : null,
    expected: excerpt(redactor, options.expected, 1000), actual: excerpt(redactor, options.actual, 1000),
    diagnostics: { errorAt: Number.isFinite(time.getTime()) ? time.toISOString() : null,
      errorAtSource: options.errorAt ? 'user' : lastError?.timestamp ? 'session' : null,
      lastFailure: lastError ? (lastError.role === 'toolResult' ? 'tool' : 'response') : null,
      messages: messages.length, failures: failures.length },
    excerpts, omittedEligibleMessages: Math.max(0, candidates.length - excerpts.length),
    exclusions: ['raw session', 'other sessions', 'environment', 'workspace files', 'attachments', 'logs',
      'tool arguments', 'full tool outputs', 'non-text blocks', 'additional text blocks',
      ...(!options.conversation ? ['conversation text'] : []), ...(!options.tools ? ['tool output excerpts'] : [])],
  }, null, 2);
}

export class FeedbackPreview {
  readonly token = randomUUID();
  constructor(readonly owner: string, readonly sessionId: string, readonly content: string) {}
  async save(owner: string, sessionId: string, token: string,
    destination: () => Promise<string | undefined>, validate: () => void) {
    if (owner !== this.owner || sessionId !== this.sessionId || token !== this.token)
      throw new Error('Preview this conversation again');
    const path = await destination();
    if (!path) return false;
    validate();
    await writeFile(path, gzipSync(this.content), { mode: 0o600 });
    return true;
  }
}
