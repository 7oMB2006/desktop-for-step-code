import type { Model } from './contracts';

export const subagentRoles = ['general', 'explore', 'review', 'planner'] as const;
export type SubagentRole = typeof subagentRoles[number];
export const subagentEfforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type SubagentEffort = typeof subagentEfforts[number];
export type SubagentRoleModel = { provider: string; id: string; effort: SubagentEffort };
export type SubagentRoleModels = Partial<Record<SubagentRole, SubagentRoleModel>>;
export type SubagentRoleSettings = { values: SubagentRoleModels; available: boolean };

export function isSubagentRole(value: unknown): value is SubagentRole {
  return subagentRoles.some(role => role === value);
}

export function parseSubagentRoleModel(value: unknown): SubagentRoleModel {
  const row = value as Partial<SubagentRoleModel> | null;
  if (!row || typeof row.provider !== 'string' || !row.provider || row.provider.length > 200 || /[\/\s:]/.test(row.provider)
    || typeof row.id !== 'string' || !row.id || row.id.length > 300 || /[\r\n\0]/.test(row.id)
    || !subagentEfforts.some(effort => effort === row.effort)) throw new Error('Invalid subagent role model');
  return { provider: row.provider, id: row.id, effort: row.effort! };
}

export function subagentModelLevels(model: Model): SubagentEffort[] {
  if (model.thinkingServiceDefault) return [];
  if (model.reasoning === false) return ['off'];
  return subagentEfforts.filter(level => model.thinkingLevels?.includes(level));
}

export type SubagentModelEvidence = SubagentRoleModel & { source: 'role' | 'inherited' | 'definition' | 'explicit' };

export function readSubagentModelEvidence(value: unknown): SubagentModelEvidence | undefined {
  const source = (value as { source?: unknown } | null)?.source;
  if (source !== 'role' && source !== 'inherited' && source !== 'definition' && source !== 'explicit') return undefined;
  try { return { ...parseSubagentRoleModel(value), source }; } catch { return undefined; }
}
