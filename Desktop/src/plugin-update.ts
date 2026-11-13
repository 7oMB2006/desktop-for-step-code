export interface PluginUpdateRequest { id: string; ref: string; candidate: string }
export interface PluginUpdateCompatibility {
  status: 'compatible' | 'needs-input' | 'unsupported';
  changes: { code: string; field?: string }[];
}
export interface PluginUpdateSession {
  runtimeId: string; sessionId?: string; name: string;
  status: 'idle' | 'busy' | 'unknown';
}
export interface PluginUpdatePreflight extends PluginUpdateCompatibility {
  token: string; pluginId: string; version: string;
  readiness: 'ready' | 'needs-release' | 'blocked';
  sessions: PluginUpdateSession[];
  blockers: string[];
}
export interface PluginUpdateOperation {
  id: string; pluginId: string; version: string;
  phase: 'releasing' | 'applying' | 'restoring' | 'done' | 'attention';
  installation: 'unchanged' | 'committed' | 'unknown';
  sessions: (PluginUpdateSession & { restoration: 'pending' | 'restored' | 'failed' | 'unknown' | 'untouched' })[];
  warnings: string[];
  error?: string;
}
export interface PluginUpdateBridge {
  pluginUpdatePreflight(input: PluginUpdateRequest): Promise<PluginUpdatePreflight>;
  pluginUpdateApply(input: { token: string; release: boolean }): Promise<PluginUpdateOperation>;
  pluginUpdateOperation(input: { pluginId: string }): Promise<PluginUpdateOperation | null>;
}
