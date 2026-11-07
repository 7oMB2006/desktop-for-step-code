import type { ConfigurationDescriptor } from './plugin-configuration.mjs';
import type { HostDeclaration, LaunchContext, FollowLaunch, ModelSelection } from '../../examples/plugins/host-client/protocol.mjs';
export { parseHostDeclaration } from '../../examples/plugins/host-client/protocol.mjs';
export interface HostBinding {
  revision: string; instance: string; pluginId: string; fingerprint: string; declarationHash: string;
  consumer: string; mode: 'follow' | 'independent'; configurationRevision: string | null;
  declaration: HostDeclaration; configurationCurrent: boolean; models: ModelSelection;
}
export class PluginHostBindingStore {
  constructor(root: string);
  current(descriptor: ConfigurationDescriptor): Promise<HostBinding | { revision: 'unconfigured' }>;
  select(descriptor: ConfigurationDescriptor, input: {
    revision: string; mode: 'follow' | 'independent'; configurationRevision?: string; models?: ModelSelection;
  }): Promise<HostBinding>;
  launch(descriptor: ConfigurationDescriptor,
    trusted: Pick<FollowLaunch, 'runtimeId' | 'sessionId' | 'accountRevision' | 'broker'>): Promise<LaunchContext>;
}
