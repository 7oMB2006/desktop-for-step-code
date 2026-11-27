import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';
import { feedbackRequestsOnBranch, type HistoryEntry } from '../electron/session-branching';
import { sessionTranscript } from '../electron/session-transcript';
import { feedbackHistory } from '../electron/feedback-history';
import { defaultFeedbackPath, feedbackDirectory, FeedbackPreview, feedbackReport, listFeedbackTurns } from '../electron/feedback-export';
import { MAX_FEEDBACK_TURNS, type FeedbackReport, type Message } from '../src/contracts';

const context = { desktop: 'test', stepCode: { baseline: 'v0.1.8', commit: 'a'.repeat(40) }, platform: 'linux', arch: 'x64' };
const options = { expected: 'works', actual: 'failed', conversation: false, tools: false };
const messages: Message[] = [
  { role: 'user', content: 'EARLY_UNRELATED' },
  { role: 'user', content: 'hello /home/fixture/private\nAPI_KEY=mock-key\nname@example.org' },
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'SYNTHETIC_A' }] },
  { role: 'toolResult', isError: true, timestamp: 1000, content: 'Failed step. PRIVATE_OUTPUT_TAIL', details: { path: 'private details' } },
  { role: 'user', content: 'LATER_UNRELATED' },
];
test('diagnostics and redacted excerpts use an explicit allowlist', () => {
  const plain = feedbackReport(options, messages, context);
  const minimal = JSON.parse(plain);
  assert.deepEqual(minimal.events.at(-1), {
    kind: 'tool', call: 1, source: 'tool_result', result: 'error', at: new Date(1000).toISOString(), toolName: null,
  });
  assert.deepEqual(minimal.summary.toolsWithOnlyFinalResult, [1]);
  assert.deepEqual(minimal.excerpts, []);
  assert.doesNotMatch(plain, /SYNTHETIC_A|mock-key|Failed step|private details|private reasoning/);
  const expanded = feedbackReport({ ...options, conversation: true, tools: true }, messages, context);
  assert.match(expanded, /SYNTHETIC_A/);
  assert.match(expanded, /Failed step/);
  assert.doesNotMatch(expanded, /EARLY_UNRELATED|LATER_UNRELATED|PRIVATE_OUTPUT_TAIL|example.org|mock-key|private details|private reasoning|\/home\/fixture/);
  assert.equal(JSON.parse(expanded).excerpts.at(-1).truncated, true);
});

test('cancel, append after preview, window and session changes, final archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dfsc-feedback-'));
  try {
    const session = [...messages];
    const content = feedbackReport({ ...options, conversation: true }, session, context);
    const preview = new FeedbackPreview('main', 'A', content);
    const path = join(dir, 'report.json.gz');
    const save = (id: string, destination: () => Promise<string | undefined>, validate = () => {}) =>
      preview.save('main', id, preview.token, destination, validate);
    assert.equal(await save('A', async () => undefined), false);
    await assert.rejects(save('B', async () => path));
    await assert.rejects(preview.save('other', 'A', preview.token, async () => path, () => {}));
    await assert.rejects(save('A', async () => path, () => { throw Error('switched'); }));
    assert.deepEqual(await readdir(dir), []);
    session.push({ role: 'user', content: 'LATE_A' });
    assert.equal(await save('A', async () => path), true);
    const saved = gunzipSync(await readFile(path)).toString('utf8');
    assert.equal(saved, content);
    assert.doesNotMatch(saved, /LATE_A/);
    let validations = 0;
    await assert.rejects(save('A', async () => path, () => {
      if (++validations === 2) throw Error('selection changed during write');
    }));
    assert.deepEqual(await readdir(dir), ['report.json.gz']);
    assert.equal(gunzipSync(await readFile(path)).toString(), content);
  } finally { await removeTestProfile(dir); }
});

test('default archives get distinct names in a dedicated profile directory', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'dfsc-feedback-default-'));
  try {
    const [first, second] = await Promise.all([defaultFeedbackPath(profile), defaultFeedbackPath(profile)]);
    assert.equal(dirname(first), feedbackDirectory(profile));
    assert.equal(dirname(second), dirname(first));
    assert.match(first, /dfsc-feedback-[\dTZ-]+-[0-9a-f-]{36}\.json\.gz$/);
    assert.notEqual(first, second);
  } finally { await removeTestProfile(profile); }
});

test('default archives reject a redirected feedback directory', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'dfsc-feedback-linked-'));
  try {
    await symlink(profile, feedbackDirectory(profile), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(defaultFeedbackPath(profile), /not a local directory/);
  } finally { await removeTestProfile(profile); }
});

test('secrets echoed in another field and terminal escapes are removed before truncation', () => {
  const content = feedbackReport({ ...options, actual: 'password=echoedSyntheticValue', conversation: true,
    expected: 'prefix echoedSyntheticValue', errorAt: '2026-04-01T10:00:00.000Z' },
    [{ role: 'user', content: 'echoedSyntheticValue\x1b]0;hiddenTerminalTitle\x07' }], context);
  assert.doesNotMatch(content, /echoedSyntheticValue|hiddenTerminalTitle/);
  assert.equal(JSON.parse(content).reportedAt, '2026-04-01T10:00:00.000Z');
  assert.deepEqual(JSON.parse(content).events, []);
  assert.throws(() => feedbackReport({ ...options, errorAt: 'invalid' }, [], context));
});

