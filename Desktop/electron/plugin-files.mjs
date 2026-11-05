import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class PluginFileError extends Error {
  constructor(code) { super(`capability:${code}`); this.code = code; }
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function packagePath(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[:\\\0?#]/u.test(value)
    || isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..'))
    throw new PluginFileError('invalid-path');
  return value;
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
export async function plainFile(root, path, limit = 65536) {
  const base = resolve(root), target = resolve(base, packagePath(path));
  const canonicalBase = await realpath(base);
  if (resolve(canonicalBase) !== base) throw new PluginFileError('invalid-path');
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new PluginFileError('invalid-path');
  let current = base;
  if (!(await lstat(base)).isDirectory() || (await lstat(base)).isSymbolicLink()) throw new PluginFileError('invalid-path');
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new PluginFileError('invalid-path');
  }
  const before = await lstat(target);
  const canonical = await realpath(target);
  if (resolve(canonical) !== target || !before.isFile() || before.size > limit) throw new PluginFileError('too-large');
  const handle = await open(target, 'r');
  try {
    if (!same(before, await handle.stat())) throw new PluginFileError('stale');
    const bytes = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== before.size || !same(before, await handle.stat())
      || !same(before, await lstat(target)) || await realpath(target) !== canonical
      || await realpath(base) !== canonicalBase) throw new PluginFileError('stale');
    // Recheck ancestors after reading, including junction swaps on Windows.
    current = base;
    if ((await lstat(current)).isSymbolicLink()) throw new PluginFileError('invalid-path');
    for (const part of rel.split(sep)) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new PluginFileError('invalid-path');
    }
    return bytes.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
export async function optionalFile(root, path, limit) {
  try { return await plainFile(root, path, limit); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
export async function packageFingerprint(root) {
  const hash = createHash('sha256');
  let files = 0, bytes = 0;
  async function visit(path = '') {
    const directory = path ? join(root, path) : root;
    if ((await lstat(directory)).isSymbolicLink()) throw new PluginFileError('invalid-path');
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++files > 10000) throw new PluginFileError('too-large');
      const child = path ? `${path}/${entry.name}` : entry.name;
      packagePath(child);
      if (entry.isSymbolicLink()) throw new PluginFileError('invalid-path');
      if (entry.isDirectory()) await visit(child);
      else {
        const content = await plainFile(root, child, 128 * 1024 * 1024);
        bytes += content.length;
        if (bytes > 128 * 1024 * 1024) throw new PluginFileError('too-large');
        hash.update(JSON.stringify([child, content.length])).update(content);
      }
    }
  }
  await visit();
  return hash.digest('hex');
}
export async function scanInstalled(root) {
  const directory = join(root, 'plugins'), entries = [];
  try {
    if ((await lstat(directory)).isSymbolicLink()) throw new PluginFileError('invalid-path');
    const children = await readdir(directory, { withFileTypes: true });
    if (children.length > 1000) throw new PluginFileError('too-large');
    for (const item of children) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      if (item.isSymbolicLink()) throw new PluginFileError('invalid-path');
      try {
        const manifest = JSON.parse((await plainFile(join(directory, item.name), 'step.plugin.json', 512 * 1024)).toString('utf8'));
        const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
        if (/^[a-z0-9][a-z0-9._-]*$/iu.test(id)) entries.push({ folder: item.name, id });
      } catch (error) { if (error instanceof PluginFileError) throw error; }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return entries;
}
export async function readReceipts(root) {
  const bytes = await optionalFile(root, 'desktop-plugins/installations.json', 1024 * 1024);
  if (!bytes) return { version: 1, installations: [] };
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new PluginFileError('storage'); }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.installations) || value.installations.length > 1000
    || value.installations.some(item => !object(item) || typeof item.instance !== 'string'
      || !/^[a-f0-9-]{36}$/u.test(item.instance) || typeof item.id !== 'string'
      || typeof item.source !== 'string' || typeof item.marketplace !== 'string'
      || !['pending', 'installed', 'removing'].includes(item.state)
      || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(item.fingerprint)
      || typeof item.folder !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u.test(item.folder)))
    throw new PluginFileError('storage');
  if (new Set(value.installations.map(item => item.instance)).size !== value.installations.length
    || new Set(value.installations.map(item => item.folder.toLowerCase())).size !== value.installations.length)
    throw new PluginFileError('storage');
  return value;
}
export async function writeReceipts(root, value) {
  return writePrivateJson(root, 'installations.json', value);
}
export async function writePrivateJson(root, filename, value) {
  if (!/^[a-z-]+\.json$/u.test(filename)) throw new PluginFileError('invalid-path');
  return writePrivateData(root, `desktop-plugins/${filename}`, value);
}
export async function writePrivateData(root, path, value) {
  packagePath(path);
  if (!path.startsWith('desktop-plugins/')) throw new PluginFileError('invalid-path');
  const directory = dirname(join(root, path));
  let current = resolve(root);
  const directories = [];
  const remember = async target => {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory() || resolve(await realpath(target)) !== target)
      throw new PluginFileError('invalid-path');
    directories.push({ target, info });
  };
  await remember(current);
  for (const part of relative(current, directory).split(sep)) {
    current = join(current, part);
    try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await remember(current);
  }
  const temporary = `${relative(root, directory).split(sep).join('/')}/${randomUUID()}.tmp`;
  const temporaryPath = join(root, temporary), destination = join(root, path);
  const handle = await open(temporaryPath, 'wx', 0o600);
  let identity;
  let committed = false;
  const assertOwned = async target => {
    for (const { target, info } of directories) {
      const now = await lstat(target);
      if (now.isSymbolicLink() || !now.isDirectory() || now.dev !== info.dev || now.ino !== info.ino
        || resolve(await realpath(target)) !== target) throw new PluginFileError('stale');
    }
    const actual = await handle.stat();
    if (!actual.isFile() || identity.dev !== actual.dev || identity.ino !== actual.ino
      || !same(actual, await lstat(target)) || resolve(await realpath(target)) !== target)
      throw new PluginFileError('stale');
  };
  try {
    // wx rejects an existing leaf, not a replaced parent. Check the opened handle
    // before writing secrets, and keep it available to erase any failed snapshot.
    identity = await handle.stat();
    await assertOwned(temporaryPath);
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
    await assertOwned(temporaryPath);
    await optionalFile(root, path, 1024 * 1024);
    await assertOwned(temporaryPath);
    await rename(temporaryPath, destination);
    await assertOwned(destination);
    committed = true;
  } finally {
    try {
      if (!committed) { await handle.truncate(0); await handle.sync(); }
    } finally {
      try { await handle.close(); }
      finally { await rm(temporaryPath, { force: true }); }
    }
  }
}
export function sourceIdentity(source) {
  // Local paths stay inside the private receipt; only their digest crosses IPC.
  return source.desktopIdentity ?? digest(JSON.stringify([source.kind, source.origin ?? resolve(source.path)]));
}
export function installationReceipt(entry, source, manifest, fingerprint) {
  return { instance: randomUUID(), folder: entry.name, id: manifest.id, source: sourceIdentity(source),
    marketplace: source.name, fingerprint, state: 'pending' };
}
