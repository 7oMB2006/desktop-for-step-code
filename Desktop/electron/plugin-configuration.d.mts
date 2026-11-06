import type { PluginConfiguration, PluginConfigurationInput, PluginConfigurationSchema } from '../src/capabilities';
export interface ConfigurationDescriptor {
  root: string; fingerprint: string; id: string; kind: string; provenance: string;
  instance?: string; name: string; ref: string;
}
export function parseConfigurationSchema(value: unknown): PluginConfigurationSchema;
export class PluginConfigurationStore {
  constructor(root: string);
  read(descriptor: ConfigurationDescriptor): Promise<PluginConfiguration>;
  save(descriptor: ConfigurationDescriptor, input: PluginConfigurationInput): Promise<PluginConfiguration>;
  revoke(id: string): Promise<void>;
}
