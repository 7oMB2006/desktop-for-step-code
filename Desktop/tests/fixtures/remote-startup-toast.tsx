import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Moon, RotateCcw, Sun } from 'lucide-react';
import type { DesktopBridge, Preferences, Session, Snapshot } from '../../src/contracts';
import type { RemotePreparationSource } from '../../src/remote-navigation';
import './remote-startup-toast.css';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const source: RemotePreparationSource = params.get('source') === 'external-agent' ? 'external-agent'
  : params.get('source') === 'feishu-session' ? 'feishu-session' : 'feishu-recovery';
const delay = Math.min(15000, Math.max(0, Number(params.get('delay') ?? 9000) || 0));
const project = 'D:\\Projects\\StepCode';
const model = { provider: 'step', id: 'preview', name: 'Step Code' };
const sessions: Session[] = [
  ['login', '修复登录刷新', '检查登录后刷新页面的状态。'],
  ['usage', '账户用量面板', '调整账户用量面板的展示。'],
  ['theme', '调整主题色', '检查明暗主题下的文字对比度。'],
].map(([id, name, firstMessage]) => ({
  id, name, firstMessage, cwd: project, path: `${id}.jsonl`,
  modified: '2026-11-14T08:00:00.000Z', messageCount: 2,
}));
let snapshot: Snapshot = {
  preferences: { theme, language: 'zh', workspaces: [project], workspace: project,
    workspaceNames: { 'd:/projects/stepcode': '阶跃桌面' },
    sessionOrder: sessions.map(session => session.id) },
  draftId: 'preview-draft', status: 'disconnected', messages: [], models: [model], sessions,
};
const clone = () => structuredClone(snapshot);
let completed = false;
let completion: Promise<void> | undefined;
let release: (() => void) | undefined;
let latest = sessions[0].id;
const listeners = new Set<(event: any) => void>();
const emit = (event: any) => listeners.forEach(listener => listener(event));
const fixture = { emit, release: () => release?.() };
declare global { interface Window { remoteNavigationPreview: typeof fixture } }
window.remoteNavigationPreview = fixture;

const open = async (id: string, requestId?: number) => {
  latest = id;
  if (!completion && !completed) {
    // Preview-only gate: represent a slow Remote worker, not a real connection.
    completion = new Promise<void>(resolve => {
      release = () => { completed = true; resolve(); };
      window.setTimeout(release, delay);
    });
  }
  if (!completed && params.get('block') !== '0') emit({ type: 'desktop_navigation_wait', requestId,
    waiting: { id: 1, source } });
  try { await completion; }
  finally { emit({ type: 'desktop_navigation_wait', requestId }); }
  const session = sessions.find(item => item.id === latest)!;
  snapshot = { ...snapshot, draftId: undefined, runtimeId: `preview-${session.id}`,
    status: 'connected', permissionPreset: 'ask',
    state: { sessionId: session.id, sessionName: session.name, isStreaming: false, model },
    messages: [{ role: 'user', content: session.firstMessage },
      { role: 'assistant', content: '好的，我先检查相关实现和已有测试。' }] };
  return clone();
};

window.desktop = {
  platform: 'win32', snapshot: async () => clone(), navigateSession: open,
  preferences: async (patch: Partial<Preferences>) => {
    snapshot.preferences = { ...snapshot.preferences, ...patch };
    return structuredClone(snapshot.preferences);
  },
  command: async (type: string) => type === 'get_available_thinking_levels' ? { levels: [] } : { commands: [] },
  onEvent: (callback: (event: any) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  systemTheme: async () => ({ systemDark: theme === 'dark' }),
  windowControl: async () => ({ focused: true, maximized: false, fullscreen: false }),
  updateState: async () => ({ status: 'idle', currentVersion: '0.6.0', channel: 'preview' }),
  onUpdateEvent: () => () => {},
  browserList: async () => ({ revision: 0, tabs: [] }), browserLayout: async () => {},
  onBrowserEvent: () => () => {}, terminalList: async () => [], onTerminalEvent: () => () => {},
  summary: async () => ({ sessionId: snapshot.state?.sessionId, tasks: [], mcp: [], skillCount: 0 }),
  settings: async () => ({ account: { loggedIn: false, validity: 'missing' }, profiles: [], mcp: {}, skills: [] }),
  capabilityCatalog: async () => ({ plugins: [], available: [], marketplaces: [], mcp: [], skills: [], warnings: [] }),
  repositoryDiff: async () => ({ state: 'not-git', bases: [], files: [], added: 0, removed: 0, truncated: false }),
  remoteState: async () => ({ revision: 1, status: completed ? 'connected' : 'connecting',
    saved: true, approvalReady: false, sessions: [], projects: [] }),
  remoteAction: async () => { throw new Error('交互预览不连接真实飞书。'); },
} as unknown as DesktopBridge;

await import('../../src/main');
await new Promise<HTMLButtonElement>(resolve => {
  const find = () => {
    const element = document.querySelector<HTMLButtonElement>('.remote-entry');
    if (element) { observer.disconnect(); resolve(element); }
  };
  const observer = new MutationObserver(find);
  observer.observe(document.getElementById('root')!, { childList: true, subtree: true });
  find();
});

function Preview() {
  const reload = (nextTheme = theme, nextSource = source) => {
    const url = new URL(location.href);
    url.searchParams.set('theme', nextTheme);
    url.searchParams.set('source', nextSource);
    url.searchParams.delete('auto');
    location.assign(url);
  };
  return <>
    {createPortal(<div className="startup-preview-tools" role="toolbar" aria-label="预览控制">
      <span>交互预览</span>
      <select aria-label="准备来源" value={source} onChange={event => reload(theme, event.target.value as RemotePreparationSource)}>
        <option value="feishu-recovery">飞书恢复</option>
        <option value="feishu-session">飞书会话</option>
        <option value="external-agent">外部 Agent</option>
      </select>
      <button type="button" className="icon-button" aria-label="重新演示" data-tooltip="重新演示"
        onClick={() => reload()}><RotateCcw size={16}/></button>
      <button type="button" className="icon-button" aria-label={theme === 'light' ? '深色预览' : '浅色预览'}
        data-tooltip={theme === 'light' ? '深色预览' : '浅色预览'}
        onClick={() => reload(theme === 'light' ? 'dark' : 'light')}>
        {theme === 'light' ? <Moon size={16}/> : <Sun size={16}/>}
      </button>
    </div>, document.querySelector('.sidebar')!)}
  </>;
}
createRoot(document.getElementById('preview-controls')!).render(<Preview/>);
if (params.get('auto') !== '0') {
  window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-reorder-id="login"] > button')?.click(), 600);
}
