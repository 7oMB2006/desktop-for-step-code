export type CapabilityPage = 'plugins' | 'mcp' | 'skills';
export type PluginTab = 'installed' | 'discover' | 'sources';
export interface CapabilityTarget { page: CapabilityPage; tab?: PluginTab; query?: string; source?: string }

// Management commands navigate to a reviewable UI, never mutate from a prompt.
export function capabilityCommand(value: string, attachments = 0, quotes = 0): CapabilityTarget | null {
  if (attachments || quotes) return null;
  const match = /^\/(plugin|mcp|skills)(?:\s+([\s\S]*))?$/u.exec(value.trim());
  if (!match) return null;
  if (match[1] !== 'plugin') return match[2]?.trim() ? null : { page: match[1] as 'mcp' | 'skills' };
  const args = match[2]?.trim() ?? '';
  if (!args || args === 'list') return { page: 'plugins', tab: 'installed' };
  if (args === 'browse') return { page: 'plugins', tab: 'discover' };
  if (/^marketplace(?:\s+list)?$/u.test(args)) return { page: 'plugins', tab: 'sources' };
  const action = /^(install|remove|uninstall)\s+(\S+)$/u.exec(args);
  if (action) return { page: 'plugins', tab: action[1] === 'install' ? 'discover' : 'installed', query: action[2].split('@')[0] };
  const market = /^marketplace\s+(add|update|remove)\s+(.+)$/u.exec(args);
  if (market) {
    const source = market[2].replace(/^(["'])(.*)\1$/u, '$2');
    return { page: 'plugins', tab: 'sources', ...(market[1] === 'add' ? { source } : { query: source }) };
  }
  return null;
}
