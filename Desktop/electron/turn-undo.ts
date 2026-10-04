import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { applyPatch, parsePatch, reversePatch } from 'diff';
import { turnChanges } from '../src/turn-changes';
import type { IndexedMessage } from '../src/conversation-presentation';
import type { TurnUndoState } from '../src/contracts';

const MAX_FILE = 1024 * 1024;
const MAX_TOTAL = 8 * MAX_FILE;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type FileRecord = { path: string; before: string; afterHash: string };
type Record = { key: string; root: string; state: 'available' | 'undone' | 'failed'; files: FileRecord[] };

function identity(session: string, items: IndexedMessage[]) {
  const changes = turnChanges(items);
  const ids = changes.files.flatMap(file => file.edits.map(edit => edit.id));
  const patches = items.filter(item => ids.includes(item.message.toolCallId ?? '')).map(item => item.message.details?.patch);
  return { changes, key: digest(JSON.stringify([session, ids, patches])) };
}

// Do not allow jsdiff to relocate a hunk to another matching region.
export function reverseExact(source: string, patch: string): string {
  const parsed = parsePatch(patch);
  if (parsed.length !== 1) throw new Error('Invalid patch');
  const reversed = reversePatch(parsed[0]);
  const lines = source.split('\n');
  for (const hunk of reversed.hunks) {
    let index = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
    for (const line of hunk.lines) {
      if (line[0] === ' ' || line[0] === '-') {
        if (lines[index++] !== line.slice(1)) throw new Error('Patch no longer matches its recorded position');
      }
    }
  }
  const before = applyPatch(source, reversed, { fuzzFactor: 0, autoConvertLineEndings: false });
  if (before === false) throw new Error('Patch cannot be reversed');
  return before;
}

async function guardedPath(root: string, path: string) {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).some(p => p.toLowerCase() === '.git'))
    throw new Error('File is outside the permitted workspace');
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('Linked paths cannot be undone');
  }
  const info = await lstat(target);
  if (!info.isFile() || info.nlink !== 1 || info.size > MAX_FILE) throw new Error('File is not eligible for undo');
  if (resolve(await realpath(target)).toLowerCase() !== target.toLowerCase()) throw new Error('File path changed');
  return target;
}

