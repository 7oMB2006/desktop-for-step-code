import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { localReference, artifactKind } from '../src/turn-artifacts';
import type { ArtifactFile } from '../src/contracts';

export async function artifactFile(cwd: string, value: unknown): Promise<ArtifactFile> {
  if (typeof value !== 'string') throw new Error('Invalid file reference');
  let reference = localReference(value);
  if (!reference || reference.startsWith('\\\\')) throw new Error('Invalid file reference');
  // Windows tool records can use Git Bash drive paths, not Windows root-relative paths.
  if (process.platform === 'win32') reference = reference.replace(/^\/([a-z])\//i, '$1:/');
  const lexicalRoot = resolve(cwd);
  const root = await realpath(lexicalRoot);
  const path = resolve(lexicalRoot, reference);
  const inside = (base: string, target: string) => { const part = relative(base, target); return part !== '..' && !part.startsWith(`..\\`) && !part.startsWith('../') && !isAbsolute(part); };
  if (!inside(lexicalRoot, path) && !inside(root, path)) throw new Error('File is outside this session workspace');
  try {
    const canonical = await realpath(path);
    if (!inside(root, canonical)) throw new Error('File points outside this session workspace');
    const info = await stat(canonical);
    if (!info.isFile()) throw new Error('Not a regular file');
    const ext = extname(canonical).toLowerCase();
    const safe = ['.html', '.htm', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.md', '.txt', '.wav', '.mp3', '.ogg', '.flac', '.mp4', '.webm', '.mov'].includes(ext);
    return { path: canonical, exists: true, size: info.size, canOpen: safe, kind: artifactKind(canonical) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, exists: false, canOpen: false, kind: artifactKind(path) };
    throw error;
  }
}
