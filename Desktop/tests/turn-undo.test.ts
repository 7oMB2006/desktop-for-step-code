import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, symlink, link, readdir } from 'node:fs/promises';
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


test('case-only root ownership changes reject prepared undo on POSIX', { skip: process.platform === 'win32' }, async () => {
  const { cwd, dir, store } = await setup();
  const items = edit('a', 'old\n', 'new\n', 'case-owner');
  await writeFile(join(cwd, 'a'), 'new\n');
  await store.capture('s', cwd, items);
  const prepared = await store.prepare('s', cwd, items);
  assert.equal(prepared.state, 'available');
  const recordPath = join(dir, 'records', (await readdir(join(dir, 'records')))[0]);
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  const originalRoot = record.root;
  record.root = originalRoot.replace(/workspace$/, 'Workspace');
  assert.notEqual(record.root, originalRoot);
  await writeFile(recordPath, JSON.stringify(record));
  assert.equal((await store.status('s', cwd, items)).state, 'unavailable');
  assert.equal((await store.prepare('s', cwd, items)).state, 'unavailable');
  assert.equal((await store.undo('s', cwd, items, prepared.token!)).state, 'unavailable');
  assert.equal(await readFile(join(cwd, 'a'), 'utf8'), 'new\n');
});

test('relocation to a different root cannot use an existing confirmation ticket', async () => {
  const { cwd, dir, store } = await setup();
  const destination = join(dir, 'relocated'); await mkdir(destination);
  const items = edit('a', 'old\n', 'new\n', 'relocate');
  for (const root of [cwd, destination]) await writeFile(join(root, 'a'), 'new\n');
  await store.capture('s', cwd, items);
  const prepared = await store.prepare('s', cwd, items);
  assert.equal((await store.status('s', destination, items)).state, 'unavailable');
  assert.equal((await store.undo('s', destination, items, prepared.token!)).state, 'unavailable');
  for (const root of [cwd, destination]) assert.equal(await readFile(join(root, 'a'), 'utf8'), 'new\n');
  assert.equal((await store.status('s', cwd, items)).state, 'available');
});


test('POSIX undo independently restores a literal-backslash file and a nested file', { skip: process.platform === 'win32' }, async () => {
  const { cwd, store } = await setup();
  await mkdir(join(cwd, 'a'));
  const literal = 'a\\b.txt', nested = 'a/b.txt';
  const context = Array(18).fill('context').join('\n');
  const beforeLiteral = `oldA\n${context}\nnewB\n`;
  const afterLiteral = beforeLiteral.replace('oldA', 'newA');
  const beforeNested = beforeLiteral.replace('newB', 'oldB');
  const afterNested = beforeLiteral;
  await writeFile(join(cwd, literal), afterLiteral);
  await writeFile(join(cwd, nested), afterNested);
  const items = [...edit(literal, beforeLiteral, afterLiteral, 'literal'), ...edit(nested, beforeNested, afterNested, 'nested')];
  await store.capture('s', cwd, items);
  const prepared = await store.prepare('s', cwd, items);
  assert.equal(prepared.state, 'available');
  assert.equal((await store.undo('s', cwd, items, prepared.token!)).state, 'undone');
  assert.equal(await readFile(join(cwd, literal), 'utf8'), beforeLiteral);
  assert.equal(await readFile(join(cwd, nested), 'utf8'), beforeNested);
});

test('legacy collapsed file records are unavailable after POSIX file identity is corrected', { skip: process.platform === 'win32' }, async () => {
  const { cwd, dir, store } = await setup();
  await mkdir(join(cwd, 'a'));
  const items = [...edit('a\\b.txt', 'old\n', 'new\n', 'literal'), ...edit('a/b.txt', 'old\n', 'new\n', 'nested')];
  for (const path of ['a\\b.txt', 'a/b.txt']) await writeFile(join(cwd, path), 'new\n');
  await store.capture('s', cwd, items);
  const prepared = await store.prepare('s', cwd, items);
  const path = join(dir, 'records', (await readdir(join(dir, 'records')))[0]);
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.files = record.files.slice(0, 1);
  await writeFile(path, JSON.stringify(record));
  assert.equal((await store.status('s', cwd, items)).state, 'unavailable');
  assert.equal((await store.undo('s', cwd, items, prepared.token!)).state, 'unavailable');
  for (const path of ['a\\b.txt', 'a/b.txt']) assert.equal(await readFile(join(cwd, path), 'utf8'), 'new\n');
});
