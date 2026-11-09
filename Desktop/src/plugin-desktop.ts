import type { CapabilityCatalog, CapabilityPlugin, PluginDesktop } from './capabilities';

export interface PluginDesktopEntry {
  id: string;
  plugin: CapabilityPlugin;
  desktop: PluginDesktop;
}

export function getPluginDesktopEntries(catalog: CapabilityCatalog): PluginDesktopEntry[] {
  const seen = new Set<string>();
  return catalog.plugins.flatMap(plugin => {
    const desktop = plugin.package?.desktop;
    if (!plugin.id || seen.has(plugin.id) || plugin.package?.provenance !== 'recorded'
      || !desktop?.pages.length) return [];
    seen.add(plugin.id);
    return [{ id: plugin.id, plugin, desktop }];
  });
}

export function pluginDesktopDefaultPage(desktop: PluginDesktop) {
  return desktop.pages.find(page => page.id === desktop.defaultPage) ?? desktop.pages[0];
}

export function pluginActionLayout(entries: PluginDesktopEntry[], narrow: boolean, maxVisible = 3) {
  const limit = narrow ? 1 : Math.max(1, Math.min(3, Number.isFinite(maxVisible) ? Math.floor(maxVisible) : 3));
  return { visible: entries.slice(0, limit), overflow: entries.slice(limit) };
}

export function pluginDesktopIconUrl(value: string | undefined) {
  return value && /^data:image\/(?:png|jpeg|webp|x-icon);base64,[A-Za-z0-9+/]+=*$/u.test(value) ? value : undefined;
}
