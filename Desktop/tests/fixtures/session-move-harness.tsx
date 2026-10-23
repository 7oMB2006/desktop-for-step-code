import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRightLeft, ChevronDown, FolderOpen, MessageSquare, MoreHorizontal, Settings, SunMoon } from 'lucide-react';
import { SessionMoveDialog } from '../../src/SessionMoveDialog';
import { useSidebarReorder } from '../../src/use-sidebar-reorder';
import { normalizedWorkspaceKey } from '../../src/workspace-key';
import { applyTheme } from '../../src/theme';
import type { Preferences, Session } from '../../src/contracts';
import '../../src/style.css';
import '../../src/theme.css';

const initialTheme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
applyTheme(initialTheme, false);
const original = 'D:\\Notes\\brainstorm';
const projects = ['D:\\Projects\\desktop-tools', 'D:\\Projects\\data-service', 'D:\\Projects\\personal-site'];
const names = ['桌面工具', '数据服务', '个人站点'];
const initial: Session[] = [
  { id: 'ideas', name: '把刚才的想法做成一个小工具', cwd: original, path: 'history/ideas', independent: true },
  { id: 'tools', name: '完善工具设置与状态展示', cwd: projects[0], path: 'history/tools' },
  { id: 'data', name: '核对数据导入的边界', cwd: projects[1], path: 'history/data' },
].map(session => ({ ...session, modified: new Date().toISOString(), firstMessage: '把刚才的想法做出来', messageCount: 2 }));
const key = (path: string) => normalizedWorkspaceKey(path, 'win32');
function Preview() {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [sessions, setSessions] = useState(initial);
  const [selected, setSelected] = useState('ideas');
  const [moving, setMoving] = useState<{ session: Session; destination?: string } | null>(null);
  const preferences: Preferences = { language: 'zh', theme, workspaces: projects,
    workspaceNames: Object.fromEntries(projects.map((path, index) => [key(path), names[index]])) };
  const drag = useSidebarReorder(!moving, false, () => {}, (id, destination) => {
    const session = sessions.find(session => session.id === id)!;
    setMoving({ session, destination });
  });
  const current = sessions.find(session => session.id === selected)!;
  const renderSession = (session: Session, group: string) => <div key={session.id}
    data-reorder-id={session.id} data-reorder-kind="session" data-reorder-group={group} data-reorder-title={session.name}
    className={`session-row ${selected === session.id ? 'selected' : ''} ${drag?.id === session.id ? 'session-dragging' : ''}`}>
    <button onClick={() => setSelected(session.id)}><MessageSquare size={14}/><span>{session.name}</span></button>
    <button className="icon-button" aria-label={`移动 ${session.name}`} title="移至项目"
      onClick={() => setMoving({ session })}><ArrowRightLeft size={14}/></button>
  </div>;
  return <div className="app move-preview-app">
    <aside className="sidebar move-preview-sidebar">
      <header className="move-preview-brand"><strong>Step Code</strong><button className="icon-button" aria-label="切换明暗主题"
        title="切换明暗主题" onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); applyTheme(next, false); }}><SunMoon size={16}/></button></header>
      <div className="workspace-tree">
        <section className="workspace-group independent-group">
          <div className="workspace-heading"><button className="workspace-toggle"><ChevronDown size={13}/><span>独立会话</span></button></div>
          {sessions.filter(session => session.independent).map(session => renderSession(session, '__independent__'))}
        </section>
        <div className="section-label">项目</div>
        {projects.map((path, index) => <section key={path} data-session-workspace={path}
          data-reorder-id={key(path)} data-reorder-kind="workspace" data-reorder-group="__projects__"
          className={`workspace-group ${drag?.workspaceTarget === path ? 'session-drop-target' : ''}`}>
          <div className="workspace-heading"><button className="workspace-toggle"><ChevronDown size={13}/><FolderOpen size={15}/><span>{names[index]}</span></button></div>
          {sessions.filter(session => !session.independent && session.cwd === path).map(session => renderSession(session, key(path)))}
        </section>)}
      </div>
      <footer className="sidebar-bottom"><button><Settings size={16}/>设置</button></footer>
    </aside>
    <main className="move-preview-main">
      <header><span>{current.name}</span><button className="icon-button" aria-label="移至项目" title="移至项目"
        onClick={() => setMoving({ session: current })}><ArrowRightLeft size={16}/></button></header>
      <div className="move-preview-conversation">
        <div className="move-preview-user">这个想法已经聊清楚了，我们把它做出来吧。</div>
        <div className="move-preview-assistant"><p>我们可以先实现核心流程，再补边界测试。</p><p>已有的讨论会保留，接下来可以在项目目录继续。</p></div>
      </div>
      <div className="move-preview-composer"><div>继续讨论…</div><footer><span><FolderOpen size={13}/>{current.cwd}</span><MoreHorizontal size={16}/></footer></div>
    </main>
    {drag && <div className="session-drag-preview" style={{ left: drag.x + 14, top: drag.y + 14 }}>{drag.title}</div>}
    {moving && <SessionMoveDialog session={moving.session} preferences={preferences} platform="win32"
      initialDestination={moving.destination} onCancel={() => setMoving(null)} onConfirm={async destination => {
        await new Promise(resolve => setTimeout(resolve, 350));
        setSessions(previous => previous.map(session => session.id === moving.session.id ? { ...session, cwd: destination, independent: false } : session));
        setMoving(null);
      }}/>}
    <style>{`
      .move-preview-app { display: flex; width: 100vw; height: 100dvh; overflow: hidden; }
      .move-preview-sidebar { width: 270px; min-width: 235px; flex-shrink: 0; }
      .move-preview-brand { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px 22px; font-size: 15px; }
      .move-preview-sidebar .session-row > button:first-child { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .move-preview-sidebar .session-row > button:first-child span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .move-preview-sidebar .session-row > .icon-button { opacity: 1; }
      .move-preview-main { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 0 30px 22px; }
      .move-preview-main > header { height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; border-bottom: 1px solid var(--border); }
      .move-preview-main > header > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .move-preview-conversation { flex: 1; width: min(680px, 100%); margin: 40px auto; font-size: 14px; line-height: 1.8; }
      .move-preview-user { width: fit-content; max-width: 90%; margin-left: auto; padding: 10px 15px; border-radius: 6px; background: var(--surface); }
      .move-preview-assistant { margin-top: 35px; }
      .move-preview-composer { width: min(720px, 100%); margin: 0 auto; padding: 15px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); font-size: 13px; }
      .move-preview-composer > footer { display: flex; justify-content: space-between; margin-top: 30px; font-size: 11px; gap: 10px; }
      .move-preview-composer > footer > span { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; min-width: 0; }
      @media (max-width: 650px) { .move-preview-sidebar { min-width: 180px; width: 42%; } .move-preview-main { padding: 0 12px 12px; } }
    `}</style>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
