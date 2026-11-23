import type { CapabilityMutation } from '../src/capabilities';

export type CapabilityScope = 'discovery' | 'theme' | 'next-start' | 'runtime';
export interface CapabilityPolicy {
  scope: CapabilityScope;
  pluginId?: string;
}
export type CapabilityGuard = (policy: Readonly<CapabilityPolicy>, recheck?: () => Promise<void>) => Promise<void | (() => void)>;

const policies = {
  'marketplace-add': 'discovery',
  'marketplace-update': 'discovery',
  'marketplace-remove': 'discovery',
  'plugin-check-updates': 'discovery',
  'plugin-install': 'runtime',
  'plugin-update': 'runtime',
  'plugin-remove': 'runtime',
  'plugin-toggle': 'next-start',
  'mcp-toggle': 'next-start',
  'skill-create': 'runtime',
  'skill-toggle': 'runtime',
  'skill-save': 'runtime',
  'skill-mode': 'runtime',
  'skill-file-save': 'runtime',
  'skill-file-remove': 'runtime',
  'skill-remove': 'runtime',
} as const satisfies Record<CapabilityMutation['action'], CapabilityScope>;

// This policy is chosen from host-side evidence, never renderer-supplied flags.
export function capabilityPolicy(action: CapabilityMutation['action'], provenThemeId?: string): Readonly<CapabilityPolicy> {
  if (!Object.hasOwn(policies, action)) throw new Error('capability:invalid-input');
  if (provenThemeId !== undefined && ['plugin-install', 'plugin-update', 'plugin-remove'].includes(action))
    return Object.freeze({ scope: 'theme', pluginId: provenThemeId });
  return Object.freeze({ scope: policies[action] });
}
