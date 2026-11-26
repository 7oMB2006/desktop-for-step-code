import { randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AppBuildInfo, FeedbackOptions, Message } from '../src/contracts';
import { attachmentPresentation } from '../src/attachment-references';
import { isUserMessage } from '../src/user-message';
import { sanitizeTerminalText } from './feedback-upstream/sanitize-terminal.ts';
import { createBoundedSecretRedactor, redactSecretString, type BoundedSecretRedactor } from './feedback-upstream/secret-redaction.ts';
import { redactDiagnosticPii } from './feedback-upstream/redact-diagnostics.ts';

// Pure redactors copied from Step Code 5309624e. Never invoke feedback submission or bundle collection.
const WINDOWS_NETWORK_PATH = /\\[^\s\\/"<>|]+\\[^\r\n"'<>|]+/gu;
const MAX_REDACTION_FIELD = 32 * 1024;
const MAX_REDACTION_CONTEXT = 128 * 1024;
const MAX_REDACTION_FIELDS = 64;

function* textBlocks(message: Message) {
  if (typeof message.content === 'string') yield message.content;
  else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type === 'text' && typeof block.text === 'string') yield block.text;
    }
  }
}
function excerpt(redactor: BoundedSecretRedactor, value: string, limit: number, partial = false) {
  if (value.length > MAX_REDACTION_FIELD) return { text: '', truncated: true };
  const result = redactor.redact(sanitizeTerminalText(value));
  if (result.status !== 'ready') return { text: '[redacted]', truncated: true };
  const safe = redactDiagnosticPii(result.value.replace(WINDOWS_NETWORK_PATH, '<redacted:path>'))
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
  // Keep a single turn: the user input leading up to the latest failure, or the current turn.
  // A later unrelated turn must not displace the evidence or enter the report.
  const anchor = lastError ? messages.lastIndexOf(lastError) : messages.length - 1;
  let start = anchor;
  while (start > 0 && !isUserMessage(messages[start])) start--;
  const turn = options.conversation || options.tools ? messages.slice(Math.max(0, start), anchor + 1) : [];
  const candidates = turn.filter(m => m.display !== false && ((options.conversation && ['user', 'assistant'].includes(m.role))
    || (options.tools && m.role === 'toolResult' && m.isError)));
  const fields = candidates.slice(-4).map(message => {
    const text = textBlocks(message).next().value ?? '';
    return { role: message.role, value: message.role === 'user' && text.length <= MAX_REDACTION_FIELD
      ? attachmentPresentation(text)?.draft ?? text : text };
  });
  // Discover labelled secrets in the bounded related turn before exporting any excerpt.
  // The additional blocks are scanned locally because a selected excerpt may echo a value from them.
  const redactor = createBoundedSecretRedactor();
  function* redactionFields() {
    yield options.expected;
    yield options.actual;
    for (const message of turn) yield* textBlocks(message);
  }
  let characters = 0, count = 0;
  for (const field of redactionFields()) {
    characters += field.length;
    if (++count > MAX_REDACTION_FIELDS || field.length > MAX_REDACTION_FIELD || characters > MAX_REDACTION_CONTEXT) {
      redactor.invalidate();
      break;
    }
    redactor.redact(sanitizeTerminalText(field));
  }
  const excerpts = fields.map(({ role, value }) => ({
    role, ...excerpt(redactor, value, role === 'toolResult' ? 160 : 320, role === 'toolResult'),
  }));
  return JSON.stringify({ format: 'dfsc-local-feedback-v1', at: new Date().toISOString(), context,
    request: requestId && /^[a-zA-Z0-9_.:-]{1,128}$/.test(requestId) && redactSecretString(requestId) === requestId && excerpt(redactor, requestId, 128).text === requestId ? { requestId, source: 'latest reply on selected branch' } : null,
    expected: excerpt(redactor, options.expected, 1000), actual: excerpt(redactor, options.actual, 1000),
    diagnostics: { errorAt: Number.isFinite(time.getTime()) ? time.toISOString() : null,
      errorAtSource: options.errorAt ? 'user' : lastError?.timestamp ? 'session' : null,
      lastFailure: lastError ? (lastError.role === 'toolResult' ? 'tool' : 'response') : null,
      messages: messages.length, failures: failures.length },
    excerptScope: lastError ? 'turn through latest failure' : 'latest turn', excerpts, omittedEligibleMessages: Math.max(0, candidates.length - excerpts.length),
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
    const scratch = await mkdtemp(join(dirname(path), '.dfsc-feedback-'));
    try {
      const archive = join(scratch, 'report.gz');
      await writeFile(archive, gzipSync(this.content), { mode: 0o600 });
      validate();
      await rename(archive, path);
      return true;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
