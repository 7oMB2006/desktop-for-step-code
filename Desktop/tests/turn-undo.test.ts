import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPatch } from 'diff';
import { TurnUndoStore, reverseExact } from '../electron/turn-undo';
import type { IndexedMessage } from '../src/conversation-presentation';

function edit(path: string, before: string, after: string, id: string): IndexedMessage[] {
  return [
    { index: 0, message: { role: 'assistant', content: [{ type: 'toolCall', name: 'edit_file', id, arguments: { path } }] } },
    { index: 1, message: { role: 'toolResult', toolCallId: id, content: 'Done', details: { patch: createPatch(path, before, after) } } },
  ];
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'step-undo-unit-'));
  const cwd = join(dir, 'workspace'); await mkdir(cwd);
  return { cwd, dir, store: new TurnUndoStore(join(dir, 'records')) };
}

test('exact reverse refuses relocation and preserves no-final-newline text', () => {
  const patch = createPatch('a', 'old', 'new');
  assert.equal(reverseExact('new', patch), 'old');
  assert.throws(() => reverseExact('extra\nnew', patch));
  assert.throws(() => reverseExact('changed', patch));
  assert.equal(reverseExact('', createPatch('a', 'old\n', '')), 'old\n');
  assert.equal(reverseExact('new\n', createPatch('a', '', 'new\n')), '');
});

test('undo reverses repeated edits and persists state without changing messages', async () => {
  const { cwd, dir, store } = await setup();
  const items = [...edit('a.ts', 'a\n', 'b\n', '1'), ...edit('a.ts', 'b\n', 'c\n', '2')];
  const original = JSON.stringify(items);
  await writeFile(join(cwd, 'a.ts'), 'c\n');
  await store.capture('session', cwd, items);
  const prepared = await store.prepare('session', cwd, items);
  assert.equal(prepared.state, 'available');
  assert.equal((await store.undo('session', cwd, items, prepared.token!)).state, 'undone');
  assert.equal(await readFile(join(cwd, 'a.ts'), 'utf8'), 'a\n');
  assert.equal((await new TurnUndoStore(join(dir, 'records')).status('session', cwd, items)).state, 'undone');
  assert.equal(JSON.stringify(items), original);
  await assert.rejects(store.undo('session', cwd, items, prepared.token!), /expired/);
});

test('post-confirmation conflict does not restore any file in the batch', async () => {
  const { cwd, store } = await setup();
  const items = [...edit('a', 'old-a\n', 'new-a\n', 'a'), ...edit('b', 'old-b\n', 'new-b\n', 'b')];
  await writeFile(join(cwd, 'a'), 'new-a\n'); await writeFile(join(cwd, 'b'), 'new-b\n');
  await store.capture('s', cwd, items);
  const prepared = await store.prepare('s', cwd, items);
  await writeFile(join(cwd, 'b'), 'later-b\n');
  assert.equal((await store.undo('s', cwd, items, prepared.token!)).state, 'conflict');
  assert.equal(await readFile(join(cwd, 'a'), 'utf8'), 'new-a\n');
  assert.equal(await readFile(join(cwd, 'b'), 'utf8'), 'later-b\n');
});

test('unrecorded history cannot create its own undo baseline through status', async () => {
  const { cwd, store } = await setup();
  const items = edit('a', 'old\n', 'new\n', 'a');
  await writeFile(join(cwd, 'a'), 'new\n');
  assert.equal((await store.prepare('s', cwd, items)).state, 'unavailable');
  await assert.rejects(store.undo('s', cwd, items, 'fake-token'), /expired/);
});

test('undo identity is session and patch specific', async () => {
  const { cwd, store } = await setup();
  const items = edit('a', 'old\n', 'new\n', 'a');
  await writeFile(join(cwd, 'a'), 'new\n');
  await store.capture('s', cwd, items);
  assert.equal((await store.status('other-session', cwd, items)).state, 'unavailable');
  assert.equal((await store.status('s', cwd, edit('a', 'different\n', 'new\n', 'a'))).state, 'unavailable');
});

test('outside paths, repository internals, binary and oversized files cannot be captured', async () => {
  const { cwd, dir, store } = await setup();
  await writeFile(join(dir, 'outside'), 'new\n');
  await assert.rejects(store.capture('s', cwd, edit('../outside', 'old\n', 'new\n', 'outside')), /outside/);
  await mkdir(join(cwd, '.git')); await writeFile(join(cwd, '.git', 'config'), 'new\n');
  await assert.rejects(store.capture('s', cwd, edit('.git/config', 'old\n', 'new\n', 'git')), /outside/);
  await writeFile(join(cwd, 'binary'), Buffer.from([0xff, 0x00]));
  await assert.rejects(store.capture('s', cwd, edit('binary', 'old', 'new', 'binary')), /UTF-8/);
  await writeFile(join(cwd, 'large'), 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(store.capture('s', cwd, edit('large', 'old', 'new', 'large')), /eligible/);
});

test('linked files and directory junctions cannot be undone', async () => {
  const { cwd, dir, store } = await setup();
  await writeFile(join(dir, 'outside'), 'new\n');
  await link(join(dir, 'outside'), join(cwd, 'hardlink'));
  await assert.rejects(store.capture('s', cwd, edit('hardlink', 'old\n', 'new\n', 'hard')), /eligible/);
  const external = join(dir, 'external'); await mkdir(external);
  await writeFile(join(external, 'a'), 'new\n');
  await symlink(external, join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.capture('s', cwd, edit('linked/a', 'old\n', 'new\n', 'linked')), /Linked/);
});
