import type { CapabilityCatalog, PluginDocument } from '../src/capabilities';
import type { PackageReadScope } from './plugin-read-scope.mjs';
export function documentUrl(value: unknown): string | undefined;
export function parsePresentation(value: unknown): Omit<import('../src/capabilities').PluginPackage, 'ref' | 'provenance' | 'warnings'>;
export interface PluginReferenceSnapshot {
  descriptor: { root: string; fingerprint: string; kind: string; instance?: string; provenance: string; id: string; repository?: string; name: string; source?: string; marketplace?: string };
}
export class PluginLibrary {
  constructor(root: string, validateImage?: (bytes: Buffer, maxDimension?: number) => boolean);
  invalidate(): void;
  revoke(ref: unknown): void;
  project(catalog: CapabilityCatalog, options?: { partial?: boolean; retain?: boolean }): Promise<CapabilityCatalog>;
  referenceSnapshot(ref: unknown): PluginReferenceSnapshot;
  reference(ref: unknown, scope?: PackageReadScope): Promise<PluginReferenceSnapshot>;
  customBackgroundContext(ref: string): Promise<{ ref: string; instance: string }>;
  document(input: unknown, scope?: PackageReadScope): Promise<PluginDocument>;
}
