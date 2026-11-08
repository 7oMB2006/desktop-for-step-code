import type { CapabilityCatalog, PluginDocument } from '../src/capabilities';
export function documentUrl(value: unknown): string | undefined;
export function parsePresentation(value: unknown): Omit<import('../src/capabilities').PluginPackage, 'ref' | 'provenance' | 'warnings'>;
export class PluginLibrary {
  constructor(root: string, validateImage?: (bytes: Buffer) => boolean);
  invalidate(): void;
  project(catalog: CapabilityCatalog): Promise<CapabilityCatalog>;
  reference(ref: unknown): Promise<{ descriptor: { root: string; fingerprint: string; kind: string; instance?: string; provenance: string; id: string; repository?: string; name: string; source?: string; marketplace?: string } }>;
  customBackgroundContext(ref: string): Promise<{ ref: string; instance: string }>;
  document(input: unknown): Promise<PluginDocument>;
}
