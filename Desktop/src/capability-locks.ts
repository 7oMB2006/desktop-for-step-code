import type { CapabilityCatalog, CapabilityMutation } from './capabilities';

// An affordance hint only. Main revalidates the complete package at commit time.
export function capabilityNeedsIdle(input: CapabilityMutation, catalog?: CapabilityCatalog) {
  if (input.action.startsWith('marketplace-') || input.action === 'plugin-check-updates') return false;
  if (input.action === 'plugin-remove')
    return !catalog?.plugins.find(plugin => plugin.id === input.id)?.package?.dataOnlyTheme;
  if (input.action === 'plugin-install')
    return !catalog?.available.find(plugin => plugin.package?.ref === input.ref
      && plugin.name === input.name && plugin.marketplace === input.marketplace
      && plugin.package?.provenance === 'recorded')?.package?.dataOnlyTheme;
  if (input.action === 'plugin-update') {
    const installed = catalog?.plugins.find(plugin => plugin.id === input.id && plugin.package?.ref === input.ref);
    const candidate = catalog?.available.find(plugin => plugin.package?.ref === input.candidate);
    return !(installed?.package?.dataOnlyTheme && candidate?.package?.dataOnlyTheme
      && installed.update?.ref === input.candidate && installed.update?.status === 'available');
  }
  return true;
}
