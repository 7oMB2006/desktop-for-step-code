import { lstat, realpath, unlink } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Session } from '../src/contracts';

export function archivedDeletionTargets(ids: unknown, sessions: Session[], archivedIds: string[]): Session[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000 ||
      ids.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid archived session selection');
  }
  const archived = new Set(archivedIds);
  const known = new Map(sessions.map(session => [session.id, session]));
  return ids.map(id => {
    const session = known.get(id);
    if (!session || !archived.has(id)) throw new Error('Only known archived sessions can be permanently deleted');
    return session;
  });
}

export async function managedSessionFile(root: string, path: string): Promise<string> {
  if (!path || extname(path).toLowerCase() !== '.jsonl') throw new Error('Invalid session file');
  const canonicalRoot = await realpath(root);
  const file = resolve(path);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid session file');
  const canonicalFile = await realpath(file);
  const inside = relative(canonicalRoot, canonicalFile);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error('Session file is outside the Desktop profile');
  }
  return canonicalFile;
}

export async function deleteManagedSessionFile(root: string, path: string) {
  // Recheck at deletion, and unlink one file only. Never remove a project directory.
  await unlink(await managedSessionFile(root, path));
}
