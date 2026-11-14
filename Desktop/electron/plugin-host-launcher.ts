import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PluginHostBroker, type HostProvider } from './plugin-host-broker';
import { plainFile } from './plugin-files.mjs';
import type { HostBinding, UnconfiguredHostBinding } from './plugin-host-contract.mjs';
import type { PluginHostRuntime } from '../src/capabilities';
import type { ConfigurationDescriptor } from './plugin-configuration.mjs';
import type { CapabilityService } from './capability-service';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import type { LaunchContext } from '../../examples/plugins/host-client/protocol.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeStartup } from '../src/runtime-startup';

interface NativeRecord {
  requestId: string; sessionId: string; pluginId: string; consumer: string; root: string;
  executionHash: string; conflict: boolean; phase: 'pending' | 'starting' | 'connected' | 'failed';
  declarationHash: string;
}
type Attachment = { record: NativeRecord; rpc: SessionRuntime['rpc']; launch?: LaunchContext; started?: boolean };
function nativeRecord(value: unknown): value is NativeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as NativeRecord;
  return /^[a-f0-9-]{36}$/u.test(item.requestId) && typeof item.sessionId === 'string'
    && item.sessionId.length <= 256 && /^[a-z][a-z0-9_-]{0,127}$/u.test(item.pluginId)
    && /^[a-z][a-z0-9_-]{0,47}$/u.test(item.consumer) && typeof item.root === 'string' && item.root.length <= 32768
    && /^[a-f0-9]{64}$/u.test(item.executionHash) && /^[a-f0-9]{64}$/u.test(item.declarationHash)
    && typeof item.conflict === 'boolean'
    && ['pending', 'starting', 'connected', 'failed'].includes(item.phase);
}

