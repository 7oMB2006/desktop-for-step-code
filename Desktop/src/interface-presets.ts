export type InterfacePreset = 'simple' | 'standard' | 'detailed';
export interface InterfaceOptions {
  thinkingExpanded: boolean;
  toolsExpanded: boolean;
  performanceVisible: boolean;
  groupTools: boolean;
  compactProcess: boolean;
}
export interface InterfacePreferences extends InterfaceOptions {
  preset: InterfacePreset | 'custom';
}
export const interfacePresets: Record<InterfacePreset, InterfaceOptions> = {
  simple: { thinkingExpanded: false, toolsExpanded: false, performanceVisible: false, groupTools: true, compactProcess: true },
  standard: { thinkingExpanded: false, toolsExpanded: false, performanceVisible: true, groupTools: true, compactProcess: false },
  detailed: { thinkingExpanded: true, toolsExpanded: false, performanceVisible: true, groupTools: false, compactProcess: false },
};
export function selectInterfacePreset(preset: InterfacePreset): InterfacePreferences {
  return { preset, ...interfacePresets[preset] };
}
export function normalizeInterfaceSettings(value: unknown): InterfacePreferences {
  if (!value || typeof value !== 'object') return selectInterfacePreset('standard');
  const input = value as Partial<InterfacePreferences>;
  if (input.preset === 'simple' || input.preset === 'standard' || input.preset === 'detailed') return selectInterfacePreset(input.preset);
  if (input.preset !== 'custom') return selectInterfacePreset('standard');
  const fallback = interfacePresets.standard;
  return {
    preset: 'custom',
    thinkingExpanded: typeof input.thinkingExpanded === 'boolean' ? input.thinkingExpanded : fallback.thinkingExpanded,
    toolsExpanded: typeof input.toolsExpanded === 'boolean' ? input.toolsExpanded : fallback.toolsExpanded,
    performanceVisible: typeof input.performanceVisible === 'boolean' ? input.performanceVisible : fallback.performanceVisible,
    groupTools: typeof input.groupTools === 'boolean' ? input.groupTools : fallback.groupTools,
    compactProcess: typeof input.compactProcess === 'boolean' ? input.compactProcess : fallback.compactProcess,
  };
}

export function validateInterfaceSettings(value: unknown): InterfacePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid interface settings');
  const input = value as Record<string, unknown>;
  if (typeof input.preset !== 'string' || !['simple', 'standard', 'detailed', 'custom'].includes(input.preset)) throw new Error('Invalid interface preset');
  for (const key of Object.keys(interfacePresets.standard)) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid interface option: ${key}`);
  }
  return normalizeInterfaceSettings(input);
}
