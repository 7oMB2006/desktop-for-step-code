export interface ReleaseDependency { path: string; reason: string }
export interface ReleaseManifest {
  schemaVersion: 1;
  files?: string[];
  runtimeDependencies: ReleaseDependency[];
}
export interface ReleaseIssue { code: string; path: string }
export interface ReleaseAudit {
  version: 1;
  ok: boolean;
  entries: number;
  files: number;
  bytes: number;
  issues: ReleaseIssue[];
  warnings: ReleaseIssue[];
}
export function validateReleaseManifest(value: unknown): ReleaseManifest;
export function readReleaseManifest(root: string): Promise<ReleaseManifest | undefined>;
export function auditPluginRelease(root: string,
  options?: { allowRuntimeDependencies?: ReleaseDependency[] }): Promise<ReleaseAudit>;
export function releaseSourcePath(root: string, path: string): Promise<string>;
