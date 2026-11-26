import { createHash } from 'node:crypto';
import { permissionApprovalPresentation, redactApprovalText } from '../src/approval-presentation';
import type { UIRequest } from '../src/contracts';
import type { ExternalApprovalCategory } from '../src/external-connectors';
import type { SessionRuntime } from './session-runtimes';
import { uniquePendingApprovalCall } from './approval-call-identity';
import { questionnaire } from '../src/questionnaire';

// A permission dialog alone is not evidence of a complete native tool call.
export function delegatedApproval(worker: SessionRuntime, request: UIRequest) {
  if (request.runtimeId !== worker.id || request.projectTrust || request.messageStyle) return;
  const question = questionnaire(request);
  if (question) {
    const call = uniquePendingApprovalCall(worker.messages, 'clarify_user', question.callId);
    if (!call) return;
    const input = JSON.stringify(question.questions);
    const serialized = JSON.stringify({ request, call });
    if (serialized.length > 12000 || redactApprovalText(serialized) !== serialized) return;
    return { category: 'question' as ExternalApprovalCategory, toolName: 'clarify_user', callId: question.callId,
      input, verificationCommand: undefined, fingerprint: createHash('sha256').update(serialized).digest('hex') };
  }
  const presentation = permissionApprovalPresentation(request, worker.messages, 'en', worker.id);
  if (!presentation || presentation.category === 'uncertain' || presentation.inputKind === 'summary'
    || !['command', 'file', 'question'].includes(presentation.operation)) return;
  const call = uniquePendingApprovalCall(worker.messages, presentation.toolName, presentation.callId);
  if (!call) return;
  const value = {
    category: (presentation.category === 'hazardous' ? 'risk' : presentation.operation) as ExternalApprovalCategory,
    toolName: presentation.toolName, callId: presentation.callId,
    input: presentation.input, otherParameters: presentation.otherParameters,
    verificationCommand: presentation.verificationCommand,
  };
  const serialized = JSON.stringify(value);
  // Do not let the reviewer approve inputs it cannot inspect completely.
  if (serialized.length > 12000 || serialized.includes('[redacted]')) return;
  return { ...value, fingerprint: createHash('sha256').update(JSON.stringify({ request, call, value })).digest('hex') };
}
