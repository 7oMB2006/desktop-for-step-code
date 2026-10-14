import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, rm, stat, mkdir, readdir } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { gte, valid } from 'semver';
import { InstallerFailure } from './update-installer';

export async function prepareUpdateCache(root: string) {
  await mkdir(root, { recursive: true });
  const rootEntry = await lstat(root);
  if (rootEntry.isSymbolicLink() || resolve(await realpath(root)) !== resolve(root)) throw new InstallerFailure('integrity');
  const cache = join(root, 'download-cache');
  await mkdir(cache, { recursive: true });
  const pending = [cache];
  let inspected = 0;
  while (pending.length) {
    const path = pending.pop()!;
    const entry = await lstat(path);
    if (++inspected > 256 || entry.isSymbolicLink()) throw new InstallerFailure('integrity');
    if (entry.isDirectory()) for (const child of await readdir(path)) pending.push(join(path, child));
  }
}
export async function verifyInstallerFile(file: string, root: string, size: number, sha512: string) {
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
    const entry = await lstat(cache);
    if (entry.isSymbolicLink() || !entry.isDirectory() || resolve(await realpath(cache)) !== resolve(cache)) return;
    await rm(cache, { recursive: true, force: true });
  } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  await rm(join(root, 'installed.json'), { force: true });
}
