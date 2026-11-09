export function object(value: unknown): value is Record<string, unknown>;
export function optionalFile(root: string, path: string, limit?: number): Promise<Buffer | undefined>;
export function packageFingerprint(root: string): Promise<string>;
export function dataOnlyThemeFingerprint(root: string, id: string): Promise<string | undefined>;
export function plainFile(root: string, path: string, limit?: number): Promise<Buffer>;
export function scanInstalled(root: string): Promise<{ folder: string; id: string }[]>;
