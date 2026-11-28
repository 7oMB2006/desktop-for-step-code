export interface PluginReloadRequest { id: string; ref: string }
export type PluginReloadReason = 'running' | 'approval' | 'queue' | 'background' | 'goal' | 'cron'
  | 'external' | 'remote-attached' | 'operation' | 'disconnected' | 'startup' | 'history' | 'changed' | 'unavailable' | 'expired' | 'failed'
  | 'occupied' | 'unsupported';
export interface PluginReloadSession {
  runtimeId: string; sessionId?: string; name: string;
  phase: 'ready' | 'waiting' | 'applying' | 'applied' | 'failed' | 'cancelled' | 'next-start';
  reason?: PluginReloadReason;
}
export interface PluginReloadState {
  pluginId: string; name: string; mode: 'plugin-mcp'; sessions: PluginReloadSession[];
  token?: string; operationId?: string;
}
export interface PluginReloadBridge {
  pluginReloadStart(input: PluginReloadRequest): Promise<PluginReloadState>;
  pluginReloadPreview(input: PluginReloadRequest): Promise<PluginReloadState>;
  pluginReloadApply(input: { token: string; whenIdle: boolean }): Promise<PluginReloadState>;
  pluginReloadState(input: PluginReloadRequest): Promise<PluginReloadState | null>;
  pluginReloadCancel(input: { id: string; operationId: string }): Promise<PluginReloadState>;
}
export function pluginReloadReason(reason: PluginReloadReason | undefined, zh: boolean): string {
  const labels: Record<PluginReloadReason, [string, string]> = {
    running: ['任务运行中', 'Task running'],
    approval: ['等待操作确认', 'Awaiting approval'],
    queue: ['有待发送消息', 'Messages queued'],
    background: ['后台任务未结束', 'Background work active'],
    goal: ['目标仍在运行', 'Goal active'],
    cron: ['定时任务占用中', 'Scheduled work active'],
    external: ['已跳过：由外部任务管理', 'Skipped: managed by an external task'],
    'remote-attached': ['已跳过：会话仍绑定 Remote', 'Skipped: session still attached to Remote'],
    operation: ['其他操作处理中', 'Another operation is in progress'],
    disconnected: ['运行时未连接', 'Runtime disconnected'],
    startup: ['工具仍在连接', 'Tools still connecting'],
    history: ['缺少可恢复的会话记录', 'Saved history unavailable'],
    changed: ['会话或配置已变化，请重新检查', 'Session or settings changed; check again'],
    unavailable: ['状态暂不可确认', 'State could not be verified'],
    expired: ['等待已过期，请重新检查', 'Wait expired; check again'],
    failed: ['插件连接未恢复', 'Plugin connection did not recover'],
    occupied: ['插件正在被调用', 'Plugin in use'],
    unsupported: ['此实例不支持热重载', 'Hot reload is unavailable for this instance'],
  };
  return reason ? labels[reason][zh ? 0 : 1] : '';
}
export const pluginReloadPending = (state?: PluginReloadState | null) =>
  Boolean(state?.operationId && state.sessions.some(item => ['ready', 'waiting', 'applying'].includes(item.phase)));
