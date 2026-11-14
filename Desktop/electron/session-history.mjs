import { open, realpath, stat } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_HISTORY_PREVIEW_BYTES = 12 * 1024 * 1024;
export const MAX_HISTORY_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_HISTORY_RESPONSE_BYTES = 24 * 1024 * 1024;

export class HistoryReadError extends Error {
  constructor(reason) { super(`history:${reason}`); this.reason = reason; }
}
const identity = value => ({
  dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs,
});
const sameFile = (a, b) => Object.keys(a).every(key => a[key] === b[key]);
export async function assertHistoryUnchanged(root, file, source) {
  const [directory, canonical] = await Promise.all([realpath(root), realpath(file)]);
  if (directory !== source.directory || canonical !== source.canonical
    || !sameFile(source.identity, identity(await stat(canonical)))) throw new HistoryReadError('changed');
}

// The upstream open/load helpers may migrate or repair files. Preview only reads
// bytes and uses the upstream in-memory migration and context projection.
export async function readHistorySource(upstream, root, file, sessionId, maxBytes = MAX_HISTORY_SOURCE_BYTES) {
  if (!root || typeof file !== 'string' || typeof sessionId !== 'string') throw new Error('Invalid history request');
  const [directory, canonical] = await Promise.all([realpath(root), realpath(file)]);
  const rel = relative(directory, canonical);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'))
    throw new Error('History is outside Desktop storage');
  const handle = await open(canonical, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new HistoryReadError('unavailable');
    if (before.size > Math.min(maxBytes, MAX_HISTORY_SOURCE_BYTES)) throw new HistoryReadError('source-limit');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || !sameFile(identity(before), identity(after))) throw new HistoryReadError('changed');
    const source = { directory, canonical, identity: identity(before) };
    await assertHistoryUnchanged(root, file, source);
    const bytes = buffer.subarray(0, length);
    const values = upstream.parseSessionEntries(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const header = values[0];
    if (header?.type !== 'session' || header.id !== sessionId || typeof header.cwd !== 'string')
      throw new Error('History identity changed');
    if (header.version > upstream.CURRENT_SESSION_VERSION) throw new HistoryReadError('future-format');
    upstream.migrateSessionEntries(values);
    const entries = values.filter(value => value.type !== 'session');
    const byId = new Map();
    for (const entry of entries) {
      if (typeof entry.id !== 'string' || byId.has(entry.id)) throw new Error('Invalid history identity');
      byId.set(entry.id, entry);
    }
    const leafId = entries.at(-1)?.id ?? null;
    const visited = new Set();
    for (let id = leafId; id;) {
      if (visited.has(id) || !byId.has(id)) throw new Error('Invalid history branch');
      visited.add(id);
      id = byId.get(id).parentId;
    }
    const result = {
      sessionId, cwd: header.cwd, entries, leafId, source,
      version: createHash('sha256').update(bytes).digest('hex'),
      messages: upstream.buildSessionContext(entries, leafId, byId).messages,
    };
    return result;
  } finally { await handle.close(); }
}

// Preserve the existing small-history management/search API. Larger projections
// must use the isolated reader, never expand the shared management frame.
export async function readSessionHistory(upstream, root, file, sessionId, maxBytes = MAX_HISTORY_PREVIEW_BYTES) {
  try {
    const { source, ...result } = await readHistorySource(upstream, root, file, sessionId,
      Math.min(maxBytes, MAX_HISTORY_PREVIEW_BYTES));
    await assertHistoryUnchanged(root, file, source);
    return Buffer.byteLength(JSON.stringify(result), 'utf8') <= MAX_HISTORY_RESPONSE_BYTES ? result : null;
  } catch (error) {
    if (error instanceof HistoryReadError) return null;
    throw error;
  }
}
