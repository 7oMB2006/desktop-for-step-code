export interface DiagnosticCompletion {
  passed: boolean;
  cleanupConfirmed: boolean;
  failurePhase?: 'operation' | 'cleanup';
  cleanupFailures: string[];
}
export function finalizeCapabilityDiagnostics(
  operationError: unknown,
  cleanups: [string, () => void | Promise<void>][],
  report: (completion: DiagnosticCompletion) => void | Promise<void>,
): Promise<void>;
