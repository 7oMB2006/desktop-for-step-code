import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeArtifactFixture } from './fixtures/artifact-cleanup';

const removeLink = (path: string) => process.platform === 'win32' ? rmdir(path) : rm(path, { force: true });
async function fixture(run: (root: string, target: string, link: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'artifact-cleanup-root-'));
  const target = await mkdtemp(join(tmpdir(), 'artifact-cleanup-target-'));
  const workspace = join(root, 'workspace');
  const link = join(workspace, 'escape');
  await mkdir(workspace);
  await writeFile(join(target, 'marker.txt'), 'preserve target');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { await run(root, target, link); }
  finally {
    await removeLink(link).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
}

test('artifact fixture cleanup removes a dangling link before recursive directory removal', () => fixture(async (root, target, link) => {
  await rm(target, { recursive: true });
  assert.equal((await readdir(join(root, 'workspace'), { withFileTypes: true }))[0].isSymbolicLink(), true);
  await removeArtifactFixture(root, [link]);
  await assert.rejects(readdir(root), { code: 'ENOENT' });
}));

test('artifact fixture cleanup removes only its link entries and preserves live targets', () => fixture(async (root, target, link) => {
  await removeArtifactFixture(root, [link]);
  assert.equal(await readFile(join(target, 'marker.txt'), 'utf8'), 'preserve target');
  await assert.rejects(readdir(root), { code: 'ENOENT' });
}));

test('mapped artifact cleanup removes both aliases after the escape target moves away', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artifact-cleanup-mapped-'));
  const retained = await mkdtemp(join(tmpdir(), 'artifact-cleanup-retained-'));
  const workspace = join(root, 'workspace');
  const alias = join(root, 'alias');
  const escape = join(workspace, 'escape');
  const target = join(root, 'outside');
  const moved = join(retained, 'outside');
  const links: string[] = [];
  try {
    await mkdir(workspace); await mkdir(target);
    await writeFile(join(target, 'marker.txt'), 'preserve moved target');
    await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(alias);
    await symlink(target, escape, process.platform === 'win32' ? 'junction' : 'dir');
    links.unshift(escape);
    await rename(target, moved);
    assert.equal((await readdir(workspace, { withFileTypes: true }))[0].isSymbolicLink(), true);
    await removeArtifactFixture(root, links);
    assert.equal(await readFile(join(moved, 'marker.txt'), 'utf8'), 'preserve moved target');
    await assert.rejects(readdir(root), { code: 'ENOENT' });
  } finally {
    await removeArtifactFixture(root, links);
    await rm(retained, { recursive: true, force: true });
  }
});

test('artifact cleanup retains the primary failure after only the workspace alias was created', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artifact-cleanup-partial-'));
  const workspace = join(root, 'workspace');
  const alias = join(root, 'alias');
  const links: string[] = [];
  const primary = new Error('fixture setup interrupted');
  try {
    await assert.rejects((async () => {
      try {
        await mkdir(workspace);
        await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
        links.push(alias);
        throw primary;
      } finally { await removeArtifactFixture(root, links); }
    })(), error => error === primary);
    await assert.rejects(readdir(root), { code: 'ENOENT' });
  } finally { await removeArtifactFixture(root, links); }
});

test('artifact fixture cleanup does not hide a non-link cleanup error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artifact-cleanup-error-'));
  const regular = join(root, 'regular-directory');
  await mkdir(regular);
  const marker = join(regular, 'marker.txt');
  await writeFile(marker, 'preserve');
  try {
    await assert.rejects(removeArtifactFixture(root, [regular]));
    assert.equal(await readFile(marker, 'utf8'), 'preserve');
  } finally { await rm(root, { recursive: true, force: true }); }
});
