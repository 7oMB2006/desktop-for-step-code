import { useState } from 'react';
import { Archive, Folder, MessageSquare, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { Preferences, RuntimeSummary, Session } from './contracts';
import { turnTime } from './ConversationNavigation';

export function ArchivedSessions({ sessions, preferences, runtimes, activeId, onOpen, onRestore, onDelete }: {
  sessions: Session[]; preferences: Preferences; runtimes: RuntimeSummary[]; activeId?: string;
  onOpen: (id: string) => void; onRestore: (id: string) => Promise<void>; onDelete: (ids: string[]) => Promise<void>;
}) {
  const zh = preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const key = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  const groupId = (session: Session) => session.independent ? '__independent__' : key(session.workspacePath ?? session.cwd);
  const groupTitle = (session: Session) => session.independent ? t('独立会话', 'Independent sessions')
    : preferences.workspaceNames?.[groupId(session)] || basename(session.workspacePath ?? session.cwd);
  const title = (session: Session) => session.name || session.firstMessage || t('新会话', 'New session');
  const modified = (session: Session) => {
    const timestamp = Date.parse(session.modified);
    const time = turnTime(timestamp, preferences.language);
    return time ? `${new Date(timestamp).getFullYear()}${zh ? '年' : '/'}${time}` : t('时间未知', 'Unknown date');
  };
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [pending, setPending] = useState(false);
  const groups = new Map<string, { title: string; independent: boolean; sessions: Session[] }>();
  const choices = new Map(sessions.map(session => [groupId(session), groupTitle(session)]));
  const search = query.trim().toLocaleLowerCase();
  for (const session of sessions) {
    const id = groupId(session);
    if (project && project !== id || search && !`${title(session)} ${groupTitle(session)}`.toLocaleLowerCase().includes(search)) continue;
    if (!groups.has(id)) groups.set(id, { title: groupTitle(session), independent: Boolean(session.independent), sessions: [] });
    groups.get(id)!.sessions.push(session);
  }
  const blocked = (session: Session) => session.id === activeId ? t('请先切换到其他会话', 'Open a different session first')
    : runtimes.some(runtime => runtime.sessionId === session.id && ['running', 'waiting'].includes(runtime.status))
      ? t('请先停止此会话任务', 'Stop this session task first') : '';
  const allBlocked = sessions.map(blocked).find(Boolean);
  const perform = async (action: () => Promise<void>) => {
    setPending(true);
    try { await action(); } finally { setPending(false); }
  };
  return <section className="archived-settings" aria-label={t('已归档的会话', 'Archived sessions')}>
    <div className="archive-heading"><h3>{t('已归档的会话', 'Archived sessions')}</h3>
      <button type="button" className="archive-delete-all" disabled={pending || !sessions.length || Boolean(allBlocked)}
        title={allBlocked || undefined} onClick={() => void perform(() => onDelete(sessions.map(session => session.id)))}>
        <Trash2 size={14}/>{t('全部删除', 'Delete all')}
      </button>
    </div>
    <div className="archive-filters">
      <div className="archive-search"><Search size={15}/><input type="search" aria-label={t('搜索归档会话', 'Search archived sessions')}
        placeholder={t('搜索归档会话', 'Search archived sessions')} value={query} onChange={event => setQuery(event.target.value)}/></div>
      <select aria-label={t('筛选归档项目', 'Filter archived projects')} value={project} onChange={event => setProject(event.target.value)}>
        <option value="">{t('所有项目', 'All projects')}</option>
        {[...choices].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </div>
    {!groups.size && <div className="archive-empty"><Archive size={24}/><p>{sessions.length ? t('没有匹配的归档会话', 'No matching archived sessions') : t('暂无归档会话', 'No archived sessions')}</p></div>}
    {[...groups].map(([id, group]) => <section className="archive-project" key={id}>
      <header>{group.independent ? <MessageSquare size={16}/> : <Folder size={16}/>}<h4>{group.title}</h4><span>{t(`${group.sessions.length} 个会话`, `${group.sessions.length} sessions`)}</span></header>
      <ul className="archive-list">{group.sessions.map(session => <li key={session.id} data-archived-session-id={session.id}>
        <div className="archive-session-text"><button type="button" className="archive-session-title" disabled={pending}
          aria-label={t(`查看 ${title(session)}`, `Open ${title(session)}`)} onClick={() => onOpen(session.id)}>{title(session)}</button>
          <time dateTime={session.modified}>{modified(session)}</time></div>
        <button type="button" className="icon-button archive-delete" disabled={pending || Boolean(blocked(session))}
          aria-label={t(`永久删除 ${title(session)}`, `Permanently delete ${title(session)}`)}
          data-tooltip={blocked(session) || t('永久删除', 'Delete permanently')} onClick={() => void perform(() => onDelete([session.id]))}><Trash2 size={15}/></button>
        <button type="button" className="archive-restore" disabled={pending} onClick={() => void perform(() => onRestore(session.id))}>
          <RotateCcw size={14}/>{t('取消归档', 'Unarchive')}
        </button>
      </li>)}</ul>
    </section>)}
  </section>;
}
