import { parseRemoteCommand } from '../../electron/remote-commands';
import type { RemoteCardValue } from '../../electron/remote-card.mjs';

export const scenes = [
  { id: 'reply', name: '正常回复', prompt: '帮我看看会话切换的边界，整理成一份清单。' },
  { id: 'approval', name: '工具审批', prompt: '运行一下测试，确认这次修改没问题。' },
  { id: 'interrupted', name: '中途停止', prompt: '先检查一下远程会话的消息路由。' },
  { id: 'pairing', name: '验证码匹配', prompt: '12345678' },
  { id: 'empty', name: '无文字结果', prompt: '执行这项任务，不需要文字回复。' },
] as const;
export type Scene = typeof scenes[number]['id'];
export interface ChatMessage {
  id: number; role: 'user' | 'bot'; text: string; reaction?: 'typing' | 'ok';
  card?: RemoteCardValue; approval?: 'pending' | 'allowed' | 'denied'; session?: string;
}
interface Job { input: number; reply: number; elapsed: number; scene: Scene; session: string; approved?: boolean }
export interface ChatState {
  messages: ChatMessage[]; events: string[]; job?: Job; queue: Job[]; next: number;
  session: string; connected: boolean; awaitingConfirmation: boolean;
}
export type ChatAction =
  | { type: 'reset'; scene: Scene }
  | { type: 'send'; text: string; scene: Scene }
  | { type: 'tick'; ms: number }
  | { type: 'finish' }
  | { type: 'decision'; id: number; allow: boolean }
  | { type: 'confirm' };
