import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { optionalFile, writePrivateJson } from './plugin-files.mjs';
import type { PluginUpdateCompatibility, PluginUpdateOperation, PluginUpdatePreflight, PluginUpdateRequest,
  PluginUpdateSession } from '../src/plugin-update';
import type { SessionRuntime, SessionRuntimes, RuntimeUpdateLease } from './session-runtimes';
import type { CapabilityGuard } from './capability-policy';
import type { CapabilityGate } from './capability-gate';

type Checked = PluginUpdateCompatibility & { stamp: string; identity: string; version: string; scope: 'runtime' | 'theme' };
type Observation = { sessions: PluginUpdateSession[]; affected: SessionRuntime[]; blockers: string[] };
type Preview = { input: PluginUpdateRequest; checked: Checked; observation: Observation; expires: number };
const copy = <T>(value: T): T => structuredClone(value);
const failure = (error: unknown) => /capability:[a-z-]+/u.exec(String(error))?.[0] ?? 'capability:operation-failed';
const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const displayText = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, max);
const recordValid = (value: any): value is PluginUpdateOperation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['id', 'pluginId', 'version', 'phase', 'installation', 'sessions', 'warnings', 'error'].includes(key))
    || !text(value.id, 128) || !text(value.pluginId, 128) || !text(value.version, 80)
    || !['releasing', 'applying', 'restoring', 'done', 'attention'].includes(value.phase)
    || !['unchanged', 'committed', 'unknown'].includes(value.installation)
    || !Array.isArray(value.sessions) || value.sessions.length > 100
    || !Array.isArray(value.warnings) || value.warnings.length > 100
    || value.warnings.some((item: unknown) => !text(item, 500))
    || value.error !== undefined && (typeof value.error !== 'string' || !/^capability:[a-z-]+$/u.test(value.error))) return false;
  const ids = new Set<string>();
  for (const item of value.sessions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['runtimeId', 'sessionId', 'name', 'status', 'restoration'].includes(key))
      || !text(item.runtimeId, 128) || item.sessionId !== undefined && !text(item.sessionId, 128)
      || !text(item.name, 120) || !['idle', 'busy', 'unknown'].includes(item.status)
      || !['pending', 'restored', 'failed', 'unknown', 'untouched'].includes(item.restoration) || ids.has(item.runtimeId)) return false;
    ids.add(item.runtimeId);
  }
  return true;
};

