import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importedHistoryMessages } from '../electron/imported-history';
import { messagesWithEntryIds } from '../electron/session-branching';
// @ts-expect-error Node ESM adapter is staged verbatim beside admin.mjs.
import { readSessionHistory, MAX_HISTORY_PREVIEW_BYTES } from '../electron/session-history.mjs';

const bundle = resolve('runtime/step/dist/bundle/index.js');
const native = existsSync(bundle) ? await import(pathToFileURL(bundle).href) : undefined;
const header = { type: 'session', id: 'history', version: 3, cwd: 'fixture', timestamp: '2026-10-24T00:00:00Z' };
const message = (id: string, parentId: string | null, text: string) => ({
  type: 'message', id, parentId, timestamp: header.timestamp,
  message: { role: 'user', content: text, timestamp: 1 },
});
const upstream = {
  CURRENT_SESSION_VERSION: 3,
  parseSessionEntries: (text: string) => text.split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }),
  migrateSessionEntries: () => {},
  buildSessionContext: (entries: any[]) => ({ messages: entries.filter(entry => entry.type === 'message').map(entry => entry.message) }),
};
async function fixture(t: TestContext, values: unknown[] = [header, message('a', null, 'readable')], tail = '') {
  const root = await mkdtemp(join(tmpdir(), 'desktop-history-'));
  const sessions = join(root, 'sessions');
  await mkdir(sessions);
  const file = join(sessions, 'history.jsonl');
  await writeFile(file, values.map(value => JSON.stringify(value)).join('\n') + tail);
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\') || resolve(root).startsWith(resolve(tmpdir()) + '/'));
    await rm(root, { recursive: true, force: true });
  });
  return { root, sessions, file };
}
test('preview never repairs a missing newline or malformed final record, and hashes the original bytes', async t => {
  const { sessions, file } = await fixture(t, undefined, '\n{"type":"message"');
  const before = await readFile(file), metadata = await stat(file);
  const first = await readSessionHistory(upstream, sessions, file, 'history');
  const second = await readSessionHistory(upstream, sessions, file, 'history');
  assert.deepEqual(first.messages, [{ role: 'user', content: 'readable', timestamp: 1 }]);
  assert.equal(first.version, second.version);
  assert.equal(first.version.length, 64);
  assert.deepEqual(await readFile(file), before);
  assert.equal((await stat(file)).mtimeMs, metadata.mtimeMs);
});
test('preview rejects another identity and malformed active paths', async t => {
  const { sessions, file } = await fixture(t);
  await assert.rejects(readSessionHistory(upstream, sessions, file, 'other'), /identity/);
  for (const entries of [
    [message('a', null, 'first'), message('a', null, 'duplicate')],
    [message('a', 'missing', 'missing')],
    [message('a', 'b', 'a'), message('b', 'a', 'b')],
  ]) {
    await writeFile(file, [header, ...entries].map(value => JSON.stringify(value)).join('\n'));
    await assert.rejects(readSessionHistory(upstream, sessions, file, 'history'), /history/);
  }
});
test('preview cannot follow an out-of-profile file or junction', async t => {
  const { root, sessions, file } = await fixture(t);
  await assert.rejects(readSessionHistory(upstream, join(root, 'elsewhere'), file, 'history'));
  const external = join(root, 'external');
  await mkdir(external);
  const outside = join(external, 'history.jsonl');
  await writeFile(outside, JSON.stringify(header));
  await assert.rejects(readSessionHistory(upstream, sessions, outside, 'history'), /outside Desktop/);
  const link = join(sessions, 'linked');
  await symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readSessionHistory(upstream, sessions, join(link, 'history.jsonl'), 'history'), /outside Desktop/);
});
test('large and future-format histories fall back without projection or rewrite', async t => {
  const { sessions, file } = await fixture(t, [{ ...header, version: 999 }]);
  assert.equal(await readSessionHistory(upstream, sessions, file, 'history'), null);
  const handle = await open(file, 'r+');
  try { await handle.truncate(MAX_HISTORY_PREVIEW_BYTES + 1); }
  finally { await handle.close(); }
  assert.equal(await readSessionHistory(upstream, sessions, file, 'history'), null);
  assert.equal((await stat(file)).size, MAX_HISTORY_PREVIEW_BYTES + 1);
});
test('expanded projection cannot overflow the shared management response', async t => {
  const { sessions, file } = await fixture(t);
  assert.equal(await readSessionHistory({ ...upstream,
    buildSessionContext: () => ({ messages: [{ role: 'user', content: 'x'.repeat(24 * 1024 * 1024) }] }),
  }, sessions, file, 'history'), null);
});
test('native preview follows the active branch including custom and compacted context', { skip: !native }, async t => {
  const entries = [
    header, message('a', null, 'original'),
    message('abandoned', 'a', 'hidden branch'),
    message('b', 'a', 'kept'),
    { type: 'compaction', id: 'compact', parentId: 'b', timestamp: header.timestamp,
      summary: 'earlier work', firstKeptEntryId: 'b', tokensBefore: 100 },
    { type: 'custom_message', id: 'custom', parentId: 'compact', timestamp: header.timestamp,
      customType: 'fixture', content: 'visible custom', display: true },
    { type: 'session_info', id: 'name', parentId: 'custom', timestamp: header.timestamp, name: 'Branched' },
  ];
  const { sessions, file } = await fixture(t, entries);
  const history = await readSessionHistory(native, sessions, file, 'history');
  const copy = join(sessions, 'copy.jsonl');
  await writeFile(copy, await readFile(file));
  const manager = native.SessionManager.open(copy, sessions);
  assert.deepEqual(history.messages, manager.buildSessionContext().messages);
  assert.equal(history.leafId, manager.getLeafId());
  assert.ok(JSON.stringify(history.messages).includes('earlier work'));
  assert.ok(!JSON.stringify(history.messages).includes('hidden branch'));
  const projected = messagesWithEntryIds(history.messages, history.entries, history.leafId);
  assert.equal(projected.find(value => value.content === 'kept')?.entryId, 'b');
});
test('native legacy migration stays in memory and imported tool display retains original identities', { skip: !native }, async t => {
  const { sessions, file } = await fixture(t, [{ ...header, version: 1 },
    { type: 'message', message: { role: 'user', content: 'old history', timestamp: 1 } }]);
  const before = await readFile(file), metadata = await stat(file);
  const legacy = await readSessionHistory(native, sessions, file, 'history');
  assert.equal(legacy.messages[0].content, 'old history');
  assert.ok(legacy.entries[0].id);
  assert.deepEqual(await readFile(file), before);
  assert.equal((await stat(file)).mtimeMs, metadata.mtimeMs);
  await writeFile(file, [header, {
    ...message('imported', null, 'placeholder'),
    imported: { source: 'codex', sessionId: 'source', itemId: 'source-item' },
    message: { role: 'toolResult', toolCallId: 'call', toolName: 'run_command',
      content: [{ type: 'text', text: 'original tool output' }], timestamp: 1 },
  }].map(value => JSON.stringify(value)).join('\n'));
  const history = await readSessionHistory(native, sessions, file, 'history');
  const display = importedHistoryMessages(history.messages, history.entries, history.leafId);
  assert.equal(display[0].role, 'toolResult');
  assert.equal(display[0].entryId, 'imported');
  assert.deepEqual(display[0].content, [{ type: 'text', text: 'original tool output' }]);
  assert.match(display[0].toolCallId!, /^desktop-import:/);
});
