import type { Session } from '../../src/contracts';

export interface SearchMessage { id: string; role: 'user' | 'assistant'; text: string }
export interface SearchConversation {
  id: string; title: string; project: string; date: string; archived?: boolean; messages: SearchMessage[];
}

// Fixture records only. No account, model or filesystem access is used.
export const conversations: SearchConversation[] = [
  { id: 'account', title: '账户用量与模型切换', project: 'StepCode Desktop', date: '2026-10-26', messages: [
    { id: 'a1', role: 'user', text: '切换到 Plan 以后，不能还在花直调 API 的钱。我们要怎么确认？' },
    { id: 'a2', role: 'assistant', text: '先区分选择中的登录方式和已经生效的账户。计费路由跟随已生效账户；Plan 请求失败也不自动回退为 API。账户额度与会话费用估算分开显示。' },
    { id: 'a3', role: 'user', text: '那取消授权呢？我不想把原来的账户也清空。' },
    { id: 'a4', role: 'assistant', text: '取消或授权失败时保留原账户。授权完成前不发送新任务，运行中的任务也不允许切换账户。这两个门控需要一起验证。' },
  ] },
  { id: 'usage', title: '套餐额度与余额展示', project: 'StepCode Desktop', date: '2026-10-24', messages: [
    { id: 'u1', role: 'user', text: '套餐用户和 API 用户都应该能直接看到余额，不想每次打开官网。' },
    { id: 'u2', role: 'assistant', text: '套餐页按官方返回的名称、额度窗口和重置时间展示；API 账户显示可用余额。查询失败保留带时间标记的旧数据，不把未知额度显示成零。' },
    { id: 'u3', role: 'assistant', text: '上下文计费估算按原始请求的 Plan 或 API 口径记录。切换账户后不能重算过去的请求，也不能把 Credit 与金额合成一个总数。' },
  ] },
  { id: 'cache', title: '长任务中的缓存命中', project: 'StepCode Desktop', date: '2026-10-21', messages: [
    { id: 'c1', role: 'user', text: '上下文长度差不多，为什么切计划模式以后缓存命中明显下降？' },
    { id: 'c2', role: 'assistant', text: '需要核对工具列表和任务状态快照的位置。保持提示词公共前缀稳定，可以减少不必要的缓存失效；不能只靠总 Token 数判断计费变化。' },
  ] },
  { id: 'release', title: 'v0.5.1 发布前检查', project: 'StepCode Desktop', date: '2026-10-19', messages: [
    { id: 'r1', role: 'user', text: '我两头切换试过了，计费正常，没有串。剩下覆盖升级验收。' },
    { id: 'r2', role: 'assistant', text: '保留账户、设置和历史会话，退出托盘中的旧应用后覆盖安装。升级结束再检查套餐额度和 API 余额，确认会话能继续。' },
  ] },
  { id: 'web', title: '账户说明页文案', project: '项目网站', date: '2026-10-22', messages: [
    { id: 'w1', role: 'user', text: '官网说明里，计费估算和实际账单的区别要写清楚。' },
    { id: 'w2', role: 'assistant', text: '账户余额来自官方接口，会话费用是本机估算。第三方供应商只统计 Token，不默认套用官方 API 价格。' },
  ] },
  { id: 'notes', title: 'Agent 系统设计笔记', project: '研究笔记', date: '2026-10-16', messages: [
    { id: 'n1', role: 'user', text: '把会话历史和检索索引分离，索引可以删除重建，会话本身不能受影响。' },
    { id: 'n2', role: 'assistant', text: '索引属于派生数据。查询只返回需要的片段，点击后再加载对应消息；首次回填和降级扫描的负载需要单独测量。' },
  ] },
  { id: 'archive', title: '早期账户方案', project: 'StepCode Desktop', date: '2026-10-08', archived: true, messages: [
    { id: 'h1', role: 'user', text: '早期方案把 API 金额与套餐计费展示在同一个位置，看起来容易混淆。' },
    { id: 'h2', role: 'assistant', text: '后续拆成两个账户视图，已保存的历史记录不因为用户切换模式而重新解释。' },
  ] },
];

export const projects = [...new Set(conversations.map(item => item.project))];
export const projectPath = (project: string) => `D:\\Projects\\${project}`;
export const sidebarSessions: Session[] = conversations.map(item => ({
  id: item.id, name: item.title, cwd: projectPath(item.project), path: `${item.id}.jsonl`,
  firstMessage: item.messages[0].text, modified: item.date, messageCount: item.messages.length,
}));
export const sidebarPreferences = {
  language: 'zh' as const, workspaces: projects.map(projectPath),
  archivedSessionIds: conversations.filter(item => item.archived).map(item => item.id),
};

export const termsFor = (query: string) => query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
export const matches = (text: string, query: string) => termsFor(query).every(term => text.toLocaleLowerCase().includes(term));

export function queryFixture(query: string, project: string, range: string, archived: boolean) {
  if (!query.trim()) return [];
  const since = range === '7' ? '2026-10-20' : range === '30' ? '2026-09-27' : '';
  return [...conversations].sort((a, b) => b.date.localeCompare(a.date)).flatMap(conversation => {
    if ((!archived && conversation.archived) || (project !== 'all' && project !== conversation.project) || conversation.date < since) return [];
    return conversation.messages.filter(message => matches(message.text, query))
      .map(message => ({ conversation, message }));
  });
}
