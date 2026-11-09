import { join } from 'node:path';
import { RpcManagementStopError, RpcProcess } from './runtime';
import { PluginLibrary } from './plugin-library.mjs';
import { PluginRepositoryInfo } from './plugin-repository.mjs';
import { PluginConfigurationStore } from './plugin-configuration.mjs';
import { inspectPluginUpdate, recoverPluginUpdate } from './plugin-update.mjs';
import { dataOnlyThemeFingerprint, digest, optionalFile, scanInstalled } from './plugin-files.mjs';
import { capabilityPolicy, type CapabilityGuard } from './capability-policy';
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
  private quarantined = false;
  private runtimeQuarantined = false;
  private initialized = false;
  get available() { return !this.quarantined; }
  get runtimeAvailable() { return !this.runtimeQuarantined; }
  constructor(private options: {
    root: string; runtime: string; node: string; environment(): NodeJS.ProcessEnv;
    validateImage?(bytes: Buffer, maxDimension?: number): boolean;
    fetchRepository?: typeof globalThis.fetch;
    createWorker?(): RpcProcess;
    guardRecovery?: (id: string) => Promise<void | (() => void)>;
  }) {
    this.library = new PluginLibrary(options.root, options.validateImage);
    this.repositories = new PluginRepositoryInfo(options.root, { fetch: options.fetchRepository });
    this.configurations = new PluginConfigurationStore(options.root);
  }
  private async request(type: string, args: Record<string, unknown> = {}, protectsRuntime = false) {
    this.assertHealthy();
    const { root, runtime, node } = this.options;
    const worker = this.options.createWorker?.() ?? new RpcProcess(() => {});
    this.workers.add(worker);
    let succeeded = false;
    try {
      // A dedicated, short-lived management worker keeps upstream HOME discovery
      // inside Desktop without changing the environment of any live agent.
      worker.start(node, join(runtime, 'capability-admin.mjs'), root, {
        ...this.options.environment(), HOME: root, USERPROFILE: root,
      });
      const result = await worker.request(type, args, type === 'catalog' ? 30000 : 150000);
      succeeded = true;
      return result;
    } finally {
      try {
        await worker.stopManagement();
        this.workers.delete(worker);
      } catch {
        // Never release the serial writer to another management process when the
        // previous one may still be writing, even if it sent its success response.
        this.quarantined = true;
        this.runtimeQuarantined ||= protectsRuntime;
        throw new Error(type === 'catalog' ? 'capability:management-unavailable'
          : succeeded ? 'capability:management-committed' : 'capability:management-uncertain');
      }
      if (protectsRuntime) {
        let pending = true;
        try {
          pending = await optionalFile(root, 'desktop-plugins/update-transaction.json', 65536) !== undefined;
        } catch { /* Unknown recovery state cannot release the runtime barrier. */ }
        if (pending) {
          this.runtimeQuarantined = true;
          if (succeeded) throw new Error('capability:update-recovery-required');
        }
      }
    }
  }
  private assertHealthy() {
    if (this.quarantined) throw new Error('capability:management-unavailable');
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.mutation.then(action);
    this.mutation = operation.catch(() => {});
    return operation;
  }
  private async themeRemovalFingerprint(input: CapabilityMutation): Promise<string | undefined> {
    if (input.action !== 'plugin-remove') return;
    try {
      const matches = (await scanInstalled(this.options.root)).filter(plugin => plugin.id === input.id);
      if (matches.length !== 1) return;
      return await dataOnlyThemeFingerprint(join(this.options.root, 'plugins', matches[0].folder), input.id);
    } catch { return; }
  }
  private async themeInstallExpected(input: CapabilityMutation): Promise<Record<string, string> | undefined> {
    if (input.action !== 'plugin-install' || !input.ref) return;
    try {
      // Use an already issued reference: classification must not recover a pending
      // transaction or discover a different candidate before the ownership guard.
      const { descriptor } = await this.library.reference(input.ref);
      if (descriptor.kind !== 'available' || descriptor.provenance !== 'recorded'
        || descriptor.name !== input.name || descriptor.marketplace !== input.marketplace || !descriptor.source) return;
      const fingerprint = await dataOnlyThemeFingerprint(descriptor.root, descriptor.id);
      if (fingerprint !== descriptor.fingerprint) return;
      return { expectedFingerprint: fingerprint, expectedSource: descriptor.source, themeId: descriptor.id };
    } catch { return; }
  }
  initialize() { return this.enqueue(() => this.initializeStorage()); }
  private async initializeStorage() {
    this.assertHealthy();
    if (this.initialized) return;
    await this.request('initialize');
    this.initialized = true;
  }
  recover() { return this.enqueue(async () => {
    this.assertHealthy();
    const pending = await inspectPluginUpdate(this.options.root);
    if (!pending) return;
    if (!this.options.guardRecovery) throw new Error('capability:update-recovery-required');
    const release = await this.options.guardRecovery(pending.id);
    try { await recoverPluginUpdate(this.options.root, { expectedJournal: pending.fingerprint }); }
    catch (error) { this.runtimeQuarantined = true; throw error; }
    finally { release?.(); }
  }); }
  catalog(): Promise<CapabilityCatalog> { return this.enqueue(() => this.readCatalog()); }
  private async readCatalog(): Promise<CapabilityCatalog> {
    const catalog = await this.library.project(await this.request('catalog'));
    for (const plugin of [...catalog.plugins, ...catalog.available]) {
      if (plugin.package && plugin.repository) plugin.package.stars = await this.repositories.snapshot(plugin.repository);
      if (plugin.package) {
        try {
          const { descriptor } = await this.library.reference(plugin.package.ref);
          if (await optionalFile(descriptor.root, 'dfsc.theme.json', 32768) !== undefined
            && await dataOnlyThemeFingerprint(descriptor.root, descriptor.id) === descriptor.fingerprint)
            plugin.package.dataOnlyTheme = true;
        } catch { /* Unreadable packages receive no independent-operation affordance. */ }
      }
    }
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
  private async readDesktop(ref: string) {
    if (typeof ref !== 'string' || ref.length > 80) throw new Error('capability:invalid-input');
    const catalog = await this.readCatalog();
    const plugin = catalog.plugins.find(item => item.package?.ref === ref);
    if (!plugin?.package?.desktop || plugin.package.provenance !== 'recorded')
      throw new Error('capability:stale');
    const { descriptor } = await this.library.reference(ref);
    if (descriptor.kind !== 'installed' || descriptor.provenance !== 'recorded') throw new Error('capability:stale');
    return plugin;
  }
  desktop(ref: string) { return this.enqueue(() => this.readDesktop(ref)); }
  connection(ref: string) { return this.enqueue(async () => {
    const plugin = await this.readDesktop(ref);
    if (plugin.package?.desktop?.connection?.protocol !== 'agent-bridge-v1'
      || plugin.package.desktop.surface !== 'main-view') throw new Error('capability:invalid-input');
    const { descriptor } = await this.library.reference(ref);
    return digest(JSON.stringify([descriptor.root, descriptor.id, descriptor.instance, descriptor.fingerprint]));
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
  mutate(input: CapabilityMutation, guard?: CapabilityGuard): Promise<CapabilityResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || JSON.stringify(input).length > 150000) throw new Error('capability:invalid-input');
    // Freeze caller-owned input before the operation waits in the serial queue.
    input = JSON.parse(JSON.stringify(input));
    return this.enqueue(async () => {
      this.assertHealthy();
      capabilityPolicy(input.action);
      let expected: Record<string, string> | undefined;
      let themeId: string | undefined;
      const fingerprint = await this.themeRemovalFingerprint(input);
      const installation = await this.themeInstallExpected(input);
      if (fingerprint && input.action === 'plugin-remove') {
        expected = { expectedFingerprint: fingerprint }; themeId = input.id;
      }
      if (installation) {
        const { themeId: id, ...proof } = installation;
        expected = proof; themeId = id;
      }
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
        if (await dataOnlyThemeFingerprint(installed.root, input.id) === installed.fingerprint
          && await dataOnlyThemeFingerprint(candidate.root, input.id) === candidate.fingerprint)
          themeId = input.id;
      }
      const policy = Object.freeze({ ...capabilityPolicy(input.action, themeId),
        ...(['plugin-remove', 'plugin-update'].includes(input.action) && 'id' in input ? { pluginId: input.id } : {}) });
      const release = await guard?.(policy);
      try {
        // Recovery is a different operation, guarded by the actual journal owner.
        // Neither a mutation nor a follow-up catalog read may perform it implicitly.
        if (await optionalFile(this.options.root, 'desktop-plugins/update-transaction.json', 65536) !== undefined)
          throw new Error('capability:update-recovery-required');
        if (input.action === 'plugin-install' && input.ref) {
          const { descriptor } = await this.library.reference(input.ref);
          if (descriptor.kind !== 'available' || descriptor.name !== input.name || descriptor.marketplace !== input.marketplace || !descriptor.source)
            throw new Error('capability:stale');
          if (expected && (expected.expectedFingerprint !== descriptor.fingerprint || expected.expectedSource !== descriptor.source))
            throw new Error('capability:stale');
          expected ??= { expectedFingerprint: descriptor.fingerprint, expectedSource: descriptor.source };
        }
        await this.initializeStorage();
        if (input.action.startsWith('marketplace-') || ['plugin-install', 'plugin-remove', 'plugin-update', 'plugin-check-updates'].includes(input.action)) this.library.invalidate();
        return await this.request('mutate', { input: { ...input, ...expected, preserveRuntime: policy.scope !== 'runtime' } },
          policy.scope === 'runtime');
      } finally {
        release?.();
      }
    });
  }
  importSkill(path: string): Promise<CapabilityResult> { return this.enqueue(async () => {
    await this.initializeStorage();
    return this.request('import', { path }, true);
  }); }
  async stop() { await Promise.all([...this.workers].map(async worker => {
    try { await worker.stopManagement(); }
    catch (error) {
      // Shutdown needs confirmed exit, not write-safety proof; quarantine stays intact.
      if (!(error instanceof RpcManagementStopError) || !error.exitConfirmed) throw error;
    }
    this.workers.delete(worker);
  })); }
}
