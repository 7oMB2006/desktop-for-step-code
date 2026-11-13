import type { ExternalConnectorAction } from '../src/external-connectors';
import { validCategories } from './external-approval-policy';

export function parseExternalConnectorAction(value: unknown): ExternalConnectorAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('connector:invalid-input');
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if ((input.type === 'enable' || input.type === 'disable') && keys.length === 1) return { type: input.type };
  const pluginRef = typeof input.pluginRef === 'string' && /^[a-f0-9-]{36}$/u.test(input.pluginRef);
  if (input.type === 'bind-plugin' && keys.length === 3 && pluginRef
    && typeof input.agentId === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(input.agentId))
    return { type: 'bind-plugin', agentId: input.agentId, pluginRef: input.pluginRef as string };
  if (input.type === 'pair' && (keys.length === 3 || keys.length === 4 && pluginRef)
    && keys.every(key => ['type', 'displayName', 'roots', 'pluginRef'].includes(key)) && typeof input.displayName === 'string'
    && input.displayName.trim() && input.displayName.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(input.displayName)
    && Array.isArray(input.roots) && input.roots.length > 0 && input.roots.length <= 32
    && input.roots.every(root => typeof root === 'string' && root.length > 0 && root.length <= 4096)
    && new Set(input.roots).size === input.roots.length)
    return { type: 'pair', displayName: input.displayName.trim(), roots: input.roots as string[],
      ...(pluginRef ? { pluginRef: input.pluginRef as string } : {}) };
  if (input.type === 'revoke' && keys.length === 2 && typeof input.agentId === 'string'
    && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(input.agentId)) return { type: 'revoke', agentId: input.agentId };
  const scope = typeof input.agentId === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(input.agentId)
    && typeof input.cwd === 'string' && input.cwd.length > 0 && input.cwd.length <= 4096;
  if (input.type === 'unpolicy' && keys.length === 3 && scope)
    return { type: 'unpolicy', agentId: input.agentId as string, cwd: input.cwd as string };
  if (input.type === 'policy' && keys.length === 6 && scope && [null, 1, 7, 30].includes(input.days as any)
    && validCategories(input.categories) && ['ask', 'approve-for-me'].includes(String(input.permissionPreset)))
    return { type: 'policy', agentId: input.agentId as string, cwd: input.cwd as string,
      days: input.days as 1 | 7 | 30 | null, categories: [...input.categories],
      permissionPreset: input.permissionPreset as 'ask' | 'approve-for-me' };
  const task = typeof input.taskId === 'string' && /^[a-f0-9-]{36}$/u.test(input.taskId);
  if (input.type === 'undelegate' && keys.length === 2 && task)
    return { type: 'undelegate', taskId: input.taskId as string };
  if (input.type === 'delegate' && keys.length === 4 && task && [0, 15, 30, 60].includes(input.minutes as number)
    && validCategories(input.categories))
    return { type: 'delegate', taskId: input.taskId as string, minutes: input.minutes as number, categories: input.categories };
  throw new Error('connector:invalid-input');
}

// Local viewing, approvals and stopping remain available during an external turn.
export function externalSessionCommandAllowed(type: string) {
  return ['abort', 'extension_ui_response', 'get_commands', 'get_available_thinking_levels',
    'get_session_stats', 'set_session_name'].includes(type);
}
