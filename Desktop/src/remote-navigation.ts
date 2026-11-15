export type RemotePreparationSource = 'feishu-recovery' | 'feishu-session' | 'external-agent';
export interface RemoteNavigationWait {
  id: number;
  source: RemotePreparationSource;
}

export function remoteNavigationWait(value: unknown): RemoteNavigationWait | undefined {
  if (!value || typeof value !== 'object') return;
  const { id, source } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(id) || (id as number) < 1
    || !['feishu-recovery', 'feishu-session', 'external-agent'].includes(source as string)) return;
  return { id: id as number, source: source as RemotePreparationSource };
}

export function remoteNavigationTitle(source: RemotePreparationSource, language: string): string {
  const zh = language === 'zh';
  if (source === 'external-agent') return zh ? '正在准备外部 Agent 任务' : 'Preparing an external agent task';
  if (source === 'feishu-recovery') return zh ? '正在恢复飞书会话' : 'Restoring the Feishu session';
  return zh ? '正在准备飞书会话' : 'Preparing the Feishu session';
}