test('failure evidence follows its own reply, never a successful retry, a sibling, or a summary', () => {
  const failure = { entryId: 'failed', role: 'assistant', content: [], provider: 'step', model: 'selected-model',
    errorMessage: 'HTTP 429 Error: private user text', stopReason: 'error', timestamp: 1000 };
  const retry = { entryId: 'retry', role: 'assistant', content: 'Success', timestamp: 2000 };
  const message = (id: string, parentId: string | null, message: Message) => ({ type: 'message', id, parentId, message });
  const request = (id: string, parentId: string, usageEntryId: string, data: object = {}) => ({ type: 'custom', id, parentId,
    customType: 'step.usage_provenance', data: { requestId: id, usageEntryId, originSessionId: 'A', sessionId: 'A', ...data } });
  const entries = [
    message('failed', null, failure), request('req-failed', 'failed', 'failed', { responseModel: 'actual-model', statusCode: 429, outcome: 'http_error' }),
    message('retry', 'req-failed', retry), request('req-retry', 'retry', 'retry', { statusCode: 200, outcome: 'ok' }),
    request('summary', 'req-retry', 'failed', { purpose: 'compaction' }),
    request('foreign', 'summary', 'failed', { originSessionId: 'B' }),
    request('abandoned', 'req-failed', 'failed'),
  ] satisfies HistoryEntry[];
  const history = feedbackHistory(entries, 'foreign', 'A');
  const manual = '2026-11-26T06:10:00.000Z';
  const result = JSON.parse(feedbackReport({ ...options, errorAt: manual }, [failure, retry], context, history));
  assert.equal(result.reportedAt, manual);
  assert.deepEqual(result.events[0], {
    kind: 'model', result: 'error', at: new Date(1000).toISOString(), requestId: 'req-failed', provider: 'step',
    model: 'actual-model', modelSource: 'response', statusCode: 429, statusSource: 'request', outcome: 'http_error',
    transportAttempts: null, errorDetail: null,
  });
  assert.deepEqual(result.events.map((event: { requestId: string }) => event.requestId), ['req-failed', 'req-retry']);
  const optIn = JSON.parse(feedbackReport({ ...options, conversation: true }, [failure, retry], context, history));
  assert.match(optIn.events[0].errorDetail.text, /HTTP 429/);
  const unlinked = JSON.parse(feedbackReport(options, [{ ...failure, entryId: undefined }, retry], context, history));
  assert.equal(unlinked.events[0].requestId, null);
  assert.equal(unlinked.events[0].statusCode, 429);
  assert.equal(unlinked.events[0].statusSource, 'error_text');
  assert.equal(unlinked.events[0].modelSource, 'requested');
  assert.equal(feedbackRequestsOnBranch(entries, 'abandoned', 'A').has('failed'), false);
  assert.equal(feedbackRequestsOnBranch(entries, null, 'A').size, 0);
  const latest = JSON.parse(feedbackReport(options, [retry], context, history));
  assert.equal(latest.events[0].result, 'reply');
  assert.equal(latest.events[0].requestId, 'req-retry');
  const current = JSON.parse(feedbackReport({ ...options, focus: 'current', conversation: true },
    [failure, { role: 'user', content: 'Current input' }, retry], context, history));
  assert.equal(current.events[0].requestId, 'req-retry');
  assert.deepEqual(current.excerpts.map((item: { text: string }) => item.text), ['Current input', 'Success']);
  assert.deepEqual(JSON.parse(feedbackReport(options, [retry, { role: 'user', content: 'New turn' }], context, history)).events, []);
});

test('excerpts redact Windows network paths and echoes of credentials from omitted blocks and messages', () => {
  const content = feedbackReport({ ...options, conversation: true }, [
    { role: 'user', content: [{ type: 'text', text: 'Steps' }, { type: 'text', text: 'password=omittedSyntheticValue' }] },
    ...Array.from({ length: 3 }, () => ({ role: 'assistant', content: 'Fixture reply' })),
    { role: 'assistant', stopReason: 'error', content: String.raw`Path \\fixture-machine\private-share\example.txt
Echo: omittedSyntheticValue
End of report` },
  ], context);
  assert.doesNotMatch(content, /omittedSyntheticValue|fixture-machine|private-share|example\.txt/);
  assert.match(content, /<redacted:path>/);
  assert.match(content, /End of report/);
  assert.equal(JSON.parse(content).omittedEligibleMessages, 1);
});

