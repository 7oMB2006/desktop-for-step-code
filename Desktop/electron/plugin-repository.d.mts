import type { PluginStarSnapshot } from '../src/capabilities';
export class PluginRepositoryInfo {
  constructor(root: string, options?: { fetch?: typeof globalThis.fetch; now?: () => number });
  snapshot(repository: string): Promise<PluginStarSnapshot>;
  refresh(repository: string): Promise<PluginStarSnapshot>;
}
