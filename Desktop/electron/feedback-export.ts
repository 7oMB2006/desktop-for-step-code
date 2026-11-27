import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MAX_FEEDBACK_TURNS, type FeedbackEvent, type FeedbackOptions, type FeedbackReport, type FeedbackToolIssueGroup,
  type FeedbackTurn, type FeedbackTurnEvidence, type Message } from '../src/contracts';
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
const MAX_HISTORY_EVENTS = 4 * MAX_FEEDBACK_TURNS;
// Fixed public labels from the pinned Step Code tool profile, not an export of arbitrary names.
const STEP_TOOL_LABELS = new Set([
  'list_directory', 'find_files', 'search_files', 'search_web', 'read_file', 'write_file',
  'edit_file', 'run_command', 'bash_list', 'bash_kill', 'find_tools',
]);

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

function feedbackRedactionScope() {
  const redactor = createBoundedSecretRedactor();
  let scanned = 0;
  let characters = 0;
  return {
    redactor,
    collect(fields: Iterable<string>) {
      for (const field of fields) {
        characters += field.length;
        if (scanned >= MAX_REDACTION_FIELDS || field.length > MAX_REDACTION_FIELD
          || characters > MAX_REDACTION_CONTEXT) return false;
        if (redactor.redact(sanitizeTerminalText(field)).status !== 'ready') return false;
        scanned++;
      }
      return true;
    },
  };
}