test('optional context limits suppress both notes and excerpts while preserving the timeline', () => {
  const limits: [string, string[]][] = [
    ['single field', ['x'.repeat(32 * 1024 + 1)]],
    ['field count', Array.from({ length: 64 }, () => 'Unverified excerpt')],
    ['total text size', Array.from({ length: 4 }, () => 'x'.repeat(32 * 1024))],
    ['credential candidates', [Array.from({ length: 257 }, (_, index) => `password=fixture-password-${index}`).join('\n')]],
  ];
  for (const [name, fields] of limits) {
    const longTurn: Message[] = [
      { role: 'user', content: 'password=prior-context-value' },
      ...fields.map(content => ({ role: 'assistant' as const, content })),
      { role: 'assistant', content: 'password=late-context-value' },
      { role: 'toolResult', toolName: 'fixture-tool', timestamp: 1000, isError: true, content: 'Unverified excerpt' },
    ];
    const reportOptions = { ...options, expected: 'Expected no echo of late-context-value.',
      actual: 'Failed while processing prior-context-value and late-context-value.' };
    const raw = feedbackReport({ ...reportOptions, conversation: true, tools: true }, longTurn, context);
    const expanded = JSON.parse(raw);
    assert.doesNotMatch(raw, /prior-context-value|late-context-value|fixture-password|Unverified excerpt/, name);
    assert.deepEqual(expanded.expected, { text: '[redacted]', truncated: true }, name);
    assert.deepEqual(expanded.actual, { text: '[redacted]', truncated: true }, name);
    assert.equal(expanded.summary.optionalText, 'redaction_limit', name);
    assert.equal(expanded.summary.toolErrors, 1, name);
    assert.deepEqual(expanded.excerpts, [], name);
    assert.ok(expanded.omittedEligibleMessages > 0, name);
    assert.deepEqual(expanded.events.at(-1), {
      kind: 'tool', call: 1, source: 'tool_result', result: 'error', at: new Date(1000).toISOString(), toolName: null,
    }, name);

    const diagnostics = JSON.parse(feedbackReport(options, longTurn, context));
    assert.equal(diagnostics.summary.optionalText, 'excluded', name);
    assert.equal(diagnostics.expected.text, options.expected, name);
    assert.equal(diagnostics.actual.text, options.actual, name);
    assert.equal(diagnostics.events.at(-1).toolName, 'fixture-tool', name);
    assert.deepEqual(diagnostics.excerpts, [], name);
  }
});

