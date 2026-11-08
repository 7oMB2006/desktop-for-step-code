import { randomUUID } from 'node:crypto';
import { capabilityFailureCode, capabilityFailureDetails, type CapabilityFailureDetails } from './capability-failure.mjs';

const actions = new Set([
  'plugin-install', 'plugin-check-updates', 'plugin-update', 'plugin-remove',
  'plugin-toggle', 'marketplace-add', 'marketplace-update', 'marketplace-remove',
  'mcp-toggle', 'skill-create', 'skill-toggle', 'skill-remove',
]);
export type CapabilityPhase = 'dispatch' | 'idle-check' | 'resource-check' | 'mutation' | 'theme-refresh';
export type CapabilityPhaseMarker = (phase: CapabilityPhase) => void;
type DiagnosticDetails = { diagnosticId: string; action: string; operationPhase: CapabilityPhase; code: string }
  & Partial<CapabilityFailureDetails>;
type DiagnosticWriter = (error: Error, details: DiagnosticDetails) => Promise<void>;

export async function diagnoseCapabilityMutation<T>(
  method: string, input: unknown,
  invoke: (markPhase: CapabilityPhaseMarker) => Promise<T>,
  record: DiagnosticWriter,
): Promise<T> {
  if (method !== 'capabilityMutate') return invoke(() => {});
  let phase: CapabilityPhase = 'dispatch';
  const rawAction = input && typeof input === 'object' && 'action' in input ? input.action : undefined;
  const action = typeof rawAction === 'string' && actions.has(rawAction) ? rawAction : 'unknown';
  const failure = async (error: unknown) => {
    const code = capabilityFailureCode(error);
    const diagnosticId = randomUUID().replace(/-/gu, '').slice(0, 12);
    try {
      await record(new Error(`capability:${code}`), {
        diagnosticId, action, operationPhase: phase, code, ...capabilityFailureDetails(error),
      });
    } catch {
      // A diagnostic write must never replace or accidentally permit a refused operation.
    }
    return `capability:${code}; diagnostic:${diagnosticId}`;
  };
  try {
    const result = await invoke(value => { phase = value; });
    if (action === 'plugin-check-updates' && result && typeof result === 'object' && 'failures' in result) {
      const { failures, ...rest } = result;
      const warnings = 'warnings' in rest && Array.isArray(rest.warnings) ? [...rest.warnings] : [];
      if (Array.isArray(failures))
        for (const item of failures.slice(0, 128)) warnings.push(await failure(item));
      return { ...rest, warnings } as T;
    }
    return result;
  } catch (error) {
    throw new Error(await failure(error));
  }
}
