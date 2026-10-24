import type { DesktopBridge, Preferences, RepositoryDiff, Session, Snapshot } from '../../src/contracts';
import { themes } from '../../src/theme';

const params = new URLSearchParams(location.search);
const theme = themes.find(item => item.id === params.get('theme'))?.id ?? 'light';
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const gitPreview = params.get('git') === '1';
let repositoryReads = 0;
const repository: RepositoryDiff = {
  state: 'ready', root: 'D:\\Projects\\StepCode', branch: 'feat/session-search',
  bases: ['main', 'HEAD'], base: 'main', revision: 'preview', truncated: false,
  added: 148, removed: 23,
  files: [
    { path: 'Desktop/src/session-search.ts', status: 'A', added: 86, removed: 0, binary: false },
    { path: 'Desktop/src/main.tsx', status: 'M', added: 42, removed: 18, binary: false },
    { path: 'Desktop/src/session-search.css', status: 'A', added: 20, removed: 0, binary: false },
    { path: 'Desktop/src/legacy-search.ts', status: 'D', added: 0, removed: 5, binary: false },
  ],
};
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
  repositoryDiff: async () => {
    if (!gitPreview) return { state: 'not-git', bases: [], files: [], added: 0, removed: 0, truncated: false };
    const value = structuredClone(repository);
    const step = repositoryReads++ % 6;
    value.added += step * 8;
    value.removed += step * 2;
    value.files[1].added += step * 8;
    value.files[1].removed += step * 2;
    return value;
  },
  repositoryFileDiff: async (_runtimeId: string, _base: string, path: string) => {
    const file = repository.files.find(item => item.path === path);
    return { path, added: file?.added ?? 0, removed: file?.removed ?? 0, rows: [], reason: 'no-text-change' };
  },
  summary: async () => ({ sessionId: snapshot.state?.sessionId,
    tasks: gitPreview ? [
      { id: '1', subject: '核对会话搜索与项目分组', description: '保留原有分组、置顶和排序。', status: 'completed' },
      { id: '2', subject: '补齐键盘与空结果交互', description: '检查 Escape、输入法和焦点恢复。', status: 'in_progress' },
      { id: '3', subject: '回归验证明暗主题', description: '核对窄窗口与展开状态。', status: 'pending' },
    ] : [],
    mcp: gitPreview ? [
      { name: 'steppage__steppage', status: 'connected', toolCount: 13 },
      { name: 'filesystem', status: 'disabled', toolCount: 0 },
    ] : [], skillCount: gitPreview ? 6 : 0 }),
} as unknown as DesktopBridge;
if (gitPreview) {
  await open('search');
}
await import('../../src/main');
