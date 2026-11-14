export interface ToolStartup {
  name: string;
  status: 'pending' | 'connecting' | 'connected' | 'failed' | 'disabled';
  toolCount: number;
  hosted?: boolean;
  cleanupConfirmed?: boolean;
  startedAt: number;
  settledAt?: number;
}
export interface RuntimeStartup {
  protocol: 1;
  runtimeId: string;
  sessionId: string;
  startupEpoch: string;
  configurationRevision: string;
  catalogRevision: number;
  targetBound: boolean;
  modelReady: boolean;
  cleanupConfirmed: boolean;
  discovery: 'waiting' | 'discovering' | 'ready' | 'failed';
  tools: ToolStartup[];
  coreReadyAt: number;
  sessionBoundAt?: number;
  modelReadyAt?: number;
  pluginHostsSettledAt?: number;
  toolsSettledAt?: number;
  firstPromptAcceptedAt?: number;
}
export function runtimeStartup(value: unknown, runtimeId: string, sessionId?: string): RuntimeStartup | undefined {
  const state = value as RuntimeStartup | undefined;
  if (!state || state.protocol !== 1 || state.runtimeId !== runtimeId || typeof state.sessionId !== 'string'
    || sessionId && state.sessionId !== sessionId || !/^[a-f0-9-]{36}$/.test(state.startupEpoch)
    || !/^[a-f0-9-]{36}$/.test(state.configurationRevision) || !Number.isSafeInteger(state.catalogRevision)
    || state.catalogRevision < 0 || typeof state.targetBound !== 'boolean' || typeof state.modelReady !== 'boolean'
    || typeof state.cleanupConfirmed !== 'boolean'
    || !['waiting', 'discovering', 'ready', 'failed'].includes(state.discovery)
    || !Array.isArray(state.tools) || state.tools.length > 512 || state.tools.some(tool =>
      typeof tool.name !== 'string' || tool.name.length > 512
      || !['pending', 'connecting', 'connected', 'failed', 'disabled'].includes(tool.status)
      || !Number.isSafeInteger(tool.toolCount) || tool.toolCount < 0
      || tool.cleanupConfirmed !== undefined && typeof tool.cleanupConfirmed !== 'boolean')) return;
  return state;
}
export function startupWaiting(state?: RuntimeStartup) {
  return Boolean(state && state.discovery !== 'failed' && (!state.targetBound || !state.modelReady || state.discovery !== 'ready'
    || state.tools.some(tool => tool.status === 'pending' || tool.status === 'connecting')));
}
export function startupBlocked(state?: RuntimeStartup) {
  return Boolean(state && (!state.cleanupConfirmed || state.discovery === 'failed' || startupWaiting(state)
    || state.tools.some(tool => tool.cleanupConfirmed === false)));
}
export function startupMissing(state: RuntimeStartup) {
  return state.tools.filter(tool => tool.status === 'failed').map(tool => tool.name).sort();
}
