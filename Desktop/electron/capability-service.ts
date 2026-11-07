import { join } from 'node:path';
import { RpcProcess } from './runtime';
import { PluginLibrary } from './plugin-library.mjs';
import { PluginRepositoryInfo } from './plugin-repository.mjs';
import { PluginConfigurationStore } from './plugin-configuration.mjs';
import { recoverPluginUpdate } from './plugin-update.mjs';
import semver from 'semver';
import type { PluginConfigurationInput } from '../src/capabilities';
import type { CapabilityCatalog, CapabilityMutation, CapabilityResult } from '../src/capabilities';

export async function assertPluginUnused(id: string, workers: Iterable<{
  rpc: { request(type: string): Promise<unknown> };
}>) {
  try {
    for (const worker of workers) {
      const summary = await worker.rpc.request('get_desktop_summary') as { mcp?: { name: string; status: string }[] };
      if (!Array.isArray(summary?.mcp) || summary.mcp.some(server =>
        server.name.startsWith(`${id}__`) && server.status !== 'disabled'))
        throw new Error('capability:resource-in-use');
    }
  } catch {
    // A missing observation cannot establish that Windows has released a directory.
    throw new Error('capability:resource-in-use');
  }
}

export class CapabilityService {
  private workers = new Set<RpcProcess>();
  private library: PluginLibrary;
  private repositories: PluginRepositoryInfo;
  private configurations: PluginConfigurationStore;
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private options: {
    root: string; runtime: string; node: string; environment(): NodeJS.ProcessEnv;
    validateImage?(bytes: Buffer): boolean;
    fetchRepository?: typeof globalThis.fetch;
  }) {
    this.library = new PluginLibrary(options.root, options.validateImage);
    this.repositories = new PluginRepositoryInfo(options.root, { fetch: options.fetchRepository });
    this.configurations = new PluginConfigurationStore(options.root);
  }
  private async request(type: string, args: Record<string, unknown> = {}) {
    const { root, runtime, node } = this.options;
    const worker = new RpcProcess(() => {});
    this.workers.add(worker);
    try {
      // A dedicated, short-lived management worker keeps upstream HOME discovery
      // inside Desktop without changing the environment of any live agent.
      worker.start(node, join(runtime, 'capability-admin.mjs'), root, {
        ...this.options.environment(), HOME: root, USERPROFILE: root,
      });
      return await worker.request(type, args, type === 'catalog' ? 30000 : 150000);
    } finally { await worker.stop(); this.workers.delete(worker); }
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.mutation.then(action);
    this.mutation = operation.catch(() => {});
    return operation;
  }
  recover() { return this.enqueue(() => recoverPluginUpdate(this.options.root)); }
  catalog(): Promise<CapabilityCatalog> { return this.enqueue(() => this.readCatalog()); }
  private async readCatalog(): Promise<CapabilityCatalog> {
    const catalog = await this.library.project(await this.request('catalog'));
    for (const plugin of [...catalog.plugins, ...catalog.available])
      if (plugin.package && plugin.repository) plugin.package.stars = await this.repositories.snapshot(plugin.repository);
    for (const plugin of catalog.plugins) {
      plugin.update = { status: 'unavailable', reason: 'source' };
      if (!plugin.package || plugin.package.provenance !== 'recorded') continue;
      const installed = (await this.library.reference(plugin.package.ref)).descriptor;
      const matches = [];
      for (const candidate of catalog.available) {
        if (!candidate.package || candidate.name !== installed.name) continue;
        const descriptor = (await this.library.reference(candidate.package.ref)).descriptor;
        if (descriptor.source === installed.source && descriptor.marketplace === installed.marketplace) matches.push(candidate);
      }
      if (matches.length !== 1) {
        if (matches.length > 1) plugin.update = { status: 'unavailable', reason: 'conflict' };
        continue;
      }
      const candidate = matches[0];
      if (candidate.blocked || candidate.id !== plugin.id || candidate.package?.provenance !== 'recorded') {
        plugin.update = { status: 'unavailable', reason: 'conflict' }; continue;
      }
      if (!semver.valid(plugin.version) || !semver.valid(candidate.version)) {
        plugin.update = { status: 'unavailable', reason: 'version' }; continue;
      }
      plugin.update = semver.gt(candidate.version!, plugin.version!)
        ? { status: 'available', version: candidate.version, ref: candidate.package!.ref } : { status: 'current' };
    }
    return { ...catalog, pluginUpdates: true };
  }
  repositoryInfo(input: { ref: string; refresh: boolean }) { return this.enqueue(async () => {
    if (!input || typeof input.ref !== 'string' || typeof input.refresh !== 'boolean') throw new Error('capability:invalid-input');
    await this.readCatalog();
    const { descriptor } = await this.library.reference(input.ref);
    if (!descriptor.repository) throw new Error('capability:not-found');
    return input.refresh ? this.repositories.refresh(descriptor.repository) : this.repositories.snapshot(descriptor.repository);
  }); }
  document(input: unknown) { return this.enqueue(async () => {
    await this.readCatalog();
    return this.library.document(input);
  }); }
  configuration(input: { ref: string }, save?: PluginConfigurationInput) { return this.enqueue(async () => {
    if (!input || typeof input.ref !== 'string') throw new Error('capability:invalid-input');
    const catalog = await this.readCatalog();
    const { descriptor } = await this.library.reference(input.ref);
    const context = { ...descriptor, ref: input.ref };
    const current = await this.configurations.read(context);
    if (catalog.mcp.some(server => server.name === `${descriptor.id}__${current.schema.consumer.server}` && server.source !== 'plugin'))
      throw new Error('capability:configuration-consumer-conflict');
    return save ? this.configurations.save(context, save) : current;
  }); }
  mutate(input: CapabilityMutation): Promise<CapabilityResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || JSON.stringify(input).length > 150000) throw new Error('capability:invalid-input');
    return this.enqueue(async () => {
      let expected: Record<string, string> | undefined;
      if (input.action === 'plugin-update') {
        const catalog = await this.readCatalog();
        const plugin = catalog.plugins.find(item => item.id === input.id && item.package?.ref === input.ref);
        if (!plugin || plugin.update?.status !== 'available' || plugin.update.ref !== input.candidate)
          throw new Error('capability:stale');
        const installed = (await this.library.reference(input.ref)).descriptor;
        const candidate = (await this.library.reference(input.candidate)).descriptor;
        if (!installed.source || !installed.marketplace || !installed.instance) throw new Error('capability:stale');
        expected = { name: installed.name, marketplace: installed.marketplace,
          expectedSource: installed.source, expectedInstance: installed.instance,
          expectedOldFingerprint: installed.fingerprint, expectedFingerprint: candidate.fingerprint,
          expectedVersion: plugin.update.version!, expectedOldVersion: plugin.version! };
      }
      if (input.action === 'plugin-install' && input.ref) {
        await this.readCatalog();
        const { descriptor } = await this.library.reference(input.ref);
        if (descriptor.kind !== 'available' || descriptor.name !== input.name || descriptor.marketplace !== input.marketplace || !descriptor.source)
          throw new Error('capability:stale');
        expected = { expectedFingerprint: descriptor.fingerprint, expectedSource: descriptor.source };
      }
      if (input.action.startsWith('marketplace-') || ['plugin-install', 'plugin-remove', 'plugin-update', 'plugin-check-updates'].includes(input.action)) this.library.invalidate();
      return this.request('mutate', { input: { ...input, ...expected } });
    });
  }
  importSkill(path: string): Promise<CapabilityResult> { return this.enqueue(() => this.request('import', { path })); }
  async stop() { await Promise.all([...this.workers].map(worker => worker.stop())); }
}
