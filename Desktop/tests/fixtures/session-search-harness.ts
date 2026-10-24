import type { DesktopBridge, Preferences, Session, Snapshot } from '../../src/contracts';
import { themes } from '../../src/theme';

const params = new URLSearchParams(location.search);
const theme = themes.find(item => item.id === params.get('theme'))?.id ?? 'light';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const project = 'D:\\Projects\\StepCode';
const other = 'D:\\Projects\\Website';
const model = { provider: 'step', id: 'preview', name: 'Step Code' };
const now = new Date().toISOString();
const sessions: Session[] = [
  ['login', '修复登录刷新', 'Investigate token refresh after login', project],
  ['usage', '账户用量面板', '查询 Step Plan 套餐额度', project],
  ['mcp', 'MCP 连接重试', '检查内置 StepPage 首次准备', project],
  ['theme', '调整主题色', '让侧栏跟随主题底色', project],
  ['search', '会话搜索', '搜索会话与项目', project],
  ['web', '网页布局', '修复首页的窄屏布局', other],
  ['notes', '周末研究', '整理 Agent 系统设计笔记', 'D:\\Notes'],
  ['archived', '旧登录方案', '已归档的 token 方案', project],
].map(([id, name, firstMessage, cwd]) => ({ id, name, firstMessage, cwd, path: id + '.jsonl',
  modified: now, messageCount: 2, independent: cwd === 'D:\\Notes' }));
let snapshot: Snapshot = {
  preferences: { theme, language, workspaces: [project, other], workspace: project,
    workspaceNames: { 'd:/projects/stepcode': '阶跃桌面', 'd:/projects/website': '项目网站' },
    collapsedWorkspaces: ['d:/projects/stepcode'], pinnedWorkspaces: ['d:/projects/stepcode'],
    archivedSessionIds: ['archived'], sessionOrder: sessions.map(session => session.id) },
  draftId: 'preview-draft', status: 'disconnected', messages: [], models: [model], sessions,
};
const clone = () => structuredClone(snapshot);
const listeners = new Set<(event: any) => void>();
const open = async (id: string) => {
  const session = sessions.find(item => item.id === id)!;
  snapshot = { ...snapshot, draftId: undefined, runtimeId: 'preview-' + id, status: 'connected',
    preferences: { ...snapshot.preferences, workspace: session.cwd }, independent: session.independent,
    state: { sessionId: id, sessionName: session.name, isStreaming: false, model },
    messages: [{ role: 'user', content: session.firstMessage },
      { role: 'assistant', content: session.name ?? session.firstMessage }], permissionPreset: 'ask' };
  return clone();
};
window.desktop = {
  platform: 'win32',
  snapshot: async () => clone(),
  navigateSession: open,
  preferences: async (patch: Partial<Preferences>) => {
    snapshot.preferences = { ...snapshot.preferences, ...patch };
    return structuredClone(snapshot.preferences);
  },
  command: async (type: string) => type === 'get_available_thinking_levels' ? { levels: [] } : { commands: [] },
  onEvent: (callback: (event: any) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  systemTheme: async () => ({ systemDark: theme === 'dark' }),
  windowControl: async () => ({ focused: true, maximized: false, fullscreen: false }),
  updateState: async () => ({ status: 'idle', currentVersion: '0.5.1', channel: 'preview' }),
  onUpdateEvent: () => () => {},
  browserList: async () => ({ revision: 0, tabs: [] }),
  browserLayout: async () => {},
  onBrowserEvent: () => () => {},
  terminalList: async () => [],
  onTerminalEvent: () => () => {},
  summary: async () => ({ sessionId: snapshot.state?.sessionId, tasks: [], mcp: [], skillCount: 0 }),
} as unknown as DesktopBridge;
await import('../../src/main');
