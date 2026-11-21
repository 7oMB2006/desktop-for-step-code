import type { ConfigurationDescriptor } from './plugin-configuration.mjs';
import type { PackageReadScope } from './plugin-read-scope.mjs';
import type { Capability, HostDeclaration, LaunchContext, FollowLaunch } from '../../examples/plugins/host-client/protocol.mjs';
import type { PluginHostModels, PluginHostSource } from '../src/capabilities';
export { parseHostDeclaration } from '../../examples/plugins/host-client/protocol.mjs';
export type PluginHostAccountBinding = PluginHostSource & { id: string };
export function parseHostModels(value: unknown, declared: readonly Capability[]): PluginHostModels;
export interface HostBinding {
  revision: string; instance: string; pluginId: string; fingerprint: string; declarationHash: string;
  consumer: string; mode: 'follow' | 'independent' | 'paused'; configurationRevision: string | null;
  declaration: HostDeclaration; configurationCurrent: boolean; models: PluginHostModels; account?: PluginHostAccountBinding;
}
export interface UnconfiguredHostBinding { revision: 'unconfigured'; declaration: HostDeclaration }
export class PluginHostBindingStore {
  constructor(root: string);
  current(descriptor: ConfigurationDescriptor, scope?: PackageReadScope): Promise<HostBinding | UnconfiguredHostBinding>;
  select(descriptor: ConfigurationDescriptor, input: {
    revision: string; mode: 'follow' | 'independent' | 'paused'; configurationRevision?: string; models?: PluginHostModels;
    account?: PluginHostAccountBinding;
  }): Promise<HostBinding>;
  launch(descriptor: ConfigurationDescriptor,
    trusted: Pick<FollowLaunch, 'runtimeId' | 'sessionId' | 'accountRevision' | 'broker'>): Promise<LaunchContext>;
}