test('unsafe hand-written notes fail closed without exporting echoes in other fields', () => {
  const longExpected = `password=oversized-note-value\n${'x'.repeat(32 * 1024)}`;
  for (const conversation of [false, true]) {
    const raw = feedbackReport({ ...options, conversation, expected: longExpected, actual: 'Echo: oversized-note-value' }, [
      { role: 'user', content: 'Echo in the conversation: oversized-note-value' },
      { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Echo in the response: oversized-note-value' },
    ], context);
    const report = JSON.parse(raw);
    assert.doesNotMatch(raw, /oversized-note-value/);
    assert.deepEqual(report.expected, { text: '[redacted]', truncated: true });
    assert.deepEqual(report.actual, { text: '[redacted]', truncated: true });
    assert.deepEqual(report.excerpts, []);
    assert.equal(report.events.at(-1).errorDetail, null);
    assert.equal(report.summary.modelErrors, 1);
    assert.equal(report.summary.redactionLimited, true);
    assert.equal(report.summary.optionalText, conversation ? 'redaction_limit' : 'excluded');
  }
});

test('three recorded errors share one tool call; a matching result is not a fourth error', () => {
  const path: HistoryEntry[] = [];
  const append = (id: string, fields: Omit<HistoryEntry, 'id' | 'parentId'> & { customType?: string; data?: object }) =>
    path.push({ id, parentId: path.at(-1)?.id ?? null, ...fields });
  const message = (id: string, message: Message) => append(id, { type: 'message', message });
  const custom = (id: string, type: string, data: object) =>
    append(id, { type: 'custom', customType: type, data: { version: 1, ...data } });
  message('prior', { role: 'assistant', stopReason: 'error', timestamp: 50, content: 'Outside scope' });
  message('u', { role: 'user', content: 'Inspect synthetic file' });
  custom('turn', 'step.turn', { phase: 'start', turnId: 'my-turn', userEntryId: 'u' });
  message('a', { role: 'assistant', content: [{ type: 'toolCall', id: 'exact-call', name: 'read' }], timestamp: 100 });
  custom('start', 'step.tool_execution', { toolCallId: 'exact-call', phase: 'start', startedAt: 110, assistantEntryId: 'a' });
  custom('end1', 'step.tool_execution', { toolCallId: 'exact-call', phase: 'end', endedAt: 120, outcome: 'error', raw: 'TRACE_PRIVATE' });
  message('steer', { role: 'user', content: 'Steer within the same turn' });
  custom('end2', 'step.tool_execution', { toolCallId: 'exact-call', phase: 'end', endedAt: 130, outcome: 'timeout' });
  custom('end3', 'step.tool_execution', { toolCallId: 'exact-call', phase: 'end', endedAt: 140, outcome: 'error' });
  const leaf = 'done';
  message('r', { role: 'toolResult', content: 'TOOL_PRIVATE', isError: true, toolName: 'read', toolCallId: 'exact-call', timestamp: 141 });
  message('fail', { role: 'assistant', content: [], stopReason: 'error', timestamp: 150 });
  custom('request1', 'step.usage_provenance', { usageEntryId: 'fail', requestId: 'actual-fail', statusCode: 503,
    outcome: 'http_error', transportAttempts: 4, sessionId: 'A', originSessionId: 'A' });
  message('reply', { role: 'assistant', content: 'Success', timestamp: 160 });
  custom('request2', 'step.usage_provenance', { usageEntryId: 'reply', requestId: 'actual-success', statusCode: 200,
    outcome: 'ok', sessionId: 'A', originSessionId: 'A' });
  custom(leaf, 'step.turn', { phase: 'end', turnId: 'my-turn', outcome: 'completed' });
  const messages = sessionTranscript(path, leaf);
  const raw = feedbackReport(options, messages, context, feedbackHistory([
    ...path, { id: 'sibling', parentId: 'end1', type: 'custom', customType: 'step.tool_execution',
      data: { version: 1, toolCallId: 'exact-call', phase: 'end', endedAt: 999, outcome: 'blocked' } } as HistoryEntry,
  ], leaf, 'A', messages));
  const report = JSON.parse(raw);
  assert.equal(report.format, 'dfsc-local-feedback-v3');
  assert.equal(report.summary.toolErrors, 3);
  assert.equal(report.summary.modelErrors, 1);
  assert.deepEqual(report.summary.toolsWithOnlyFinalResult, []);
  assert.deepEqual(report.events.map(({ result }: { result: string }) => result), ['request', 'started', 'error', 'timeout', 'error', 'error', 'reply']);
  for (const event of report.events.slice(1, 5)) {
    assert.equal(event.call, 1);
    assert.equal(event.toolName, 'read');
    assert.equal(Object.hasOwn(event, 'requestId'), false);
  }
  assert.equal(report.events[5].requestId, 'actual-fail');
  assert.equal(report.events[5].transportAttempts, 4);
  assert.equal(report.events[6].requestId, 'actual-success');
  assert.doesNotMatch(raw, /TOOL_PRIVATE|TRACE_PRIVATE|exact-call|Outside scope|blocked/);
});

test('a tool without a trace only reports the saved result and an unfinished trace has no final result', () => {
  const call: Message = { role: 'assistant', content: [{ type: 'toolCall', id: 'valid', name: 'read' }] };
  const entries = [
    { type: 'message', parentId: null, id: 'a', message: call },
    { type: 'custom', parentId: 'a', id: 'start', customType: 'step.tool_execution',
      data: { version: 1, toolCallId: 'valid', phase: 'start', startedAt: 100, assistantEntryId: 'a' } },
  ];
  const unfinished = JSON.parse(feedbackReport(options, [{ ...call, entryId: 'a' }], context, feedbackHistory(entries, 'start', 'A')));
  assert.deepEqual(unfinished.summary.toolsWithNoResult, [1]);
  assert.equal(unfinished.events.at(-1).result, 'started');
  const result = JSON.parse(feedbackReport(options, [call, { role: 'toolResult', toolCallId: 'valid', content: 'DO_NOT_INFER', isError: true }], context));
  assert.deepEqual(result.summary.toolsWithOnlyFinalResult, [1]);
  assert.equal(result.summary.toolErrors, 1);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_INFER/);
});

test('event limits and absent optional material are declared', () => {
  const report = JSON.parse(feedbackReport({ ...options, tools: true }, Array.from({ length: 67 }, (_, timestamp) =>
    ({ role: 'toolResult', toolCallId: 'one-call', content: [], isError: true, timestamp })), context));
  assert.equal(report.events.length, 64);
  assert.equal(report.summary.toolErrors, 67);
  assert.equal(report.summary.omittedEvents, 3);
  assert.equal(report.summary.optionalText, 'not_recorded');
  assert.equal(report.events[0].at, new Date(0).toISOString());
  assert.equal(report.events.at(-1).at, new Date(66).toISOString());
});

test('a desktop goal starts a separate excerpt scope', () => {
  const content = feedbackReport({ ...options, conversation: true }, [
    { role: 'user', content: 'Unrelated earlier prompt' },
    { role: 'custom', customType: 'desktop-goal-input', content: 'Synthetic goal' },
    { role: 'assistant', stopReason: 'error', content: 'Related error' },
  ], context);
  assert.match(content, /Related error/);
  assert.doesNotMatch(content, /Unrelated earlier prompt/);
});

