import { open, type Entry, type ZipFile } from 'yauzl';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdir, symlink, realpath, chmod } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, posix } from 'node:path';
import { InstallerFailure } from './update-installer';

const APP = 'Desktop for Step Code.app';
export function archivePath(name: string) {
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').includes('..')
    || name.split('/').includes('.') || name.normalize('NFC') !== name) throw new InstallerFailure('integrity');
  if (name.startsWith('__MACOSX/')) return undefined;
  if (name !== APP && !name.startsWith(`${APP}/`)) throw new InstallerFailure('integrity');
  return name;
}
export async function extractMacUpdate(file: string, destination: string, signal: AbortSignal) {
  const zip = await new Promise<ZipFile>((done, fail) => open(file, { lazyEntries: true, strictFileNames: true }, (error, value) => error ? fail(error) : done(value!)));
  const links: { path: string; target: string }[] = [];
  const seen = new Set<string>(); let bytes = 0; let count = 0;
  await mkdir(destination, { recursive: false, mode: 0o700 });
  try {
    await new Promise<void>((done, fail) => {
      const abort = () => { zip.close(); fail(signal.reason ?? new Error('Cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      const finish = (error?: unknown) => { signal.removeEventListener('abort', abort); error ? fail(error) : done(); };
      zip.on('error', finish); zip.on('end', () => finish());
      zip.on('entry', async (entry: Entry) => {
        try {
          signal.throwIfAborted();
          if (++count > 100000 || (bytes += entry.uncompressedSize) > 8 * 1024 ** 3) throw new InstallerFailure('integrity');
          const name = archivePath(entry.fileName);
          if (!name) { zip.readEntry(); return; }
          const key = name.replace(/\/$/, '').toLocaleLowerCase('en-US');
          if (seen.has(key)) throw new InstallerFailure('integrity');
          seen.add(key);
          const path = join(destination, name);
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const kind = mode & 0o170000;
          if (kind && ![0o040000, 0o100000, 0o120000].includes(kind)) throw new InstallerFailure('integrity');
          if (kind === 0o120000 && name.endsWith('/')) throw new InstallerFailure('integrity');
          if (name.endsWith('/')) { await mkdir(path, { recursive: true, mode: 0o755 }); zip.readEntry(); return; }
          if (entry.uncompressedSize > 1024 ** 3 || kind === 0o120000 && entry.uncompressedSize > 4096) throw new InstallerFailure('integrity');
          const stream = await new Promise<NodeJS.ReadableStream>((done, fail) => zip.openReadStream(entry, (error, value) => error ? fail(error) : done(value!)));
          if (kind === 0o120000) {
            const chunks: Buffer[] = []; let length = 0;
            for await (const chunk of stream as any) { signal.throwIfAborted(); length += chunk.length; if (length > 4096) throw new InstallerFailure('integrity'); chunks.push(chunk); }
            if (length !== entry.uncompressedSize) throw new InstallerFailure('integrity');
            const target = Buffer.concat(chunks).toString('utf8');
            const resolved = posix.normalize(posix.join(posix.dirname(name), target));
            if (!target || target.includes('\0') || target.includes('\\') || isAbsolute(target) || !resolved.startsWith(`${APP}/`)) throw new InstallerFailure('integrity');
            links.push({ path, target });
          } else {
            await mkdir(dirname(path), { recursive: true, mode: 0o755 });
            await pipeline(stream as any, createWriteStream(path, { flags: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 }), { signal });
          }
          zip.readEntry();
        } catch (error) { zip.close(); finish(error); }
      });
      if (signal.aborted) abort(); else zip.readEntry();
    });
    // Create links only after regular files: extraction can never follow an archive link.
    for (const link of links) { await mkdir(dirname(link.path), { recursive: true }); await symlink(link.target, link.path); }
    const root = await realpath(join(destination, APP));
    for (const link of links) {
      const offset = relative(root, await realpath(link.path));
      if (offset.startsWith('..') || isAbsolute(offset)) throw new InstallerFailure('integrity');
    }
    await chmod(root, 0o755);
    return root;
  } finally { zip.close(); }
}
