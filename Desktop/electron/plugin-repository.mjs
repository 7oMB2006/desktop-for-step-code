import { optionalFile, writePrivateJson, object } from './plugin-files.mjs';

export class PluginRepositoryInfo {
  cache = new Map();
  pending = new Map();
  active = 0;
  waiters = [];
  save = Promise.resolve();
  constructor(root, options = {}) {
    this.root = root;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.ready = this.load();
  }
  async load() {
    try {
      const bytes = await optionalFile(this.root, 'desktop-plugins/repositories.json', 1024 * 1024);
      const entries = bytes && JSON.parse(bytes.toString('utf8'));
      if (Array.isArray(entries)) for (const row of entries.slice(-1000)) {
        if (!Array.isArray(row) || row.length !== 2) continue;
        const [key, value] = row;
        if (typeof key === 'string' && /^[\w.-]+\/[\w.-]+$/u.test(key) && object(value)
          && (value.count === undefined || Number.isSafeInteger(value.count) && value.count >= 0
            && Number.isFinite(Date.parse(value.checkedAt))) && Number.isFinite(value.attempted)) this.cache.set(key, value);
      }
    } catch {}
  }
  key(repository) {
    if (typeof repository !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u.test(repository))
      throw new Error('capability:invalid-input');
    return new URL(repository).pathname.slice(1).toLowerCase();
  }
  async snapshot(repository) {
    await this.ready;
    const value = this.cache.get(this.key(repository));
    if (value?.count !== undefined) return { count: value.count, checkedAt: value.checkedAt,
      status: value.failed || this.now() - Date.parse(value.checkedAt) >= 6 * 3600000 ? 'stale' : 'fresh' };
    return { status: value?.limited ? 'limited' : value?.failed ? 'unavailable' : 'unknown' };
  }
  async refresh(repository) {
    await this.ready;
    const key = this.key(repository), value = this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    if (value && (this.now() - value.attempted < 60000
      || !value.failed && this.now() - Date.parse(value.checkedAt) < 6 * 3600000)) return this.snapshot(repository);
    const operation = this.query(key).then(() => this.snapshot(repository)).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
  async query(key) {
    if (this.active >= 2) await new Promise(resolve => this.waiters.push(resolve));
    else this.active++;
    const previous = this.cache.get(key);
    let next = { ...previous, attempted: this.now(), failed: true };
    try {
      const response = await this.fetch(`https://api.github.com/repos/${key}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DFSC-plugin-center' },
        redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        next.limited = [403, 429].includes(response.status);
        await response.body?.cancel();
      } else {
        const reader = response.body?.getReader(), chunks = [];
        let size = 0;
        if (!reader) throw new Error('Empty response');
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            size += result.value.byteLength;
            if (size > 256 * 1024) throw new Error('Response too large');
            chunks.push(Buffer.from(result.value));
          }
        } finally { await reader.cancel(); }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Number.isSafeInteger(parsed.stargazers_count) || parsed.stargazers_count < 0) throw new Error('Invalid count');
        next = { count: parsed.stargazers_count, checkedAt: new Date(this.now()).toISOString(), attempted: this.now(), failed: false };
      }
    } catch {} finally {
      const next = this.waiters.shift();
      if (next) next(); else this.active--;
    }
    this.cache.set(key, next);
    while (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value);
    this.save = this.save.catch(() => {}).then(() => writePrivateJson(this.root, 'repositories.json', [...this.cache]));
    // An unavailable disk cache must not block plugin use or discard a valid in-memory snapshot.
    await this.save.catch(() => {});
  }
}