test('a stopped historical turn stays selectable after a new message and keeps in-turn steering', () => {
  const entries: (HistoryEntry & { customType?: string; data?: object })[] = [];
  const append = (id: string, fields: Omit<(typeof entries)[number], 'id' | 'parentId'>) =>
    entries.push({ id, parentId: entries.at(-1)?.id ?? null, ...fields });
  const message = (id: string, message: Message) => append(id, { type: 'message', message });
  const custom = (id: string, customType: string, data: object) =>
    append(id, { type: 'custom', customType, data: { version: 1, ...data } });

  message('first-user', { role: 'user', content: 'Do not export earlier prompt' });
  message('first-error', { role: 'assistant', stopReason: 'error', content: [], timestamp: 500 });
  message('loop-user', { role: 'user', content: 'Reproduce loop', timestamp: 1000 });
  custom('loop-start', 'step.turn', { phase: 'start', turnId: 'loop', userEntryId: 'loop-user' });
  for (let i = 0; i < 70; i++) {
    message(`repeat-${i}`, { role: 'assistant', timestamp: 1100 + i * 10,
      content: [{ type: 'toolCall', id: `tool-${i}`, name: 'inspect' }] });
    custom(`skipped-${i}`, 'step.tool_execution', { phase: 'end', toolCallId: `tool-${i}`,
      endedAt: 1101 + i * 10, outcome: 'not_run', notRunReason: i === 69 ? 'unverified-private-value' : 'invalid_arguments' });
  }
  message('loop-steer', { role: 'user', content: 'Steering stays in the loop', timestamp: 1900 });
  // This stop was recorded by the runtime even though no aborted reply was saved.
  custom('loop-end', 'step.turn', { phase: 'end', turnId: 'loop', outcome: 'aborted' });
  const snapshot = (leaf: string, sessionId = 'A') => {
    const messages = sessionTranscript(entries, leaf);
    const history = feedbackHistory(entries, leaf, sessionId, messages);
    return { messages, history, turns: listFeedbackTurns(messages, history) };
  };
  const old = snapshot('loop-end');
  const key = old.turns[0].key;
  message('new-user', { role: 'user', content: 'Do not export next prompt', timestamp: 2000 });
  message('new-reply', { role: 'assistant', content: 'Clean reply', timestamp: 2100 });
  const now = snapshot('new-reply');
  assert.deepEqual(now.turns.map(turn => [turn.number, turn.status]), [[3, null], [2, 'interrupted'], [1, 'errors']]);
  assert.equal(now.turns[1].key, key);
  assert.doesNotMatch(JSON.stringify(now.turns), /Reproduce loop|Steering stays|loop-user/);

  const selected = { ...options, focus: 'turn' as const, turnKey: key };
  const raw = feedbackReport(selected, now.messages, context, now.history);
  const report = JSON.parse(raw);
  assert.equal(report.scope, 'selected_turn');
  assert.deepEqual(report.turn, { startedAt: new Date(1000).toISOString(), interrupted: true, outcome: 'aborted' });
  assert.equal(report.summary.modelErrors, 0);
  assert.equal(report.summary.toolErrors, 0);
  assert.equal(report.summary.toolsNotRun, 70);
  assert.deepEqual(report.summary.notRunReasons, { invalid_arguments: 69 });
  assert.equal(report.events.at(-3).notRunReason, 'invalid_arguments');
  assert.equal(report.events.at(-1).notRunReason, undefined);
  assert.equal(report.summary.omittedEvents, 76);
  assert.equal(report.events.length, 64);
  assert.doesNotMatch(raw, new RegExp(`${key}|loop-user|new-user|Do not export|unverified-private-value`));
  assert.equal(JSON.parse(feedbackReport(options, now.messages, context, now.history)).scope, 'latest_interrupted_turn');
  const current = JSON.parse(feedbackReport({ ...options, focus: 'current' }, now.messages, context, now.history));
  assert.deepEqual(current.events.map((event: { result: string }) => event.result), ['reply']);
  assert.equal(current.turn.interrupted, false);
  // Optional excerpts in a bounded projection include steering, not the neighboring prompts.
  const text = feedbackReport({ ...selected, conversation: true }, now.messages, context, now.history);
  assert.match(text, /Steering stays in the loop/);
  assert.doesNotMatch(text, /Do not export/);
});

function historyFixture() {
  const entries: (HistoryEntry & { customType?: string; data?: object; content?: string; timestamp?: string })[] = [];
  const append = (id: string, fields: Omit<(typeof entries)[number], 'id' | 'parentId'>) =>
    entries.push({ id, parentId: entries.at(-1)?.id ?? null, ...fields });
  const message = (id: string, message: Message) => append(id, { type: 'message', message });
  const custom = (id: string, customType: string, data: object) =>
    append(id, { type: 'custom', customType, data: { version: 1, ...data } });
  const customMessage = (id: string, customType: string, content: string, timestamp: string) =>
    append(id, { type: 'custom_message', customType, content, timestamp });
  function snapshot(leaf = entries.at(-1)?.id ?? null, sessionId = 'A') {
    const messages = sessionTranscript(entries, leaf);
    const history = feedbackHistory(entries, leaf, sessionId, messages);
    return { messages, history, turns: listFeedbackTurns(messages, history) };
  }
  return { message, custom, customMessage, snapshot };
}