export class TurnUndoStore {
  private tickets = new Map<string, { key: string; expires: number }>();
  private locked = false;
  constructor(private directory: string) {}
  private path(key: string) { return join(this.directory, `${key}.json`); }
  private async save(record: Record) {
    await mkdir(this.directory, { recursive: true });
    const temp = join(this.directory, `${record.key}-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    await rename(temp, this.path(record.key));
  }
  private async load(key: string): Promise<Record | undefined> {
    try {
      const data = await readFile(this.path(key));
      if (data.length > MAX_TOTAL * 2) return;
      const record = JSON.parse(data.toString('utf8')) as Record;
      if (record.key !== key || !Array.isArray(record.files) || record.files.length > 32 ||
        typeof record.root !== 'string' || !['available', 'undone', 'failed'].includes(record.state) ||
        record.files.some(file => typeof file.path !== 'string' || typeof file.before !== 'string' || typeof file.afterHash !== 'string')) return;
      return record;
    } catch { return; }
  }
  async capture(session: string, cwd: string, items: IndexedMessage[]) {
    const { changes, key } = identity(session, items);
    if (!changes.files.length || changes.files.length > 32 || await this.load(key)) return;
    const root = await realpath(cwd);
    const files: FileRecord[] = [];
    let total = 0;
    for (const file of changes.files) {
      const path = await guardedPath(root, file.path);
      const after = await readFile(path);
      const source = after.toString('utf8');
      if (!Buffer.from(source).equals(after) || source.includes('\0')) throw new Error('Only UTF-8 text files can be undone');
      let before = source;
      for (const edit of [...file.edits].reverse()) {
        const patch = items.find(item => item.message.toolCallId === edit.id)?.message.details?.patch;
        if (!patch) throw new Error('Missing patch');
        before = reverseExact(before, patch);
      }
      total += Buffer.byteLength(before) + after.length;
      if (total > MAX_TOTAL) throw new Error('Undo record is too large');
      if (Buffer.byteLength(before) > MAX_FILE) throw new Error('Undo result is too large');
      files.push({ path: file.path, before, afterHash: digest(after) });
    }
    await this.save({ key, root, state: 'available', files });
  }
  private async checked(session: string, cwd: string, items: IndexedMessage[]) {
    const { key, changes } = identity(session, items);
    const record = await this.load(key);
    if (!record || record.root.toLowerCase() !== (await realpath(cwd)).toLowerCase() ||
      JSON.stringify(record.files.map(file => file.path)) !== JSON.stringify(changes.files.map(file => file.path))) return;
    return record;
  }
  async status(session: string, cwd: string, items: IndexedMessage[]): Promise<TurnUndoState> {
    const record = await this.checked(session, cwd, items);
    if (!record) return { state: 'unavailable' };
    if (record.state !== 'available') return { state: record.state };
    try {
      for (const file of record.files) {
        const path = await guardedPath(record.root, file.path);
        if (digest(await readFile(path)) !== file.afterHash) return { state: 'conflict' };
      }
    } catch { return { state: 'conflict' }; }
    return { state: 'available' };
  }
  async prepare(session: string, cwd: string, items: IndexedMessage[]) {
    const status = await this.status(session, cwd, items);
    if (status.state !== 'available') return status;
    const { key } = identity(session, items);
    const token = randomUUID();
    for (const [id, ticket] of this.tickets) if (ticket.expires < Date.now()) this.tickets.delete(id);
    this.tickets.set(token, { key, expires: Date.now() + 120000 });
    return { ...status, token };
  }
  async undo(session: string, cwd: string, items: IndexedMessage[], token: string): Promise<TurnUndoState> {
    const { key } = identity(session, items);
    const ticket = this.tickets.get(token);
    this.tickets.delete(token);
    if (!ticket || ticket.key !== key || ticket.expires < Date.now()) throw new Error('Undo confirmation expired');
    if (this.locked) throw new Error('Another undo is in progress');
    this.locked = true;
    const handles: Awaited<ReturnType<typeof open>>[] = [];
    try {
      const status = await this.status(session, cwd, items);
      if (status.state !== 'available') return status;
      const record = (await this.checked(session, cwd, items))!;
      for (const file of record.files) {
        const path = await guardedPath(record.root, file.path);
        const handle = await open(path, 'r+');
        handles.push(handle);
        const info = await handle.stat();
        const pathInfo = await lstat(path);
        if (info.ino !== pathInfo.ino || info.dev !== pathInfo.dev || info.nlink !== 1 || info.size > MAX_FILE ||
          digest(await handle.readFile()) !== file.afterHash) return { state: 'conflict' };
      }
      // A durable recovery record precedes every write. A partial I/O failure is
      // not auto-rolled-back, because that could overwrite an external edit.
      record.state = 'failed';
      await this.save(record);
      for (const [index, file] of record.files.entries()) {
        const handle = handles[index];
        const path = await guardedPath(record.root, file.path);
        const pathInfo = await lstat(path); const info = await handle.stat();
        const current = Buffer.alloc(info.size);
        await handle.read(current, 0, current.length, 0);
        if (pathInfo.ino !== info.ino || pathInfo.dev !== info.dev || digest(current) !== file.afterHash)
          throw new Error('File changed during undo; recovery records retained');
        const bytes = Buffer.from(file.before);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
          if (!bytesWritten) throw new Error('File write failed');
          offset += bytesWritten;
        }
        await handle.truncate(bytes.length);
        await handle.sync();
      }
      record.state = 'undone';
      await this.save(record);
      return { state: 'undone' };
    } finally {
      await Promise.all(handles.map(handle => handle.close()));
      this.locked = false;
    }
  }
}
