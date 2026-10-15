import { toolPresentation, type ResponseItem } from './conversation-presentation';

export type ToolItem = Extract<ResponseItem, { type: 'tool' }>;
export type GroupedResponseItem = ResponseItem | { type: 'tool-group'; key: string; index: number; items: ToolItem[] };

// These have dedicated interaction surfaces or lifecycle ownership.
const separateTools = new Set(['subagent', 'workflow', 'enter_plan_mode', 'exit_plan_mode', 'desktop_send_message', 'clarify_user']);

export function groupableTool(item: ResponseItem, active: boolean, awaiting: readonly string[]): item is ToolItem {
  return item.type === 'tool' && !separateTools.has(item.call?.name ?? '') && !separateTools.has(item.result?.toolName ?? '')
    && !item.result?.isError && Boolean((item.result && !item.result.desktopToolPending) || active)
    && !(item.call?.id && awaiting.includes(item.call.id));
}

export function groupConsecutiveTools(content: ResponseItem[], active: boolean, awaiting: readonly string[] = []): GroupedResponseItem[] {
  const result: GroupedResponseItem[] = [];
  let pending: ToolItem[] = [];
  const flush = () => {
    if (pending.length > 1) result.push({ type: 'tool-group', key: `tools:${pending[0].key}`, index: pending[0].index, items: pending });
    else result.push(...pending);
    pending = [];
  };
  for (const item of content) {
    if (groupableTool(item, active, awaiting)) {
      pending.push(item);
    } else {
      flush();
      result.push(item);
    }
  }
  flush();
  return result;
}

export function toolGroupLabel(items: ToolItem[], language: 'zh' | 'en'): string {
  const zh = language === 'zh';
  const finished = items.filter(item => item.result && !item.result.desktopToolPending).length;
  if (finished < items.length) return zh ? `正在处理工具 · ${finished} / ${items.length} 项已返回` : `Working · ${finished} / ${items.length} results received`;
  const counts = new Map<string, number>();
  for (const item of items) {
    const kind = toolPresentation(item.call?.name ?? item.result?.toolName ?? '', item.result, false, language).kind;
    const label = {
      read: zh ? '读取文件' : 'file reads', write: zh ? '写入文件' : 'file writes',
      edit: zh ? '修改文件' : 'file edits', command: zh ? '命令执行' : 'commands',
      search: zh ? '内容搜索' : 'searches', folder: zh ? '目录查看' : 'directory checks',
      web: zh ? '网页获取' : 'web requests', sessions: zh ? '会话查看' : 'session listings',
      'session-read': zh ? '会话读取' : 'session reads', 'session-send': zh ? '会话传话' : 'peer deliveries',
      other: zh ? '工具调用' : 'tool calls',
    }[kind];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = [...counts].map(([label, count]) => zh ? `${label} ${count} 项` : `${count} ${label}`);
  if (summary.length > 3) return zh ? `已完成 ${items.length} 项工具操作` : `${items.length} tool operations completed`;
  return `${zh ? '已完成：' : 'Completed: '}${summary.join(zh ? '、' : ', ')}`;
}
