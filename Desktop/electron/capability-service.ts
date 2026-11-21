import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RpcManagementStopError, RpcProcess } from './runtime';
import { PluginLibrary, type PluginReferenceSnapshot } from './plugin-library.mjs';
import { withVerifiedPackage, type PackageReadScope } from './plugin-read-scope.mjs';
import { PluginRepositoryInfo } from './plugin-repository.mjs';
import { PluginConfigurationStore } from './plugin-configuration.mjs';
import type { ConfigurationDescriptor } from './plugin-configuration.mjs';
import { PluginHostBindingStore, parseHostModels, type HostBinding, type PluginHostAccountBinding, type UnconfiguredHostBinding } from './plugin-host-contract.mjs';
import { inspectPluginUpdate, recoverPluginUpdate } from './plugin-update.mjs';
import { dataOnlyThemeFingerprint, digest, optionalFile, scanInstalled } from './plugin-files.mjs';
import { capabilityPolicy, type CapabilityGuard } from './capability-policy';
import semver from 'semver';
import type { PluginConfigurationInput, PluginHostRuntime, PluginHostSettings, PluginHostSettingsInput } from '../src/capabilities';
import type { PluginHostSourceChoice } from '../src/capabilities';
import { stepHostUnavailable } from '../src/step-host-catalog';
import type { CapabilityCatalog, CapabilityMutation, CapabilityPlugin, MarketplacePlugin, CapabilityResult } from '../src/capabilities';
import type { PluginRemovalRequest, PluginUpdateCompatibility, PluginUpdateRequest } from '../src/plugin-update';
import type { PluginConfirmationBinding, PluginConfirmationSource } from '../src/plugin-confirmations';
import { parsePluginConfirmations, validPluginConfirmationBinding } from './plugin-confirmation-contract.mjs';

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
  private hostBindings: PluginHostBindingStore;
  private mutation: Promise<unknown> = Promise.resolve();
  private quarantined = false;
  private runtimeQuarantined = false;
  private desktopUnavailable = false;
  private desktopRead?: Promise<CapabilityCatalog>;
  private desktopRevision = 0;
  private initialized = false;
  get available() { return !this.quarantined; }
  get runtimeAvailable() { return !this.runtimeQuarantined; }
  constructor(private options: {
    root: string; runtime: string; node: string; environment(): NodeJS.ProcessEnv;
    validateImage?(bytes: Buffer, maxDimension?: number): boolean;
    fetchRepository?: typeof globalThis.fetch;
    beforePluginMutation?(instance?: string): void;
    hostAvailable?(): boolean;
    hostAccountChoice?(): PluginHostSourceChoice | undefined;
    selectHostAccount?(ticket: unknown): PluginHostAccountBinding | undefined;
    hostStatus?(descriptor: ConfigurationDescriptor, binding: HostBinding | UnconfiguredHostBinding): Promise<PluginHostRuntime>;
    createWorker?(): RpcProcess;
    guardRecovery?: (id: string) => Promise<void | (() => void)>;
  }) {
    this.library = new PluginLibrary(options.root, options.validateImage);
    this.repositories = new PluginRepositoryInfo(options.root, { fetch: options.fetchRepository });
    this.configurations = new PluginConfigurationStore(options.root);
    this.hostBindings = new PluginHostBindingStore(options.root);
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
      const result = await worker.request(type, args, ['catalog', 'desktop-catalog', 'host-descriptor', 'target-catalog'].includes(type) ? 30000 : 150000);
      succeeded = true;
      return result;
    } finally {
      try {
        await worker.stopManagement();
        this.workers.delete(worker);
      } catch {
        // Retain unknown worker ownership. Only the inert navigation reader can
        // fail independently; possible writers keep the global safety barrier.
        if (type === 'desktop-catalog') this.desktopUnavailable = true;
        else {
          this.quarantined = true;
          this.runtimeQuarantined ||= protectsRuntime;
        }
        throw new Error(['catalog', 'desktop-catalog', 'host-descriptor', 'target-catalog'].includes(type) ? 'capability:management-unavailable'
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
  private async installExpected(input: CapabilityMutation): Promise<Record<string, string> | undefined> {
    if (input.action !== 'plugin-install' || !input.ref) return;
    try {
      // Use an already issued reference: classification must not recover a pending
      // transaction or discover a different candidate before the ownership guard.
      const { descriptor } = await this.library.reference(input.ref);
      if (descriptor.kind !== 'available' || descriptor.provenance !== 'recorded'
        || descriptor.name !== input.name || descriptor.marketplace !== input.marketplace || !descriptor.source) return;
      const fingerprint = await dataOnlyThemeFingerprint(descriptor.root, descriptor.id);
      return { expectedFingerprint: descriptor.fingerprint, expectedSource: descriptor.source,
        ...(fingerprint === descriptor.fingerprint ? { themeId: descriptor.id } : {}) };
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
    this.desktopRevision++;
    try {
      this.options.beforePluginMutation?.();
      await recoverPluginUpdate(this.options.root, { expectedJournal: pending.fingerprint });
    }
    catch (error) { this.runtimeQuarantined = true; throw error; }
    finally { this.desktopRevision++; release?.(); }
  }); }
  catalog(): Promise<CapabilityCatalog> { return this.enqueue(() => this.readCatalog()); }
  desktopCatalog(): Promise<CapabilityCatalog> {
    if (this.desktopUnavailable) return Promise.reject(new Error('capability:management-unavailable'));
    if (this.desktopRead) return this.desktopRead;
    // Navigation may observe a transient menu during a mutation, but cannot grant
    // document or execution access. It must not hold the runtime's writer barrier.
    const operation = (async () => {
      for (;;) {
        const revision = this.desktopRevision;
        try {
          const catalog = await this.library.project(await this.request('desktop-catalog'), { partial: true });
          if (revision === this.desktopRevision) return catalog;
        } catch (error) {
          if (revision === this.desktopRevision || this.desktopUnavailable || this.quarantined) throw error;
        }
      }
    })();
    this.desktopRead = operation;
    const finished = () => { if (this.desktopRead === operation) this.desktopRead = undefined; };
    void operation.then(finished, finished);
    return operation;
  }
  // Main-only. Native discovery and the read-only management worker independently
  // identify the installed consumer without projecting the whole marketplace.
  withHostDescriptor<T>(pluginId: string, root: string, consumer: string,
    action: (descriptor: ConfigurationDescriptor) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const descriptor = await this.request('host-descriptor', { input: { pluginId, root, consumer } });
      if (descriptor?.kind !== 'installed' || descriptor.provenance !== 'recorded' || descriptor.id !== pluginId
        || typeof descriptor.root !== 'string' || resolve(descriptor.root) !== resolve(root)
        || typeof descriptor.name !== 'string' || typeof descriptor.instance !== 'string'
        || !/^[a-f0-9-]{36}$/u.test(descriptor.instance)
        || typeof descriptor.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(descriptor.fingerprint))
        throw new Error('capability:host-unavailable');
      return action({ ...descriptor, ref: randomUUID() });
    });
  }
  private async readCatalog(): Promise<CapabilityCatalog> {
    const catalog = await this.library.project(await this.request('catalog'));
    for (const plugin of [...catalog.plugins, ...catalog.available]) {
      if (plugin.package && plugin.repository) plugin.package.stars = await this.repositories.snapshot(plugin.repository);
      if (plugin.package) {
        try {
          const { descriptor } = this.library.referenceSnapshot(plugin.package.ref);
          if (await optionalFile(descriptor.root, 'dfsc.theme.json', 32768) !== undefined
            && await dataOnlyThemeFingerprint(descriptor.root, descriptor.id) === descriptor.fingerprint)
            plugin.package.dataOnlyTheme = true;
        } catch { /* Unreadable packages receive no independent-operation affordance. */ }
      }
    }
    for (const plugin of catalog.plugins) {
      plugin.update = { status: 'unavailable', reason: 'source' };
      if (!plugin.package || plugin.package.provenance !== 'recorded') continue;
      const installed = this.library.referenceSnapshot(plugin.package.ref).descriptor;
      const matches = [];
      for (const candidate of catalog.available) {
        if (!candidate.package || candidate.name !== installed.name) continue;
        const descriptor = this.library.referenceSnapshot(candidate.package.ref).descriptor;
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
  private async withTarget<T>(ref: string, mcp: boolean, action: (context: {
    catalog: CapabilityCatalog; plugin: CapabilityPlugin | MarketplacePlugin;
    descriptor: ConfigurationDescriptor; scope: PackageReadScope;
  }) => Promise<T>, writes = false): Promise<T> {
    if (typeof ref !== 'string' || ref.length > 80) throw new Error('capability:invalid-input');
    const expected = this.library.referenceSnapshot(ref).descriptor;
    const identity = (descriptor: PluginReferenceSnapshot['descriptor']) => JSON.stringify([
      resolve(descriptor.root), descriptor.fingerprint, descriptor.kind, descriptor.provenance,
      descriptor.id, descriptor.name, descriptor.instance, descriptor.source, descriptor.marketplace,
    ]);
    const key = identity(expected);
    const read = async () => {
      const raw = await this.request('target-catalog', { input: { descriptor: expected, mcp } }) as CapabilityCatalog;
      const targets = [...raw.plugins, ...raw.available] as unknown as { packageDescriptor?: PluginReferenceSnapshot['descriptor'] }[];
      if (targets.length !== 1 || !targets[0].packageDescriptor || identity(targets[0].packageDescriptor) !== key)
        throw new Error('capability:stale');
      return raw;
    };
    let readingIdentity = true, confirmedCommitted = false, actionThrew = false, actionError: unknown;
    try {
      const raw = await read();
      return await withVerifiedPackage(expected, async scope => {
        // Upgrade only this verified target; a navigation token itself grants no file access.
        const catalog = await this.library.project(raw, { retain: true });
        const plugin = [...catalog.plugins, ...catalog.available][0];
        if (plugin?.package?.ref !== ref) throw new Error('capability:stale');
        const descriptor = { ...this.library.referenceSnapshot(ref).descriptor, ref };
        readingIdentity = false;
        let result: T;
        try { result = await action({ catalog, plugin, descriptor, scope }); }
        catch (error) { actionThrew = true; actionError = error; throw error; }
        if (writes) confirmedCommitted = true;
        readingIdentity = true;
        // Never add a management subprocess after a store's commit pointer changed.
        if (!writes) await read();
        return result;
      });
    } catch (error) {
      if (confirmedCommitted || readingIdentity || actionThrew && error !== actionError
        || String(error) === 'Error: capability:stale') this.library.revoke(ref);
      if (confirmedCommitted) throw new Error('capability:settings-committed-unverified');
      throw error;
    }
  }
  repositoryInfo(input: { ref: string; refresh: boolean }) { return this.enqueue(async () => {
    if (!input || typeof input.ref !== 'string' || typeof input.refresh !== 'boolean') throw new Error('capability:invalid-input');
    return this.withTarget(input.ref, false, async ({ descriptor }) => {
      const repository = this.library.referenceSnapshot(descriptor.ref).descriptor.repository;
      if (!repository) throw new Error('capability:not-found');
      return input.refresh ? this.repositories.refresh(repository) : this.repositories.snapshot(repository);
    });
  }); }
  document(input: unknown) { return this.enqueue(async () => {
    if (!input || typeof input !== 'object' || !('ref' in input) || typeof input.ref !== 'string')
      throw new Error('capability:invalid-input');
    return this.withTarget(input.ref, false, ({ scope }) => this.library.document(input, scope));
  }); }
  private assertDesktop(plugin: CapabilityPlugin | MarketplacePlugin, descriptor: ConfigurationDescriptor): asserts plugin is CapabilityPlugin {
    if (!plugin.package?.desktop || descriptor.kind !== 'installed' || descriptor.provenance !== 'recorded')
      throw new Error('capability:stale');
  }
  desktop(ref: string) { return this.enqueue(() => this.withTarget(ref, false, async ({ plugin, descriptor }) => {
    this.assertDesktop(plugin, descriptor);
    return plugin;
  })); }
  confirmationPlugins() { return this.enqueue(async () => {
    const catalog = await this.readCatalog();
    return catalog.plugins.filter(plugin => plugin.package?.provenance === 'recorded'
      && plugin.package.confirmations?.length).map(plugin => ({
      ref: plugin.package!.ref, id: plugin.id, name: plugin.package!.desktop?.title ?? plugin.name,
    }));
  }); }
  confirmationSource(input: string | PluginConfirmationBinding): Promise<PluginConfirmationSource> {
    return this.enqueue(async () => {
      if (typeof input !== 'string' && !validPluginConfirmationBinding(input)) throw new Error('capability:invalid-input');
      const catalog = await this.readCatalog();
      const candidates = catalog.plugins.filter(plugin => typeof input === 'string'
        ? plugin.package?.ref === input : plugin.id === input.id);
      if (candidates.length !== 1) throw new Error('capability:stale');
      const plugin = candidates[0], ref = plugin.package?.ref;
      if (!ref || plugin.package?.provenance !== 'recorded') throw new Error('capability:stale');
      const { descriptor } = await this.library.reference(ref);
      if (descriptor.kind !== 'installed' || !descriptor.instance || descriptor.provenance !== 'recorded')
        throw new Error('capability:stale');
      const binding = { id: plugin.id, installation: digest(JSON.stringify([
        descriptor.root, descriptor.id, descriptor.instance, descriptor.source, descriptor.marketplace,
      ])) };
      if (typeof input !== 'string' && input.installation !== binding.installation) throw new Error('capability:stale');
      // Read the declaration strictly again; broken metadata must not become "no confirmation".
      const bytes = await optionalFile(descriptor.root, 'dfsc.plugin.json', 65536);
      const metadata = bytes && JSON.parse(bytes.toString('utf8'));
      if (!metadata || metadata.schemaVersion !== 1) throw new Error('capability:invalid-confirmation');
      const confirmations = parsePluginConfirmations(metadata.confirmations);
      await this.library.reference(ref);
      return { binding, name: plugin.package?.desktop?.title ?? plugin.name,
        revision: descriptor.fingerprint, confirmations };
    });
  }
  connection(ref: string) { return this.enqueue(() => this.withTarget(ref, false, async ({ plugin, descriptor }) => {
    this.assertDesktop(plugin, descriptor);
    if (plugin.package?.desktop?.connection?.protocol !== 'agent-bridge-v1'
      || plugin.package.desktop.surface !== 'main-view') throw new Error('capability:invalid-input');
    return digest(JSON.stringify([descriptor.root, descriptor.id, descriptor.instance, descriptor.fingerprint]));
  })); }
  configuration(input: { ref: string }, save?: PluginConfigurationInput) { return this.enqueue(async () => {
    if (!input || typeof input.ref !== 'string') throw new Error('capability:invalid-input');
    return this.withTarget(input.ref, true, async ({ catalog, plugin, descriptor, scope }) => {
      if (save && plugin.package?.hostSettingsAvailable) throw new Error('capability:host-unavailable');
      const current = await this.configurations.read(descriptor, scope);
      const servers = catalog.mcp.filter(server => server.name === `${descriptor.id}__${current.schema.consumer.server}`);
      if (servers.length !== 1 || servers[0].source !== 'plugin' || servers[0].pluginId !== descriptor.id
        || servers[0].transport !== 'stdio') throw new Error('capability:configuration-consumer-conflict');
      // A generic service may require a restart to read its new snapshot.
      // Saving it must not revoke unrelated live host leases.
      return save ? this.configurations.save(descriptor, save) : current;
    }, Boolean(save));
  }); }
  customBackgroundContext(ref?: string): Promise<{ ref: string; instance: string } | undefined> {
    if (ref !== undefined && (typeof ref !== 'string' || !ref || ref.length > 128))
      return Promise.reject(new Error('capability:invalid-input'));
    return this.enqueue(async () => {
      const catalog = await this.readCatalog();
      const matches = catalog.plugins.filter(plugin => plugin.id === 'custom-background');
      const current = matches.length === 1 && matches[0].package?.hostConfiguration === 'custom-background-v1'
        ? matches[0].package.ref : undefined;
      if (!current || ref !== undefined && current !== ref) {
        if (ref !== undefined) throw new Error('capability:stale');
        return;
      }
      try { return await this.library.customBackgroundContext(current); }
      catch {
        if (ref !== undefined) throw new Error('capability:stale');
        return;
      }
    });
  }
  hostSettings(input: { ref: string }, save?: PluginHostSettingsInput): Promise<PluginHostSettings> {
    return this.enqueue(async () => {
      if (!input || typeof input.ref !== 'string' || Object.keys(input).some(key =>
        !(save ? ['ref', 'revision', 'mode', 'models', 'configuration', 'accountTicket'] : ['ref']).includes(key))
        || save && (save.ref !== input.ref || Object.keys(save).some(key =>
          !['ref', 'revision', 'mode', 'models', 'configuration', 'accountTicket'].includes(key))))
        throw new Error('capability:invalid-input');
      return this.withTarget(input.ref, true, async ({ catalog, plugin, descriptor, scope }) => {
      if (descriptor.kind !== 'installed' || descriptor.provenance !== 'recorded')
        throw new Error('capability:host-unavailable');
      let binding: HostBinding | UnconfiguredHostBinding;
      try { binding = await this.hostBindings.current(descriptor, scope); }
      catch (error) {
        if (String(error).includes('dfsc-host:')) throw new Error('capability:invalid-host-declaration');
        throw error;
      }
      const servers = catalog.mcp.filter(server => server.name === `${descriptor.id}__${binding.declaration.consumer.server}`);
      if (servers.length !== 1 || servers[0].source !== 'plugin' || servers[0].pluginId !== descriptor.id
        || servers[0].transport !== 'stdio') throw new Error('capability:configuration-consumer-conflict');
      if (save) {
        this.assertHealthy();
        if (!this.runtimeAvailable
          || await optionalFile(this.options.root, 'desktop-plugins/update-transaction.json', 65536) !== undefined)
          throw new Error('capability:update-recovery-required');
        if (!this.options.hostAvailable?.()) throw new Error('capability:host-unavailable');
        if (JSON.stringify(save).length > 150000 || save.revision !== binding.revision)
          throw new Error('capability:stale-configuration');
        if (!['account', 'independent', 'paused'].includes(save.mode)
          || save.mode !== 'account' && (save.models !== undefined || save.accountTicket !== undefined)
          || (save.mode === 'independent' ? !save.configuration || save.configuration.ref !== input.ref : save.configuration !== undefined)
          || save.mode === 'paused' && !('mode' in binding))
          throw new Error('capability:invalid-configuration');
        // Validate before revocation or committing the independent configuration.
        const account = save.mode === 'account' ? this.options.selectHostAccount?.(save.accountTicket) : undefined;
        if (save.mode === 'account' && !account) throw new Error('capability:stale-configuration');
        const models = account ? parseHostModels(save.models ?? {}, binding.declaration.capabilities) : undefined;
        if (account && models && Object.entries(models).some(([capability, model]) =>
          stepHostUnavailable(capability as keyof typeof models, account, model)))
          throw new Error('capability:invalid-configuration');
        if (save.mode === 'independent') {
          const config = await this.configurations.read(descriptor, scope);
          if (config.schema.consumer.server !== binding.declaration.consumer.server)
            throw new Error('capability:configuration-consumer-conflict');
        }
        this.options.beforePluginMutation?.(descriptor.instance);
        const config = save.mode === 'independent' ? await this.configurations.save(descriptor, save.configuration!) : undefined;
        try {
          binding = await this.hostBindings.select(descriptor, { revision: save.revision,
            mode: save.mode === 'account' ? 'follow' : save.mode,
            ...(config ? { configurationRevision: config.revision } : { models, account }) });
        } catch (error) {
          // Two commit pointers are not one transaction. Never claim the old mode
          // still works when its independent configuration was already replaced.
          if (config) throw new Error('capability:host-selection-incomplete');
          throw error;
        }
      }
      const selected = 'mode' in binding ? binding : undefined;
      let independent, independentError;
      if (plugin.package?.configurationAvailable) {
        try {
          independent = await this.configurations.read(descriptor, scope);
          if (independent.schema.consumer.server !== binding.declaration.consumer.server)
            throw new Error('capability:configuration-consumer-conflict');
        } catch (error) {
          independent = undefined;
          independentError = /capability:[a-z-]+/u.exec(String(error))?.[0] ?? 'capability:invalid-configuration';
        }
      }
      const fallback: PluginHostRuntime = { status: save ? 'restart-required' : 'unavailable' };
      const runtime: PluginHostRuntime = !this.options.hostAvailable?.() ? { status: 'unsupported' }
        : !servers[0].enabled ? { status: 'disabled' }
          : save && save.mode !== 'paused' ? fallback
            : await this.options.hostStatus?.(descriptor, binding).catch(() => fallback) ?? fallback;
      // Construct the public projection explicitly; never spread a binding, receipt or launch.
      const source = selected?.account && { channel: selected.account.channel, region: selected.account.region };
      const legacyFollow = selected?.mode === 'follow' && !source;
      const account = this.options.hostAccountChoice?.();
      const accountMatches = Boolean(account && selected?.account
        && this.options.selectHostAccount?.(account.ticket)?.id === selected.account.id);
      return { ref: input.ref, revision: binding.revision, consumer: binding.declaration.consumer.server,
        capabilities: [...binding.declaration.capabilities],
        mode: selected?.mode === 'independent' || selected?.mode === 'paused' ? selected.mode : source ? 'account' : null,
        account, source, legacyFollow, accountMatches,
        models: selected ? { ...selected.models } : {}, configurationCurrent: selected?.configurationCurrent ?? false,
        independent, independentError, runtime };
      }, Boolean(save));
    });
  }
  private async updateExpected(input: PluginUpdateRequest) {
    const catalog = await this.readCatalog();
    const plugin = catalog.plugins.find(item => item.id === input.id && item.package?.ref === input.ref);
    if (!plugin || plugin.update?.status !== 'available' || plugin.update.ref !== input.candidate)
      throw new Error('capability:stale');
    const installed = (await this.library.reference(input.ref)).descriptor;
    const candidate = (await this.library.reference(input.candidate)).descriptor;
    if (!installed.source || !installed.marketplace || !installed.instance) throw new Error('capability:stale');
    return { installed, candidate, version: plugin.update.version!,
      expected: { name: installed.name, marketplace: installed.marketplace,
        expectedSource: installed.source, expectedInstance: installed.instance,
        expectedOldFingerprint: installed.fingerprint, expectedFingerprint: candidate.fingerprint,
        expectedVersion: plugin.update.version!, expectedOldVersion: plugin.version! } };
  }
  preflightUpdate(input: PluginUpdateRequest): Promise<PluginUpdateCompatibility & {
    stamp: string; version: string; identity: string; scope: 'theme' | 'runtime';
  }> {
    if (!input || Object.keys(input).some(key => !['id', 'ref', 'candidate'].includes(key))
      || ![input.id, input.ref, input.candidate].every(value => typeof value === 'string' && value.length <= 128))
      throw new Error('capability:invalid-input');
    input = { ...input };
    return this.enqueue(async () => {
      const { expected, version, installed, candidate } = await this.updateExpected(input);
      const report = await this.request('plugin-update-preflight', { input: { action: 'plugin-update', ...input, ...expected } });
      const theme = await dataOnlyThemeFingerprint(installed.root, input.id) === installed.fingerprint
        && await dataOnlyThemeFingerprint(candidate.root, input.id) === candidate.fingerprint;
      return { ...report, version, identity: digest(JSON.stringify(expected)), scope: theme ? 'theme' : 'runtime' };
    });
  }
  private async removalExpected(input: PluginRemovalRequest) {
    if (await optionalFile(this.options.root, 'desktop-plugins/update-transaction.json', 65536) !== undefined)
      throw new Error('capability:update-recovery-required');
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['id', 'ref'].includes(key))
      || typeof input.id !== 'string' || !input.id || input.id.length > 128
      || typeof input.ref !== 'string') throw new Error('capability:invalid-input');
    return this.withTarget(input.ref, false, async ({ plugin, descriptor }) => {
      if (descriptor.kind !== 'installed' || descriptor.id !== input.id) throw new Error('capability:stale');
      const expected = { expectedFingerprint: descriptor.fingerprint,
        ...(descriptor.instance ? { expectedInstance: descriptor.instance } : {}) };
      const identity = digest(JSON.stringify([descriptor.root, descriptor.id, descriptor.name,
        descriptor.instance, descriptor.source, descriptor.marketplace, descriptor.fingerprint]));
      return { status: 'compatible' as const, changes: [], stamp: identity, identity,
        version: plugin.version || 'unknown',
        scope: await dataOnlyThemeFingerprint(descriptor.root, input.id) === descriptor.fingerprint
          ? 'theme' as const : 'runtime' as const, expected };
    });
  }
  preflightRemoval(input: PluginRemovalRequest) {
    const frozen = structuredClone(input);
    return this.enqueue(() => this.removalExpected(frozen));
  }
  reloadTarget(input: { id: string; ref: string }) {
    return this.enqueue(() => this.withTarget(input.ref, true, async ({ catalog, plugin, descriptor, scope }) => {
      if (descriptor.kind !== 'installed' || descriptor.id !== input.id || descriptor.provenance !== 'recorded')
        throw new Error('capability:stale');
      const services = catalog.mcp.filter(server => server.source === 'plugin' && server.pluginId === input.id);
      if (!services.length) throw new Error('capability:reload-unsupported');
      const configuration = plugin.package?.configurationAvailable
        ? (await this.configurations.read(descriptor, scope)).revision : undefined;
      const binding = plugin.package?.hostSettingsAvailable
        ? await this.hostBindings.current(descriptor, scope) : undefined;
      return { name: plugin.name, root: descriptor.root, services: services.map(item => item.name),
        stamp: digest(JSON.stringify([descriptor.root, descriptor.id, descriptor.instance, descriptor.fingerprint,
          services, configuration, binding, await optionalFile(this.options.root, 'config.toml', 1024 * 1024),
          ...(input.id === 'bilibili-video-research'
            ? [await optionalFile(this.options.root, 'bvr/config.json', 1024 * 1024)] : [])])) };
    }));
  }
  remove(input: PluginRemovalRequest, guard: CapabilityGuard, checked: { stamp: string; identity: string }) {
    return this.mutate({ action: 'plugin-remove', id: input.id }, guard, { ...checked, removal: { ...input } });
  }
  mutate(input: CapabilityMutation, guard?: CapabilityGuard,
    checked?: { stamp: string; identity: string; removal?: PluginRemovalRequest }): Promise<CapabilityResult> {
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
      const installation = await this.installExpected(input);
      if (fingerprint && input.action === 'plugin-remove') {
        expected = { expectedFingerprint: fingerprint }; themeId = input.id;
      }
      if (installation) {
        const { themeId: id, ...proof } = installation;
        expected = proof; themeId = id;
      }
      if (input.action === 'plugin-update') {
        const update = await this.updateExpected(input);
        const { installed, candidate } = update;
        if (checked && digest(JSON.stringify(update.expected)) !== checked.identity) throw new Error('capability:stale');
        expected = { ...update.expected, ...(checked ? { expectedConfiguration: checked.stamp } : {}) };
        if (await dataOnlyThemeFingerprint(installed.root, input.id) === installed.fingerprint
          && await dataOnlyThemeFingerprint(candidate.root, input.id) === candidate.fingerprint)
          themeId = input.id;
      }
      if (input.action === 'plugin-remove' && checked?.removal) {
        const removal = await this.removalExpected(checked.removal);
        if (checked.removal.id !== input.id || removal.identity !== checked.identity || removal.stamp !== checked.stamp)
          throw new Error('capability:stale');
        expected = removal.expected;
        themeId = removal.scope === 'theme' ? input.id : undefined;
      }
      const policy = Object.freeze({ ...capabilityPolicy(input.action, themeId),
        ...(installation && !themeId ? { scope: 'next-start' as const } : {}),
        ...(['plugin-remove', 'plugin-update'].includes(input.action) && 'id' in input ? { pluginId: input.id } : {}) });
      const recheck = checked?.removal && input.action === 'plugin-remove' ? async () => {
        const current = await this.removalExpected(checked.removal!);
        if (current.identity !== checked.identity || current.stamp !== checked.stamp) throw new Error('capability:stale');
      } : checked && input.action === 'plugin-update' ? async () => {
        const report = await this.request('plugin-update-preflight', { input: { ...input, ...expected } });
        if (report.status !== 'compatible' || report.stamp !== checked.stamp) throw new Error('capability:stale-configuration');
      } : undefined;
      const release = await guard?.(policy, recheck);
      let desktopInvalidated = false;
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
        if (input.action.startsWith('marketplace-') || ['plugin-install', 'plugin-remove', 'plugin-update', 'plugin-check-updates'].includes(input.action)) {
          this.library.invalidate();
          this.desktopRevision++;
          desktopInvalidated = true;
        }
        if (policy.scope === 'runtime') this.options.beforePluginMutation?.(expected?.expectedInstance);
        return await this.request('mutate', { input: { ...input, ...expected, preserveRuntime: policy.scope !== 'runtime' } },
          policy.scope === 'runtime');
      } finally {
        if (desktopInvalidated) this.desktopRevision++;
        release?.();
      }
    });
  }
  importSkill(path: string): Promise<CapabilityResult> { return this.enqueue(async () => {
    await this.initializeStorage();
    this.options.beforePluginMutation?.();
    return this.request('import', { path }, true);
  }); }
  async stop() {
    await Promise.all([...this.workers].map(async worker => {
      try { await worker.stopManagement(); }
      catch (error) {
        // Shutdown needs confirmed exit, not write-safety proof; quarantine stays intact.
        if (!(error instanceof RpcManagementStopError) || !error.exitConfirmed) throw error;
      }
      this.workers.delete(worker);
    }));
    this.desktopUnavailable = false;
  }
}
