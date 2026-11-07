import type { Message } from './contracts';

export function incompleteResponse(messages: Message[], active: boolean, language: 'zh' | 'en'): string | undefined {
  const last = [...messages].reverse().find(message => message.role === 'assistant' && !message.desktopImported);
  if (!last?.incomplete) return;
  const zh = language === 'zh';
  if (active) return zh ? '尚未获得有效回复，等待运行时恢复或结算' : 'No usable response yet; waiting for runtime recovery or settlement';
  return last.incomplete === 'missing_tool_call'
    ? zh ? '未收到有效工具调用，本轮未完成' : 'No valid tool call received; this run did not complete'
    : zh ? '未收到可见回复或有效工具调用，本轮未完成' : 'No visible response or valid tool call received; this run did not complete';
}
