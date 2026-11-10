export class PluginFileError extends Error { constructor(code: string); code: string; }
export interface InstallationReceipt {
  instance: string; folder: string; id: string; source: string; marketplace: string;
  fingerprint: string; state: 'pending' | 'installed' | 'removing';
}
export interface InstallationReceipts { version: 1; installations: InstallationReceipt[]; }
export interface PluginSource {
  name: string; kind: string; path?: string; origin?: string; desktopIdentity?: string;
}
export function digest(value: string | Uint8Array): string;
export function object(value: unknown): value is Record<string, unknown>;
export function packagePath(value: unknown): string;
export function plainFile(root: string, path: string, limit?: number): Promise<Buffer>;
export function optionalFile(root: string, path: string, limit?: number): Promise<Buffer | undefined>;
export function packageFingerprint(root: string): Promise<string>;
export function dataOnlyThemeFingerprint(root: string, id: string): Promise<string | undefined>;
export function scanInstalled(root: string): Promise<Array<{ folder: string; id: string }>>;
export function readReceipts(root: string): Promise<InstallationReceipts>;
export function writeReceipts(root: string, value: InstallationReceipts): Promise<void>;
export function writePrivateJson(root: string, filename: string, value: unknown): Promise<void>;
export function writePrivateData(root: string, path: string, value: unknown): Promise<void>;
export function sourceIdentity(source: PluginSource): string;
export function installationReceipt(entry: { name: string }, source: PluginSource,
  manifest: { id: string }, fingerprint: string): InstallationReceipt;
