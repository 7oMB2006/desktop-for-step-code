import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { usageDateKey } from '../src/usage-range';
import type { UsageOverview, UsageSample, UsageSource } from '../src/usage-overview';
import { btwUsage, type BtwUsageRecord } from './btw';

const DAY = 86_400_000;
const FILE_LIMIT = 2 * 1024 * 1024;
const SCAN_LIMIT = 32 * 1024 * 1024;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
const modelId = (value: unknown): value is string => typeof value === 'string' && /^[\w./:@+-]{1,160}$/.test(value);
const providerId = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const sourceFor = (provider?: string): UsageSource => provider === 'step' ? 'official' : provider ? 'custom' : 'unknown';

export class BtwUsageLedger {
  private writes = Promise.resolve();
  private failed = false;
  constructor(private root: string, private onError: () => void = () => {}) {}

  record(record: BtwUsageRecord) {
    const id = createHash('sha256').update(JSON.stringify([record.runtimeId, record.sessionId, record.scopeId, record.requestId])).digest('hex');
    const provider = providerId(record.model?.provider) ? record.model.provider : undefined;
    const model = modelId(record.model?.id) ? record.model.id : undefined;
    const raw = btwUsage(record.usage);
    const usage = raw && { input: raw.input, output: raw.output, cacheRead: raw.cacheRead, cacheWrite: raw.cacheWrite };
    const line = `\n${JSON.stringify({ version: 1, id, at: record.at, provider, model, usage })}\n`;
    this.writes = this.writes.then(async () => {
      const path = join(this.root, `${utcDay(record.at)}.jsonl`);
      await mkdir(this.root, { recursive: true });
      const dir = await lstat(this.root);
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Invalid BTW ledger directory');
      await this.checkFile(path);
      const handle = await open(path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size + Buffer.byteLength(line) > FILE_LIMIT) throw new Error('BTW ledger day limit');
        await handle.writeFile(line);
      } finally { await handle.close(); }
    }).catch(() => { this.failed = true; this.onError(); });
  }

  private async checkFile(path: string) {
    try { if (!(await lstat(path)).isFile()) throw new Error('Invalid BTW ledger file'); }
    catch (error) { if (!missing(error)) throw error; }
  }

  flush() { return this.writes; }

  async overview(result: UsageOverview): Promise<UsageOverview> {
    await this.flush();
    const days = new Map(result.days.map(day => [day.date, { ...day, samples: [...day.samples] }]));
    const seen = new Set<string>(), samples = new Map<string, UsageSample>();
    let limited = this.failed, bytes = 0;
    if (!days.size) return result;
    try {
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) return { ...result, btwLimited: true };
    } catch (error) {
      return missing(error) && !limited ? result : { ...result, btwLimited: true };
    }
    // UTC shards include the adjacent days so the current local time zone always owns grouping.
    const dates = [...days.keys()].sort();
    const start = Date.parse(`${dates[0]}T00:00:00Z`) - DAY;
    const end = Date.parse(`${dates.at(-1)}T00:00:00Z`) + DAY;
    for (let at = end; at >= start && at > end - 367 * DAY; at -= DAY) {
      const key = utcDay(at), path = join(this.root, `${key}.jsonl`);
      try {
        await this.checkFile(path);
        const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let text: string;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > FILE_LIMIT || bytes + info.size > SCAN_LIMIT) {
            limited = true;
            continue;
          }
          const buffer = Buffer.alloc(info.size);
          let offset = 0;
          while (offset < buffer.length) {
            const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
            if (!bytesRead) break;
            offset += bytesRead;
          }
          bytes += offset;
          if (offset !== buffer.length) limited = true;
          text = buffer.toString('utf8', 0, offset);
        } finally { await handle.close(); }
        for (const line of text.split('\n')) {
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            const usage = btwUsage(entry?.usage);
            if (entry?.version !== 1 || typeof entry.id !== 'string' || !/^[a-f0-9]{64}$/.test(entry.id)
              || !Number.isSafeInteger(entry.at) || utcDay(entry.at) !== key
              || (entry.provider !== undefined && !providerId(entry.provider))
              || (entry.model !== undefined && !modelId(entry.model))
              || (entry.usage !== undefined && !usage)) throw new Error('Invalid BTW ledger entry');
            const time = new Date(entry.at), day = days.get(usageDateKey(time));
            if (!day || seen.has(entry.id)) continue;
            const source = sourceFor(entry.provider);
            const total = usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : 0;
            if (!Number.isSafeInteger(day.official + day.custom + day.unknown + total)) throw new Error('BTW token overflow');
            seen.add(entry.id);
            const counts = (day.btw ??= {})[source] ??= { tokens: 0, unreported: 0 };
            if (!usage) { counts.unreported++; continue; }
            counts.tokens += total;
            day[source] += total;
            const model = entry.model ?? '\u672a\u8bb0\u5f55\u6a21\u578b', hour = time.getHours();
            const sampleKey = JSON.stringify([day.date, source, model, hour]);
            let sample = samples.get(sampleKey);
            if (!sample) {
              sample = { source, model, hour, input: 0, output: 0, cached: 0, written: 0, total: 0 };
              samples.set(sampleKey, sample);
              day.samples.push(sample);
            }
            sample.input += usage.input;
            sample.output += usage.output;
            sample.cached += usage.cacheRead;
            sample.written += usage.cacheWrite;
            sample.total += total;
          } catch { limited = true; }
        }
      } catch (error) { if (!missing(error)) limited = true; }
    }
    return { ...result, days: [...days.values()], btwLimited: limited };
  }
}
