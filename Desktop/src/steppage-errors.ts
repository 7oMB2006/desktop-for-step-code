/** Project only known lifecycle failures, never raw IPC/runtime messages. */
export function stepPageOperationError(error: unknown, operation: 'prepare' | 'restart', language: string) {
  const zh = language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const message = error instanceof Error ? error.message : '';
  if (operation === 'restart' && message.includes('Delete scheduled Cron jobs before restarting or changing this runtime; Cron state must be available'))
    return t('当前会话承载定时任务或其状态尚未确认，未执行重启。可在新会话中使用已准备的插件。',
      'This session hosts scheduled tasks or its Cron state is unavailable, so it was not restarted. Use the prepared plugin in a new session.');
  if (message.includes('Pause the active goal first'))
    return t('请先暂停正在运行的 Goal，再重试。', 'Pause the active Goal before retrying.');
  if (message.includes('Send or withdraw the pending messages first'))
    return t('请先发送或撤回排队消息，再重试。', 'Send or withdraw queued messages before retrying.');
  if (message.includes('Stop this session task first'))
    return t('仍有会话任务正在执行或等待确认，请结束后重试。', 'A session is running or awaiting confirmation. Finish it before retrying.');
  if (['Shared settings operation in progress', 'Session operation in progress', 'Workspace operation in progress', 'Undo in progress'].some(value => message.includes(value)))
    return t('其他设置或会话操作尚未完成，请稍后重试。', 'Another settings or session operation is in progress. Please retry shortly.');
  return operation === 'prepare'
    ? t('准备请求未完成，请重试。', 'The preparation request did not complete. Please retry.')
    : t('会话重启未完成，请重试。', 'Session restart did not complete. Please retry.');
}
