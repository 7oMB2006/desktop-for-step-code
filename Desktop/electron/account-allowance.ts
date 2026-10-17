import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import type { AccountAllowance, AllowanceIssue } from '../src/account-allowance';

// Schema 1 follows Step Code's step/usage/account.ts at b5dbed938d9.
// Only the display projection crosses IPC; Credit quantities and credentials do not.
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid quota');
  return value as Record<string, any>;
}
function decimal(value: unknown, positive = false): string {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value) || BigInt(value) > 9223372036854775807n
    || (positive && BigInt(value) === 0n)) throw new Error('Invalid quota');
  return value;
}
function time(value: unknown): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 8640000000000000) throw new Error('Invalid quota');
  return value;
}
function percent(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('Invalid quota');
  return value;
}
function label(value: unknown): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'string' || value.length > 1024) throw new Error('Invalid quota');
  return stripVTControlCharacters(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').slice(0, 256).trim() || undefined;
}
export function decodeAccountAllowance(value: unknown, uid: string | undefined, now: number): AccountAllowance {
  const raw = record(value), plan = record(raw.plan), quota = record(raw.quota);
  const accountId = decimal(record(raw.account).id, true);
  if (uid && BigInt(uid) !== BigInt(accountId)) throw new Error('identity');
  const observedAt = time(raw.observed_at_ms);
  if (raw.schema_version !== 1 || raw.scope !== 'personal_account' || !observedAt || observedAt > now + 120000
    || observedAt <= now - 300000 || !['known', 'unavailable'].includes(plan.state)
    || !['coding', 'token', 'none'].includes(plan.family) || !['known', 'partial'].includes(quota.state)
    || typeof quota.allowed !== 'boolean' || !Array.isArray(quota.windows) || quota.windows.length > 2) throw new Error('Invalid quota');
  const name = label(plan.name);
  label(quota.reason);
  let expiresAt: number | undefined;
  if (plan.subscription !== null) {
    const subscription = record(plan.subscription);
    decimal(subscription.id, true);
    expiresAt = time(subscription.expires_at_ms);
  }
  if ((plan.state === 'unavailable' && (plan.name !== null || plan.subscription !== null))
    || (plan.family === 'none' && (plan.subscription !== null || quota.allowed))) throw new Error('Invalid quota');
  const meters: AccountAllowance['meters'] = quota.windows.map((item: unknown) => {
    const w = record(item);
    if (!['five_hour', 'weekly'].includes(w.id) || typeof w.limited !== 'boolean') throw new Error('Invalid quota');
    const used = percent(w.used_percent);
    if ((w.limited && used === null) || (!w.limited && used !== null)) throw new Error('Invalid quota');
    return { kind: w.id, remainingPercent: used === null ? null : 100 - used, unlimited: !w.limited, resetsAt: time(w.resets_at_ms) };
  });
  if ((plan.family === 'coding' && (meters.length !== 2 || new Set(meters.map(m => m.kind)).size !== 2))
    || (plan.family !== 'coding' && meters.length) || (quota.state === 'partial' && plan.family !== 'token')) throw new Error('Invalid quota');
  if (quota.credit_buckets === null) {
    if (quota.state !== 'partial') throw new Error('Invalid quota');
  } else {
    if (!Array.isArray(quota.credit_buckets) || quota.credit_buckets.length > 256 || quota.state !== 'known'
      || (plan.family !== 'token' && quota.credit_buckets.length)) throw new Error('Invalid quota');
    for (const item of quota.credit_buckets) {
      const b = record(item);
      if (typeof b.type !== 'string' || b.type.length > 128) throw new Error('Invalid quota');
      if (!['subscription', 'topup'].includes(b.type)) {
        meters.push({ kind: 'unsupported', remainingPercent: null });
        continue;
      }
      const total = decimal(b.total);
      decimal(b.remaining);
      const used = percent(b.used_percent);
      meters.push({ kind: b.type as 'subscription' | 'topup', remainingPercent: used === null || BigInt(total) === 0n ? null : 100 - used,
        resetsAt: time(b.resets_at_ms), expiresAt: time(b.expires_at_ms) });
    }
  }
  return {
    status: 'ready', issue: quota.state === 'partial' ? 'partial' : undefined,
    plan: { state: plan.state, family: plan.family, name, expiresAt }, meters, fetchedAt: now,
    expiresAt: Math.min(now + 300000, observedAt + 300000),
  };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Invalid quota');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 262144) throw new Error('Invalid quota');
      text += decoder.decode(item.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export class AccountAllowanceService {
  private state: AccountAllowance = { status: 'idle', meters: [] };
  private identity = '';
  private generation = 0;
  private abort?: AbortController;
  private pending?: Promise<AccountAllowance>;
  private receivedTick = -Infinity;
  private retryTick = -Infinity;
  constructor(
    private readonly auth: () => Record<string, unknown>,
    private readonly fetcher: typeof fetch,
    private readonly clock = Date.now,
    private readonly tick = () => performance.now(),
    private readonly timeout = 12000,
    private readonly refreshCredential?: (signal: AbortSignal) => Promise<void>,
  ) {}
  private context() {
    const stored = this.auth().step as Record<string, unknown> | undefined;
    const key = stored?.type === 'oauth' && typeof stored.access === 'string' ? stored.access.trim() : '';
    const profile = typeof stored?.profile === 'string' && stored.profile ? stored.profile : 'step_plan';
    const uid = typeof stored?.uid === 'string' && /^\d+$/.test(stored.uid) ? stored.uid : undefined;
    const host = profile === 'step_plan' ? 'api.stepfun.com' : profile === 'step_plan_oversea' ? 'api.stepfun.ai' : undefined;
    const identity = createHash('sha256').update(JSON.stringify([profile, key, uid, stored?.type])).digest('hex');
    const needsRefresh = typeof stored?.expires === 'number' && stored.expires <= this.clock() + 60000;
    return { key, uid, identity, needsRefresh, endpoint: host ? `https://${host}/step_plan/v1/usage` : undefined,
      issue: (!stored ? 'signed-out' : !host || !key ? 'unsupported' : undefined) as AllowanceIssue | undefined };
  }
  cached(): AccountAllowance {
    const context = this.context();
    if (context.identity !== this.identity) {
      this.cancel(); this.identity = context.identity; this.receivedTick = -Infinity; this.retryTick = -Infinity;
      this.state = { status: context.issue ? 'unsupported' : 'idle', issue: context.issue, meters: [] };
    }
    if (this.state.plan && (this.tick() - this.receivedTick >= 300000 || this.clock() >= (this.state.expiresAt ?? 0))) {
      this.state = { status: 'error', issue: 'expired', meters: [] };
    } else if (this.state.plan && this.state.status === 'ready' && (this.tick() - this.receivedTick >= 30000 || this.crossedBoundary())) {
      this.state = { ...this.state, status: 'stale' };
    }
    return structuredClone(this.state);
  }
  private crossedBoundary() {
    const crossed = (at?: number) => at !== undefined && at <= this.clock() && (this.state.fetchedAt ?? Infinity) < at;
    return crossed(this.state.plan?.expiresAt) || this.state.meters.some(m => crossed(m.resetsAt) || crossed(m.expiresAt));
  }
  cancel() {
    this.generation++; this.abort?.abort(); this.abort = undefined; this.pending = undefined;
    if (this.state.status === 'loading') this.state = { ...this.state, status: this.state.plan ? 'stale' : 'idle' };
  }
  query(force = false): Promise<AccountAllowance> {
    const previous = this.cached();
    let context = this.context();
    if (context.issue) return Promise.resolve(previous);
    if (this.pending) return this.pending;
    if (this.tick() < this.retryTick || (!force && previous.status === 'ready')) return Promise.resolve(previous);
    const generation = ++this.generation, controller = new AbortController();
    this.abort = controller; this.state = { ...previous, status: 'loading', issue: undefined };
    const current = () => generation === this.generation && context.identity === this.context().identity;
    const valid = () => current() && !controller.signal.aborted;
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('cancelled'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const work = async () => {
      if (context.needsRefresh) {
        if (!this.refreshCredential) throw new Error('Credential refresh unavailable');
        await this.refreshCredential(controller.signal);
        if (generation !== this.generation || controller.signal.aborted) return;
        context = this.context();
        if (context.issue || context.needsRefresh) throw new Error('Credential refresh failed');
        this.identity = context.identity;
      }
      const response = await this.fetcher(context.endpoint!, {
        method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${context.key}` },
        redirect: 'error', credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const code = response.status;
        const issue: AllowanceIssue = code === 401 || code === 403 ? 'authentication' : code === 404 ? 'not-available' : code === 429 ? 'rate-limit' : 'network';
        if (valid()) {
          let retryAt: number | undefined;
          if (code === 429) {
            const header = response.headers.get('retry-after') ?? '1';
            const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - this.clock()) / 1000;
            const delay = Math.min(86400000, Math.max(1000, Number.isFinite(seconds) ? seconds * 1000 : 1000));
            this.retryTick = this.tick() + delay; retryAt = this.clock() + delay;
          }
          this.state = issue === 'authentication' ? { status: 'error', issue, meters: [] }
            : { ...previous, status: previous.plan ? 'stale' : 'error', issue, retryAt };
        }
        return;
      }
      let result: AccountAllowance;
      try { result = decodeAccountAllowance(await readResponse(response), context.uid, this.clock()); }
      catch (error) {
        if (valid()) this.state = error instanceof Error && error.message === 'identity'
          ? { status: 'error', issue: 'identity', meters: [] }
          : { ...previous, status: previous.plan ? 'stale' : 'error', issue: 'invalid-response' };
        return;
      }
      if (valid()) { this.state = result; this.receivedTick = this.tick(); this.retryTick = -Infinity; }
    };
    timer = setTimeout(() => controller.abort(), this.timeout);
    this.pending = Promise.race([work(), aborted]).catch(() => {
      if (current()) this.state = { ...previous, status: previous.plan ? 'stale' : 'error', issue: 'network' };
    }).then(() => this.cached()).finally(() => {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
      if (generation === this.generation) { this.pending = undefined; this.abort = undefined; }
    });
    return this.pending;
  }
}
