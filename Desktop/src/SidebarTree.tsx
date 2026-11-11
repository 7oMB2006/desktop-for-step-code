import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Folder, FolderOpen, MessageSquare, MoreHorizontal, Plus } from 'lucide-react';
import type { Preferences, Session } from './contracts';
import { filterSessions } from './session-search';
import { orderSessions } from './sidebar-order';
import { normalizedWorkspaceKey } from './workspace-key';
import { SessionSearchText } from './SessionSearchText';
import { useSidebarMotion } from './use-sidebar-motion';
import type { SidebarActivity } from './sidebar-state';

export type SidebarPreferences = Pick<Preferences, 'language' | 'workspace' | 'workspaces' | 'workspaceNames'
  | 'archivedSessionIds' | 'sessionSort' | 'sessionOrder' | 'pinnedWorkspaces' | 'collapsedWorkspaces'>;
export type SidebarContextMenu = { type: 'session' | 'workspace'; id: string; x: number; y: number };
type Actions = {
  navigate: (id: string) => void;
  context: (menu: SidebarContextMenu) => void;
  toggle: (key: string) => void;
  moveSession: (id: string, target: string, after: boolean) => void;
  moveWorkspace: (id: string, target: string, after: boolean) => void;
  create: (path: string) => void;
  openProject: () => void;
};
type Props = {
  sessions: Session[];
  preferences: SidebarPreferences;
  platform: string;
  activities: ReadonlyMap<string, SidebarActivity>;
  disclosure: ReadonlyMap<string, { open: boolean }>;
  query: string;
  highlightQuery: string;
  selected?: string;
  slow?: string;
  available: boolean;
  loading: boolean;
  navigating: boolean;
  drag: { id: string; target?: string; after: boolean; workspaceTarget?: string } | null;
  actions: Actions;
};
const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
function IconButton({ title, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return <button type="button" className="icon-button" data-tooltip={title} aria-label={title} {...props}>{children}</button>;
}

export function SidebarTree({ actions, ...props }: Props) {
  const handlers = useRef(actions);
  useLayoutEffect(() => { handlers.current = actions; });
  // A cached row calls the current committed shell action, not an old session closure.
  const callbacks = useMemo<Actions>(() => ({
    navigate: id => handlers.current.navigate(id),
    context: menu => handlers.current.context(menu),
    toggle: key => handlers.current.toggle(key),
    moveSession: (id, target, after) => handlers.current.moveSession(id, target, after),
    moveWorkspace: (id, target, after) => handlers.current.moveWorkspace(id, target, after),
    create: path => handlers.current.create(path),
    openProject: () => handlers.current.openProject(),
  }), []);
  return <MemoizedTree {...props} actions={callbacks}/>;
}

type RowProps = {
  session: Session; group: string; language: 'zh' | 'en'; activity: SidebarActivity;
  selected: boolean; slow: boolean; dragging: boolean; drop?: 'before' | 'after';
  searching: boolean; highlightQuery: string; manual: boolean; previous?: string; next?: string;
  disabled: boolean; loading: boolean; actions: Actions;
};
const SessionRow = memo(function SessionRow({ session, group, language, activity, selected, slow, dragging, drop,
  searching, highlightQuery, manual, previous, next, disabled, loading, actions }: RowProps) {
  const t = (cn: string, en: string) => language === 'zh' ? cn : en;
  const title = session.name || session.firstMessage || t('新会话', 'New session');
  const label = activity === 'waiting' ? t('等待确认', 'Awaiting approval')
    : activity === 'failed' || activity === 'interrupted' ? t('任务已终止', 'Task interrupted')
    : activity === 'completed' ? t('有未读回复', 'Unread reply') : t('正在运行', 'Running');
  const context = (event: MouseEvent) => {
    event.preventDefault();
    actions.context({ type: 'session', id: session.id, x: Math.max(8, Math.min(event.clientX, innerWidth - 206)),
      y: Math.max(8, Math.min(event.clientY, innerHeight - 230)) });
  };
  return <div data-reorder-id={session.id} data-reorder-kind="session" data-reorder-group={group} data-reorder-title={title}
    data-reorder-locked={!session.path || ['running', 'waiting'].includes(activity)}
    className={`session-row ${selected ? 'selected' : ''} ${dragging ? 'session-dragging' : ''} ${drop ? `drop-${drop}` : ''}`}
    onContextMenu={context}>
    <button aria-current={selected ? 'page' : undefined} disabled={disabled} onClick={() => actions.navigate(session.id)}
      aria-keyshortcuts={!searching && manual && group !== '__archived__' ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onKeyDown={event => {
        if (searching || !manual || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || group === '__archived__') return;
        event.preventDefault();
        const target = event.key === 'ArrowUp' ? previous : next;
        if (target) actions.moveSession(session.id, target, event.key === 'ArrowDown');
      }}>
      <i className={`session-activity ${activity}`} role={activity === 'idle' ? undefined : 'img'}
        aria-hidden={activity === 'idle' ? true : undefined} aria-label={activity === 'idle' ? undefined : label}/>
      <span title={searching ? `${title}\n${session.firstMessage}\n${session.cwd}` : undefined}>
        <SessionSearchText text={title} query={highlightQuery}/>
        {searching && session.name && session.firstMessage && <small className="session-search-preview"><SessionSearchText text={session.firstMessage} query={highlightQuery}/></small>}
      </span>
      {slow && <span className="session-navigation-spinner" role="status" aria-label={t('正在打开会话', 'Opening conversation')}/>}
    </button>
    <IconButton title={t('更多操作', 'More actions')} aria-haspopup="menu" disabled={loading} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      actions.context({ type: 'session', id: session.id, x: Math.min(rect.right, innerWidth - 206), y: Math.min(rect.bottom, innerHeight - 190) });
    }}><MoreHorizontal size={15}/></IconButton>
  </div>;
});

