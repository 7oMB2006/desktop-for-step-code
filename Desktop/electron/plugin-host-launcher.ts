import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PluginHostBroker, type HostProvider } from './plugin-host-broker';
import { plainFile } from './plugin-files.mjs';
import type { HostBinding } from './plugin-host-contract.mjs';
import type { ConfigurationDescriptor } from './plugin-configuration.mjs';
import type { CapabilityService } from './capability-service';
import type { SessionRuntime, SessionRuntimes } from './session-runtimes';
import type { LaunchContext } from '../../examples/plugins/host-client/protocol.mjs';

interface NativeRecord {
  requestId: string; sessionId: string; pluginId: string; consumer: string; root: string;
  executionHash: string; conflict: boolean; phase: 'pending' | 'starting' | 'connected' | 'failed';
  declarationHash: string;
}
type Attachment = { record: NativeRecord; rpc: SessionRuntime['rpc']; launch?: LaunchContext };
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
  private attaching = new WeakMap<SessionRuntime, Promise<void>>();
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
    if (pending) return pending;
    const operation = this.open(worker).finally(() => {
      if (this.attaching.get(worker) === operation) this.attaching.delete(worker);
    });
    this.attaching.set(worker, operation);
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
        try {
          await this.options.capabilities.withHostDescriptor(record.pluginId, record.root, record.consumer, async descriptor => {
            if (!current()) throw new Error('Stale plugin launch');
            const launch = await this.broker.issue(descriptor, worker);
            attachment.launch = launch;
            if (!current()) throw new Error('Stale plugin launch');
            const result = await rpc.request('desktop_plugin_host',
              { action: 'start', requestId: record.requestId, context: JSON.stringify(launch) }, 30000);
            if (!current() || result?.started !== true) throw new Error('Plugin launch failed');
          });
        } catch {
          if (attachment.launch) {
            this.broker.release(attachment.launch);
            delete attachment.launch;
            // Keep this record consumed locally; transaction release cannot renew an issued launch.
          } else attachments.delete(record.requestId);
          // Failure is local to this consumer; no raw native error is published.
        }
      }
    } finally {
      if (identityCurrent() && !this.options.available()) this.deferred.set(worker, rpc);
    }
  }
  private async validate(descriptor: ConfigurationDescriptor, binding: HostBinding, worker: SessionRuntime) {
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
      if (!nativeRecord(inspected) || inspected.conflict || inspected.phase === 'failed'
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
