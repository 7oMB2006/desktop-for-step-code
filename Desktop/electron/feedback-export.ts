import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FeedbackEvent, FeedbackOptions, FeedbackReport, Message } from '../src/contracts';
import { attachmentPresentation } from '../src/attachment-references';
import { isUserMessage } from '../src/user-message';
import { sanitizeTerminalText } from './feedback-upstream/sanitize-terminal.ts';
import { createBoundedSecretRedactor, redactSecretString, type BoundedSecretRedactor } from './feedback-upstream/secret-redaction.ts';
import { redactDiagnosticPii } from './feedback-upstream/redact-diagnostics.ts';
import type { FeedbackRequestEvidence } from './session-branching';
import type { FeedbackHistory } from './feedback-history';

// Pure redactors copied from Step Code 5309624e. Never invoke feedback submission or bundle collection.
const WINDOWS_NETWORK_PATH = /\\[^\s\\/"<>|]+\\[^\r\n"'<>|]+/gu;
const MAX_REDACTION_FIELD = 32 * 1024;
const MAX_REDACTION_CONTEXT = 128 * 1024;
const MAX_REDACTION_FIELDS = 64;
const MAX_EVENTS = 64;

export function feedbackDirectory(downloads: string) {
  return join(downloads, 'Desktop for Step Code Feedback');
}

export async function prepareFeedbackDirectory(downloads: string) {
  const path = feedbackDirectory(downloads);
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory()) throw new Error('Feedback destination is not a local directory');
  return path;
}

export async function defaultFeedbackPath(downloads: string) {
  const directory = await prepareFeedbackDirectory(downloads);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(directory, `dfsc-feedback-${stamp}-${randomUUID()}.json.gz`);
}

function* textBlocks(message: Message) {
  if (typeof message.content === 'string') yield message.content;
  else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type === 'text' && typeof block.text === 'string') yield block.text;
    }
  }
}
function excerpt(redactor: BoundedSecretRedactor, value: string, limit: number, partial = false) {
  if (!value) return { text: '', truncated: false };
  if (value.length > MAX_REDACTION_FIELD) return { text: '', truncated: true };
  const result = redactor.redact(sanitizeTerminalText(value));
  if (result.status !== 'ready') return { text: '[redacted]', truncated: true };
  const safe = redactDiagnosticPii(result.value.replace(WINDOWS_NETWORK_PATH, '<redacted:path>'))
    .replace(/^.*\b[A-Z_][A-Z_0-9]*\s*=.*$/gm, '[redacted]')
    .replace(/^.*(?:cookie|authorization)\s*[:=].*$/gim, '[redacted]');
  const end = partial ? Math.min(limit, Math.floor(safe.length / 2)) : limit;
  return { text: safe.slice(0, end), truncated: safe.length > end };
}

