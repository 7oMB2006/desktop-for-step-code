import type { Content, Message } from './contracts';

export const messageBlocks = (message: Message): Content[] => typeof message.content === 'string'
  ? [{ type: 'text', text: message.content }] : message.content ?? [];
export const messageText = (message: Message): string => messageBlocks(message)
  .filter(block => block.type === 'text').map(block => block.text ?? '').join('\n\n');

export type IndexedMessage = { message: Message; index: number };
export type ConversationEntry = { type: 'user'; item: IndexedMessage } | {
  type: 'response'; index: number; items: IndexedMessage[];
};

export function conversationEntries(messages: Message[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'user') entries.push({ type: 'user', item: { message, index } });
    else {
      const last = entries.at(-1);
      if (last?.type === 'response') last.items.push({ message, index });
      else entries.push({ type: 'response', index, items: [{ message, index }] });
    }
  });
  return entries;
}

export type ResponseItem =
  | { type: 'thinking' | 'text' | 'image'; block: Content; index: number; key: string }
  | { type: 'tool'; call?: Content; result?: Message; index: number; key: string };

export function responsePresentation(items: IndexedMessage[]) {
  const content: ResponseItem[] = [];
  const pending = new Map<string, Extract<ResponseItem, { type: 'tool' }>>();
  for (const { message, index } of items) {
    if (message.role === 'toolResult') {
      const call = message.toolCallId ? pending.get(message.toolCallId) : undefined;
      if (call) {
        call.result = message;
        pending.delete(message.toolCallId!);
      } else content.push({ type: 'tool', result: message, index, key: `${index}:result` });
      continue;
    }
    messageBlocks(message).forEach((block, part) => {
      const key = `${index}:${part}`;
      if (block.type === 'toolCall') {
        const item: Extract<ResponseItem, { type: 'tool' }> = { type: 'tool', call: block, index, key };
        content.push(item);
        if (block.id) pending.set(block.id, item);
      } else if (['thinking', 'text', 'image'].includes(block.type)) {
        content.push({ type: block.type as 'thinking' | 'text' | 'image', block, index, key });
      }
    });
  }
  return {
    content,
    lastTextIndex: content.reduce((last, item, position) =>
      item.type === 'text' && item.block.text?.trim() ? position : last, -1),
    text: items.filter(item => item.message.role !== 'toolResult')
      .map(item => messageText(item.message)).filter(Boolean).join('\n\n'),
  };
}

export function toolSubject(call: Content | undefined): string {
  const args = call?.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const values = args as Record<string, unknown>;
  const value = ['path', 'file_path', 'filePath', 'command', 'cmd', 'query', 'url']
    .map(key => values[key]).find(value => typeof value === 'string');
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').slice(0, 160) : '';
}

export type ToolState = 'running' | 'done' | 'failed' | 'missing';
type ToolKind = 'command' | 'read' | 'write' | 'edit' | 'search' | 'folder' | 'web' | 'other';
const toolKinds: Record<string, ToolKind> = {
  bash: 'command', powershell: 'command', run_command: 'command', exec_command: 'command',
  read: 'read', read_file: 'read',
  write: 'write', write_file: 'write',
  edit: 'edit', edit_file: 'edit', apply_patch: 'edit',
  grep: 'search', search: 'search', search_files: 'search',
  ls: 'folder', list_directory: 'folder', find: 'folder',
  fetch: 'web', fetch_url: 'web', web_fetch: 'web',
};
const toolLabels: Record<ToolKind, [string, string, string, string, string, string]> = {
  command: ['运行命令', '运行了命令', '运行命令失败', 'Running command', 'Ran command', 'Command failed'],
  read: ['读取文件', '读取了文件', '读取文件失败', 'Reading file', 'Read file', 'Read failed'],
  write: ['写入文件', '写入了文件', '写入文件失败', 'Writing file', 'Wrote file', 'Write failed'],
  edit: ['修改文件', '修改了文件', '修改文件失败', 'Editing file', 'Edited file', 'Edit failed'],
  search: ['搜索内容', '搜索了内容', '搜索内容失败', 'Searching content', 'Searched content', 'Search failed'],
  folder: ['查看目录', '查看了目录', '查看目录失败', 'Inspecting directory', 'Inspected directory', 'Directory inspection failed'],
  web: ['获取网页', '获取了网页', '获取网页失败', 'Fetching page', 'Fetched page', 'Fetch failed'],
  other: ['', '', '', '', '', ''],
};

export function toolPresentation(name: string, result: Message | undefined, active: boolean, language: 'zh' | 'en') {
  const state: ToolState = result ? (result.isError ? 'failed' : 'done') : active ? 'running' : 'missing';
  const kind = Object.hasOwn(toolKinds, name) ? toolKinds[name] : 'other';
  const zh = language === 'zh';
  const labels = toolLabels[kind];
  const label = kind === 'other'
    ? (zh ? (state === 'running' ? `正在调用 ${name}` : state === 'done' ? `调用了 ${name}`
      : state === 'failed' ? `调用 ${name} 失败` : `调用 ${name}（未返回）`)
      : (state === 'running' ? `Calling ${name}` : state === 'done' ? `Called ${name}`
        : state === 'failed' ? `${name} failed` : `${name} (no result)`))
    : state === 'running' ? (zh ? `正在${labels[0]}` : labels[3])
      : state === 'done' ? labels[zh ? 1 : 4]
        : state === 'failed' ? labels[zh ? 2 : 5]
          : `${labels[zh ? 0 : 3]}${zh ? '（未返回）' : ' (no result)'}`;
  const status = zh ? ({ running: '等待结果', done: '完成', failed: '失败', missing: '未返回' }[state])
    : ({ running: 'Pending', done: 'Done', failed: 'Failed', missing: 'No result' }[state]);
  return { state, kind, label, status };
}
