export const defaultRuntimeBaseline: 'v018';

export function readRuntimeBaseline(name?: string): Promise<{
  name: 'v017' | 'v018';
  manifest: {
    commit: string;
    patchIds?: string[];
    sources: Record<string, string>;
    patchedSources: Record<string, string>;
  };
}>;
