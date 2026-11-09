import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalInstructionsStore } from '../electron/global-instructions';
import { MAX_GLOBAL_INSTRUCTIONS_LENGTH } from '../src/global-instructions';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-instructions-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const agentDir = join(directory, 'agent');
  return { directory, agentDir, store: new GlobalInstructionsStore(agentDir) };
}

test('global instructions default to empty without creating configuration', async t => {
  const { directory, store } = await fixture(t);
  assert.deepEqual(await store.read(), { content: '', revision: 'missing' });
  assert.deepEqual(await readdir(directory), []);
});

test('global instructions round-trip Unicode, persist across stores and clear without replacement rules', async t => {
  const { agentDir, store } = await fixture(t);
  const content = '# \u5168\u5c40\u6307\u4ee4\n\u9ed8\u8ba4\u7528\u4e2d\u6587\u56de\u7b54\u3002\n';
  const saved = await store.save(content, 'missing');
  assert.equal(await readFile(join(agentDir, 'AGENTS.md'), 'utf8'), content);
  assert.deepEqual(await new GlobalInstructionsStore(agentDir).read(), saved);
  const cleared = await store.save('', saved.revision);
  assert.equal(cleared.content, '');
  assert.equal(await readFile(join(agentDir, 'AGENTS.md'), 'utf8'), '');
  assert.deepEqual(await readdir(agentDir), ['AGENTS.md']);
});

test('invalid content, null bytes and oversized values cannot write configuration', async t => {
  const { directory, store } = await fixture(t);
  for (const content of [null, {}, 123, '\0', 'a'.repeat(MAX_GLOBAL_INSTRUCTIONS_LENGTH + 1)]) {
    await assert.rejects(store.save(content, 'missing'), /GLOBAL_INSTRUCTIONS_(INVALID|TOO_LARGE)/);
  }
  await assert.rejects(store.save('valid', null), /INVALID/);
  assert.deepEqual(await readdir(directory), []);
});

test('stale and concurrent saves do not overwrite newer instructions', async t => {
  const { store } = await fixture(t);
  const first = store.save('first', 'missing');
  const second = store.save('second', 'missing');
  await first;
  await assert.rejects(second, /CONFLICT/);
  const current = await store.read();
  assert.equal(current.content, 'first');
  await assert.rejects(store.save('stale', 'missing'), /CONFLICT/);
  assert.equal((await store.save('next', current.revision)).content, 'next');
});

test('manual edits and new higher-priority context files invalidate an editor revision', async t => {
  const { agentDir, store } = await fixture(t);
  const initial = await store.save('initial', 'missing');
  await writeFile(join(agentDir, 'AGENTS.md'), 'external');
  await assert.rejects(store.save('lost update', initial.revision), /CONFLICT/);
  const current = await store.read();
  await writeFile(join(agentDir, 'AGENTS.override.md'), 'override');
  await assert.rejects(store.save('lost override', current.revision), /CONFLICT/);
  const override = await store.read();
  await store.save('updated override', override.revision);
  assert.equal(await readFile(join(agentDir, 'AGENTS.md'), 'utf8'), 'external');
  assert.equal(await readFile(join(agentDir, 'AGENTS.override.md'), 'utf8'), 'updated override');
});

test('existing fallback files and UTF-8 BOM follow native context discovery', async t => {
  const { agentDir, store } = await fixture(t);
  await mkdir(agentDir);
  await writeFile(join(agentDir, 'CLAUDE.md'), '\ufeffexisting preferences');
  const existing = await store.read();
  assert.equal(existing.content, 'existing preferences');
  await store.save('updated preferences', existing.revision);
  assert.deepEqual(await readdir(agentDir), ['CLAUDE.md']);
  assert.equal(await readFile(join(agentDir, 'CLAUDE.md'), 'utf8'), 'updated preferences');
});

test('linked profile directories cannot redirect instruction writes outside the profile', async t => {
  const { directory, agentDir, store } = await fixture(t);
  const outside = join(directory, 'personal-cli');
  await mkdir(outside);
  await writeFile(join(outside, 'AGENTS.md'), 'personal rules');
  await symlink(outside, agentDir, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.read(), /UNAVAILABLE/);
  await assert.rejects(store.save('replace personal', 'missing'), /UNAVAILABLE/);
  assert.equal(await readFile(join(outside, 'AGENTS.md'), 'utf8'), 'personal rules');
});

test('invalid UTF-8 and oversized existing files fail explicitly without being rewritten', async t => {
  const { agentDir, store } = await fixture(t);
  await mkdir(agentDir);
  const path = join(agentDir, 'AGENTS.md');
  await writeFile(path, Buffer.from([0xff, 0xfe]));
  await assert.rejects(store.read());
  assert.deepEqual(await readFile(path), Buffer.from([0xff, 0xfe]));
  await writeFile(path, 'a'.repeat(MAX_GLOBAL_INSTRUCTIONS_LENGTH * 4 + 4));
  await assert.rejects(store.read(), /TOO_LARGE/);
});