function isoTime(value?: number) {
  const date = new Date(value ?? NaN);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeIdentifier(redactor: BoundedSecretRedactor, value: unknown, pathLike = false) {
  if (typeof value !== 'string' || !(pathLike ? /^[a-zA-Z0-9_.:/-]{1,128}$/ : /^[a-zA-Z0-9_.:-]{1,128}$/).test(value)
    || value.startsWith('/') || value.includes(':/') || value.includes('//')) return null;
  return redactSecretString(value) === value && excerpt(redactor, value, 128).text === value ? value : null;
}

function httpStatus(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

type ModelEvent = Extract<FeedbackEvent, { kind: 'model' }>;
type ToolEvent = Extract<FeedbackEvent, { kind: 'tool' }>;
type ToolGroup = { name?: string; start: number; finals: number; notable: boolean };
type Evidence = { position: number; start: number } & (
  { kind: 'model'; message: Message; request?: FeedbackRequestEvidence; result: ModelEvent['result'] } |
  { kind: 'tool'; call: ToolGroup; at?: number; source: ToolEvent['source']; result: ToolEvent['result'] });

function evidenceFor(messages: Message[], history?: FeedbackHistory) {
  let start = 0, position = -1;
  const scopes: number[] = [];
  const visibleEntries = new Set(messages.flatMap(message => message.entryId && message.display !== false ? [message.entryId] : []));
  const evidence: Evidence[] = [];
  const calls = new Map<string, ToolGroup | null>();
  const unlinked = new Map<number, Map<string, ToolGroup>>();
  const addTool = (call: ToolGroup, result: ToolEvent['result'], source: ToolEvent['source'], order: number, at?: number) => {
    if (result !== 'started') call.finals++;
    if (result !== 'started' && result !== 'ok') call.notable = true;
    evidence.push({ kind: 'tool', call, start: call.start, position: order, at, source, result });
  };
  messages.forEach((message, index) => {
    if (isUserMessage(message) && !message.desktopSteered && !(message.entryId && history?.steering.has(message.entryId))) start = index;
    scopes.push(start);
    const entryId = message.entryId ?? history?.resultEntries.get(message);
    position = (entryId ? history?.positions.get(entryId) : undefined) ?? position + 1 / (messages.length + 1);
    if (message.display === false || message.desktopToolPending) return;
    if (message.role === 'assistant') {
      const issued = Array.isArray(message.content) ? message.content.filter(block => block?.type === 'toolCall' || block?.type === 'tool_use') : [];
      for (const block of issued) if (block.id)
        calls.set(block.id, calls.has(block.id) ? null : { name: block.name, start, finals: 0, notable: false });
      const request = message.entryId ? history?.requests.get(message.entryId) : undefined;
      const stopped = message.stopReason;
      const result = stopped === 'aborted' ? 'aborted'
        : message.isError || stopped === 'error' || request?.outcome === 'http_error' || request?.outcome === 'transport_error' ? 'error'
        : issued.length ? 'request' : 'reply';
      evidence.push({ kind: 'model', message, request, result, start, position });
    } else if (message.role === 'toolResult') {
      const id = message.toolCallId;
      let call = id ? calls.get(id) : undefined;
      const matched = entryId && history?.matchedResults.get(entryId);
      const origin = matched && history?.calls.get(matched);
      if (call && origin && visibleEntries.has(origin.reply)) return;
      if (!call) {
        const group = { name: message.toolName, start, finals: 0, notable: false };
        if (id && call !== null && history?.calls.get(id) !== null) {
          let byId = unlinked.get(start);
          if (!byId) unlinked.set(start, byId = new Map());
          call = byId.get(id) ?? group;
          byId.set(id, call);
        } else call = group;
      }
      addTool(call, message.isError ? 'error' : 'ok', 'tool_result', position, message.timestamp);
    }
  });
  for (const [id, recorded] of history?.calls ?? []) {
    if (!recorded?.traces.length) continue;
    const call = calls.get(id);
    if (!call || !visibleEntries.has(recorded.reply)) continue;
    for (const trace of recorded.traces) addTool(call, trace.result, 'execution_trace', trace.position, trace.at);
  }
  evidence.sort((a, b) => a.position - b.position);
  return { evidence, scopes, currentStart: start };
}

function modelEvent(row: Extract<Evidence, { kind: 'model' }>, redactor: BoundedSecretRedactor, includeError: boolean): ModelEvent {
  const { message, request, result } = row;
  const error = result === 'error' && typeof message.errorMessage === 'string' ? message.errorMessage : '';
  const recordedStatus = httpStatus(request?.statusCode);
  const statusCode = recordedStatus ?? (error.length <= MAX_REDACTION_FIELD
    ? httpStatus(Number(/^(?:HTTP(?: status)?\s*[:=]?\s+|(?:API|request) error\s*\(?)([45]\d\d)\b/i.exec(error)?.[1])) : null);
  const responseModel = safeIdentifier(redactor, request?.responseModel ?? message.responseModel, true);
  const model = responseModel ?? safeIdentifier(redactor, request?.requestedModel ?? message.model, true);
  const outcome = request?.outcome;
  const attempts = request?.transportAttempts;
  return {
    kind: 'model', result, at: isoTime(message.timestamp), requestId: safeIdentifier(redactor, request?.requestId),
    provider: safeIdentifier(redactor, request?.responseProvider ?? message.provider ?? request?.requestedProvider),
    model, modelSource: model ? responseModel ? 'response' : 'requested' : null, statusCode,
    statusSource: recordedStatus !== null ? 'request' : statusCode !== null ? 'error_text' : null,
    outcome: outcome === 'ok' || outcome === 'http_error' || outcome === 'transport_error' ? outcome : null,
    transportAttempts: typeof attempts === 'number' && Number.isSafeInteger(attempts) && attempts > 0 ? attempts : null,
    errorDetail: includeError && error ? excerpt(redactor, error, 320) : null,
  };
}

export function feedbackReport(options: FeedbackOptions, messages: Message[], context: FeedbackReport['context'], history?: FeedbackHistory) {
  const { evidence, scopes, currentStart } = evidenceFor(messages, history);
  const reportedAt = options.errorAt ?? null;
  if (reportedAt !== null && isoTime(Date.parse(reportedAt)) !== reportedAt)
    throw new Error('Invalid incident time');
  let failed: Evidence | undefined;
  if (options.focus !== 'current') for (let index = evidence.length - 1; index >= 0; index--) {
    const row = evidence[index];
    if (row.result === 'error' || row.result === 'timeout' || row.result === 'blocked' || row.result === 'not_run') {
      failed = row;
      break;
    }
  }
  const start = failed?.start ?? currentStart;
  const rows = evidence.filter(row => row.start === start && (row.kind === 'model' || row.call.notable || !row.call.finals));
  const selected = rows.slice(-MAX_EVENTS);
  const turn = options.conversation || options.tools ? messages.filter((_message, index) => scopes[index] === start) : [];
  const candidates = turn.flatMap(message => {
    if (message.display === false || !((options.conversation && ['user', 'assistant'].includes(message.role))
      || (options.tools && message.role === 'toolResult' && message.isError))) return [];
    const text = textBlocks(message).next().value ?? '';
    return text.trim() ? [{ role: message.role, value: message.role === 'user' && text.length <= MAX_REDACTION_FIELD
      ? attachmentPresentation(text)?.draft ?? text : text }] : [];
  });
  // Discover labelled secrets in the bounded related turn before exporting any excerpt.
  // The additional blocks are scanned locally because a selected excerpt may echo a value from them.
  const redactor = createBoundedSecretRedactor();
  function* redactionFields() {
    yield options.expected;
    yield options.actual;
    if (options.conversation) for (const row of selected) {
      if (row.kind === 'model' && typeof row.message.errorMessage === 'string') yield row.message.errorMessage;
    }
    for (const message of turn) yield* textBlocks(message);
  }
  let characters = 0, count = 0, redactionLimited = false;
  for (const field of redactionFields()) {
    characters += field.length;
    if (++count > MAX_REDACTION_FIELDS || field.length > MAX_REDACTION_FIELD || characters > MAX_REDACTION_CONTEXT
      || redactor.redact(sanitizeTerminalText(field)).status !== 'ready') {
      redactor.invalidate();
      redactionLimited = true;
      break;
    }
  }
  const excerpts = (redactionLimited ? [] : candidates.slice(-4)).map(({ role, value }) => ({
    role, ...excerpt(redactor, value, role === 'toolResult' ? 160 : 320, role === 'toolResult'),
  }));
  const calls = new Map<ToolGroup, number>();
  const events: FeedbackEvent[] = selected.map(row => {
    if (row.kind === 'model') return modelEvent(row, redactor, options.conversation && !redactionLimited);
    let call = calls.get(row.call);
    if (call === undefined) calls.set(row.call, call = calls.size + 1);
    return { kind: 'tool', call, source: row.source, result: row.result, at: isoTime(row.at),
      toolName: safeIdentifier(redactor, row.call.name) };
  });
  const optionalIncluded = excerpts.length || events.some(event => event.kind === 'model' && event.errorDetail);
  const report: FeedbackReport = { format: 'dfsc-local-feedback-v3', at: new Date().toISOString(), context,
    expected: excerpt(redactor, options.expected, 1000), actual: excerpt(redactor, options.actual, 1000), reportedAt,
    scope: failed ? 'latest_failed_turn' : 'current_turn',
    summary: {
      modelErrors: rows.filter(row => row.kind === 'model' && row.result === 'error').length,
      toolErrors: rows.filter(row => row.kind === 'tool' && (row.result === 'error' || row.result === 'timeout')).length,
      toolsWithOnlyFinalResult: [...calls].flatMap(([call, id]) => call.finals === 1 ? [id] : []),
      toolsWithNoResult: [...calls].flatMap(([call, id]) => call.finals === 0 ? [id] : []),
      omittedEvents: rows.length - events.length,
      optionalText: redactionLimited ? 'redaction_limit' : optionalIncluded ? 'included'
        : options.conversation || options.tools ? 'not_recorded' : 'excluded',
    },
    events, excerpts, omittedEligibleMessages: candidates.length - excerpts.length,
    exclusions: ['raw session', 'other sessions', 'environment', 'workspace files', 'attachments', 'logs',
      'tool arguments', 'full tool outputs', 'non-text blocks', 'additional text blocks',
      ...(!options.conversation ? ['conversation text', 'response error text'] : []), ...(!options.tools ? ['tool output excerpts'] : [])],
  };
  return JSON.stringify(report, null, 2);
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
