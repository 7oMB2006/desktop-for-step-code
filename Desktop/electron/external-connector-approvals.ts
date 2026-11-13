import { createHash } from 'node:crypto';
import { permissionApprovalPresentation } from '../src/approval-presentation';
import type { UIRequest } from '../src/contracts';
import type { ExternalApprovalCategory } from '../src/external-connectors';
import type { SessionRuntime } from './session-runtimes';

// A permission dialog alone is not evidence of a complete native tool call.
export function delegatedApproval(worker: SessionRuntime, request: UIRequest) {
  if (request.runtimeId !== worker.id || request.projectTrust || request.messageStyle) return;
  const presentation = permissionApprovalPresentation(request, worker.messages, 'en', worker.id);
  if (!presentation || presentation.category !== 'ordinary' || presentation.inputKind === 'summary'
    || !['command', 'file'].includes(presentation.operation)) return;
  const value = {
    category: presentation.operation as ExternalApprovalCategory,
    toolName: presentation.toolName, callId: presentation.callId,
    input: presentation.input, otherParameters: presentation.otherParameters,
    verificationCommand: presentation.verificationCommand,
  };
  const serialized = JSON.stringify(value);
  // Do not let the reviewer approve inputs it cannot inspect completely.
  if (serialized.length > 12000 || serialized.includes('[redacted]')) return;
  return { ...value, fingerprint: createHash('sha256').update(JSON.stringify({ request, value })).digest('hex') };
}
