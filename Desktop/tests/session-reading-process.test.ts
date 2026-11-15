import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { historyProcessRunner } from '../electron/session-history-readers';
import { importedHistoryMessages } from '../electron/imported-history';
import { messagesWithEntryIds } from '../electron/session-branching';
// @ts-expect-error Native adapter is staged without TypeScript.
import { readHistorySource } from '../electron/session-history.mjs';
// @ts-expect-error Shared synthetic history for Node and Electron acceptance.
import { readingHistory } from './fixtures/session-reading-history.mjs';
import { mkdtemp, removeTestProfile } from '../scripts/test-profile.mjs';

const entry = resolve('runtime/session-reading-worker.mjs');
const bundle = resolve('runtime/step/dist/bundle/index.js');
const node = resolve('runtime/node', process.platform === 'win32' ? 'node.exe' : 'node');
const staged = existsSync(entry) && existsSync(bundle) && existsSync(node);

test('isolated native reader projects a case-sized history completely, without starting an agent or rewriting', { skip: !staged, timeout: 120000 }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-reading-process-'));
  const root = join(profile, 'step-runtime', 'sessions');
  await mkdir(root, { recursive: true });
  const file = join(root, 'large.jsonl');
  const text = readingHistory(profile);
  await writeFile(file, text);
  t.after(() => removeTestProfile(profile));
  const before = await stat(file);
  assert.ok(before.size > 15 * 1024 * 1024 && before.size < 16 * 1024 * 1024);
  const metrics: { heapUsed: number; rss: number }[] = [], pids: number[] = [];
  const run = historyProcessRunner(node, entry, profile, {
    started: pid => pids.push(pid), metrics: value => metrics.push(value),
  });
  const samples: number[] = [], projectionBytes: number[] = [];
  const count = Number(process.env.DESKTOP_READING_SAMPLES ?? 1);
  const native = await import(pathToFileURL(bundle).href);
  const history = await readHistorySource(native, root, file, 'reading-large');
  const imported = importedHistoryMessages(history.messages, history.entries, history.leafId);
  const expected = imported === history.messages ? messagesWithEntryIds(imported, history.entries, history.leafId) : imported;
  for (let index = 0; index < count; index++) {
    const start = performance.now();
    const result = await run({ root, profile, file, sessionId: 'reading-large', cwd: profile }, new AbortController().signal);
    samples.push(performance.now() - start);
    assert.ok(!('unavailable' in result), JSON.stringify(result));
    if ('unavailable' in result) continue;
    projectionBytes.push(Buffer.byteLength(JSON.stringify(result), 'utf8'));
    assert.deepEqual(result.messages, JSON.parse(JSON.stringify(expected)));
    assert.deepEqual(Object.keys(result).sort(), ['messages', 'modelChanges', 'sessionId', 'version']);
    assert.ok(JSON.stringify(result).includes('READING_HISTORY_END'));
    assert.ok(!JSON.stringify(result).includes('ABANDONED_BRANCH_MUST_NOT_APPEAR'));
  }
  assert.deepEqual(await readFile(file, 'utf8'), text);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), 'Reader exit must be confirmed before resolving');
  assert.equal(metrics.length, count);
  const ordered = [...samples].sort((a, b) => a - b);
  console.log(JSON.stringify({ sourceBytes: before.size, samples: count, medianMs: ordered[Math.floor(count / 2)],
    p95Ms: ordered[Math.ceil(count * .95) - 1], maxObservedHeap: Math.max(...metrics.map(value => value.heapUsed)),
    maxObservedRss: Math.max(...metrics.map(value => value.rss)),
    maxProjectionBytes: Math.max(...projectionBytes), cpu: cpus()[0]?.model, totalmem: totalmem() }));
});

test('cancelled isolated reader confirms exit and does not touch source bytes', { skip: !staged, timeout: 15000 }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'desktop-reading-cancel-'));
  const root = join(profile, 'sessions');
  await mkdir(root);
  const file = join(root, 'large.jsonl'), text = readingHistory(profile);
  await writeFile(file, text);
  t.after(() => removeTestProfile(profile));
  let pid = 0;
  const run = historyProcessRunner(node, entry, profile, { started: value => { pid = value; } });
  const controller = new AbortController();
  const reading = run({ root, profile, file, sessionId: 'reading-large', cwd: profile }, controller.signal);
  const start = performance.now();
  controller.abort();
  await assert.rejects(reading);
  const cancellationToConfirmedExitMs = performance.now() - start;
  assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0));
  assert.deepEqual(await readFile(file, 'utf8'), text);
  console.log(JSON.stringify({ cancellationToConfirmedExitMs }));
});

test('isolated reader supports Desktop project redirects without weakening managed history identity',
  { skip: !staged, timeout: 15000 }, async t => {
    const profile = await mkdtemp(join(tmpdir(), 'desktop-reading-redirect-'));
    t.after(() => removeTestProfile(profile));
    const root = join(profile, 'sessions'), cwd = join(profile, 'relocated-project');
    await mkdir(root);
    await mkdir(cwd);
    const file = join(root, 'large.jsonl'), text = readingHistory(join(profile, 'original-project'));
    await writeFile(file, text);
    const run = historyProcessRunner(node, entry, profile);
    const request = { root, profile, file, sessionId: 'reading-large', cwd };
    const result = await run(request, new AbortController().signal);
    assert.ok(!('unavailable' in result), JSON.stringify(result));
    assert.ok(JSON.stringify(result).includes('READING_HISTORY_END'));
    const wrongSession = await run({ ...request, sessionId: 'other-session' }, new AbortController().signal);
    assert.ok('unavailable' in wrongSession);
    const outside = join(profile, 'outside.jsonl');
    await writeFile(outside, text);
    const wrongRoot = await run({ ...request, file: outside }, new AbortController().signal);
    assert.ok('unavailable' in wrongRoot);
    assert.equal(await readFile(file, 'utf8'), text);
  });
