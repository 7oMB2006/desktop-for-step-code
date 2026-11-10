import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { windowsShortPath } from './fixtures/windows-short-path';

const windowsOnly = { skip: process.platform !== 'win32' };

test('native short aliases preserve Unicode, spaces and literal shell characters', windowsOnly, async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'dfsc-short-native-'));
  const target = join(root, '\u4e2d\u6587 long & (folder) %PATH% !literal! ^caret');
  await mkdir(target);
  const short = await windowsShortPath(target, root);
  assert.equal((await realpath(short)).toLowerCase(), (await realpath(target)).toLowerCase());
});

test('native short aliases keep the identity of a directory junction', windowsOnly, async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'dfsc-short-junction-'));
  const target = join(root, 'long target directory'), link = join(root, 'long junction directory');
  await mkdir(target);
  await symlink(target, link, 'junction');
  const short = await windowsShortPath(link, root);
  assert.equal((await realpath(short)).toLowerCase(), (await realpath(target)).toLowerCase());
});

test('short alias lookup refuses paths outside its exact owned fixture root', windowsOnly, async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'dfsc-short-owned-'));
  await assert.rejects(windowsShortPath(`${root}-outside`, root), assert.AssertionError);
});

test('short alias lookup cannot turn a nonexistent path into a valid fixture', windowsOnly, async () => {
  const root = await mkdtemp(join(realpathSync(tmpdir()), 'dfsc-short-missing-'));
  await assert.rejects(windowsShortPath(join(root, 'missing directory'), root));
});