// Private RPC never enters preload, events, history or renderer snapshots.
export class PluginHostLauncher {
  readonly broker: PluginHostBroker;
  private attachments = new Map<SessionRuntime, Map<string, Attachment>>();
  private generation = 0;
  private versions = new WeakMap<SessionRuntime, number>();
  private attaching = new WeakMap<SessionRuntime, {
    rpc: SessionRuntime['rpc']; version: number; generation: number; operation: Promise<void>;
  }>();
  private deferred = new Map<SessionRuntime, SessionRuntime['rpc']>();
  constructor(private options: {
    root: string; pool: Pick<SessionRuntimes, 'workers' | 'activeId' | 'confirm'>;
    capabilities: Pick<CapabilityService, 'withHostDescriptor'>; provider: HostProvider;
    language(): 'zh' | 'en'; available(): boolean;
  }) {
    this.broker = new PluginHostBroker({ ...options,
      validateConsumer: (descriptor, binding, worker) => this.validate(descriptor, binding, worker) });
  }
  start() { return this.broker.start(); }
  invalidate(worker?: SessionRuntime) {
    if (worker) {
      this.versions.set(worker, (this.versions.get(worker) ?? 0) + 1);
      this.attachments.delete(worker);
      this.deferred.delete(worker);
    } else { this.generation++; this.attachments.clear(); this.deferred.clear(); }
    this.broker.invalidate(worker);
  }
  async resumeDeferred() {
    if (!this.options.available()) return;
    const pending = [...this.deferred];
    this.deferred.clear();
    await Promise.all(pending.filter(([worker, rpc]) =>
      worker.rpc === rpc && this.options.pool.workers.get(worker.id) === worker)
      .map(([worker]) => this.attach(worker)));
  }
  attach(worker: SessionRuntime): Promise<void> {
    if (!this.options.available()) {
      this.deferred.set(worker, worker.rpc);
      return Promise.resolve();
    }
    this.deferred.delete(worker);
    const pending = this.attaching.get(worker);
    const rpc = worker.rpc, version = this.versions.get(worker) ?? 0, generation = this.generation;
    if (pending?.rpc === rpc && pending.version === version && pending.generation === generation)
      return pending.operation;
    const operation = this.open(worker).finally(() => {
      if (this.attaching.get(worker)?.operation === operation) this.attaching.delete(worker);
    });
    this.attaching.set(worker, { rpc, version, generation, operation });
    return operation;
  }
  private async open(worker: SessionRuntime) {
    if (!this.options.available()) return;
    const rpc = worker.rpc, sessionId = worker.state?.sessionId;
    const generation = this.generation, version = this.versions.get(worker) ?? 0;
    const identityCurrent = () => generation === this.generation
      && version === (this.versions.get(worker) ?? 0) && worker.rpc === rpc
      && this.options.pool.workers.get(worker.id) === worker && worker.status === 'connected'
      && !worker.stopping && !worker.mutating && worker.state?.sessionId === sessionId;
    const current = () => this.options.available() && identityCurrent();
    if (!sessionId || !current()) return;
    try {
      if (worker.startup) {
        const deadline = Date.now() + 60000;
        for (;;) {
          if (!current() || Date.now() >= deadline) return;
          const state = runtimeStartup(await rpc.request('desktop_startup', { action: 'state' }, 10000), worker.id, sessionId);
          if (!state || state.startupEpoch !== worker.startup.startupEpoch
            || !state.targetBound || !state.modelReady || state.discovery === 'failed') return;
          if (state.discovery === 'ready') break;
          await delay(100);
        }
      }
      let inventory: unknown;
      try { inventory = await rpc.request('desktop_plugin_host', { action: 'list' }, 10000); }
      catch { return; }
      const records = (inventory as { records?: unknown })?.records;
      if (!current() || !Array.isArray(records) || records.length > 64 || !records.every(nativeRecord)
        || new Set(records.map(item => item.requestId)).size !== records.length) return;
      const attachments = this.attachments.get(worker) ?? new Map<string, Attachment>();
      this.attachments.set(worker, attachments);
      for (const record of records) {
        if (!current()) return;
        if (record.sessionId !== sessionId || record.phase !== 'pending' || record.conflict
          || attachments.has(record.requestId)) continue;
        const attachment: Attachment = { record, rpc };
        attachments.set(record.requestId, attachment);
        let valid = true, timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const operation = this.options.capabilities.withHostDescriptor(record.pluginId, record.root, record.consumer, async descriptor => {
            if (!valid || !current()) throw new Error('Stale plugin launch');
            const launch = await this.broker.issue(descriptor, worker);
            attachment.launch = launch;
            if (!valid || !current()) { this.broker.release(launch); throw new Error('Stale plugin launch'); }
            const result = await rpc.request('desktop_plugin_host',
              { action: 'start', requestId: record.requestId, context: JSON.stringify(launch) }, 30000);
            if (!valid || !current() || result?.started !== true) throw new Error('Plugin launch failed');
            attachment.started = true;
          });
          if (worker.startup) await Promise.race([operation, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { timedOut = true; valid = false; reject(new Error('Plugin startup timed out')); }, 120000);
          })]);
          else await operation;
        } catch {
          if (attachment.launch) {
            this.broker.release(attachment.launch);
            delete attachment.launch;
            // Keep this record consumed locally; transaction release cannot renew an issued launch.
          } else attachments.delete(record.requestId);
          if (worker.startup && identityCurrent()) {
            try { await rpc.request('desktop_plugin_host', { action: 'reject', requestId: record.requestId,
              ...(timedOut ? { cleanupConfirmed: false } : {}) }, 10000); }
            catch {}
          }
          // Failure is local to this consumer; no raw native error is published.
        } finally { valid = false; clearTimeout(timer); }
      }
    } finally {
      if (identityCurrent() && !this.options.available()) this.deferred.set(worker, rpc);
    }
  }
  async status(descriptor: ConfigurationDescriptor, binding: HostBinding | UnconfiguredHostBinding): Promise<PluginHostRuntime> {
    if (!this.options.available()) return { status: 'unavailable' };
    const worker = this.options.pool.workers.get(this.options.pool.activeId ?? '');
    if (!worker || worker.status !== 'connected' || !worker.state?.sessionId || worker.stopping || worker.mutating)
      return { status: 'no-session' };
    if (!('mode' in binding)) return { status: 'unconfigured' };
    if (!binding.configurationCurrent) return { status: 'restart-required' };
    const attachment = [...this.attachments.get(worker)?.values() ?? []].find(item =>
      item.launch?.pluginId === binding.pluginId && item.launch.revision === binding.revision
      && item.launch.instance === binding.instance && item.rpc === worker.rpc && item.started);
    if (!attachment?.launch || !await this.validate(descriptor, binding, worker, true))
      return { status: 'restart-required' };
    const status = attachment.launch.mode === 'follow' ? await this.broker.status(attachment.launch)
      : { status: 'connected' as const };
    if (this.options.pool.activeId !== worker.id || this.attachments.get(worker)?.get(attachment.record.requestId) !== attachment)
      return { status: 'unavailable' };
    return status;
  }
  private async validate(descriptor: ConfigurationDescriptor, binding: HostBinding, worker: SessionRuntime, connected = false) {
    const matches = [...this.attachments.get(worker)?.values() ?? []].filter(item =>
      item.record.pluginId === binding.pluginId && item.record.consumer === binding.consumer
      && item.record.root === resolve(descriptor.root) && item.rpc === worker.rpc
      && item.record.sessionId === worker.state?.sessionId);
    if (matches.length !== 1) return false;
    const attachment = matches[0];
    if (attachment.record.declarationHash !== binding.declarationHash) return false;
    try {
      if (!this.options.available()) return false;
      const inspected: unknown = await attachment.rpc.request('desktop_plugin_host',
        { action: 'inspect', requestId: attachment.record.requestId }, 10000);
      if (!nativeRecord(inspected) || inspected.conflict || inspected.phase === 'failed' || connected && inspected.phase !== 'connected'
        || Object.entries(attachment.record).some(([key, value]) =>
          key !== 'phase' && inspected[key as keyof NativeRecord] !== value)) return false;
      const manifest = JSON.parse((await plainFile(descriptor.root, 'step.plugin.json')).toString('utf8'));
      const server = manifest.mcpServers?.[binding.consumer];
      const expected = createHash('sha256').update(JSON.stringify([
        server.command.trim(), server.args ?? [], resolve(descriptor.root, server.cwd?.trim() ?? ''),
        Object.entries(server.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      ])).digest('hex');
      return expected === inspected.executionHash && this.options.available()
        && this.attachments.get(worker)?.get(attachment.record.requestId) === attachment
        && worker.rpc === attachment.rpc && worker.state?.sessionId === attachment.record.sessionId;
    } catch { return false; }
  }
  async close() { this.invalidate(); await this.broker.close(); }
}
