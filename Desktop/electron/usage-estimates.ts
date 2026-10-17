import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message, RuntimeEvent } from '../src/contracts';
import { defaultEstimateRules, estimateResponse, PRICE_VERSION,
  type EstimateContext, type EstimateRules, type EstimateSettings, type SessionEstimate, type EstimateGroup } from '../src/usage-estimates';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const validRules = (value: unknown): value is EstimateRules => Boolean(value && typeof value === 'object'
  && typeof (value as EstimateRules).planProtected === 'boolean' && typeof (value as EstimateRules).apiLegacyCache === 'boolean');
type Entry = { id: string; account: string; mode: 'plan' | 'api'; region: 'cn' | 'global';
  amount?: number; at: number; rules: EstimateRules; priceVersion: string };
type Worker = { id: string; state?: { sessionId?: string }; messages: Message[] };

// Main-process-only sidecars contain no keys, prompts, or raw server responses.
export class UsageEstimates {
  private sessions = new Map<string, Map<string, Entry>>();
  private rules = new Map<string, EstimateRules>();
  private contexts = new Map<string, EstimateContext | undefined>();
  private requests = new Map<string, { context: EstimateContext; at: number }>();
  private writes: Promise<void> = Promise.resolve();
  private ruleUpdates: Promise<unknown> = Promise.resolve();
  private storageError = false;
  constructor(private root: string, private auth: () => Record<string, unknown>, private onError: (error: unknown) => void = () => {}) {}
  private context(): EstimateContext | undefined {
    const auth = this.auth().step as Record<string, unknown> | undefined;
    if (auth?.type !== 'oauth' || typeof auth.access !== 'string' || !auth.access.trim()) return;
    const profile = typeof auth.profile === 'string' ? auth.profile : 'step_plan';
    if (!['step_plan', 'step_plan_oversea', 'platform_cn', 'platform_oversea'].includes(profile)) return;
    const region = profile.endsWith('oversea') ? 'global' : 'cn';
    const mode = profile.startsWith('platform_') ? 'api' : 'plan';
    // Prefer a stable official UID; key-only API credentials are isolated per key.
    const account = hash(JSON.stringify([region, typeof auth.uid === 'string' && /^\d+$/.test(auth.uid) ? `uid:${auth.uid}` : `credential:${auth.access}`]));
    return { account, mode, region, rules: { ...this.rules.get(account) ?? defaultEstimateRules } };
  }
  settings(): EstimateSettings {
    const context = this.context();
    return context ? { available: true, accountRef: context.account, mode: context.mode, region: context.region, rules: context.rules }
      : { available: false, rules: { ...defaultEstimateRules } };
  }
  async initialize() {
    try {
      const value = JSON.parse(await readFile(join(this.root, 'rules.json'), 'utf8'));
      for (const [key, rules] of Object.entries(value)) if (/^[a-f0-9]{64}$/.test(key) && validRules(rules)) this.rules.set(key, rules);
    } catch (error) { this.report(error); }
  }
  async setRules(value: unknown, accountRef: unknown): Promise<EstimateSettings> {
    if (!validRules(value)) throw new Error('Invalid estimate rules');
    const context = this.context();
    if (!context || context.account !== accountRef) throw new Error('Estimate account changed');
    const update = this.ruleUpdates.catch(() => {}).then(async () => {
      if (this.context()?.account !== context.account) throw new Error('Estimate account changed');
      const next = new Map(this.rules);
      next.set(context.account, { planProtected: value.planProtected, apiLegacyCache: value.apiLegacyCache });
      await this.write('rules.json', Object.fromEntries(next));
      this.rules = next;
      return this.settings();
    });
    this.ruleUpdates = update.catch(() => {});
    return update;
  }
  private filename(id: string) { return `${hash(id)}.json`; }
  async load(id: string) {
    if (this.sessions.has(id)) return;
    let entries: Entry[] = [];
    try {
      const value: unknown = JSON.parse(await readFile(join(this.root, this.filename(id)), 'utf8'));
      if (!Array.isArray(value)) throw new Error('Invalid estimate history');
      entries = value.filter((e): e is Entry => e && /^[a-f0-9]{64}$/.test(e.id) && /^[a-f0-9]{64}$/.test(e.account)
        && ['plan', 'api'].includes(e.mode) && ['cn', 'global'].includes(e.region) && validRules(e.rules)
        && Number.isFinite(e.at) && typeof e.priceVersion === 'string'
        && (e.amount === undefined || Number.isFinite(e.amount) && e.amount >= 0));
    } catch (error) { this.report(error); }
    // Events can arrive while the asynchronous disk read is in flight.
    this.sessions.set(id, new Map([...entries.map(e => [e.id, e] as const), ...this.sessions.get(id) ?? []]));
  }
  attach(worker: Worker) { this.contexts.set(worker.id, this.context()); }
  private messageId(message: Message) {
    return hash(JSON.stringify([message.timestamp, message.provider, message.model, message.content]));
  }
  event(worker: Worker, event: RuntimeEvent, now = Date.now()) {
    const sessionId = worker.state?.sessionId;
    if (!sessionId) return;
    const message = event.message as Message | undefined;
    if (message?.role !== 'assistant' || !['message_start', 'message_end'].includes(event.type)) return;
    const id = this.messageId(message);
    // Timestamp identifies a response while its content is still streaming.
    const requestId = `${worker.id}:${message.timestamp}`;
    if (event.type === 'message_start') {
      const attached = this.contexts.get(worker.id), current = this.context();
      const context = attached && current?.account === attached.account && current.mode === attached.mode
        ? { ...attached, rules: { ...current.rules } } : undefined;
      if (context && message.provider === 'step' && Number.isFinite(message.timestamp))
        this.requests.set(requestId, { context, at: now });
      return;
    }
    const request = this.requests.get(requestId);
    this.requests.delete(requestId);
    if (!request || message.provider !== 'step' || !message.usage) return;
    const entries = this.sessions.get(sessionId) ?? new Map<string, Entry>();
    this.sessions.set(sessionId, entries);
    if (entries.has(id)) return;
    entries.set(id, { id, account: request.context.account, mode: request.context.mode, region: request.context.region,
      amount: estimateResponse(request.context, message.model ?? '', message.usage, request.at),
      at: request.at, rules: request.context.rules, priceVersion: PRICE_VERSION });
    void this.write(this.filename(sessionId), [...entries.values()]).catch(() => {});
  }
  summary(worker?: Worker): SessionEstimate {
    const settings = this.settings(), context = this.context();
    const entries = this.sessions.get(worker?.state?.sessionId ?? '');
    const groups = new Map<string, EstimateGroup>();
    const groupId = (account: string, mode: string, region: string) => `${account}:${mode}:${region}`;
    // Other accounts remain on disk, but are never attributed to the current account.
    for (const entry of entries?.values() ?? []) {
      const id = groupId(entry.account, entry.mode, entry.region);
      const group = groups.get(id) ?? { id, mode: entry.mode, region: entry.region,
        currency: entry.region === 'cn' ? 'CNY' as const : 'USD' as const, amount: 0, responses: 0, unknown: 0,
        currentAccount: entry.account === context?.account };
      group.responses++;
      if (entry.amount === undefined) group.unknown++; else group.amount += entry.amount;
      groups.set(id, group);
    }
    return { settings, active: context ? groups.get(groupId(context.account, context.mode, context.region)) : undefined,
      groups: [...groups.values()], storageError: this.storageError,
      historicalUnknown: Boolean(worker?.messages.some(message => message.role === 'assistant'
        && (message.provider === 'step' || message.provider === undefined) && message.usage
        && !entries?.has(this.messageId(message)))) };
  }
  detach(worker: Worker) {
    this.contexts.delete(worker.id);
    for (const key of this.requests.keys()) if (key.startsWith(`${worker.id}:`)) this.requests.delete(key);
  }
  private report(error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.storageError = true; this.onError(error); }
  }
  private write(name: string, value: unknown) {
    const contents = JSON.stringify(value);
    const operation = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.root, { recursive: true });
      const path = join(this.root, name);
      await writeFile(`${path}.tmp`, contents, 'utf8');
      await rename(`${path}.tmp`, path);
    });
    this.writes = operation.catch(error => this.report(error));
    return operation;
  }
  async flush() { await this.ruleUpdates; await this.writes; }
  async remove(id: string) {
    await this.flush();
    this.sessions.delete(id);
    await rm(join(this.root, this.filename(id)), { force: true });
  }
}
