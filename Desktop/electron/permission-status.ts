export const permissionPresets = ['ask', 'approve-for-me', 'full-access'] as const;
export type PermissionPreset = typeof permissionPresets[number];

const statusLabels: Record<string, PermissionPreset> = {
  Ask: 'ask',
  'Approve for Me': 'approve-for-me',
  'Full Access': 'full-access',
};

export function permissionFromStatus(event: { method?: unknown; statusKey?: unknown; statusText?: unknown }): PermissionPreset | undefined {
  if (event.method !== 'setStatus' || event.statusKey !== 'step-permission' || typeof event.statusText !== 'string') return undefined;
  const match = /^Mode: (Ask|Approve for Me|Full Access)(?: \(auto-resume\))?$/.exec(event.statusText);
  return match ? statusLabels[match[1]] : undefined;
}
