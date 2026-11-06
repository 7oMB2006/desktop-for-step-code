import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, rm, stat, mkdir, readdir } from 'node:fs/promises';
import { dirname, basename, join, relative, resolve, isAbsolute } from 'node:path';
import { gte, valid } from 'semver';
import { InstallerFailure } from './update-installer';

const samePath = (left: string, right: string) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase() : left === right;

async function redirectedDirectory(path: string) {
  const parent = dirname(path);
  if (parent === path) return false;
  const entries = await readdir(parent, { withFileTypes: true });
  const matches = entries.filter(entry => samePath(entry.name, basename(path)));
  if (matches.length) return matches.some(entry => entry.isSymbolicLink() || !entry.isDirectory());
  // Short names and filesystem-normalized spellings need not appear in the listing.
  const [canonical, canonicalParent] = await Promise.all([realpath(path), realpath(parent)]);
  if (!samePath(dirname(canonical), canonicalParent)) return true;
  const target = entries.find(entry => samePath(entry.name, basename(canonical)));
  if (!target || !target.isDirectory() || target.isSymbolicLink()) return true;
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    let destination;
    try { destination = await realpath(join(parent, entry.name)); }
    catch (error: any) { if (error.code === 'ENOENT') continue; throw error; }
    if (samePath(destination, canonical)) return true;
  }
  return false;
}

async function checkCacheRoot(root: string, allowMissing = false) {
  let path = resolve(root);
  for (;;) {
    let entry;
    try { entry = await lstat(path); }
    catch (error: any) { if (!allowMissing || error.code !== 'ENOENT') throw error; }
    if (entry && (entry.isSymbolicLink() || !entry.isDirectory() || await redirectedDirectory(path)))
      throw new InstallerFailure('integrity');
    const parent = dirname(path);
    if (parent === path) return;
    path = parent;
  }
}
export async function prepareUpdateCache(root: string) {
  await checkCacheRoot(root, true);
  await mkdir(root, { recursive: true });
  await checkCacheRoot(root);
  const cache = join(root, 'download-cache');
  await checkCacheRoot(cache, true);
  await mkdir(cache, { recursive: true });
  await checkCacheRoot(cache);
  const pending = [cache];
  let inspected = 1;
  while (pending.length) {
    const path = pending.pop()!;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (++inspected > 256 || entry.isSymbolicLink()) throw new InstallerFailure('integrity');
      if (entry.isDirectory()) pending.push(join(path, entry.name));
    }
  }
}
export async function verifyInstallerFile(file: string, root: string, size: number, sha512: string) {
  await checkCacheRoot(root);
  const [canonicalRoot, canonicalFile, entry] = await Promise.all([realpath(root), realpath(file), lstat(file)]);
  const offset = relative(canonicalRoot, canonicalFile);
  if (!offset || offset.startsWith('..') || isAbsolute(offset) || entry.isSymbolicLink() || !entry.isFile()
    || (await stat(canonicalFile)).size !== size) throw new InstallerFailure('integrity');
  const digest = createHash('sha512');
  for await (const chunk of createReadStream(canonicalFile)) digest.update(chunk);
  if (digest.digest('base64') !== sha512) throw new InstallerFailure('integrity');
}

// Only our download cache is removed, and only after the target version has started.
export async function cleanInstalledUpdate(root: string, currentVersion: string) {
  let marker: any;
  try { marker = JSON.parse(await readFile(join(root, 'installed.json'), 'utf8')); }
  catch { return; }
  if (!valid(marker.version) || !valid(currentVersion) || !gte(currentVersion, marker.version)) return;
  const cache = join(root, 'download-cache');
  try {
    await checkCacheRoot(root);
    const entry = await lstat(cache);
    if (entry.isSymbolicLink() || !entry.isDirectory() || await redirectedDirectory(resolve(cache))
      || relative(await realpath(root), await realpath(cache)) !== 'download-cache') return;
    await rm(cache, { recursive: true, force: true });
  } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  await rm(join(root, 'installed.json'), { force: true });
}
