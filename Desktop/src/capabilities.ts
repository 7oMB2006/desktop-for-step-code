export type CapabilityPluginIcon = { kind: 'step' } | { kind: 'png'; dataUrl: string };
export interface CapabilityPlugin {
  id: string; name: string; version?: string; description?: string;
  mcpServers: string[]; warnings: string[]; icon?: CapabilityPluginIcon;
}
export interface MarketplacePlugin {
  name: string; marketplace: string; description?: string; installed: boolean; icon?: CapabilityPluginIcon;
}
export interface CapabilityMarketplace {
  name: string; kind: 'builtin' | 'git' | 'local'; origin: string | null;
}
export interface CapabilityMcp {
  name: string; source: 'user' | 'plugin'; pluginId?: string; pluginName?: string;
  transport: 'stdio' | 'http'; enabled: boolean; configurable: boolean;
}
export interface CapabilitySkill {
  id: string; name: string; description: string; location: string;
  source: 'user' | 'plugin'; pluginName?: string;
  enabled: boolean; toggleable: boolean; deletable: boolean;
}
export interface CapabilityCatalog {
  plugins: CapabilityPlugin[]; available: MarketplacePlugin[]; marketplaces: CapabilityMarketplace[];
  mcp: CapabilityMcp[]; skills: CapabilitySkill[]; warnings: string[];
}
export type CapabilityMutation =
  | { action: 'plugin-install'; name: string; marketplace: string }
  | { action: 'plugin-remove'; id: string }
  | { action: 'marketplace-add'; source: string }
  | { action: 'marketplace-update' | 'marketplace-remove'; name: string }
  | { action: 'mcp-toggle'; name: string; enabled: boolean }
  | { action: 'skill-create'; name: string; description: string; instructions: string }
  | { action: 'skill-toggle'; id: string; enabled: boolean }
  | { action: 'skill-remove'; id: string };
export interface CapabilityResult { warnings: string[] }
