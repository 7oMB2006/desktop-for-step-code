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
import { defaultFeedbackPath, feedbackDirectory, FeedbackPreview, feedbackReport } from '../electron/feedback-export';
import type { Message } from '../src/contracts';

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

test('an oversized opted-in redaction context suppresses excerpts without affecting diagnostics-only', () => {
  const longTurn: Message[] = [
    { role: 'user', content: 'x'.repeat(32 * 1024 + 1) },
    { role: 'assistant', content: 'Unverified excerpt' },
  ];
  const expanded = JSON.parse(feedbackReport({ ...options, conversation: true }, longTurn, context));
  assert.doesNotMatch(JSON.stringify(expanded), /Unverified excerpt/);
  assert.deepEqual(expanded.excerpts, []);
  assert.equal(expanded.summary.optionalText, 'redaction_limit');
  const diagnostics = JSON.parse(feedbackReport(options, longTurn, context));
  assert.equal(diagnostics.events[0].result, 'reply');
  assert.equal(diagnostics.events[0].requestId, null);
  assert.equal(diagnostics.expected.text, options.expected);
  assert.deepEqual(diagnostics.excerpts, []);
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
  assert.equal(report.events[0].at, new Date(3).toISOString());
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
