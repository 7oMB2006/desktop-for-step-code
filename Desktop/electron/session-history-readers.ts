import { spawn } from 'node:child_process';
import { isolatedEnvironment } from './runtime';
import { MAX_READING_BYTES, assertReadingBudget } from './session-reading-budget';
import type { SessionReading, SessionReadingResult, SessionReadingUnavailable } from '../src/contracts';

export interface HistoryRequest { root: string; profile: string; file: string; sessionId: string; cwd: string }
type Subscriber = { owner: string; revision: number; resolve: (value: SessionReadingResult) => void; timer?: NodeJS.Timeout };
type Job = { key: string; request: HistoryRequest; subscribers: Set<Subscriber>; controller: AbortController };
type Runner = (request: HistoryRequest, signal: AbortSignal) => Promise<Omit<SessionReadingUnavailable, 'sessionId'> | SessionReading>;
const unavailable = (sessionId: string, reason: SessionReadingUnavailable['unavailable']): SessionReadingUnavailable =>
  ({ sessionId, unavailable: reason });

/** One active large reader. Owners include surface, webContents and generation. */
export class SessionHistoryReaders {
  private jobs = new Map<string, Job>();
  private current = new Map<string, { job: Job; subscriber: Subscriber }>();
  private revisions = new Map<string, number>();
  private active?: Job;
  private running?: Promise<void>;
  private closed = false;
  constructor(private run: Runner, private waitMs = 60000, private executionMs = 30000) {}

  read(owner: string, revision: number, request: HistoryRequest, version: string): Promise<SessionReadingResult> {
    if (this.closed || revision <= (this.revisions.get(owner) ?? -1)) return Promise.resolve(null);
    this.cancel(owner);
    this.revisions.set(owner, revision);
    const key = JSON.stringify([request.sessionId, request.file, version]);
    let job = this.jobs.get(key);
    if (!job || job.controller.signal.aborted) {
      job = { key, request, subscribers: new Set(), controller: new AbortController() };
      this.jobs.set(key, job);
    }
    const selected = job;
    return new Promise(resolve => {
      const subscriber: Subscriber = { owner, revision, resolve };
      selected.subscribers.add(subscriber);
      this.current.set(owner, { job: selected, subscriber });
      if (selected !== this.active) subscriber.timer = setTimeout(() => {
        this.release(selected, subscriber, unavailable(request.sessionId, 'queue-timeout'));
      }, this.waitMs);
      this.pump();
    });
  }
  cancel(owner: string, revision?: number) {
    const current = this.current.get(owner);
    if (current && (revision === undefined || current.subscriber.revision === revision))
      this.release(current.job, current.subscriber, null);
  }
  forget(owner: string) { this.cancel(owner); this.revisions.delete(owner); }
  forgetWindow(prefix: string) {
    for (const owner of this.revisions.keys()) if (owner.startsWith(prefix)) this.forget(owner);
  }
  private release(job: Job, subscriber: Subscriber, value: SessionReadingResult) {
    clearTimeout(subscriber.timer);
    job.subscribers.delete(subscriber);
    if (this.current.get(subscriber.owner)?.subscriber === subscriber) this.current.delete(subscriber.owner);
    subscriber.resolve(value);
    if (!job.subscribers.size) {
      job.controller.abort();
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    }
  }
  private pump() {
    if (this.active || this.closed) return;
    const job = this.jobs.values().next().value as Job | undefined;
    if (!job) return;
    this.active = job;
    for (const subscriber of job.subscribers) clearTimeout(subscriber.timer);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; job.controller.abort(); }, this.executionMs);
    this.running = (async () => {
      let result: SessionReadingResult;
      try {
        // Retry one changed source, still under the same deadline/subscriptions.
        let value = await this.run(job.request, job.controller.signal);
        if ('unavailable' in value && value.unavailable === 'changed' && !job.controller.signal.aborted)
          value = await this.run(job.request, job.controller.signal);
        result = 'unavailable' in value ? unavailable(job.request.sessionId, value.unavailable) : value;
        if (timedOut) result = unavailable(job.request.sessionId, 'timeout');
      } catch { result = unavailable(job.request.sessionId, timedOut ? 'timeout' : 'unavailable'); }
      finally { clearTimeout(timer); }
      for (const subscriber of [...job.subscribers]) this.release(job, subscriber, result!);
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      this.active = undefined;
      this.running = undefined;
      this.pump();
    })();
  }
  async close() {
    this.closed = true;
    for (const owner of [...this.current.keys()]) this.cancel(owner);
    await this.running;
    this.revisions.clear();
  }
}

export function historyProcessRunner(node: string, entry: string, storage: string,
  observe: { started?: (pid: number) => void; metrics?: (value: { heapUsed: number; rss: number }) => void } = {}): Runner {
  return (request, signal) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(node, ['--max-old-space-size=256', entry], {
      cwd: storage, env: isolatedEnvironment(storage), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    if (child.pid) observe.started?.(child.pid);
    let bytes = 0, failed = false;
    const abort = () => { failed = true; child.kill(); };
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.stdin.on('error', () => { failed = true; });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_READING_BYTES + 1024) abort();
      else if (!failed) chunks.push(chunk);
    });
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      if (failed || signal.aborted || code !== 0) { reject(new Error('History reader stopped')); return; }
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const value = payload.reading;
        if (!value || typeof value !== 'object') throw new Error('Invalid reading result');
        if (value.unavailable) {
          const allowed = ['changed', 'source-limit', 'future-format', 'response-limit', 'node-limit', 'unavailable'];
          if (!allowed.includes(value.unavailable)) throw new Error('Invalid reading result');
        } else {
          if (value.sessionId !== request.sessionId || !Array.isArray(value.messages) || typeof value.version !== 'string')
            throw new Error('Invalid reading identity');
          assertReadingBudget(value);
        }
        if (Number.isFinite(payload.metrics?.heapUsed) && Number.isFinite(payload.metrics?.rss))
          observe.metrics?.({ heapUsed: payload.metrics.heapUsed, rss: payload.metrics.rss });
        resolve(value);
      } catch { reject(new Error('Invalid reading result')); }
    });
    child.stdin.end(JSON.stringify(request) + '\n');
    if (signal.aborted) abort();
  });
}
