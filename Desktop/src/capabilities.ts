export type CapabilityPluginIcon = { kind: 'step' } | { kind: 'png'; dataUrl: string };
export interface PluginLocale {
  description?: string;
  documentation?: { readme?: string; changelog?: string };
}
export type PluginDesktopSymbol = 'plug' | 'bot' | 'book' | 'wrench' | 'sparkles';
export interface PluginDesktop {
  title: string;
  surface: 'main-view' | 'side-panel' | 'window';
  symbol?: PluginDesktopSymbol;
  icon?: { light: string; dark?: string };
  defaultPage?: string;
  connection?: {
    protocol: 'agent-bridge-v1';
    guides?: { setup?: string; firstTask?: string; troubleshooting?: string };
  };
  pages: { id: string; title: string; document: string }[];
}
export interface PluginConnection {
  status: 'unselected' | 'profile-missing' | 'companion-missing' | 'configuration-invalid'
    | 'pairing-required' | 'connection-unavailable' | 'identity-mismatch' | 'ready';
  profile?: string; agentId?: string; displayName?: string;
  roots: string[];
  tasks: { id: string; title: string; phase: string; cwd: string }[];
  checkedAt?: number;
}
export interface PluginRequirements {
  dfsc?: string;
  external?: { name: string; description?: string; url?: string; optional?: boolean }[];
}
export interface PluginPackage {
  ref: string; provenance: 'recorded' | 'unknown' | 'conflict';
  author?: string; maintainer?: string; license?: string;
  categories?: string[]; keywords?: string[];
  documentation: { readme?: string; changelog?: string };
  tutorials: { title: string; creator: string; source: string; url: string; kind: 'author' | 'community' }[];
  links: { title: string; url: string }[]; warnings: string[];
  stars?: PluginStarSnapshot;
  configurationAvailable?: boolean;
  hostSettingsAvailable?: boolean;
  dataOnlyTheme?: boolean;
  locales?: Partial<Record<'zh' | 'en', PluginLocale>>;
  desktop?: PluginDesktop;
  requirements?: PluginRequirements;
}
export interface PluginConfigurationField {
  id: string; label: string; help?: string; type: 'text' | 'number' | 'enum' | 'boolean' | 'secret' | 'path';
  required: boolean; maxLength: number; min?: number; max?: number;
  default?: string | number | boolean; options?: { value: string; label: string }[];
  selection?: 'file' | 'directory';
}
export interface PluginConfigurationSchema {
  schemaVersion: 1; consumer: { kind: 'json-file-v1'; server: string };
  groups: { id: string; title: string; fields: PluginConfigurationField[] }[];
}
export interface PluginConfiguration {
  ref: string; revision: string; configured: boolean; schema: PluginConfigurationSchema;
  values: Record<string, string | number | boolean>; hasSecret: Record<string, boolean>;
}
export interface PluginConfigurationInput {
  ref: string; revision: string; values: Record<string, string | number | boolean>;
  secrets: Record<string, { action: 'keep' | 'replace' | 'delete'; value?: string }>;
}
export type PluginHostCapability = 'model.text' | 'model.video' | 'model.asr' | 'model.tts';
export type PluginHostModels = Partial<Record<'model.asr' | 'model.tts', string>>;
export interface PluginHostRuntime {
  status: 'unsupported' | 'no-session' | 'unconfigured' | 'disabled' | 'restart-required' | 'connected' | 'unavailable';
  capabilities?: { id: PluginHostCapability; available: boolean; model?: string; channel?: 'plan' | 'api';
    region?: 'cn' | 'oversea'; authorization: 'required' | 'approved' | 'unavailable' }[];
}
export interface PluginHostSettings {
  ref: string; revision: string; mode: 'follow' | 'independent' | null; consumer: string;
  capabilities: PluginHostCapability[]; models: PluginHostModels; configurationCurrent: boolean;
  independent?: PluginConfiguration; independentError?: string; runtime: PluginHostRuntime;
}
export interface PluginHostSettingsInput {
  ref: string; revision: string; mode: 'follow' | 'independent'; models?: PluginHostModels;
  configuration?: PluginConfigurationInput;
}
export interface PluginDocument {
  path: string; text: string; images: Record<string, string>; links: Record<string, string>;
}
export interface PluginStarSnapshot {
  count?: number; checkedAt?: string;
  status: 'unknown' | 'fresh' | 'stale' | 'unavailable' | 'limited';
}
export interface CapabilityPlugin {
  id: string; name: string; version?: string; description?: string;
  mcpServers: string[]; warnings: string[]; icon?: CapabilityPluginIcon; repository?: string; marketplace?: string; package?: PluginPackage;
  installationSource?: { status: 'recorded' | 'matched' | 'unknown' | 'conflict'; marketplaces: string[] };
  update?: { status: 'available' | 'current' | 'unavailable'; version?: string; ref?: string;
    reason?: 'source' | 'version' | 'conflict' };
}
export interface MarketplacePlugin {
  name: string; marketplace: string; description?: string; installed: boolean; icon?: CapabilityPluginIcon;
  id?: string; displayName?: string; version?: string; repository?: string; installedId?: string;
  blocked?: boolean; package?: PluginPackage;
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
  pluginUpdates?: boolean;
  recovery?: { required: true; pluginId?: string };
}
export type CapabilityMutation =
  | { action: 'plugin-install'; name: string; marketplace: string; ref?: string }
  | { action: 'plugin-check-updates' }
  | { action: 'plugin-update'; id: string; ref: string; candidate: string }
  | { action: 'plugin-remove'; id: string }
  | { action: 'plugin-toggle'; id: string; enabled: boolean }
  | { action: 'marketplace-add'; source: string }
  | { action: 'marketplace-update' | 'marketplace-remove'; name: string }
  | { action: 'mcp-toggle'; name: string; enabled: boolean }
  | { action: 'skill-create'; name: string; description: string; instructions: string }
  | { action: 'skill-toggle'; id: string; enabled: boolean }
  | { action: 'skill-remove'; id: string };
export interface CapabilityResult { warnings: string[] }
