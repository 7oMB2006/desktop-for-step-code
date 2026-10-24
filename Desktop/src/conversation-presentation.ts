import type { Content, Message } from './contracts';
import { visibleInputBlocks } from './ultracode-input';
import { isUserMessage } from './user-message';
import { cronMessage, type CronNotice } from './cron-message';
import { isAutoResumeMessage } from './auto-resume-message';

export const messageBlocks = (message: Message): Content[] => visibleInputBlocks(message);
export const messageText = (message: Message): string => messageBlocks(message)
  .filter(block => block.type === 'text').map(block => block.text ?? '').join('\n\n');

export type IndexedMessage = { message: Message; index: number };
export type ConversationEntry = { type: 'user'; item: IndexedMessage } | {
  type: 'response'; index: number; items: IndexedMessage[];
};

export function conversationEntries(messages: Message[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  messages.forEach((message, index) => {
    if (message.display === false) return;
    if (isUserMessage(message))
      entries.push({ type: 'user', item: { message, index } });
    else {
      const last = entries.at(-1);
      if (last?.type === 'response' && !cronMessage(message)) last.items.push({ message, index });
      else entries.push({ type: 'response', index, items: [{ message, index }] });
    }
  });
  return entries;
}

export type ResponseItem =
  | { type: 'auto-resume'; index: number; key: string }
  | { type: 'cron'; notice: CronNotice; index: number; key: string }
  | { type: 'thinking' | 'text' | 'image'; block: Content; index: number; key: string }
  | { type: 'tool'; call?: Content; result?: Message; index: number; key: string };

export function responsePresentation(items: IndexedMessage[]) {
  const content: ResponseItem[] = [];
  const pending = new Map<string, Extract<ResponseItem, { type: 'tool' }>>();
  for (const { message, index } of items) {
    if (message.display === false) continue;
    if (isAutoResumeMessage(message)) {
      content.push({ type: 'auto-resume', index, key: `${index}:auto-resume` });
      continue;
    }
    const notice = cronMessage(message);
    if (notice) {
      content.push({ type: 'cron', notice, index, key: `${index}:cron` });
      continue;
    }
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
    text: items.filter(item => item.message.display !== false && item.message.role !== 'toolResult'
      && !isAutoResumeMessage(item.message))
      .map(item => messageText(item.message)).filter(Boolean).join('\n\n'),
  };
}

export type SubagentTaskKey = { agent: string; task: string; toolCallId?: string; taskIndex?: number };

/** Finds the live record for a selected subagent, so an open panel tracks later tool events. */
export function findSubagentTask(messages: Message[], key: SubagentTaskKey | null): SubagentTask | null {
  if (!key) return null;
  const background = backgroundSubagentStates(messages);
  const results = new Map(messages.filter(message => message.role === 'toolResult' && message.toolCallId)
    .map(message => [message.toolCallId!, message]));
  const matches = (task: SubagentTask) => key.toolCallId
      ? task.toolCallId === key.toolCallId && task.taskIndex === key.taskIndex
      : task.agent === key.agent && task.task === key.task;
  for (const message of messages) {
    for (const block of messageBlocks(message)) {
      if (block.type !== 'toolCall' || block.name !== 'subagent' || (key.toolCallId && block.id !== key.toolCallId)) continue;
      const match = subagentTasks(block, block.id ? results.get(block.id) : undefined, background).find(matches);
      if (match) return match;
    }
  }
  for (const result of results.values()) {
    if (result.toolName !== 'subagent') continue;
    const match = subagentTasks(undefined, result, background).find(matches);
    if (match) return match;
  }
  return null;
}

export function toolSubject(call: Content | undefined): string {
  const args = call?.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return '';
  const values = args as Record<string, unknown>;
  const value = ['path', 'file_path', 'filePath', 'command', 'cmd', 'query', 'url']
    .map(key => values[key]).find(value => typeof value === 'string');
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').slice(0, 160) : '';
}

const SUBAGENT_STATUSES = ['queued', 'running', 'completed', 'failed', 'aborted', 'skipped'] as const;
export type SubagentTask = {
  agent: string;
  task: string;
  status: typeof SUBAGENT_STATUSES[number];
  messages: Message[];
  model?: string;
  turns?: number;
  toolCallId?: string;
  taskIndex?: number;
  backgroundAgentId?: string;
};

export type BackgroundSubagentStates = ReadonlyMap<string, SubagentTask['status']>;

/** Background dispatch results are snapshots; later custom messages carry lane lifecycle. */
export function backgroundSubagentStates(messages: Message[]): BackgroundSubagentStates {
  const states = new Map<string, SubagentTask['status']>();
  const eventStatuses: Record<string, SubagentTask['status']> = {
    background_done: 'completed', background_failed: 'failed', background_interrupted: 'aborted',
    background_progress: 'running', background_restarted: 'running', background_needs_input: 'running',
  };
  // A fast child can notify before its dispatch result arrives, so register IDs first.
  for (const message of messages) {
    const id = message.details?.agentId;
    if (message.role === 'toolResult' && message.toolName === 'subagent' && typeof id === 'string' && id
      && SUBAGENT_STATUSES.includes(message.details?.status as SubagentTask['status'])) {
      states.set(id, message.details!.status as SubagentTask['status']);
    }
  }
  for (const message of messages) {
    const details = message.details;
    const id = details?.agentId;
    if (typeof id !== 'string' || !id) continue;
    if (states.has(id)) {
      if (message.role === 'custom' && message.customType === 'agent-notification'
        && typeof details?.event === 'string' && Object.hasOwn(eventStatuses, details.event)
        && details.status === eventStatuses[details.event]) {
        states.set(id, eventStatuses[details.event]);
      } else if (message.role === 'toolResult' && message.toolName === 'agent_send'
        && SUBAGENT_STATUSES.includes(details?.status as SubagentTask['status'])) {
        states.set(id, details!.status as SubagentTask['status']);
      }
    }
  }
  return states;
}

/** One subagent call carries a task list in its call args and per-task records in its result details. */
export function subagentTasks(call: Content | undefined, result: Message | undefined, background?: BackgroundSubagentStates): SubagentTask[] {
  const details = (result as { details?: { results?: unknown } } | undefined)?.details;
  const records = Array.isArray(details?.results) ? details.results.filter(record => record && typeof record === 'object') : [];
  const tasks: SubagentTask[] = records.map(record => {
    const value = record as Record<string, unknown>;
    const usage = value.usage as { turns?: unknown } | undefined;
    return {
      agent: typeof value.agent === 'string' ? value.agent : '',
      task: typeof value.task === 'string' ? value.task : '',
      status: SUBAGENT_STATUSES.includes(value.status as typeof SUBAGENT_STATUSES[number]) ? value.status as SubagentTask['status'] : 'running',
      messages: Array.isArray(value.messages) ? value.messages.filter(message => message && typeof message === 'object') as Message[] : [],
      model: typeof value.model === 'string' ? value.model : undefined,
      turns: typeof usage?.turns === 'number' ? usage.turns : undefined,
    };
  });
  // No record yet: the first update has not landed, so show the planned list from the call args.
  const args = call?.arguments as { tasks?: unknown; chain?: unknown; agent?: unknown; task?: unknown } | undefined;
  const planned: { agent: string; task: string }[] = [];
  for (const list of [args?.tasks, args?.chain]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const value = item as { agent?: unknown; task?: unknown };
      planned.push({ agent: typeof value.agent === 'string' ? value.agent : '', task: typeof value.task === 'string' ? value.task : '' });
    }
  }
  if (!planned.length && (typeof args?.agent === 'string' || typeof args?.task === 'string')) {
    planned.push({ agent: String(args.agent ?? ''), task: String(args.task ?? '') });
  }
  const entries = tasks.length ? tasks : planned.map((entry, index) => ({ ...entry,
    status: Array.isArray(args?.chain) && index > 0 ? 'queued' as const : 'running' as const, messages: [] }));
  const backgroundAgentId = typeof result?.details?.agentId === 'string' ? result.details.agentId : undefined;
  const laneStatus = backgroundAgentId ? background?.get(backgroundAgentId) : undefined;
  return entries.map((entry, taskIndex) => ({
    ...entry, toolCallId: call?.id ?? result?.toolCallId, taskIndex, backgroundAgentId,
    // Preserve already-settled steps in a failed multi-step lane. A single lane can run again.
    status: laneStatus && (entries.length === 1 || entry.status === 'running'
      || (entry.status === 'queued' && laneStatus !== 'running')) ? laneStatus : entry.status,
  }));
}

