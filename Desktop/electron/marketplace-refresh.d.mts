import type { ExecFileException } from 'node:child_process';

export type MarketplaceExecutor = (
  command: string, args: string[],
  options: { timeout: number; signal?: AbortSignal; windowsHide: boolean; encoding: 'utf8'; maxBuffer: number },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => unknown;
export function refreshGitMarketplace(
  path: string, signal?: AbortSignal, execute?: MarketplaceExecutor, timeout?: number,
): Promise<void>;
