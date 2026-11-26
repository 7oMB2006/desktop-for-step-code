import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';
import { FeedbackPreview, feedbackReport } from '../electron/feedback-export';
import type { Message } from '../src/contracts';

const context = { desktop: 'test', stepCode: { baseline: 'v0.1.8', commit: 'a'.repeat(40) }, platform: 'linux', arch: 'x64' };
const options = { expected: 'works', actual: 'failed', conversation: false, tools: false };
const messages: Message[] = [
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'SYNTHETIC_A' }] },
  { role: 'user', content: 'hello /home/fixture/private\nAPI_KEY=mock-key\nname@example.org' },
  { role: 'toolResult', isError: true, timestamp: 1000, content: 'Failed step. PRIVATE_OUTPUT_TAIL', details: { path: 'private details' } },
];
test('diagnostics and redacted excerpts use an explicit allowlist', () => {
  const plain = feedbackReport(options, messages, context, 'req-fixture');
  const minimal = JSON.parse(plain);
  assert.equal(minimal.request.requestId, 'req-fixture');
  assert.equal(minimal.diagnostics.errorAt, new Date(1000).toISOString());
  assert.deepEqual(minimal.excerpts, []);
  assert.doesNotMatch(plain, /SYNTHETIC_A|mock-key|Failed step|private details|private reasoning/);
  const expanded = feedbackReport({ ...options, conversation: true, tools: true }, messages, context);
  assert.match(expanded, /SYNTHETIC_A/);
  assert.match(expanded, /Failed step/);
  assert.doesNotMatch(expanded, /PRIVATE_OUTPUT_TAIL|example.org|mock-key|private details|private reasoning|\/home\/fixture/);
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
  } finally { await removeTestProfile(dir); }
});

test('secrets echoed in another field and terminal escapes are removed before truncation', () => {
  const content = feedbackReport({ ...options, actual: 'password=echoedSyntheticValue', conversation: true,
    expected: 'prefix echoedSyntheticValue', errorAt: '2026-04-01T10:00:00.000Z' },
    [{ role: 'user', content: 'echoedSyntheticValue\x1b]0;hiddenTerminalTitle\x07' }], context);
  assert.doesNotMatch(content, /echoedSyntheticValue|hiddenTerminalTitle/);
  assert.equal(JSON.parse(content).diagnostics.errorAtSource, 'user');
  assert.throws(() => feedbackReport({ ...options, errorAt: 'invalid' }, [], context));
});
