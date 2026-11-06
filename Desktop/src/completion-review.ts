import type { Message } from './contracts';

export interface CompletionReview {
  version: 1; id: string; sessionId: string;
  status: 'pending' | 'reviewing' | 'ended' | 'failed' | 'cancelled' | 'skipped';
  sent: boolean; reason?: string;
}
export function completionReview(value: unknown): CompletionReview | undefined {
  if (!value || typeof value !== 'object') return;
  const item = value as CompletionReview;
  if (item.version !== 1 || typeof item.id !== 'string' || typeof item.sessionId !== 'string'
    || typeof item.sent !== 'boolean' || !['pending', 'reviewing', 'ended', 'failed', 'cancelled', 'skipped'].includes(item.status)) return;
  return { version: 1, id: item.id, sessionId: item.sessionId, status: item.status, sent: item.sent,
    ...(typeof item.reason === 'string' ? { reason: item.reason } : {}) };
}
export const reviewActive = (review?: CompletionReview) => review?.status === 'pending' || review?.status === 'reviewing';
export function isReviewInput(message: Message) {
  return message.role === 'custom' && message.customType === 'desktop-completion-review-input'
    && message.details?.version === 1 && message.details.source === 'completion-review' && typeof message.details.reviewId === 'string';
}
export function reviewResult(message: Message) {
  return message.role === 'custom' && message.customType === 'desktop-completion-review-result' ? completionReview(message.details) : undefined;
}
export function reviewLabel(status: CompletionReview['status'] | 'armed', zh: boolean) {
  return (zh ? { armed: '完成后自查', pending: '待自查', reviewing: '自查中', ended: '自查流程结束',
    failed: '自查未完成', cancelled: '自查已取消', skipped: '自查已跳过' }
    : { armed: 'Review after task', pending: 'Review pending', reviewing: 'Self-reviewing', ended: 'Self-review ended',
      failed: 'Self-review failed', cancelled: 'Self-review cancelled', skipped: 'Self-review skipped' })[status];
}
export function reviewReason(reason: string | undefined, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    input: ['优先处理新输入', 'New input takes priority'],
    cancelled: ['任务已停止', 'Task stopped'], rebound: ['运行时已更换，不会自动恢复', 'Runtime replaced; no automatic resumption'],
    failure: ['模型或执行发生错误', 'Model or execution failed'], denied: ['终止性权限拒绝', 'Terminating permission denial'],
    approval: ['等待外部审批，不自动续跑', 'External approval required; no automatic continuation'],
    mode: ['任务模式或模型已改变', 'Task mode or model changed'], intercepted: ['自动自查输入未投递', 'Review input was not delivered'],
    no_final_text: ['自查未返回最终文本', 'Review returned no final text'],
    persistence: ['自查状态保存失败', 'Self-review status could not be saved'],
  };
  return reason && labels[reason] ? labels[reason][zh ? 0 : 1] : '';
}
export function reviewErrorText(text: string, zh: boolean) {
  if (!zh) return text;
  const labels: [string, string][] = [
    ['This runtime does not support completion review', '当前运行时不支持完成后自查'],
    ['Completion review is only available for ordinary main tasks', '完成后自查仅适用于普通主会话任务'],
    ['Disable completion review before selecting another task mode', '请先关闭完成后自查，再选择其他任务模式'],
    ['Wait for the current prompt submission', '请等待当前任务提交完成'],
    ['Tasks with completion review must be sent in order', '带有完成后自查的任务必须按队列顺序发送，不能插入当前任务'],
    ['Completion review requires a new idle task.', '请在当前任务结束后开始新的自查任务。'],
    ['Finish or cancel completion review before changing this task.', '请先完成或取消自查，再修改当前任务。'],
    ['Task cancelled before delivery.', '任务已在投递前取消。'],
    ['Completion review was cancelled before delivery.', '自查已在投递前取消。'],
  ];
  for (const [original, translated] of labels) text = text.replace(original, translated);
  return text;
}
