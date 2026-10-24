export function sessionMoveError(cause: unknown, zh: boolean): string {
  const message = cause instanceof Error ? cause.message : '';
  const t = (cn: string, en: string) => zh ? cn : en;
  const cron = /MOVE_CRON_(HOST|ASSOCIATED|UNAVAILABLE)(?:: ([\w, -]+))?/.exec(message);
  const ids = cron?.[2] && !['unavailable', 'runtime'].includes(cron[2]) ? ` (${cron[2]})` : '';
  if (cron?.[1] === 'HOST') return t(
    `此会话正在承载定时任务${ids}，移动会停止原目录的调度。请先在定时任务页处理这些任务。`,
    `This conversation is hosting scheduled tasks${ids}. Moving would stop their original host. Resolve these tasks in Scheduled Tasks first.`);
  if (cron?.[1] === 'ASSOCIATED') return t(
    `此会话有关联的持久定时任务${ids}，任务不会随会话迁移。请先在定时任务页处理这些任务。`,
    `This conversation owns saved scheduled tasks${ids}, which do not move with the chat. Resolve these tasks in Scheduled Tasks first.`);
  if (cron || /scheduled|cron/i.test(message)) return t(
    '暂时无法核验此会话的定时任务或运行时不支持隔离，请刷新后重试；无需清空其他会话的定时任务。',
    'Scheduled-task ownership cannot be verified, or the runtime lacks isolation support. Refresh and retry; unrelated tasks do not need to be deleted.');
  if (/goal/.test(message)) return t('请先暂停当前目标，再移动会话。', 'Pause the active goal before moving.');
  if (/background agents/.test(message)) return t(
    '后台子代理尚未确认结束，请先处理后再移动。', 'Background agents have not settled. Resolve them before moving.');
  if (/ENOENT|ENOTDIR|directory|unavailable/.test(message)) return t(
    '目标目录不可用，请检查目录是否存在。', 'The destination folder is unavailable. Check that it exists.');
  return t('未能移动，请确认会话已停止、待发消息与审批已处理后重试。',
    'Could not move. Stop the session and resolve queued messages and approvals, then retry.');
}
