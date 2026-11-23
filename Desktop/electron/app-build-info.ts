import type { AppBuildInfo } from '../src/contracts';
import { commit as v017 } from '../../patches/v017/manifest.json';
import { commit as v018 } from '../../patches/v018/manifest.json';

export function bundledStepCode(manifest: unknown): AppBuildInfo['runtime'] {
  const commit = (manifest as { commit?: unknown } | null)?.commit;
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) return null;
  // These are Desktop integration baselines, not assertions about upstream release tags.
  const baseline = commit === v018 ? 'v0.1.8' : commit === v017 ? 'v0.1.7' : undefined;
  return { commit, baseline };
}