const MemoizedTree = memo(function MemoizedTree(props: Props) {
  const { sessions, preferences, platform, activities, disclosure, query, highlightQuery, selected, slow,
    available, loading, navigating, drag, actions } = props;
  const t = (cn: string, en: string) => preferences.language === 'zh' ? cn : en;
  const key = (path: string) => normalizedWorkspaceKey(path, platform);
  const title = (path: string) => preferences.workspaceNames?.[key(path)] || basename(path);
  const searching = Boolean(query.trim()), manual = preferences.sessionSort !== 'updated';
  const model = useMemo(() => {
    const groups = new Map<string, { path: string; sessions: Session[] }>();
    for (const path of preferences.workspaces) if (!groups.has(key(path))) groups.set(key(path), { path, sessions: [] });
    const visible = orderSessions(filterSessions(sessions, preferences, query, platform), preferences);
    const independent: Session[] = [];
    for (const session of visible) {
      const group = key(session.workspacePath ?? session.cwd);
      if (session.independent ?? !groups.has(group)) independent.push(session);
      else groups.get(group)?.sessions.push(session);
    }
    return { groups, visible, independent };
  }, [sessions, preferences, query, platform]);
  const { groups, visible, independent } = model;
  const pinned = useMemo(() => new Set(preferences.pinnedWorkspaces ?? []), [preferences.pinnedWorkspaces]);
  const closed = useMemo(() => {
    const result = new Set(preferences.collapsedWorkspaces ?? []);
    for (const [id, { open }] of disclosure) { if (open) result.delete(id); else result.add(id); }
    return result;
  }, [preferences.collapsedWorkspaces, disclosure]);
  const motionKey = useMemo(() => JSON.stringify([preferences.workspaces, preferences.pinnedWorkspaces,
    preferences.sessionOrder, preferences.sessionSort, preferences.archivedSessionIds,
    query, sessions.map(session => [session.id, session.cwd, session.modified])]),
  [preferences.workspaces, preferences.pinnedWorkspaces, preferences.sessionOrder, preferences.sessionSort,
    preferences.archivedSessionIds, query, sessions]);
  const tree = useSidebarMotion(motionKey);
  const rows = (items: Session[], group: string) => items.map((session, index) => <SessionRow key={session.id}
    session={session} group={group} language={preferences.language} activity={activities.get(session.id) ?? 'idle'}
    selected={session.id === selected} slow={session.id === slow} dragging={drag?.id === session.id}
    drop={drag?.target === session.id ? drag.after ? 'after' : 'before' : undefined}
    searching={searching} highlightQuery={highlightQuery} manual={manual}
    previous={items[index - 1]?.id} next={items[index + 1]?.id}
    disabled={!available || loading && !navigating} loading={loading} actions={actions}/>);
  const renderWorkspace = ([id, group]: [string, { path: string; sessions: Session[] }]) => {
    if (searching && !group.sessions.length) return null;
    const expanded = searching || !closed.has(id);
    return <section key={id} className={`workspace-group ${drag?.id === id ? 'session-dragging' : ''} ${drag?.target === id ? drag.after ? 'drop-after' : 'drop-before' : ''} ${drag?.workspaceTarget === group.path ? 'session-drop-target' : ''}`}
      aria-label={group.path} data-session-workspace={group.path} data-reorder-id={id} data-reorder-kind="workspace"
      data-reorder-group={pinned.has(id) ? '__pinned__' : '__projects__'} data-reorder-title={title(group.path)}>
      <div className={`workspace-heading ${id === key(preferences.workspace ?? '') ? 'current' : ''}`}
        onContextMenu={event => {
          event.preventDefault();
          actions.context({ type: 'workspace', id: group.path, x: Math.max(8, Math.min(event.clientX, innerWidth - 206)),
            y: Math.max(8, Math.min(event.clientY, innerHeight - 230)) });
        }}>
        <button className="workspace-toggle" aria-label={title(group.path)} aria-expanded={expanded}
          aria-disabled={searching || undefined} onClick={() => { if (!searching) actions.toggle(id); }}
          aria-keyshortcuts={searching ? undefined : 'Alt+ArrowUp Alt+ArrowDown'} onKeyDown={event => {
            if (searching || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const siblings = pinned.has(id) ? [...pinned] : [...groups.keys()].filter(key => !pinned.has(key));
            const target = siblings[siblings.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)];
            if (target) actions.moveWorkspace(id, target, event.key === 'ArrowDown');
          }}>{expanded ? <FolderOpen size={15}/> : <Folder size={15}/>}<span><SessionSearchText text={title(group.path)} query={highlightQuery}/></span></button>
        <IconButton title={t(`在 ${basename(group.path)} 新建会话`, `New session in ${basename(group.path)}`)}
          disabled={!available || loading} onClick={() => actions.create(group.path)}><Plus size={15}/></IconButton>
        <IconButton title={t('更多操作', 'More actions')} aria-haspopup="menu" onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          actions.context({ type: 'workspace', id: group.path, x: Math.min(rect.right, innerWidth - 206), y: Math.min(rect.bottom, innerHeight - 190) });
        }}><MoreHorizontal size={15}/></IconButton>
      </div>
      <div className="workspace-disclosure" aria-hidden={!expanded} inert={!expanded}>
        <div className="workspace-sessions">{rows(group.sessions, id)}{!group.sessions.length && <span className="workspace-empty">{t('暂无会话', 'No sessions yet')}</span>}</div>
      </div>
    </section>;
  };
  const independentExpanded = searching || !closed.has('__independent__');
  return <nav ref={tree} className={`workspace-tree ${drag ? 'is-reordering' : ''}`} aria-label={t('工作区与会话', 'Workspaces and sessions')}
    onScroll={event => { event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 0); }}>
    {searching && <div className="session-search-status" role="status">{t(`找到 ${visible.length} 个会话`, `${visible.length} sessions found`)}</div>}
    {searching && !visible.length && <p className="list-empty">{t('没有匹配的会话', 'No matching sessions')}</p>}
    {(!searching || independent.length > 0) && <section className="workspace-group independent-group" aria-label={t('独立会话', 'Independent sessions')}>
      <div className="workspace-heading"><button className="workspace-toggle" aria-label={t('独立会话', 'Independent sessions')} aria-expanded={independentExpanded}
        aria-disabled={searching || undefined} onClick={() => { if (!searching) actions.toggle('__independent__'); }}><MessageSquare size={15}/>
        <span><SessionSearchText text={t('独立会话', 'Independent sessions')} query={highlightQuery}/></span><small>{independent.length}</small></button></div>
      <div className="workspace-disclosure" aria-hidden={!independentExpanded} inert={!independentExpanded}><div className="workspace-sessions">{rows(independent, '__independent__')}</div></div>
    </section>}
    {[...pinned].some(id => groups.has(id) && (!searching || groups.get(id)!.sessions.length > 0)) && <div className="pinned-projects">
      <div className="section-label">{t('置顶', 'Pinned')}</div>
      {[...pinned].flatMap(id => groups.has(id) ? [[id, groups.get(id)!] as [string, { path: string; sessions: Session[] }]] : []).map(renderWorkspace)}
    </div>}
    {(!searching || [...groups].some(([id, group]) => !pinned.has(id) && group.sessions.length > 0)) && <div className="section-label">{t('项目', 'Projects')}
      <IconButton title={t('添加工作区', 'Add workspace')} disabled={!available || loading} onClick={() => actions.openProject()}><Plus size={15}/></IconButton></div>}
    {[...groups].filter(([id]) => !pinned.has(id)).map(renderWorkspace)}
    {!searching && !groups.size && <button disabled={!available || loading} onClick={() => actions.openProject()}><FolderOpen size={15}/>{t('打开项目', 'Open project')}</button>}
  </nav>;
});