const names: Record<string, string> = { s1: '远程访问', s2: '发布准备' };
export const sessionLabel = (id: string) => `${id} · ${names[id] ?? '新会话'}`;
export const sampleAnswer = [
  '这几个边界已经整理好了：',
  '',
  '1. **切换会话**只影响后续消息，正在运行的任务仍属于原会话。',
  '2. **本机草稿**保持不变，不会被远端输入覆盖。',
  '3. **停止与审批**跟随原来的任务，不会误操作新一轮。',
  '',
  '可以先在一个会话里发起任务，再切换到另一个会话检查。',
  '',
  '```text',
  '/session s2',
  '/status s1',
  '```',
].join('\n');
export function initialChat(scene: Scene = 'reply'): ChatState {
  return { messages: scene === 'pairing' ? [] : [
    { id: 1, role: 'user', text: '你好，能收到我消息吗？' },
    { id: 2, role: 'bot', text: '可以，我在。\n\n我们继续刚才的任务，还是换个方向？',
      card: { title: sessionLabel('s1'), reply: 'completed', text: '可以，我在。\n\n我们继续刚才的任务，还是换个方向？' } },
  ], events: [], queue: [], next: 3, session: 's1', connected: scene !== 'pairing', awaitingConfirmation: false };
}
function event(state: ChatState, text: string): ChatState {
  return { ...state, events: [...state.events, text].slice(-12) };
}
function notice(state: ChatState, title: string, text: string): ChatState {
  return { ...state, next: state.next + 1,
    messages: [...state.messages, { id: state.next, role: 'bot', text, card: { title, text } }] };
}
function project(state: ChatState, job: Job, text: string, reply: 'working' | 'completed' | 'interrupted'): ChatState {
  const value: ChatMessage = { id: job.reply, role: 'bot', text,
    card: { title: sessionLabel(job.session), text, reply } };
  return { ...state, messages: state.messages.some(message => message.id === job.reply)
    ? state.messages.map(message => message.id === job.reply ? value : message) : [...state.messages, value] };
}
function settle(state: ChatState, interrupted = false): ChatState {
  const job = state.job;
  if (!job) return state;
  const previous = state.messages.find(message => message.id === job.reply)?.text ?? '';
  const text = interrupted ? previous : job.scene === 'empty' ? ''
    : job.scene === 'approval' ? '测试已经完成，**全部通过**。\n\n修改保持在当前分支，还没有打包或发布。' : sampleAnswer;
  const projected = project(state, job, text, interrupted ? 'interrupted' : 'completed');
  return event({ ...projected, job: undefined,
    messages: projected.messages.map(message => message.id === job.input ? { ...message, reaction: undefined } : message) },
  `${sessionLabel(job.session)} · ${interrupted ? '回复中断' : '回复结束'}，移除处理反应`);
}
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'reset') return initialChat(action.scene);
  if (action.type === 'finish') return state.job?.scene === 'approval' && !state.job.approved ? state : settle(state);
  if (action.type === 'confirm') return state.awaitingConfirmation
    ? notice(event({ ...state, connected: true, awaitingConfirmation: false }, '本机确认私聊与项目授权'),
      'Remote Beta / 远程访问', `已授权当前私聊。\n当前会话：${sessionLabel(state.session)}`) : state;
  if (action.type === 'decision') {
    if (!state.job || state.job.scene !== 'approval' || state.job.approved !== undefined
      || !state.messages.some(message => message.id === action.id && message.approval === 'pending')) return state;
    const messages = state.messages.map(message => message.id === action.id
      ? { ...message, approval: action.allow ? 'allowed' as const : 'denied' as const } : message);
    const next = event({ ...state, messages, job: { ...state.job, approved: action.allow, elapsed: 1800 } },
      action.allow ? '允许一次 · 原始审批已结算' : '拒绝 · 原始审批已结算');
    return action.allow ? next : settle(next, true);
  }
  if (action.type === 'send') {
    const text = action.text.trim();
    if (!text || text.length > 12000) return state;
    let next: ChatState = { ...state, next: state.next + 1,
      messages: [...state.messages, { id: state.next, role: 'user', text }] };
    const command = parseRemoteCommand(text);
    if (command.type !== 'message') {
      if (command.type === 'help') return notice(next, 'Remote Beta / 远程访问',
        '/sessions  查看会话\n/session s1  切换会话\n/new  新建会话\n/current  当前会话\n/status s1  查看状态\n/stop s1  停止任务\n/disconnect  断开连接');
      if (command.type === 'sessions') return notice(next, '会话',
        `s1 · 远程访问${state.session === 's1' ? ' ← 当前' : ''}\ns2 · 发布准备${state.session === 's2' ? ' ← 当前' : ''}`);
      if (command.type === 'select' && ['s1', 's2'].includes(command.ref))
        return notice({ ...next, session: command.ref }, '已切换会话', `后续消息发送到 ${sessionLabel(command.ref)}。`);
      if (command.type === 'current' || command.type === 'status')
        return notice(next, '会话状态', `${sessionLabel(command.type === 'status' && command.ref || state.session)}\n${state.job ? '任务正在运行' : '空闲'}`);
      if (command.type === 'stop') return !state.job || command.ref && command.ref !== state.job.session
        ? notice(next, '停止请求', '没有对应的运行中任务。')
        : notice(settle(next, true), '停止请求', `已请求停止 ${sessionLabel(state.job.session)}。`);
      if (command.type === 'projects') return notice(next, '已授权项目', 'p1 · Desktop for Step Code');
      if (command.type === 'disconnect') return notice({ ...next, connected: false }, '已断开连接', '本机已接受的任务仍保留。');
      if (command.type === 'new') return notice({ ...next, session: 's2' }, '新会话', 's2 · 发布准备\n尚未发送模型请求。');
      return notice(next, '未接收', '未知指令或参数不正确，没有转发给模型。');
    }
    if (action.scene === 'pairing') {
      if (text !== '12345678') return event(next, '验证码不匹配 · 没有授权或发送模型请求');
      next = { ...next, connected: false, awaitingConfirmation: true,
        messages: next.messages.map(message => message.id === state.next ? { ...message, reaction: 'ok' } : message) };
      return event(next, '验证码已匹配 · 等待本机确认，尚未授予会话访问权限');
    }
    if (!state.connected) return notice(next, '尚未授权', '请先在 Desktop 确认私聊与项目访问范围。');
    const job: Job = { input: state.next, reply: state.next + 1, elapsed: 0, scene: action.scene, session: state.session };
    return event({ ...next, next: state.next + 2,
      messages: next.messages.map(message => message.id === job.input ? { ...message, reaction: 'typing' } : message),
      ...(state.job ? { queue: [...state.queue, job] } : { job }) },
    `${sessionLabel(job.session)} · ${state.job ? '排队' : '接受消息'}，添加处理反应`);
  }
  if (!state.job) return state.queue.length ? event({ ...state, job: state.queue[0], queue: state.queue.slice(1) }, '开始处理下一条排队消息') : state;
  const job = { ...state.job, elapsed: state.job.elapsed + action.ms };
  let next: ChatState = { ...state, job };
  if (job.scene === 'approval' && job.elapsed >= 1300 && job.approved === undefined) {
    if (next.messages.some(message => message.approval === 'pending')) return state;
    next = project(next, job, '我先运行测试，确认结果。', 'working');
    return event({ ...next, next: next.next + 1, messages: [...next.messages, {
      id: next.next, role: 'bot', text: 'pnpm test\n\n仅执行本次测试，不修改权限策略。', approval: 'pending',
      card: { title: `工具审批 · ${sessionLabel(job.session)}`, text: 'pnpm test\n\n仅执行本次测试，不修改权限策略。' },
    }] }, '等待审批 · 模拟任务暂停');
  }
  const answer = job.scene === 'approval' ? '测试已经完成，**全部通过**。\n\n修改保持在当前分支，还没有打包或发布。' : sampleAnswer;
  if (job.elapsed >= 650) next = project(next, job, job.scene === 'empty' ? ''
    : answer.slice(0, Math.floor(Math.max(0, job.elapsed - 1500) / 6500 * answer.length)), 'working');
  if (job.scene === 'interrupted' && job.elapsed >= 5400) return settle(next, true);
  return job.elapsed >= 8500 ? settle(next) : next;
}
