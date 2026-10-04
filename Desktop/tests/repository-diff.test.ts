import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNumstat, repositoryDiff, repositoryFileDiff } from '../electron/repository-diff';

const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'step-repository-test-'));
  const git = async (...args: string[]) => (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout;
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.hooksPath', join(root, 'no-hooks'));
  await writeFile(join(root, 'a.txt'), 'before\n');
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
  await git('add', '--', '.');
  await git('commit', '-m', 'base');
  await git('switch', '-c', 'feature');
  return { root, git };
}
test('numstat parsing preserves tabs and newlines in filenames and marks binary files', () => {
  const parsed = parseNumstat('2\t3\ta\tb.txt\0-\t-\tpicture.png\0');
  assert.equal(parsed.get('a\tb.txt')?.added, 2);
  assert.equal(parsed.get('picture.png')?.binary, true);
  assert.throws(() => parseNumstat('bad\t3\ta.txt\0'));
});
test('branch comparison includes branch commits, index, worktree and untracked files without mutating Git', async () => {
  const { root, git } = await fixture();
  await writeFile(join(root, 'committed.txt'), 'branch change\n');
  await git('add', '--', 'committed.txt');
  await git('commit', '-m', 'feature');
  await writeFile(join(root, 'a.txt'), 'staged\n');
  await git('add', '--', 'a.txt');
  await writeFile(join(root, 'a.txt'), 'worktree\nanother\n');
  await writeFile(join(root, 'new name.txt'), 'new\n');
  await writeFile(join(root, 'ignored.txt'), 'ignored\n');
  await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
  const index = await readFile(join(root, '.git', 'index'));
  const status = await git('status', '--porcelain');
  const result = await repositoryDiff(root);
  assert.equal(result.state, 'ready'); assert.equal(result.branch, 'feature'); assert.equal(result.base, 'main');
  assert.deepEqual(result.files.map(file => file.path).sort(), ['a.txt', 'binary.bin', 'committed.txt', 'new name.txt']);
  assert.equal(result.files.find(file => file.path === 'a.txt')?.added, 2);
  assert.equal(result.added, 4); assert.equal(result.removed, 1);
  assert.equal(result.files.find(file => file.path === 'binary.bin')?.binary, true);
  const patch = await repositoryFileDiff(root, 'main', 'a.txt');
  assert.ok(patch.rows.some(row => row.kind === 'add' && row.text === 'worktree'));
  assert.ok(!patch.rows.some(row => row.text === 'staged'));
  assert.equal((await repositoryFileDiff(root, 'main', 'new name.txt')).added, 1);
  assert.equal((await repositoryFileDiff(root, 'main', 'binary.bin')).reason, 'binary');
  assert.equal(await git('status', '--porcelain'), status);
  assert.deepEqual(await readFile(join(root, '.git', 'index')), index);
  assert.equal((await repositoryDiff(root, 'HEAD')).files.some(file => file.path === 'committed.txt'), false);
  await assert.rejects(repositoryDiff(root, '--output=outside'), /Invalid comparison base/);
  await assert.rejects(repositoryFileDiff(root, 'main', '../outside.txt'), /not found/);
});
test('merge-base comparison does not count changes made only on the base branch', async () => {
  const { root, git } = await fixture();
  await git('switch', 'main');
  await writeFile(join(root, 'base-only.txt'), 'main only\n');
  await git('add', '--', '.'); await git('commit', '-m', 'base advances');
  await git('switch', 'feature');
  assert.equal((await repositoryDiff(root, 'main')).files.length, 0);
});
test('non-repositories, unborn repositories and ignored files remain distinct states', async () => {
  const root = await mkdtemp(join(tmpdir(), 'step-no-git-test-'));
  assert.equal((await repositoryDiff(root)).state, 'not-git');
  await exec('git', ['-C', root, 'init', '-b', 'main'], { windowsHide: true });
  assert.equal((await repositoryDiff(root)).state, 'unborn');
});
test('worktree links and large untracked files are never read as normal previews', async () => {
  const { root } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'step-outside-test-'));
  await writeFile(join(outside, 'secret.txt'), 'outside data\n');
  await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(root, 'large.txt'), 'a'.repeat(200_000));
  const result = await repositoryDiff(root);
  const link = result.files.find(file => file.path.startsWith('link'));
  if (link) {
    assert.equal(link.unavailable, true);
    assert.equal((await repositoryFileDiff(root, 'main', link.path)).reason, 'unsupported');
  }
  assert.equal(result.files.find(file => file.path === 'large.txt')?.unavailable, true);
  assert.equal((await repositoryFileDiff(root, 'main', 'large.txt')).reason, 'too-large');
});
test('credential files and inline credential values never reach the diff preview', async () => {
  const { root, git } = await fixture();
  await writeFile(join(root, 'cloud-config.ts'), 'const AWS_SECRET_ACCESS_KEY = "fixture-old-cloud-value";\n');
  await git('add', '--', 'cloud-config.ts');
  await git('commit', '-m', 'cloud fixture baseline');
  await writeFile(join(root, 'cloud-config.ts'), 'const awsSecretAccessKey = "fixture-new-cloud-value";\n');
  await writeFile(join(root, '.env'), 'API_KEY=fixture-sensitive-value\n');
  await writeFile(join(root, 'config.ts'), 'const apiKey = "fixture-sensitive-value";\n');
  assert.equal((await repositoryFileDiff(root, 'main', '.env')).reason, 'sensitive');
  const file = await repositoryFileDiff(root, 'main', 'config.ts');
  assert.ok(file.rows.some(row => row.text.includes('[redacted]')));
  assert.ok(!JSON.stringify(file).includes('fixture-sensitive-value'));
  const cloud = await repositoryFileDiff(root, 'HEAD', 'cloud-config.ts');
  assert.ok(cloud.rows.some(row => row.kind === 'add' && row.text.includes('[redacted]')));
  assert.ok(cloud.rows.some(row => row.kind === 'remove' && row.text.includes('[redacted]')));
  assert.ok(!JSON.stringify(cloud).includes('fixture-old-cloud-value'));
  assert.ok(!JSON.stringify(cloud).includes('fixture-new-cloud-value'));
});
