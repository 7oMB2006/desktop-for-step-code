import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PluginHostBindingStore, type HostBinding } from './plugin-host-contract.mjs';
import type { ConfigurationDescriptor } from './plugin-configuration.mjs';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import { HostClientError, LIMITS, boundedJson, keys, parseContext, parseInvoke, parseResult } from '../../examples/plugins/host-client/protocol.mjs';
import type { Capability, FollowLaunch, HostContext, Invocation, LaunchContext, ModelSelection, Results } from '../../examples/plugins/host-client/protocol.mjs';

export interface HostProviderSnapshot {
  revision: string; expiresAt: number; capabilities: HostContext['capabilities'];
}
export interface HostProvider {
  read(worker: SessionRuntime, models: ModelSelection): Promise<HostProviderSnapshot>;
  invoke(snapshot: HostProviderSnapshot, input: Invocation, signal: AbortSignal): Promise<Results[Capability]>;
}
type Budgets = { -readonly [K in 'lease' | 'queue' | 'confirmation' | 'provider']: number };
type Confirmation = { controller: AbortController; promise: Promise<void>; users: number; settled: boolean };
type Lease = {
  worker: SessionRuntime; rpc: SessionRuntime['rpc']; descriptor: ConfigurationDescriptor; binding: HostBinding;
  launch: FollowLaunch; snapshot: HostProviderSnapshot; revision: string; controller: AbortController;
  timer: NodeJS.Timeout; requests: Set<string>; active: Map<string, AbortController>;
  grants: Set<Capability>; confirmations: Map<Capability, Confirmation>;
};
type Waiter = { group: string; ready(): void; reject(): void };
const fresh = () => createHash('sha256').update(randomBytes(32)).digest('hex');
function fail(code: string): never { throw new HostClientError(code); }
function aborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  if (signal.reason instanceof HostClientError) throw signal.reason;
  fail(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED');
}
function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { try { aborted(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
async function readBody(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('INVALID_REQUEST');
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > LIMITS.request)) fail('TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const bytes of request) {
    size += bytes.length;
    if (size > LIMITS.request) fail('TOO_LARGE');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return fail('INVALID_REQUEST'); }
}

// Main-only service. There is intentionally no HTTP endpoint for issuing a lease.
export class PluginHostBroker {
  private server?: Server;
  private origin?: string;
  private closed = false;
  private leases = new Map<string, Lease>();
  private store: PluginHostBindingStore;
  private budgets: Budgets;
  private waiting: Waiter[] = [];
  private groups = new Map<string, number>();
  private running = 0;
  private receiving = 0;
  constructor(private options: {
    root: string; pool: Pick<SessionRuntimes, 'workers' | 'activeId' | 'confirm'>; provider: HostProvider;
    language(): 'zh' | 'en';
    validateConsumer(descriptor: ConfigurationDescriptor, binding: HostBinding, worker: SessionRuntime): Promise<boolean>;
    budgets?: Partial<Budgets>;
  }) {
    this.store = new PluginHostBindingStore(options.root);
    this.budgets = { lease: LIMITS.lease, queue: LIMITS.queue, confirmation: LIMITS.confirmation, provider: LIMITS.provider };
    for (const name of Object.keys(this.budgets) as Array<keyof Budgets>) {
      const value = options.budgets?.[name];
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 1 || value > this.budgets[name]) fail('INVALID_REQUEST');
        this.budgets[name] = value;
      }
    }
  }
  async start() {
    if (this.closed) fail('CLOSED');
    if (this.server) fail('BUSY');
    const server = createServer((request, response) => { void this.handle(request, response); });
    this.server = server;
    server.maxConnections = 32;
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 1000;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === 'string' || this.closed) fail('HOST_UNAVAILABLE');
      this.origin = `http://127.0.0.1:${address.port}`;
    } catch (error) {
      server.close();
      this.server = undefined;
      throw error;
    }
  }
  async issue(descriptor: ConfigurationDescriptor, worker: SessionRuntime): Promise<LaunchContext> {
    if (!this.origin || this.closed) return fail('HOST_UNAVAILABLE');
    if (this.leases.size >= 64) return fail('BUSY');
    const binding = await this.store.current(descriptor);
    if (!('mode' in binding) || !binding.configurationCurrent) return fail('AUTHORIZATION_REQUIRED');
    const rpc = worker.rpc, sessionId = worker.state?.sessionId;
    if (!sessionId || !this.sameRuntime(worker, rpc, sessionId)) return fail('STALE_CONTEXT');
    if (!await this.options.validateConsumer(descriptor, binding, worker)) return fail('DENIED');
    const snapshot = binding.mode === 'follow' ? await this.options.provider.read(worker, binding.models) : undefined;
    const token = randomBytes(32).toString('base64url');
    const launch = await this.store.launch(descriptor, {
      runtimeId: worker.id, sessionId, accountRevision: snapshot?.revision ?? fresh(),
      broker: { origin: this.origin, token, expiresAt: Math.min(Date.now() + this.budgets.lease, snapshot?.expiresAt ?? Infinity) },
    });
    if (launch.revision !== binding.revision
      || !await this.options.validateConsumer(descriptor, binding, worker) || this.closed
      || !this.sameRuntime(worker, rpc, sessionId)) return fail('STALE_CONTEXT');
    if (launch.mode !== 'follow') return launch;
    if (this.leases.size >= 64) return fail('BUSY');
    const lease: Lease = {
      worker, rpc, descriptor: { ...descriptor }, binding, launch, snapshot: snapshot!, revision: fresh(),
      controller: new AbortController(), timer: undefined!, requests: new Set(), active: new Map(),
      grants: new Set(), confirmations: new Map(),
    };
    lease.timer = setTimeout(() => this.revoke(lease), Math.max(1, launch.broker.expiresAt - Date.now())).unref();
    this.leases.set(token, lease);
    return structuredClone(launch);
  }
  private revoke(lease: Lease) {
    this.leases.delete(lease.launch.broker.token);
    clearTimeout(lease.timer);
    lease.controller.abort(new HostClientError('STALE_CONTEXT'));
    lease.grants.clear();
  }
  invalidate(worker?: SessionRuntime) {
    for (const lease of this.leases.values()) if (!worker || lease.worker === worker) this.revoke(lease);
  }
  release(launch: LaunchContext) {
    if (launch.mode !== 'follow') return;
    const lease = this.leases.get(launch.broker.token);
    if (lease?.launch.launchId === launch.launchId) this.revoke(lease);
  }
  private sameRuntime(worker: SessionRuntime, rpc: SessionRuntime['rpc'], sessionId: string) {
    return this.options.pool.workers.get(worker.id) === worker && worker.rpc === rpc
      && worker.status === 'connected' && !worker.stopping && !worker.mutating
      && worker.state?.sessionId === sessionId;
  }
  private async current(lease: Lease) {
    const worker = lease.worker;
    try {
      if (lease.controller.signal.aborted || Date.now() >= lease.launch.broker.expiresAt
        || !this.sameRuntime(worker, lease.rpc, lease.launch.sessionId)) fail('STALE_CONTEXT');
      const binding = await this.store.current(lease.descriptor);
      if (!('mode' in binding) || binding.mode !== 'follow' || !binding.configurationCurrent
        || binding.revision !== lease.binding.revision
        || !await this.options.validateConsumer(lease.descriptor, binding, worker)) fail('STALE_CONTEXT');
      const snapshot = await this.options.provider.read(worker, binding.models);
      if (snapshot.revision !== lease.snapshot.revision || lease.controller.signal.aborted
        || !this.sameRuntime(worker, lease.rpc, lease.launch.sessionId)) fail('STALE_CONTEXT');
    } catch {
      this.revoke(lease);
      fail('STALE_CONTEXT');
    }
  }
  private pump() {
    for (const item of [...this.waiting]) {
      if (this.running >= LIMITS.globalConcurrency) break;
      if ((this.groups.get(item.group) ?? 0) < LIMITS.perPluginConcurrency) item.ready();
    }
  }
  private acquire(group: string, signal: AbortSignal): Promise<() => void> {
    aborted(signal);
    if (this.waiting.length >= 32) return Promise.reject(new HostClientError('BUSY'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', item.reject);
        this.waiting = this.waiting.filter(value => value !== item);
      };
      const item: Waiter = { group, ready: () => {
        cleanup();
        if (signal.aborted) { item.reject(); return; }
        this.running++;
        this.groups.set(group, (this.groups.get(group) ?? 0) + 1);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.running--;
          const count = (this.groups.get(group) ?? 1) - 1;
          if (count) this.groups.set(group, count); else this.groups.delete(group);
          this.pump();
        });
      }, reject: () => {
        cleanup();
        try { aborted(signal); } catch (error) { reject(error); }
      } };
      this.waiting.push(item);
      signal.addEventListener('abort', item.reject, { once: true });
      this.pump();
    });
  }
  private async approve(lease: Lease, capability: Capability, signal: AbortSignal) {
    if (lease.grants.has(capability)) return;
    if (this.options.pool.activeId !== lease.worker.id) fail('AUTHORIZATION_REQUIRED');
    let confirmation = lease.confirmations.get(capability);
    if (!confirmation) {
      const controller = new AbortController();
      const combined = AbortSignal.any([lease.controller.signal, controller.signal, AbortSignal.timeout(this.budgets.confirmation)]);
      const zh = this.options.language() === 'zh';
      const selected = lease.snapshot.capabilities.find(item => item.id === capability)!;
      const message = zh
        ? `${lease.launch.pluginId} 申请 ${capability}，模型 ${selected.model}。\n渠道：${selected.channel === 'plan' ? 'Step Plan 套餐' : '直调 API'}；地区：${selected.region}。\n文字、音频或视频将发送给阶跃并可能消耗额度。仅授权本次启动、此会话的当前账户、模型及本项能力。失败不会切换计费渠道；取消不保证免除已产生的费用。`
        : `${lease.launch.pluginId} requests ${capability} with ${selected.model}.\nChannel: ${selected.channel === 'plan' ? 'Step Plan' : 'direct API'}; region: ${selected.region}.\nText, audio or video is sent to Step and may consume quota. Approval covers only this launch, session, account, model and capability. No billing fallback. Cancellation may not prevent charges already incurred.`;
      confirmation = { controller, users: 0, settled: false, promise: undefined! };
      const record = confirmation;
      record.promise = wait(this.options.pool.confirm(lease.worker,
        zh ? '允许插件使用当前模型账户？' : 'Allow plugin model account access?', message, combined), combined)
        .then(approved => {
          aborted(combined);
          if (!approved) fail('DENIED');
          lease.grants.add(capability);
        }).finally(() => { record.settled = true; });
      lease.confirmations.set(capability, record);
    }
    confirmation.users++;
    try { await wait(confirmation.promise, signal); }
    finally {
      confirmation.users--;
      if (!confirmation.users && !confirmation.settled) {
        confirmation.controller.abort(new HostClientError('CANCELLED'));
        lease.confirmations.delete(capability);
      }
    }
  }
  private async invoke(lease: Lease, value: unknown, signal: AbortSignal) {
    const invocation = parseInvoke(value);
    if (!lease.launch.capabilities.includes(invocation.capability)) fail('DENIED');
    if (invocation.revision !== lease.revision) fail('STALE_CONTEXT');
    if (lease.requests.has(invocation.requestId)) fail('INVALID_REQUEST');
    if (lease.requests.size >= 1024) fail('BUSY');
    lease.requests.add(invocation.requestId);
    const controller = new AbortController();
    lease.active.set(invocation.requestId, controller);
    const combined = AbortSignal.any([signal, controller.signal]);
    let release: (() => void) | undefined;
    try {
      release = await this.acquire(`${lease.launch.instance}:${lease.launch.sessionId}`,
        AbortSignal.any([combined, AbortSignal.timeout(this.budgets.queue)]));
      await wait(this.current(lease), combined);
      if (!lease.snapshot.capabilities.some(item => item.id === invocation.capability && item.available)) fail('CAPABILITY_UNAVAILABLE');
      await this.approve(lease, invocation.capability, combined);
      await wait(this.current(lease), combined);
      aborted(combined);
      const providerSignal = AbortSignal.any([combined, AbortSignal.timeout(this.budgets.provider)]);
      let result;
      try { result = await wait(this.options.provider.invoke(lease.snapshot, invocation, providerSignal), providerSignal); }
      catch (error) { if (error instanceof HostClientError) throw error; return fail('PROVIDER_FAILED'); }
      await wait(this.current(lease), combined);
      aborted(providerSignal);
      const response = { version: 1, requestId: invocation.requestId, result };
      parseResult(response, invocation);
      boundedJson(response, LIMITS.response);
      return response;
    } finally { release?.(); lease.active.delete(invocation.requestId); }
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    let admitted = false;
    const controller = new AbortController();
    response.once('close', () => controller.abort(new HostClientError('CANCELLED')));
    const send = (status: number, value: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
      response.end(JSON.stringify(value));
    };
    try {
      if (this.closed || !this.origin) fail('HOST_UNAVAILABLE');
      if (request.method !== 'POST' || !['/v1/context', '/v1/invoke', '/v1/cancel'].includes(request.url ?? '')
        || request.headers.origin !== undefined || request.headers.host !== new URL(this.origin).host
        || request.headersDistinct.authorization?.length !== 1) fail('DENIED');
      const authorization = request.headers.authorization;
      const lease = authorization?.startsWith('Bearer ') ? this.leases.get(authorization.slice(7)) : undefined;
      if (!lease || lease.controller.signal.aborted) fail('STALE_CONTEXT');
      if (this.receiving >= LIMITS.globalConcurrency) fail('BUSY');
      this.receiving++; admitted = true;
      const signal = AbortSignal.any([controller.signal, lease.controller.signal,
        AbortSignal.timeout(request.url === '/v1/invoke'
          ? this.budgets.queue + this.budgets.confirmation + this.budgets.provider : 10000)]);
      const input = await wait(readBody(request), signal);
      this.receiving--; admitted = false;
      await wait(this.current(lease), signal);
      if (request.url === '/v1/context') {
        keys(input, []);
        const context = parseContext({ version: 1, revision: lease.revision,
          capabilities: lease.snapshot.capabilities.filter(item => lease.launch.capabilities.includes(item.id)) }, lease.launch.capabilities);
        send(200, context);
      } else if (request.url === '/v1/cancel') {
        keys(input, ['requestId']);
        const requestId = (input as { requestId: unknown }).requestId;
        if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(requestId)) fail('INVALID_REQUEST');
        const active = lease.active.get(requestId);
        active?.abort(new HostClientError('CANCELLED'));
        send(200, { version: 1, requestId, cancelled: Boolean(active) });
      } else send(200, await this.invoke(lease, input, signal));
    } catch (error) {
      const code = error instanceof HostClientError ? error.code : 'HOST_UNAVAILABLE';
      const statuses: Partial<Record<typeof code, number>> = { TOO_LARGE: 413, BUSY: 429, DENIED: 403, STALE_CONTEXT: 409, TIMEOUT: 408 };
      const status = statuses[code] ?? 400;
      send(status, { version: 1, error: { code } });
    } finally { if (admitted) this.receiving--; }
  }
  async close() {
    this.closed = true;
    this.invalidate();
    const server = this.server;
    this.server = undefined; this.origin = undefined;
    if (server) {
      const stopped = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      await stopped;
    }
  }
}
