export function capabilityFailureCode(error: unknown): string;
export function marketplaceFailureCode(error: unknown, signal?: AbortSignal): string;
export interface CapabilityFailureDetails {
  operation: 'marketplace-refresh';
  elapsedMs: number | null;
  gitExitCode: number | null;
  gitSignal: string | null;
  gitSystemCode: string | null;
}
export function capabilityFailureDetails(error: unknown): CapabilityFailureDetails | undefined;
