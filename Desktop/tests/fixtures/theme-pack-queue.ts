import type { PendingMessage } from '../../src/contracts';
import { quotePrompt } from '../../src/chat-quotes';

export function themeQueueSamples(): PendingMessage[] {
  const text = '切换会话应该复用场景，而不是重新加载素材。';
  return [
    { id: 'offline-queue-1', version: 1, attachmentCount: 0,
      message: quotePrompt('先核对场景复用，再检查退出时的资源释放。', [{
        id: 'offline-quote', role: 'assistant', messageIndex: 1, startOffset: 0, endOffset: text.length,
        text, markdown: text, annotation: '保持原来的星海构图。',
      }], 'zh') },
    { id: 'offline-queue-2', version: 1, attachmentCount: 0, message: '接着检查窄窗口下的批阅抽屉和输入焦点。' },
    { id: 'offline-queue-3', version: 1, attachmentCount: 0, message: '最后核对静态模式和原版主题恢复。' },
  ];
}

// Mirrors only the local preview's edit/remove handshake; never sends to a runtime.
export function updateThemeQueue(messages: readonly PendingMessage[], action: string,
  args?: Record<string, unknown>): { messages: PendingMessage[]; delivered?: PendingMessage } {
  if (!['queue_edit', 'queue_remove', 'queue_steer', 'queue_steer_first'].includes(action))
    throw new Error('离线样例不支持此队列操作');
  const item = action === 'queue_steer_first' ? messages[0] : messages.find(item => item.id === args?.id);
  if (!item || item.sending || action !== 'queue_steer_first' && item.version !== args?.version)
    throw new Error('离线队列已变化，请重新打开');
  if (action === 'queue_edit') {
    if (typeof args?.message !== 'string' || !args.message.trim() || args.message.length > 100000)
      throw new Error('请输入有效的离线消息');
    return { messages: messages.map(current => current.id === item.id
      ? { ...current, message: args.message as string, version: current.version + 1 } : { ...current }) };
  }
  return { messages: messages.filter(current => current.id !== item.id).map(current => ({ ...current })),
    delivered: action === 'queue_remove' ? undefined : { ...item } };
}
