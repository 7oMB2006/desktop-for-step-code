import { satisfies, valid, validRange } from 'semver';
import type { PluginPackage } from './capabilities';

export type PluginVersionStatus = 'undeclared' | 'invalid' | 'unknown' | 'matches' | 'mismatch';

export function pluginVersionStatus(range?: string, currentVersion?: string): PluginVersionStatus {
  if (range === undefined) return 'undeclared';
  if (typeof range !== 'string' || !range.trim() || range.length > 128 || !validRange(range)) return 'invalid';
  if (!currentVersion || !valid(currentVersion)) return 'unknown';
  return satisfies(currentVersion, range) ? 'matches' : 'mismatch';
}

export function pluginMarketplaceSearchText(pkg?: PluginPackage): string {
  return [pkg?.author, pkg?.maintainer, pkg?.requirements?.dfsc,
    ...(pkg?.requirements?.external?.flatMap(item => [item.name, item.description]) ?? [])]
    .filter(Boolean).join(' ');
}