export type ToolState = 'running' | 'done' | 'failed' | 'missing';
type ToolKind = 'command' | 'read' | 'write' | 'edit' | 'search' | 'folder' | 'web' | 'sessions' | 'session-read' | 'session-send' | 'other';
const toolKinds: Record<string, ToolKind> = {
  bash: 'command', powershell: 'command', run_command: 'command', exec_command: 'command',
  read: 'read', read_file: 'read',
  write: 'write', write_file: 'write',
  edit: 'edit', edit_file: 'edit', apply_patch: 'edit',
  grep: 'search', search: 'search', search_files: 'search',
  ls: 'folder', list_directory: 'folder', find: 'folder',
  fetch: 'web', fetch_url: 'web', web_fetch: 'web',
  desktop_sessions: 'sessions', desktop_read_session: 'session-read', desktop_send_message: 'session-send',
};
const toolLabels: Record<ToolKind, [string, string, string, string, string, string]> = {
  command: ['运行命令', '运行了命令', '运行命令失败', 'Running command', 'Ran command', 'Command failed'],
  read: ['读取文件', '读取了文件', '读取文件失败', 'Reading file', 'Read file', 'Read failed'],
  write: ['写入文件', '写入了文件', '写入文件失败', 'Writing file', 'Wrote file', 'Write failed'],
  edit: ['修改文件', '修改了文件', '修改文件失败', 'Editing file', 'Edited file', 'Edit failed'],
  search: ['搜索内容', '搜索了内容', '搜索内容失败', 'Searching content', 'Searched content', 'Search failed'],
  folder: ['查看目录', '查看了目录', '查看目录失败', 'Inspecting directory', 'Inspected directory', 'Directory inspection failed'],
  web: ['获取网页', '获取了网页', '获取网页失败', 'Fetching page', 'Fetched page', 'Fetch failed'],
  sessions: ['查看会话', '查看了会话', '查看会话失败', 'Listing sessions', 'Listed sessions', 'Session listing failed'],
  'session-read': ['读取会话', '读取了会话', '读取会话失败', 'Reading session', 'Read session', 'Session read failed'],
  'session-send': ['请求会话传话', '处理了会话传话请求', '会话传话失败', 'Requesting peer delivery', 'Processed peer delivery request', 'Peer delivery failed'],
  other: ['', '', '', '', '', ''],
};