test('runtime-anchored automatic turns do not inherit the previous human turn or its text', () => {
  const { message, custom, customMessage, snapshot } = historyFixture();
  message('human', { role: 'user', content: 'HUMAN_PROMPT_CANARY', timestamp: 100 });
  custom('human-start', 'step.turn', { phase: 'start', turnId: 'human', userEntryId: 'human' });
  message('human-reply', { role: 'assistant', content: 'HUMAN_REPLY_CANARY', timestamp: 200 });
  custom('human-end', 'step.turn', { phase: 'end', turnId: 'human', outcome: 'completed' });
  customMessage('cron', 'step-cron', 'CRON_PROMPT_CANARY', new Date(300).toISOString());
  custom('cron-start', 'step.turn', { phase: 'start', turnId: 'cron', userEntryId: 'cron', trigger: 'cron' });
  customMessage('notice', 'step-cron', 'CRON_NOTICE_CANARY', new Date(400).toISOString());
  message('cron-reply', { role: 'assistant', content: [], stopReason: 'error', timestamp: 500 });
  custom('cron-end', 'step.turn', { phase: 'end', turnId: 'cron', outcome: 'error' });
  const { messages, history, turns } = snapshot();
  assert.deepEqual(turns.map(turn => [turn.number, turn.status, turn.evidence.outcome]),
    [[2, 'errors', 'error'], [1, null, 'completed']]);
  const raw = feedbackReport({ ...options, conversation: true }, messages, context, history);
  const report: FeedbackReport = JSON.parse(raw);
  assert.equal(report.scope, 'latest_failed_turn');
  assert.equal(report.turn?.outcome, 'error');
  assert.equal(report.turn?.startedAt, new Date(300).toISOString());
  assert.deepEqual(report.events.map(event => event.result), ['error']);
  assert.doesNotMatch(raw, /HUMAN_|CRON_/);
});

test('a tool error loop cannot displace the model failure from the bounded timeline', () => {
  const { message, snapshot } = historyFixture();
  message('u', { role: 'user', content: 'Test mixed failure' });
  message('first-tool', { role: 'toolResult', toolName: 'fixture', isError: true, content: [], timestamp: 1 });
  message('model-error', { role: 'assistant', stopReason: 'error', errorMessage: 'HTTP 429: Synthetic rate limit',
    content: [], timestamp: 2 });
  for (let i = 3; i < 75; i++) message(`tool-${i}`, { role: 'toolResult', toolName: 'fixture', isError: true,
    content: [], timestamp: i });
  message('reply', { role: 'assistant', content: 'Recovered', timestamp: 75 });
  const { messages, history } = snapshot();
  const report: FeedbackReport = JSON.parse(feedbackReport(options, messages, context, history));
  assert.equal(report.events.length, 64);
  assert.equal(report.events[0].at, new Date(1).toISOString());
  assert.equal(report.events.at(-2)?.at, new Date(74).toISOString());
  assert.equal(report.events.at(-1)?.result, 'reply');
  const model = report.events.find(event => event.kind === 'model' && event.result === 'error');
  assert.ok(model?.kind === 'model');
  assert.equal(model.statusCode, 429);
});

test('long interrupted loops retain fixed tool labels and counts when details cannot be redacted', () => {
  const { message, custom, snapshot } = historyFixture();
  const trace = (id: string, name: string, outcome: string, notRunReason?: string) => {
    message(`a-${id}`, { role: 'assistant', content: [
      { type: 'toolCall', id, name, arguments: { text: 'PRIVATE_ARGUMENT_CANARY' } },
    ] });
    custom(`end-${id}`, 'step.tool_execution', { phase: 'end', toolCallId: id, endedAt: 20, outcome, notRunReason });
  };
  message('first', { role: 'user', content: 'PRIVATE_EXCERPT_CANARY', timestamp: 10 });
  custom('start-loop', 'step.turn', { phase: 'start', turnId: 'loop', userEntryId: 'first' });
  for (let i = 0; i < 99; i++) trace(`call-${i}`, 'edit_file', 'not_run', 'invalid_arguments');
  trace('custom', 'PRIVATE_TOOL_NAME_CANARY', 'not_run', 'PRIVATE_REASON_CANARY');
  message('unlinked-result', { role: 'toolResult', toolName: 'read_file', isError: true, content: 'x'.repeat(33000) });
  custom('end-loop', 'step.turn', { phase: 'end', turnId: 'loop', outcome: 'aborted' });
  message('gap', { role: 'user', content: 'Intermediate turn' });
  trace('gap-call', 'search_web', 'blocked');
  message('last', { role: 'user', content: 'Later turn' });
  message('reply', { role: 'assistant', content: 'Later reply' });
  const { messages, history, turns: [last, , first] } = snapshot();
  const expanded = { ...options, conversation: true, tools: true, expected: 'PRIVATE_NOTE_CANARY' };
  const raw = feedbackReport({ ...expanded, focus: 'turn', turnKey: first.key }, messages, context, history);
  const report: FeedbackReport = JSON.parse(raw);
  assert.equal(report.summary.optionalText, 'redaction_limit');
  assert.equal(report.expected.text, '[redacted]');
  assert.equal(report.excerpts.length, 0);
  assert.equal(report.events.length, 64);
  assert.equal(report.summary.toolsNotRun, 100);
  assert.deepEqual(report.summary.toolIssueGroups, [
    { toolName: 'edit_file', result: 'not_run', notRunReason: 'invalid_arguments', count: 99 },
    { toolName: null, result: 'not_run', count: 1 },
    { toolName: null, result: 'error', count: 1 },
  ]);
  assert.ok(report.events.every(event => event.kind !== 'tool' || event.toolName === null));
  assert.doesNotMatch(raw, /PRIVATE_|read_file|search_web|Later reply/);
  const multi: FeedbackReport = JSON.parse(feedbackReport({ ...expanded, focus: 'history', turnKeys: [last.key, first.key],
    includeBetween: true }, messages, context, history));
  assert.deepEqual(multi.summary.toolIssueGroups, report.summary.toolIssueGroups?.map(group => ({ turn: 1, ...group })));
  assert.equal(multi.gaps?.[0].overview?.toolErrors, 1);
  assert.doesNotMatch(JSON.stringify(multi), /search_web/);
});

