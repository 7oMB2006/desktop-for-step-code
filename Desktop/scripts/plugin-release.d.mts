import type { ReleaseAudit } from '../electron/plugin-release.mjs';
export function stagePluginRelease(source: string, output: string,
  options?: { manifest?: unknown }): Promise<ReleaseAudit>;
