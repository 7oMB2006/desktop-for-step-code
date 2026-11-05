import { join } from 'node:path';
import { RpcProcess } from './runtime';
import { PluginLibrary } from './plugin-library.mjs';
import { PluginRepositoryInfo } from './plugin-repository.mjs';
import { PluginConfigurationStore } from './plugin-configuration.mjs';
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
  async catalog(): Promise<CapabilityCatalog> {
    const catalog = await this.library.project(await this.request('catalog'));
    for (const plugin of [...catalog.plugins, ...catalog.available])
      if (plugin.package && plugin.repository) plugin.package.stars = await this.repositories.snapshot(plugin.repository);
    return catalog;
  }
  async repositoryInfo(input: { ref: string; refresh: boolean }) {
    if (!input || typeof input.ref !== 'string' || typeof input.refresh !== 'boolean') throw new Error('capability:invalid-input');
    await this.catalog();
    const { descriptor } = await this.library.reference(input.ref);
    if (!descriptor.repository) throw new Error('capability:not-found');
    return input.refresh ? this.repositories.refresh(descriptor.repository) : this.repositories.snapshot(descriptor.repository);
  }
  async document(input: unknown) {
    await this.catalog();
    return this.library.document(input);
  }
  async configuration(input: { ref: string }, save?: PluginConfigurationInput) {
    if (!input || typeof input.ref !== 'string') throw new Error('capability:invalid-input');
    const catalog = await this.catalog();
    const { descriptor } = await this.library.reference(input.ref);
    const context = { ...descriptor, ref: input.ref };
    const current = await this.configurations.read(context);
    if (catalog.mcp.some(server => server.name === `${descriptor.id}__${current.schema.consumer.server}` && server.source !== 'plugin'))
      throw new Error('capability:configuration-consumer-conflict');
    return save ? this.configurations.save(context, save) : current;
  }
  mutate(input: CapabilityMutation): Promise<CapabilityResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || JSON.stringify(input).length > 150000) throw new Error('capability:invalid-input');
    const operation = this.mutation.then(async () => {
      let expected: { expectedFingerprint: string; expectedSource: string } | undefined;
      if (input.action === 'plugin-install' && input.ref) {
        await this.catalog();
        const { descriptor } = await this.library.reference(input.ref);
        if (descriptor.kind !== 'available' || descriptor.name !== input.name || descriptor.marketplace !== input.marketplace || !descriptor.source)
          throw new Error('capability:stale');
        expected = { expectedFingerprint: descriptor.fingerprint, expectedSource: descriptor.source };
      }
      if (input.action === 'plugin-remove') await this.configurations.revoke(input.id);
      if (input.action.startsWith('marketplace-') || ['plugin-install', 'plugin-remove'].includes(input.action)) this.library.invalidate();
      return this.request('mutate', { input: { ...input, ...expected } });
    });
    this.mutation = operation.catch(() => {});
    return operation;
  }
  importSkill(path: string): Promise<CapabilityResult> { return this.request('import', { path }); }
  async stop() { await Promise.all([...this.workers].map(worker => worker.stop())); }
}
