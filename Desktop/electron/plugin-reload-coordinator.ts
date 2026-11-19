import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { PluginReloadReason, PluginReloadRequest, PluginReloadSession, PluginReloadState } from '../src/plugin-reload';
import type { CapabilityGate } from './capability-gate';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';

type Target = { worker: SessionRuntime; rpc: SessionRuntime['rpc']; sessionId: string;
  pluginId: string; root: string; view: PluginReloadSession };
type Plan = { request: PluginReloadRequest; stamp: string; state: PluginReloadState; targets: Target[]; expires: number; whenIdle?: boolean };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,127}$/u.test(value);
const validRequest = (input: PluginReloadRequest) => input && identifier(input.id) && typeof input.ref === 'string'
  && input.ref.length <= 128 && Object.keys(input).every(key => key === 'id' || key === 'ref');
const label = (value: string) => value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 120);
const pending = (target: Target) => ['ready', 'waiting'].includes(target.view.phase);

// The plugin is the operation owner. Session references are frozen targets, never the UI selection.
export class PluginReloadCoordinator {
  private previews = new Map<string, Plan>();
  private operations = new Map<string, Plan>();
  private accepting = new Set<string>();
  private starting = new Map<string, { ref: string; operation: Promise<PluginReloadState> }>();
  private pumping = false;
  private drained: (() => void)[] = [];
  private closed = false;
  private epoch = 0;
  constructor(private options: {
    pool: SessionRuntimes; gate: CapabilityGate;
    check(input: PluginReloadRequest): Promise<{ name: string; stamp: string; root: string }>;
    assertAvailable(): void;
    external(worker: SessionRuntime): boolean;
    now?: () => number;
  }) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private current(target: Target) {
    return this.options.pool.workers.get(target.worker.id) === target.worker && target.worker.rpc === target.rpc
      && target.worker.state?.sessionId === target.sessionId;
  }
  private reason(worker: SessionRuntime): PluginReloadReason | undefined {
    if (worker.status !== 'connected') return 'disconnected';
    if (this.options.external(worker) || worker.remoteAttached) return 'external';
    if (worker.mutating || worker.stopping) return 'operation';
  }
  private async request(target: Target, action: 'inspect' | 'reload') {
    const result: unknown = await target.rpc.request('desktop_plugin_reload', {
      action, sessionId: target.sessionId, pluginId: target.pluginId, root: target.root,
    }, action === 'inspect' ? 2500 : 45000);
    const status = (result as { status?: unknown } | null)?.status;
    if (status === 'ready' || status === 'busy' || status === 'absent' || status === 'unsupported'
      || status === 'unavailable' || status === 'applied' || status === 'failed') return status;
    throw new Error('Invalid plugin reload response');
  }
  private async readiness(target: Target): Promise<PluginReloadReason | 'absent' | undefined> {
    if (!this.current(target)) return 'changed';
    const reason = this.reason(target.worker);
    if (reason) return reason;
    try {
      const status = await this.request(target, 'inspect');
      if (!this.current(target)) return 'changed';
      return this.reason(target.worker) ?? (status === 'ready' ? undefined : status === 'busy' ? 'occupied'
        : status === 'absent' || status === 'unsupported' ? status : 'unavailable');
    } catch { return this.current(target) ? 'unavailable' : 'changed'; }
  }
  private wait(target: Target, reason: PluginReloadReason | 'absent', whenIdle: boolean) {
    const terminal = reason === 'absent' || reason === 'unsupported' || reason === 'changed' || reason === 'external';
    target.view.phase = whenIdle && !terminal ? 'waiting' : 'cancelled';
    target.view.reason = reason === 'absent' ? 'changed' : reason;
  }
  async preview(input: PluginReloadRequest): Promise<PluginReloadState> {
    if (!validRequest(input)) throw new Error('capability:invalid-input');
    this.options.assertAvailable();
    if (this.closed) throw new Error('capability:busy');
    const epoch = this.epoch;
    const current = this.operations.get(input.id);
    if (current?.targets.some(pending) || current?.targets.some(item => item.view.phase === 'applying'))
      return structuredClone(current.state);
    const request = { ...input }, checked = await this.options.check(request);
    const targets: Target[] = [];
    await Promise.all([...this.options.pool.workers.values()].map(async worker => {
      const sessionId = worker.state?.sessionId;
      if (worker.status !== 'connected' || !sessionId) return;
      const target: Target = { worker, rpc: worker.rpc, sessionId, pluginId: request.id, root: checked.root,
        view: { runtimeId: worker.id, sessionId,
          name: label(worker.state?.sessionName || basename(worker.cwd) || worker.id), phase: 'ready' } };
      targets.push(target);
      const reason = await this.readiness(target);
      if (reason) this.wait(target, reason, true);
      if (reason === 'absent' || !this.current(target)) targets.splice(targets.indexOf(target), 1);
    }));
    if (this.closed || this.epoch !== epoch) throw new Error('capability:busy');
    for (const [token, plan] of this.previews) if (plan.expires <= this.now()) this.previews.delete(token);
    if (this.previews.size >= 32) this.previews.delete(this.previews.keys().next().value!);
    const token = randomUUID(), state: PluginReloadState = {
      pluginId: request.id, name: checked.name, mode: 'plugin-mcp', token, sessions: targets.map(item => item.view),
    };
    this.previews.set(token, { request, stamp: checked.stamp, state, targets, expires: this.now() + 120000 });
    return structuredClone(state);
  }
  async start(input: PluginReloadRequest): Promise<PluginReloadState> {
    if (!validRequest(input)) throw new Error('capability:invalid-input');
    const running = this.operations.get(input.id);
    if (running?.targets.some(item => pending(item) || item.view.phase === 'applying')) {
      if (running.request.ref !== input.ref) throw new Error('capability:stale');
      return structuredClone(running.state);
    }
    const starting = this.starting.get(input.id);
    if (starting) {
      if (starting.ref !== input.ref) throw new Error('capability:stale');
      return starting.operation;
    }
    const operation = (async () => {
      const preview = await this.preview(input);
      return preview.token ? this.apply({ token: preview.token, whenIdle: true }) : preview;
    })();
    this.starting.set(input.id, { ref: input.ref, operation });
    try { return await operation; }
    finally { this.starting.delete(input.id); }
  }
  async apply(input: { token: string; whenIdle: boolean }): Promise<PluginReloadState> {
    if (!input || typeof input.token !== 'string' || typeof input.whenIdle !== 'boolean'
      || Object.keys(input).some(key => !['token', 'whenIdle'].includes(key))) throw new Error('capability:invalid-input');
    this.options.assertAvailable();
    if (this.closed) throw new Error('capability:busy');
    const epoch = this.epoch;
    const plan = this.previews.get(input.token);
    this.previews.delete(input.token);
    if (!plan || plan.expires <= this.now()) throw new Error('capability:stale');
    if (this.accepting.has(plan.request.id)
      || this.operations.get(plan.request.id)?.targets.some(item => pending(item) || item.view.phase === 'applying'))
      throw new Error('capability:busy');
    this.accepting.add(plan.request.id);
    try {
      if ((await this.options.check(plan.request)).stamp !== plan.stamp || plan.targets.some(target => !this.current(target)))
        throw new Error('capability:stale');
      for (const target of plan.targets) {
        const reason = await this.readiness(target);
        if (reason) this.wait(target, reason, input.whenIdle);
        else { target.view.phase = 'ready'; delete target.view.reason; }
      }
      this.options.assertAvailable();
      if (this.closed || this.epoch !== epoch) throw new Error('capability:busy');
      if (plan.expires <= this.now() || plan.targets.some(target => !this.current(target))
        || (await this.options.check(plan.request)).stamp !== plan.stamp) throw new Error('capability:stale');
      if (this.closed || this.epoch !== epoch) throw new Error('capability:busy');
      this.options.assertAvailable();
      if (plan.expires <= this.now() || plan.targets.some(target => !this.current(target))) throw new Error('capability:stale');
      if (this.operations.size >= 32) {
        const finished = [...this.operations].find(([, value]) =>
          !value.targets.some(item => pending(item) || item.view.phase === 'applying'));
        if (!finished) throw new Error('capability:busy');
        this.operations.delete(finished[0]);
      }
      delete plan.state.token;
      plan.whenIdle = input.whenIdle;
      plan.state.operationId = randomUUID();
      plan.expires = this.now() + 30 * 60000;
      this.operations.set(plan.request.id, plan);
      void this.tick();
      return structuredClone(plan.state);
    } finally { this.accepting.delete(plan.request.id); }
  }
  state(input: PluginReloadRequest): PluginReloadState | null {
    if (!validRequest(input)) throw new Error('capability:invalid-input');
    const plan = this.operations.get(input.id);
    return plan?.request.ref === input.ref ? structuredClone(plan.state) : null;
  }
  cancel(input: { id: string; operationId: string }): PluginReloadState {
    if (!input || !identifier(input.id) || typeof input.operationId !== 'string'
      || Object.keys(input).some(key => !['id', 'operationId'].includes(key)))
      throw new Error('capability:invalid-input');
    const plan = this.operations.get(input.id);
    if (!plan || plan.state.operationId !== input.operationId) throw new Error('capability:stale');
    for (const target of plan.targets) if (pending(target)) { target.view.phase = 'cancelled'; delete target.view.reason; }
    return structuredClone(plan.state);
  }
  async tick(): Promise<void> {
    if (this.pumping || this.closed) return;
    this.pumping = true;
    try {
      for (const plan of this.operations.values()) for (const target of plan.targets) {
        if (!pending(target)) continue;
        if (this.closed || !this.current(target) || plan.expires <= this.now()) {
          target.view.phase = 'cancelled'; target.view.reason = plan.expires <= this.now() ? 'expired' : 'changed'; continue;
        }
        try { this.options.assertAvailable(); }
        catch { target.view.reason = 'operation'; continue; }
        const reason = await this.readiness(target);
        if (!pending(target) || this.closed) continue;
        if (reason) { this.wait(target, reason, Boolean(plan.whenIdle)); continue; }
        if (this.options.gate.active) { target.view.phase = 'waiting'; target.view.reason = 'operation'; continue; }
        await this.options.gate.run(async () => {
          try {
            if ((await this.options.check(plan.request)).stamp !== plan.stamp) {
              target.view.phase = 'cancelled'; target.view.reason = 'changed'; return;
            }
            const latest = await this.readiness(target);
            if (!pending(target) || this.closed) return;
            this.options.assertAvailable();
            if (plan.expires <= this.now() || !this.current(target)) {
              target.view.phase = 'cancelled'; target.view.reason = plan.expires <= this.now() ? 'expired' : 'changed'; return;
            }
            if (latest) { this.wait(target, latest, Boolean(plan.whenIdle)); return; }
            if ((await this.options.check(plan.request)).stamp !== plan.stamp || !this.current(target)) {
              target.view.phase = 'cancelled'; target.view.reason = 'changed'; return;
            }
            if (!pending(target) || this.closed) return;
            this.options.assertAvailable();
            if (plan.expires <= this.now()) {
              target.view.phase = 'cancelled'; target.view.reason = 'expired'; return;
            }
            const finalReason = this.reason(target.worker);
            if (finalReason) { this.wait(target, finalReason, Boolean(plan.whenIdle)); return; }
            target.view.phase = 'applying'; delete target.view.reason;
            const status = await this.request(target, 'reload');
            if (!this.current(target)) this.wait(target, 'changed', false);
            else if (status === 'applied') target.view.phase = 'applied';
            else if (status === 'busy') this.wait(target, 'occupied', Boolean(plan.whenIdle));
            else if (status === 'unsupported' || status === 'absent') this.wait(target, status, false);
            else { target.view.phase = 'failed'; target.view.reason = 'failed'; }
          } catch {
            if (target.view.phase === 'applying') { target.view.phase = 'failed'; target.view.reason = 'failed'; }
            else { target.view.phase = 'cancelled'; target.view.reason = 'changed'; }
          }
        });
      }
    } finally {
      this.pumping = false;
      for (const resolve of this.drained.splice(0)) resolve();
    }
  }
  async close() {
    this.closed = true; this.epoch++;
    this.previews.clear();
    for (const plan of this.operations.values()) for (const target of plan.targets)
      if (pending(target)) target.view.phase = 'cancelled';
    if (this.pumping) await new Promise<void>(resolve => this.drained.push(resolve));
  }
  resume() { this.closed = false; }
}