test('history exports ordered selections, opt-in structure-only gaps, and no session or turn keys', () => {
  const { message, custom, snapshot } = historyFixture();
  message('u100', { role: 'user', content: 'First selected turn', timestamp: 100 });
  custom('start100', 'step.turn', { phase: 'start', turnId: '100', userEntryId: 'u100' });
  message('a100', { role: 'assistant', content: 'Start of loop', stopReason: 'aborted', timestamp: 150 });
  custom('end100', 'step.turn', { phase: 'end', turnId: '100', outcome: 'aborted' });
  const onlyFirst = snapshot();
  custom('metadata', 'something.else', {});
  message('u101', { role: 'user', content: 'MIDDLE_TEXT_CANARY', timestamp: 200 });
  custom('start101', 'step.turn', { phase: 'start', turnId: '101', userEntryId: 'u101' });
  message('a101', { role: 'assistant', content: 'An intermediate failure', timestamp: 250 });
  custom('req101', 'step.usage_provenance', { sessionId: 'A', originSessionId: 'A', usageEntryId: 'a101',
    requestId: 'MIDDLE_REQUEST_ID', statusCode: 200, outcome: 'ok' });
  custom('end101', 'step.turn', { phase: 'end', turnId: '101', outcome: 'error' });
  message('u102', { role: 'user', content: 'Later selected turn', timestamp: 300 });
  message('a102', { role: 'assistant', content: 'Behavior improved', timestamp: 350 });
  const beforeAppend = snapshot();
  const [latest, middle, first] = beforeAppend.turns;
  assert.equal(first.key, onlyFirst.turns[0].key);
  assert.equal(middle.status, 'errors');
  assert.equal(middle.evidence.outcome, 'error');
  assert.equal(middle.evidence.modelErrors, 0);
  message('u103', { role: 'user', content: 'LATE_PROMPT_CANARY', timestamp: 400 });
  const { messages, history } = snapshot();
  const selection = { ...options, conversation: true, focus: 'history' as const, turnKeys: [latest.key, first.key] };
  const render = (extra = {}) => {
    const raw = feedbackReport({ ...selection, ...extra }, messages, context, history);
    assert.doesNotMatch(raw, new RegExp([latest.key, middle.key, first.key, 'LATE_PROMPT_CANARY'].join('|')));
    return { raw, report: JSON.parse(raw) as FeedbackReport };
  };
  const skipped = render();
  assert.equal(skipped.report.format, 'dfsc-local-feedback-v4');
  assert.deepEqual(skipped.report.events.map(event => [event.turn, event.result]), [[1, 'aborted'], [2, 'reply']]);
  assert.deepEqual(skipped.report.gaps, [{ after: 1, before: 2, count: 1, overview: null }]);
  const bridged = render({ includeBetween: true });
  assert.deepEqual(bridged.report.gaps?.[0].overview,
    { completed: 0, aborted: 0, failed: 1, unknown: 0, modelErrors: 0, toolErrors: 0, toolsNotRun: 0 });
  for (const { raw } of [skipped, bridged]) assert.doesNotMatch(raw, /MIDDLE_TEXT_CANARY|MIDDLE_REQUEST_ID/);
  const detailed = render({ turnKeys: [...selection.turnKeys, middle.key], includeBetween: true });
  assert.deepEqual(detailed.report.gaps, []);
  assert.match(detailed.raw, /MIDDLE_TEXT_CANARY|MIDDLE_REQUEST_ID/);
  assert.deepEqual(detailed.report.turns?.map(turn => turn.outcome), ['aborted', 'error', null]);
  const foreign = snapshot(undefined, 'B');
  assert.throws(() => feedbackReport(selection, foreign.messages, context, foreign.history), /no longer available/);
  const past = snapshot('end100');
  assert.throws(() => feedbackReport(selection, past.messages, context, past.history), /no longer available/);
  for (const turnKeys of [[], [first.key, first.key], ['bogus'], Array(MAX_FEEDBACK_TURNS + 1).fill(first.key)]) {
    assert.throws(() => feedbackReport({ ...selection, turnKeys }, messages, context, history), /Invalid feedback turn selection/);
  }
});

