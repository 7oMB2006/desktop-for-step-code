import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archivedDeletionTargets, deleteManagedSessionFile, managedSessionFile } from '../electron/session-deletion';
import type { Session } from '../src/contracts';

const session: Session = { id: 'archived', path: '', cwd: '', firstMessage: '', modified: '', messageCount: 1 };
test('permanent deletion accepts only a bounded unique selection of known archived IDs', () => {
  assert.deepEqual(archivedDeletionTargets(['archived'], [session], ['archived']), [session]);
  for (const ids of [[], 'archived', [1], ['unknown'], ['archived', 'archived'], ['x'.repeat(201)]]) {
    assert.throws(() => archivedDeletionTargets(ids, [session], ['archived']));
  }
  assert.throws(() => archivedDeletionTargets(['archived'], [session], []), /Only known archived/);
});

test('deleting managed history never deletes a project file, directory or outside session', async () => {
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'desktop-delete-unit-')));
  const root = join(profile, 'sessions');
  const project = join(profile, 'project');
  await mkdir(root); await mkdir(project);
  const inside = join(root, 'saved.jsonl');
  const outside = join(project, 'saved.jsonl');
  await writeFile(inside, 'history'); await writeFile(outside, 'project content');
  assert.equal(await managedSessionFile(root, inside), await realpath(inside));
  await assert.rejects(managedSessionFile(root, outside), /outside/);
  await assert.rejects(managedSessionFile(root, project), /Invalid/);
  await writeFile(join(root, 'config.json'), '{}');
  await assert.rejects(managedSessionFile(root, join(root, 'config.json')), /Invalid/);
  await mkdir(join(root, 'directory.jsonl'));
  await assert.rejects(managedSessionFile(root, join(root, 'directory.jsonl')), /Invalid/);
  const alias = join(root, 'outside-alias');
  await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(deleteManagedSessionFile(root, join(alias, 'saved.jsonl')), /outside/);
  await deleteManagedSessionFile(root, inside);
  await assert.rejects(readFile(inside), /ENOENT/);
  assert.equal(await readFile(outside, 'utf8'), 'project content');
});