export function thenRunStatus(name: string, result: Message | undefined): 'passed' | 'failed' | 'timed-out' | 'unavailable' | undefined {
  if (!['write_file', 'edit_file'].includes(name) || !result || result.isError || result.desktopToolPending) return;
  const details = result.details?.thenRun;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return;
  const check = details as Record<string, unknown>;
  if (typeof check.command !== 'string' || !check.command.trim() || typeof check.timedOut !== 'boolean'
    || check.exitCode !== null && !(typeof check.exitCode === 'number' && Number.isSafeInteger(check.exitCode) && check.exitCode >= 0)) return;
  return check.timedOut ? 'timed-out' : check.exitCode === 0 ? 'passed' : check.exitCode === null ? 'unavailable' : 'failed';
}

export function toolPresentation(name: string, result: Message | undefined, active: boolean, language: 'zh' | 'en', input?: unknown) {
  const verification = thenRunStatus(name, result);
  const checkFailed = verification !== undefined && verification !== 'passed';
  const state: ToolState = result && !result.desktopToolPending ? (result.isError || checkFailed ? 'failed' : 'done') : active ? 'running' : 'missing';
  const kind = Object.hasOwn(toolKinds, name) ? toolKinds[name] : 'other';
  const zh = language === 'zh';
  const labels = toolLabels[kind];
  const embedded = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).then_run : undefined;
  // Cancellation can retain a mutation receipt but omit structured check details.
  if (state === 'failed' && result?.isError && ['write_file', 'edit_file'].includes(name)
    && typeof embedded === 'string' && embedded.trim()) {
    const label = zh ? '文件修改或验证未完成' : 'File change or check incomplete';
    return { state, kind, label, status: label };
  }
  if (verification) {
    const check = zh ? { passed: '验证通过', failed: '验证失败', 'timed-out': '验证超时', unavailable: '验证未完成' }[verification]
      : { passed: 'check passed', failed: 'check failed', 'timed-out': 'check timed out', unavailable: 'check incomplete' }[verification];
    const mutation = result?.details?.changed === false ? zh ? '文件内容未变化' : 'File unchanged' : labels[zh ? 1 : 4];
    return { state, kind, label: `${mutation} · ${check}`, status: `${mutation} · ${check}` };
  }
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