test('multi-turn budgets preserve each turn and the first fault even with long retry loops', () => {
  const { message, snapshot } = historyFixture();
  for (let turn = 1; turn <= MAX_FEEDBACK_TURNS; turn++) {
    message(`u${turn}`, { role: 'user', content: 'Next turn', timestamp: turn * 1000 });
    for (let i = 0; i < 140; i++) message(`a${turn}-${i}`, { role: 'assistant', content: [],
      stopReason: i === 139 ? 'aborted' : 'error', timestamp: turn * 1000 + i + 1 });
  }
  const { messages, turns, history } = snapshot();
  const report: FeedbackReport = JSON.parse(feedbackReport({ ...options, focus: 'history', turnKeys: turns.map(turn => turn.key) },
    messages, context, history));
  assert.equal(report.events.length, 128);
  assert.equal(report.turns?.length, MAX_FEEDBACK_TURNS);
  assert.equal(report.summary.omittedEvents, MAX_FEEDBACK_TURNS * 140 - 128);
  for (const turn of report.turns ?? []) {
    const events = report.events.filter(event => event.turn === turn.turn);
    assert.equal(events[0].at, new Date(turn.turn * 1000 + 1).toISOString());
    assert.equal(events.at(-1)?.result, 'aborted');
    assert.equal(turn.modelErrors, 139);
  }
});

test('one bounded redaction scope covers secrets echoed across detailed turns', () => {
  const { message, snapshot } = historyFixture();
  message('u1', { role: 'user', content: 'API_KEY=synthetic-cross-turn-secret' });
  message('a1', { role: 'assistant', content: 'Early evidence' });
  message('u2', { role: 'user', content: 'Unselected intervening text' });
  message('a2', { role: 'assistant', content: `password=synthetic-unscanned-secret\n${'x'.repeat(40000)}` });
  message('u3', { role: 'user', content: 'Later evidence' });
  message('a3', { role: 'assistant', content: 'Echo: synthetic-cross-turn-secret' });
  const s = snapshot();
  const selection = { ...options, focus: 'history' as const, conversation: true, includeBetween: true,
    turnKeys: [s.turns[0].key, s.turns[2].key] };
  const safe = feedbackReport(selection, s.messages, context, s.history);
  assert.match(safe, /Early evidence/);
  assert.match(safe, /Later evidence/);
  assert.doesNotMatch(safe, /synthetic-cross-turn-secret|Unselected intervening text/);
  const raw = feedbackReport({ ...selection, actual: 'Echo: synthetic-unscanned-secret', turnKeys: s.turns.map(turn => turn.key) },
    s.messages, context, s.history);
  assert.doesNotMatch(raw, /synthetic-unscanned-secret/);
  const bounded = JSON.parse(raw);
  assert.equal(bounded.summary.optionalText, 'redaction_limit');
  assert.deepEqual(bounded.excerpts, []);
  assert.deepEqual(bounded.expected, { text: '[redacted]', truncated: true });
  assert.deepEqual(bounded.actual, { text: '[redacted]', truncated: true });
  assert.equal(bounded.turns.length, 3);
});

test('an interrupted or successful turn can be selected, but not from a different session or divergent branch', () => {
  const entries = [
    { type: 'message', id: 'user', parentId: null, message: { role: 'user', content: 'Fixture prompt' } },
    { type: 'message', id: 'stopped', parentId: 'user', message: { role: 'assistant', stopReason: 'aborted', content: [], timestamp: 1000 } },
    { type: 'message', id: 'continued-user', parentId: 'stopped', message: { role: 'user', content: 'Follow-up' } },
    { type: 'message', id: 'continued', parentId: 'continued-user', message: { role: 'assistant', content: 'OK', timestamp: 2000 } },
    { type: 'message', id: 'sibling', parentId: 'user', message: { role: 'assistant', content: 'Different branch', timestamp: 3000 } },
  ];
  const snapshot = (leaf: string, id: string) => {
    const messages = sessionTranscript(entries, leaf);
    const history = feedbackHistory(entries, leaf, id, messages);
    return { messages, history, turns: listFeedbackTurns(messages, history) };
  };
  const { messages, history, turns } = snapshot('continued', 'A');
  const automatic = JSON.parse(feedbackReport(options, messages, context, history));
  assert.equal(automatic.scope, 'latest_interrupted_turn');
  assert.deepEqual(automatic.events.map((event: { result: string }) => event.result), ['aborted']);
  const selection = { ...options, focus: 'turn' as const, turnKey: turns[0].key };
  const success = JSON.parse(feedbackReport(selection, messages, context, history));
  assert.equal(success.scope, 'selected_turn');
  assert.deepEqual(success.events.map((event: { result: string }) => event.result), ['reply']);
  for (const other of [snapshot('sibling', 'A'), snapshot('continued', 'B')]) {
    assert.throws(() => feedbackReport({ ...selection, turnKey: turns[1].key }, other.messages, context, other.history),
      /no longer available/);
  }
  assert.throws(() => feedbackReport(selection, messages, context), /no longer available/);
});
