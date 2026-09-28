export const permissionPresets = ['ask', 'read-only', 'bypass', 'autopilot'] as const;
export type PermissionPreset = typeof permissionPresets[number];

const statusLabels: Record<string, PermissionPreset> = {
  Ask: 'ask',
  'Read Only': 'read-only',
  Bypass: 'bypass',
  Autopilot: 'autopilot',
};

export function permissionFromStatus(event: { method?: unknown; statusKey?: unknown; statusText?: unknown }): PermissionPreset | undefined {
  if (event.method !== 'setStatus' || event.statusKey !== 'step-permission' || typeof event.statusText !== 'string') return undefined;
  const match = /^Mode: (Ask|Read Only|Bypass|Autopilot)(?: \(auto-resume\))?$/.exec(event.statusText);
  return match ? statusLabels[match[1]] : undefined;
}