export class PluginUpdateCoordinator {
  private previews = new Map<string, Preview>();
  private operation?: PluginUpdateOperation;
  private running = false;
  constructor(private options: {
    root: string; pool: SessionRuntimes; gate: CapabilityGate;
    check(input: PluginUpdateRequest): Promise<Checked>;
    mutate(input: PluginUpdateRequest, guard: CapabilityGuard, checked: Checked): Promise<{ warnings: string[] }>;
    assertAvailable(): void;
    acquire(): () => void;
    external(worker: SessionRuntime): boolean;
    canRestore(): boolean;
    restore(lease: RuntimeUpdateLease): Promise<void>;
    refreshed(): Promise<void>;
    releaseSupported?: boolean;
  }) {}
  private async observe(id: string, scope: Checked['scope']): Promise<Observation> {
    if (scope === 'theme') return { sessions: [], affected: [], blockers: [] };
    const { pool } = this.options;
    const workers = [...pool.workers.values()], sessions: PluginUpdateSession[] = [], affected: SessionRuntime[] = [], blockers: string[] = [];
    const owners = workers.map(worker => ({ worker, rpc: worker.rpc, sessionId: worker.state?.sessionId }));
    for (const worker of workers) {
      let status: PluginUpdateSession['status'] = 'idle', used = false;
      try {
        if (worker.status !== 'connected') throw new Error('unknown');
        const summary = await worker.rpc.request('get_desktop_summary');
        if (!Array.isArray(summary?.mcp)) throw new Error('unknown');
        used = summary.mcp.some((server: { name: string; status: string }) =>
          typeof server.name !== 'string' || typeof server.status !== 'string'
          || server.name.startsWith(`${id}__`) && server.status !== 'disabled');
        if (this.options.external(worker) || worker.operations || worker.mutating || worker.stopping) status = 'busy';
        await pool.assertIdle(worker, { stopHost: used, allowRemote: !used, resources: true });
      } catch { status = worker.status === 'connected' ? 'busy' : 'unknown'; }
      if (used && status === 'idle') {
        try { pool.assertUpdateRestorable(worker); }
        catch { blockers.push('runtime-history-unavailable'); }
      }
      if (used) affected.push(worker);
      if (used || status !== 'idle') {
        const name = displayText(String(worker.state?.sessionName || basename(worker.cwd) || worker.state?.sessionId || worker.id), 120);
        sessions.push({ runtimeId: worker.id, sessionId: worker.state?.sessionId,
          name: name || (worker.state?.sessionId || worker.id).slice(0, 120), status });
      }
      if (status !== 'idle') blockers.push(status === 'unknown' ? 'runtime-unknown' : 'session-busy');
    }
    if (workers.length !== pool.workers.size || owners.some(({ worker, rpc, sessionId }) =>
      pool.workers.get(worker.id) !== worker || worker.rpc !== rpc || worker.state?.sessionId !== sessionId))
      blockers.push('runtime-changed');
    if (affected.length && !(this.options.releaseSupported ?? process.platform === 'win32')) blockers.push('release-unsupported');
    return { sessions, affected, blockers: [...new Set(blockers)] };
  }
  async preflight(input: PluginUpdateRequest): Promise<PluginUpdatePreflight> {
    this.options.assertAvailable();
    if (this.running || this.options.gate.active) throw new Error('capability:busy');
    const checked = await this.options.check(input);
    const observation = await this.observe(input.id, checked.scope);
    const token = randomUUID();
    for (const [key, value] of this.previews) if (value.expires < Date.now()) this.previews.delete(key);
    if (this.previews.size >= 32) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(token, { input: { ...input }, checked, observation, expires: Date.now() + 120000 });
    return { token, pluginId: input.id, version: checked.version, status: checked.status, changes: checked.changes,
      readiness: checked.status !== 'compatible' || observation.blockers.length ? 'blocked'
        : observation.affected.length ? 'needs-release' : 'ready', sessions: observation.sessions, blockers: observation.blockers };
  }
  private async persist() {
    await writePrivateJson(this.options.root, 'update-operation.json', { version: 1, operation: this.operation });
  }
  private async persistProgress() {
    try { await this.persist(); }
    catch {
      if (!this.operation!.warnings.includes('capability:update-operation-record-failed'))
        this.operation!.warnings = [...this.operation!.warnings.slice(0, 99), 'capability:update-operation-record-failed'];
    }
  }
  async latest(pluginId: string): Promise<PluginUpdateOperation | null> {
    if (typeof pluginId !== 'string' || pluginId.length > 128) throw new Error('capability:invalid-input');
    if (!this.operation) {
      const bytes = await optionalFile(this.options.root, 'desktop-plugins/update-operation.json', 65536);
      if (!this.operation && bytes) {
        let record;
        try { record = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('capability:update-recovery-required'); }
        const op = record?.operation;
        if (record?.version !== 1 || Object.keys(record).some(key => !['version', 'operation'].includes(key))
          || !recordValid(op)) throw new Error('capability:update-recovery-required');
        // A prior process cannot attest restoration or replay a user's restart consent.
        this.operation = ['done', 'attention'].includes(op.phase) ? op : { ...op, phase: 'attention', installation: 'unknown',
          sessions: op.sessions.map((item: PluginUpdateOperation['sessions'][number]) => ({ ...item, restoration: 'unknown' })),
          error: 'capability:update-operation-interrupted' };
      }
    }
    return this.operation?.pluginId === pluginId ? copy(this.operation) : null;
  }
  async apply(input: { token: string; release: boolean }): Promise<PluginUpdateOperation> {
    if (!input || Object.keys(input).some(key => !['token', 'release'].includes(key)) || typeof input.token !== 'string'
      || typeof input.release !== 'boolean') throw new Error('capability:invalid-input');
    if (this.running) throw new Error('capability:busy');
    const preview = this.previews.get(input.token);
    this.previews.delete(input.token);
    if (!preview || preview.expires < Date.now()) throw new Error('capability:stale');
    if (preview.checked.status !== 'compatible' || preview.observation.blockers.length
      || preview.observation.affected.length && !input.release) throw new Error('capability:operation-denied');
    this.running = true;
    const leases: RuntimeUpdateLease[] = [];
    this.operation = { id: input.token, pluginId: preview.input.id, version: preview.checked.version,
      phase: 'releasing', installation: 'unchanged', sessions: preview.observation.sessions.map(session =>
        ({ ...session, restoration: 'pending' })), warnings: [] };
    try {
      await this.options.gate.run(async () => {
        let unlock: (() => void) | undefined;
        const guard: CapabilityGuard = async (policy, recheck) => {
          if (policy.scope !== preview.checked.scope) throw new Error('capability:stale');
          const release = await this.options.gate.guard(policy, {
            assertAvailable: () => this.options.assertAvailable(),
            acquireRuntime: () => {
              unlock ??= this.options.acquire();
              // The service ends its writer lease before restoration. The outer
              // operation retains the runtime barrier until every lease is handled.
              return () => {};
            },
            assertIdle: async () => {
              if ([...this.options.pool.workers.values()].some(this.options.external)) throw new Error('capability:busy');
              await this.options.pool.assertUpdateIdle(leases);
            },
            assertResource: async id => {
              // Recheck configuration before the first interruption, not only before disk commit.
              if (!recheck) throw new Error('capability:operation-denied');
              await recheck();
              if (policy.scope === 'theme') return;
              const current = await this.observe(id, preview.checked.scope);
              if (current.blockers.length || current.affected.length && !input.release
                || current.affected.some(worker => !preview.observation.affected.includes(worker))
                || preview.observation.affected.some(worker => !current.affected.includes(worker)))
                throw new Error('capability:resource-in-use');
              await this.persist();
              await this.options.pool.releaseForUpdate(current.affected, leases);
              const released = new Set(leases.filter(lease => this.options.pool.isReleasedForUpdate(lease)).map(lease => lease.worker));
              if (released.size !== current.affected.length) throw new Error('capability:release-unconfirmed');
              for (const worker of this.options.pool.workers.values()) {
                if (released.has(worker)) continue;
                const summary = await worker.rpc.request('get_desktop_summary');
                if (!Array.isArray(summary?.mcp) || summary.mcp.some((server: { name: string; status: string }) =>
                  typeof server.name !== 'string' || server.name.startsWith(`${id}__`) && server.status !== 'disabled'))
                  throw new Error('capability:resource-in-use');
              }
              this.operation!.phase = 'applying';
              await this.persist();
            },
          });
          return release;
        };
        try {
          try {
            const result = await this.options.mutate(preview.input, guard, preview.checked);
            this.operation!.installation = 'committed';
            this.operation!.warnings = [...this.operation!.warnings, ...result.warnings]
              .map(warning => displayText(warning, 500)).filter(Boolean).slice(0, 100);
          } catch (error) {
            this.operation!.error = failure(error);
            if (!this.options.canRestore()) this.operation!.installation = 'unknown';
          } finally {
            this.operation!.phase = 'restoring';
            await this.persistProgress();
            for (const lease of leases) {
              const item = this.operation!.sessions.find(session => session.runtimeId === lease.worker.id);
              if (!item) continue;
              if (!this.options.canRestore()) { item.restoration = 'unknown'; continue; }
              try { await this.options.restore(lease); item.restoration = 'restored'; }
              catch { item.restoration = 'failed'; }
              await this.persistProgress();
            }
          }
        } finally { unlock?.(); }
      });
      await this.options.refreshed();
    } catch (error) {
      this.operation.error = failure(error);
      if (!this.options.canRestore()) this.operation.installation = 'unknown';
    } finally {
      for (const item of this.operation.sessions) {
        if (item.restoration !== 'pending') continue;
        const worker = this.options.pool.workers.get(item.runtimeId);
        item.restoration = worker?.status === 'connected' && worker.state?.sessionId === item.sessionId && !worker.mutating
          ? 'untouched' : 'unknown';
      }
      this.operation.phase = this.operation.error || this.operation.sessions.some(item => item.restoration !== 'restored')
        ? 'attention' : 'done';
      await this.persistProgress();
      this.running = false;
    }
    return copy(this.operation);
  }
}