function feedbackNote(redactor: BoundedSecretRedactor, value: string, scanned: boolean) {
  return scanned || !value ? excerpt(redactor, value, 1000) : { text: '[redacted]', truncated: true };
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
type ToolGroup = { name?: string; imported?: boolean; start: number; finals: number; notable: boolean };
type Evidence = { position: number; start: number } & (
  { kind: 'model'; message: Message; request?: FeedbackRequestEvidence; result: ModelEvent['result'] } |
  { kind: 'tool'; call: ToolGroup; at?: number; source: ToolEvent['source']; result: ToolEvent['result'];
    notRunReason?: ToolEvent['notRunReason'] });

type TurnScope = {
  start: number;
  anchor?: Message;
  lastEntry?: string;
  rows: Evidence[];
  interrupted: boolean;
  abnormal: boolean;
  outcome?: FeedbackTurnEvidence['outcome'];
};

function issue(row: Evidence) {
  return row.result !== 'started' && row.result !== 'ok' && row.result !== 'reply' && row.result !== 'request';
}

function evidenceFor(messages: Message[], history?: FeedbackHistory) {
  let scope: TurnScope = { start: 0, rows: [], interrupted: false, abnormal: false };
  const turns = new Map([[0, scope]]);
  let position = -1;
  const scopes: number[] = [];
  const visibleEntries = new Set(messages.flatMap(message => message.entryId && message.display !== false ? [message.entryId] : []));
  const evidence: Evidence[] = [];
  const calls = new Map<string, ToolGroup | null>();
  const unlinked = new Map<number, Map<string, ToolGroup>>();
  const addTool = (call: ToolGroup, result: ToolEvent['result'], source: ToolEvent['source'], order: number,
    at?: number, notRunReason?: ToolEvent['notRunReason']) => {
    if (result !== 'started') call.finals++;
    if (result !== 'started' && result !== 'ok') call.notable = true;
    evidence.push({ kind: 'tool', call, start: call.start, position: order, at, source, result, notRunReason });
  };
  messages.forEach((message, index) => {
    const recordedStart = message.entryId && history?.turnStarts.has(message.entryId);
    if (recordedStart || (isUserMessage(message) && !message.desktopSteered
      && !(message.entryId && history?.steering.has(message.entryId)))) {
      const anchorPosition = message.entryId ? history?.positions.get(message.entryId) : undefined;
      if (anchorPosition !== undefined) scope.lastEntry = history?.entryIds[anchorPosition - 1];
      scope = { start: index, anchor: message, rows: [], abnormal: false, interrupted: false };
      turns.set(index, scope);
    }
    const start = scope.start;
    scopes.push(start);
    const entryId = message.entryId ?? history?.resultEntries.get(message);
    position = (entryId ? history?.positions.get(entryId) : undefined) ?? position + 1 / (messages.length + 1);
    if (message.display === false || message.desktopToolPending) return;
    if (message.role === 'assistant') {
      const issued = Array.isArray(message.content) ? message.content.filter(block => block?.type === 'toolCall' || block?.type === 'tool_use') : [];
      for (const block of issued) if (block.id)
        calls.set(block.id, calls.has(block.id) ? null
          : { name: block.name, imported: message.desktopImported, start, finals: 0, notable: false });
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
      if (call) scopes[index] = call.start;
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
    for (const trace of recorded.traces) addTool(call, trace.result, 'execution_trace', trace.position, trace.at, trace.notRunReason);
  }
  scope.lastEntry = history?.entryIds.at(-1);
  evidence.sort((a, b) => a.position - b.position);
  for (const row of evidence) {
    const turn = turns.get(row.start)!;
    if (row.kind === 'model') turn.interrupted = row.result === 'aborted';
    if (issue(row)) turn.abnormal = true;
    if (row.kind === 'model' || row.call.notable || !row.call.finals) turn.rows.push(row);
  }
  for (const turn of turns.values()) {
    const entry = turn.anchor?.entryId;
    const recorded = entry ? history?.turnOutcomes.get(entry) : undefined;
    if (recorded) {
      turn.outcome = recorded;
      turn.interrupted = recorded === 'aborted';
      if (recorded !== 'completed') turn.abnormal = true;
    }
  }
  return { turns, scopes, current: scope };
}

function turnEvidence(turn: TurnScope): FeedbackTurnEvidence {
  const evidence: FeedbackTurnEvidence = { outcome: turn.outcome ?? null, modelErrors: 0, toolErrors: 0, toolsNotRun: 0 };
  for (const row of turn.rows) {
    if (row.kind === 'model') {
      if (row.result === 'error') evidence.modelErrors++;
    } else if (row.result === 'not_run') evidence.toolsNotRun++;
    else if (issue(row)) evidence.toolErrors++;
  }
  return evidence;
}

function toolIssueGroups(rows: Evidence[], numbers: Map<number, number>, multi: boolean) {
  const groups = new Map<string, FeedbackToolIssueGroup>();
  for (const row of rows) {
    if (row.kind !== 'tool' || row.result === 'started' || row.result === 'ok') continue;
    const toolName = row.source === 'execution_trace' && !row.call.imported
      && row.call.name && STEP_TOOL_LABELS.has(row.call.name) ? row.call.name : null;
    const turn = multi ? numbers.get(row.start) : undefined;
    const { result, notRunReason } = row;
    const key = JSON.stringify([turn, toolName, result, notRunReason]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { turn, toolName, result, notRunReason, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function turnKey(turn: TurnScope, history?: FeedbackHistory) {
  const entry = turn.anchor?.entryId;
  const last = entry ? history?.turnEnds.get(entry) ?? turn.lastEntry : undefined;
  if (!entry || !last || !history?.positions.has(entry)) return undefined;
  // A new turn does not change this key; a branch change within this turn does.
  return createHash('sha256').update(JSON.stringify([history.sessionId, entry, last])).digest('hex');
}

export function listFeedbackTurns(messages: Message[], history?: FeedbackHistory): FeedbackTurn[] {
  if (!history) return [];
  let number = 0;
  return [...evidenceFor(messages, history).turns.values()].flatMap(turn => {
    if (!turn.anchor) return [];
    number++;
    const key = turnKey(turn, history);
    if (!key) return [];
    const evidence = turnEvidence(turn);
    const status: FeedbackTurn['status'] = turn.interrupted ? 'interrupted'
      : evidence.modelErrors || evidence.toolErrors || turn.outcome === 'error' ? 'errors'
      : evidence.toolsNotRun ? 'not_run' : turn.abnormal ? 'errors' : null;
    return [{ key, number, startedAt: isoTime(turn.anchor.timestamp), status, evidence }];
  }).reverse();
}

export function feedbackTurnKeys(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_FEEDBACK_TURNS
    || [...value].some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
    || new Set(value).size !== value.length) throw new Error('Invalid feedback turn selection');
  return value;
}

function eventsForTurns(turns: TurnScope[], max: number) {
  const rows = new Set<Evidence>();
  const perTurn = turns.map(turn => {
    const last = turn.rows.length - 1;
    const firstIssue = turn.rows.findIndex(issue);
    let lastModel = -1, lastModelError = -1, lastToolIssue = -1;
    for (let i = last; i >= 0 && (lastModelError < 0 || lastToolIssue < 0); i--) {
      const row = turn.rows[i];
      if (row.kind === 'model') {
        if (lastModel < 0) lastModel = i;
        if (lastModelError < 0 && row.result === 'error') lastModelError = i;
      } else if (lastToolIssue < 0 && issue(row)) lastToolIssue = i;
    }
    // At most four reserved slots per turn. A tool loop must not crowd out a model failure.
    for (const index of [firstIssue, last, lastModelError, lastToolIssue]) {
      if (index >= 0) rows.add(turn.rows[index]);
    }
    return { rows: turn.rows, cursor: last, lastModel };
  });
  for (const turn of perTurn) {
    if (rows.size === max) break;
    if (turn.lastModel >= 0) rows.add(turn.rows[turn.lastModel]);
  }
  // Reserve evidence for every detailed turn before sharing the remaining space.
  let grew = true;
  while (rows.size < max && grew) {
    grew = false;
    for (const turn of perTurn) {
      while (turn.cursor >= 0 && rows.has(turn.rows[turn.cursor])) turn.cursor--;
      if (turn.cursor < 0) continue;
      rows.add(turn.rows[turn.cursor--]);
      grew = true;
      if (rows.size === max) break;
    }
  }
  return [...rows].sort((a, b) => a.position - b.position);
}

function gapsForTurns(all: TurnScope[], chosen: TurnScope[], includeBetween: boolean): NonNullable<FeedbackReport['gaps']> {
  const positions = new Map(all.map((turn, index) => [turn, index]));
  return chosen.flatMap((turn, index) => {
    if (index === 0) return [];
    const start = positions.get(chosen[index - 1])! + 1;
    const end = positions.get(turn)!;
    if (start === end) return [];
    const overview = includeBetween
      ? { completed: 0, aborted: 0, failed: 0, unknown: 0, modelErrors: 0, toolErrors: 0, toolsNotRun: 0 }
      : null;
    if (overview) for (let i = start; i < end; i++) {
      const { outcome, modelErrors, toolErrors, toolsNotRun } = turnEvidence(all[i]);
      overview[outcome === 'completed' ? 'completed' : outcome === 'aborted' ? 'aborted' : outcome === 'error' ? 'failed' : 'unknown']++;
      overview.modelErrors += modelErrors;
      overview.toolErrors += toolErrors;
      overview.toolsNotRun += toolsNotRun;
    }
    return [{ after: index, before: index + 1, count: end - start, overview }];
  });
}

function modelEvent(row: Extract<Evidence, { kind: 'model' }>, redactor: BoundedSecretRedactor,
  includeIdentifiers: boolean, includeError: boolean): ModelEvent {
  const { message, request, result } = row;
  const error = result === 'error' && typeof message.errorMessage === 'string' ? message.errorMessage : '';
  const recordedStatus = httpStatus(request?.statusCode);
  const statusCode = recordedStatus ?? (error.length <= MAX_REDACTION_FIELD
    ? httpStatus(Number(/^(?:HTTP(?: status)?\s*[:=]?\s+|(?:API|request) error\s*\(?)([45]\d\d)\b/i.exec(error)?.[1])) : null);
  const responseModel = includeIdentifiers ? safeIdentifier(redactor, request?.responseModel ?? message.responseModel, true) : null;
  const model = responseModel ?? (includeIdentifiers ? safeIdentifier(redactor, request?.requestedModel ?? message.model, true) : null);
  const outcome = request?.outcome;
  const attempts = request?.transportAttempts;
  return {
    kind: 'model', result, at: isoTime(message.timestamp),
    requestId: includeIdentifiers ? safeIdentifier(redactor, request?.requestId) : null,
    provider: includeIdentifiers ? safeIdentifier(redactor, request?.responseProvider ?? message.provider ?? request?.requestedProvider) : null,
    model, modelSource: model ? responseModel ? 'response' : 'requested' : null, statusCode,
    statusSource: recordedStatus !== null ? 'request' : statusCode !== null ? 'error_text' : null,
    outcome: outcome === 'ok' || outcome === 'http_error' || outcome === 'transport_error' ? outcome : null,
    transportAttempts: typeof attempts === 'number' && Number.isSafeInteger(attempts) && attempts > 0 ? attempts : null,
    errorDetail: includeError && error ? excerpt(redactor, error, 320) : null,
  };
}

export function feedbackReport(options: FeedbackOptions, messages: Message[], context: FeedbackReport['context'], history?: FeedbackHistory) {
  const { turns, scopes, current } = evidenceFor(messages, history);
  const reportedAt = options.errorAt ?? null;
  if (reportedAt !== null && isoTime(Date.parse(reportedAt)) !== reportedAt)
    throw new Error('Invalid incident time');
  let chosen = current;
  let scope: FeedbackReport['scope'] = 'current_turn';
  let selection: TurnScope[] | undefined;
  const all = [...turns.values()];
  if (options.focus === 'history') {
    const keys = new Set(feedbackTurnKeys(options.turnKeys));
    selection = all.filter(turn => {
      const key = turnKey(turn, history);
      return key && keys.has(key);
    });
    if (selection.length !== keys.size) throw new Error('The selected turn is no longer available in this conversation');
    chosen = selection[0];
    scope = selection.length === 1 ? 'selected_turn' : 'selected_turns';
  } else if (options.focus === 'turn') {
    const match = options.turnKey && [...turns.values()].find(turn => turnKey(turn, history) === options.turnKey);
    if (!match) throw new Error('The selected turn is no longer available in this conversation');
    chosen = match;
    scope = 'selected_turn';
  } else if (options.focus !== 'current') {
    const latest = [...all].reverse().find(turn => turn.abnormal || turn.interrupted);
    if (latest) {
      chosen = latest;
      scope = latest.interrupted ? 'latest_interrupted_turn' : 'latest_failed_turn';
    }
  }
  const detailed = selection ?? [chosen];
  const multi = detailed.length > 1;
  const numbers = new Map(detailed.map((turn, index) => [turn.start, index + 1]));
  const rows = detailed.flatMap(turn => turn.rows);
  const selected = eventsForTurns(detailed, multi ? MAX_HISTORY_EVENTS : MAX_EVENTS);
  const optionalRequested = options.conversation || options.tools;
  const candidates = new Map<number, { role: string; value: string }[]>();
  let eligibleMessages = 0;
  // Notes can echo a credential declared later in selected context. Release
  // neither source until the entire opted-in redaction scope has been scanned.
  const redaction = feedbackRedactionScope();
  const notesScanned = redaction.collect([options.expected, options.actual]);
  function* contextFields() {
    for (const [index, message] of messages.entries()) {
      const number = numbers.get(scopes[index]);
      if (number === undefined || message.display === false || message.desktopToolPending) continue;
      if (typeof message.errorMessage === 'string' && message.errorMessage) yield message.errorMessage;
      yield* textBlocks(message);
    }
  }
  const contextScanned = notesScanned && (!optionalRequested || redaction.collect(contextFields()));
  if (optionalRequested) for (const [index, message] of messages.entries()) {
    const number = numbers.get(scopes[index]);
    if (number === undefined || message.display === false || message.desktopToolPending
      || !((options.conversation && (message.role === 'user' || message.role === 'assistant'))
        || (options.tools && message.role === 'toolResult' && message.isError))) continue;
    const text = textBlocks(message).next().value ?? '';
    if (!text || (text.length <= MAX_REDACTION_FIELD && !text.trim())) continue;
    eligibleMessages++;
    if (!contextScanned) continue;
    let recent = candidates.get(number);
    if (!recent) candidates.set(number, recent = []);
    if (recent.length === 4) recent.shift();
    recent.push({ role: message.role, value: message.role === 'user' ? attachmentPresentation(text)?.draft ?? text : text });
  }
  const { redactor } = redaction;
  const expected = feedbackNote(redactor, options.expected, contextScanned);
  const actual = feedbackNote(redactor, options.actual, contextScanned);
  const excerpts = [...numbers.values()].flatMap(number => (candidates.get(number) ?? []).map(({ role, value }) => ({
    ...(multi ? { turn: number } : {}), role, ...excerpt(redactor, value, role === 'toolResult' ? 160 : 320, role === 'toolResult'),
  })));
  const calls = new Map<ToolGroup, number>();
  const events: FeedbackEvent[] = selected.map(row => {
    const reference = multi ? { turn: numbers.get(row.start)! } : {};
    if (row.kind === 'model') return { ...reference, ...modelEvent(row, redactor, contextScanned, options.conversation && contextScanned) };
    let call = calls.get(row.call);
    if (call === undefined) calls.set(row.call, call = calls.size + 1);
    return { ...reference, kind: 'tool', call, source: row.source, result: row.result, at: isoTime(row.at), notRunReason: row.notRunReason,
      toolName: contextScanned ? safeIdentifier(redactor, row.call.name) : null };
  });
  const notRunReasons: FeedbackReport['summary']['notRunReasons'] = {};
  let toolsNotRun = 0;
  for (const row of rows) if (row.kind === 'tool' && row.result === 'not_run') {
    toolsNotRun++;
    if (row.notRunReason) notRunReasons[row.notRunReason] = (notRunReasons[row.notRunReason] ?? 0) + 1;
  }
  const optionalIncluded = excerpts.length || events.some(event => event.kind === 'model' && event.errorDetail);
  const evidence = detailed.map(turnEvidence);
  const includedCounts = new Map<number, number>();
  for (const row of selected) includedCounts.set(row.start, (includedCounts.get(row.start) ?? 0) + 1);
  const finalOnly = new Set<ToolGroup>();
  const started = new Set<ToolGroup>();
  for (const row of rows) if (row.kind === 'tool') {
    if (row.result === 'started') started.add(row.call);
    else finalOnly.add(row.call);
  }
  const report: FeedbackReport = { format: multi ? 'dfsc-local-feedback-v4' : 'dfsc-local-feedback-v3',
    at: new Date().toISOString(), context,
    expected, actual, reportedAt,
    scope, turn: !multi && (chosen.anchor || chosen.interrupted)
      ? { startedAt: isoTime(chosen.anchor?.timestamp), interrupted: chosen.interrupted, outcome: chosen.outcome } : null,
    ...(multi ? {
      turns: detailed.map((turn, index) => ({ turn: index + 1, startedAt: isoTime(turn.anchor?.timestamp),
        interrupted: turn.interrupted, ...evidence[index], omittedEvents: turn.rows.length - (includedCounts.get(turn.start) ?? 0) })),
      gaps: gapsForTurns(all, detailed, options.includeBetween === true),
    } : {}),
    summary: {
      modelErrors: evidence.reduce((count, turn) => count + turn.modelErrors, 0),
      toolErrors: evidence.reduce((count, turn) => count + turn.toolErrors, 0),
      toolsNotRun, notRunReasons, toolIssueGroups: toolIssueGroups(rows, numbers, multi),
      toolsWithOnlyFinalResult: [...calls].flatMap(([call, id]) => finalOnly.has(call) && !started.has(call) ? [id] : []),
      toolsWithNoResult: [...calls].flatMap(([call, id]) => call.finals === 0 ? [id] : []),
      omittedEvents: rows.length - events.length,
      ...(!contextScanned ? { redactionLimited: true } : {}),
      optionalText: !optionalRequested ? 'excluded' : !contextScanned ? 'redaction_limit'
        : optionalIncluded ? 'included' : 'not_recorded',
    },
    events, excerpts, omittedEligibleMessages: eligibleMessages - excerpts.length,
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
