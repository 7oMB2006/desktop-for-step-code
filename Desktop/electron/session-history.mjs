import { open, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_HISTORY_PREVIEW_BYTES = 12 * 1024 * 1024;

// The upstream open/load helpers may migrate or repair files. Preview only reads
// bytes and uses the upstream in-memory migration and context projection.
export async function readSessionHistory(upstream, root, file, sessionId) {
  if (!root || typeof file !== 'string' || typeof sessionId !== 'string') throw new Error('Invalid history request');
  const [directory, canonical] = await Promise.all([realpath(root), realpath(file)]);
  const rel = relative(directory, canonical);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'))
    throw new Error('History is outside Desktop storage');
  const handle = await open(canonical, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_HISTORY_PREVIEW_BYTES) return null;
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return null;
    const bytes = buffer.subarray(0, length);
    const values = upstream.parseSessionEntries(bytes.toString('utf8'));
    const header = values[0];
    if (header?.type !== 'session' || header.id !== sessionId || typeof header.cwd !== 'string')
      throw new Error('History identity changed');
    if (header.version > upstream.CURRENT_SESSION_VERSION) return null;
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
      sessionId, cwd: header.cwd, entries, leafId,
      version: createHash('sha256').update(bytes).digest('hex'),
      messages: upstream.buildSessionContext(entries, leafId, byId).messages,
    };
    // Projection can expand escaped tool payloads; never overflow the shared
    // management transport's 32 MiB frame and disconnect unrelated requests.
    return JSON.stringify(result).length <= 24 * 1024 * 1024 ? result : null;
  } finally { await handle.close(); }
}
