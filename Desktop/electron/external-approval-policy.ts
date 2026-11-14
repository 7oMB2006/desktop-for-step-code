import type { ExternalApprovalCategory, ExternalApprovalPolicy } from '../src/external-connectors';

export const approvalCategories: ExternalApprovalCategory[] = ['command', 'file', 'risk', 'question'];
export function validCategories(value: unknown): value is ExternalApprovalCategory[] {
  return Array.isArray(value) && value.length > 0 && value.length <= approvalCategories.length
    && value.every(item => approvalCategories.includes(item)) && new Set(value).size === value.length;
}
export interface SavedApprovalPolicy extends ExternalApprovalPolicy { binding: string; clock: number }
export function savedApprovalPolicies(value: unknown): SavedApprovalPolicy[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) throw new Error('connector:storage');
  const seen = new Set<string>();
  return value.map(p => {
    if (!p || typeof p !== 'object' || !/^[a-f0-9-]{36}$/u.test(p.id)
      || typeof p.agentId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(p.agentId)
      || typeof p.cwd !== 'string' || !p.cwd || p.cwd.length > 4096
      || typeof p.binding !== 'string' || !/^[a-f0-9]{64}$/u.test(p.binding)
      || !Number.isFinite(p.createdAt) || !Number.isFinite(p.clock) || p.clock < p.createdAt
      || p.expiresAt !== null && (!Number.isFinite(p.expiresAt) || p.expiresAt <= p.createdAt
        || p.expiresAt - p.createdAt > 30 * 86400000)
      || !validCategories(p.categories) || !['ask', 'approve-for-me'].includes(p.permissionPreset)
      || seen.has(`${p.agentId}:${p.cwd}`)) throw new Error('connector:storage');
    seen.add(`${p.agentId}:${p.cwd}`);
    return { id: p.id, agentId: p.agentId, cwd: p.cwd, binding: p.binding, clock: p.clock,
      createdAt: p.createdAt, expiresAt: p.expiresAt, categories: [...p.categories], permissionPreset: p.permissionPreset };
  });
}
