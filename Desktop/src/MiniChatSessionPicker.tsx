import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderOpen, MessagesSquare, Plus, Search, X } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import { SessionSearchText } from './SessionSearchText';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import { MINI_INDEPENDENT_PROJECT, miniChatGroups, type MiniChatGroup, type MiniChatProject, type MiniChatSession } from './mini-chat-sessions';
import './mini-chat-session-picker.css';

function SessionGroup({ group, expanded, searching, query, selected, language, toggle, select, create }: {
  group: MiniChatGroup; expanded: boolean; searching: boolean; query: string; selected: string; language: 'zh' | 'en';
  toggle: () => void; select: (id: string) => void; create?: (project: string) => void;
}) {
  const { details, body } = useAnimatedDisclosure(expanded);
  const { project } = group;
  const zh = language === 'zh', independent = project.id === MINI_INDEPENDENT_PROJECT;
  const newLabel = independent ? zh ? '新建独立会话' : 'New independent session'
    : zh ? `在 ${group.showPath ? project.path : project.name} 新建会话` : `New session in ${group.showPath ? project.path : project.name}`;
  return <section className="mini-session-group" aria-label={group.showPath ? project.path : project.name} data-project-id={project.id}>
    <details ref={details} data-expanded={expanded}>
      <summary aria-expanded={expanded} aria-disabled={searching || undefined} onClick={event => {
        event.preventDefault();
        if (!searching) toggle();
      }}>
        <span className="mini-session-chevron"><DisclosureChevron/></span>
        {independent ? <MessagesSquare size={14}/> : <FolderOpen size={14}/>}
        <span className="mini-session-project-copy" data-tooltip={project.path}>
          <span><SessionSearchText text={project.name} query={query}/></span>
          {group.showPath && <small><SessionSearchText text={project.path!} query={query}/></small>}
        </span>
        <span className="mini-session-count">{searching ? group.sessions.length : group.total}</span>
      </summary>
      <div ref={body} inert={!expanded} aria-hidden={!expanded}>
        <div className="mini-session-options" role="listbox" aria-label={project.name}>
          {group.sessions.map(session => <button key={session.id} type="button" role="option" aria-selected={session.id === selected}
            aria-label={session.title} className="mini-session-option" data-mini-session={session.id}
            onClick={() => select(session.id)}>
            <MessagesSquare size={14}/>
            <span className="mini-session-option-copy">
              <span><SessionSearchText text={session.title} query={query}/></span>
              {session.branch && <small><SessionSearchText text={session.branch} query={query}/></small>}
            </span>
            {session.id === selected && <Check size={14} className="mini-session-selected"/>}
          </button>)}
          {!group.sessions.length && <p className="mini-session-empty">{zh ? '暂无会话' : 'No conversations'}</p>}
        </div>
      </div>
    </details>
    {create && <button type="button" className="icon-button mini-session-new" aria-label={newLabel}
      data-tooltip={newLabel} onClick={() => create(project.id)}><Plus size={15}/></button>}
  </section>;
}

export function MiniChatSessionPicker({ id, anchor, open, session, projects, sessions, language, onSelect, onCreate, onClose }: {
  id: string; anchor: RefObject<HTMLButtonElement | null>; open: boolean; session: MiniChatSession; projects: MiniChatProject[];
  sessions: MiniChatSession[]; language: 'zh' | 'en'; onSelect: (id: string) => void;
  onCreate?: (project: string) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([session.projectId]));
  const [position, setPosition] = useState<{ left: number; top: number; height: number; upwards: boolean }>();
  const searching = Boolean(query.trim());
  const groups = useMemo(() => miniChatGroups(projects, sessions, session.projectId, query),
    [projects, sessions, session.projectId, query]);
  const close = () => { onClose(); anchor.current?.focus({ preventScroll: true }); };
  const select = (value: string) => { close(); onSelect(value); };
  const create = onCreate ? (value: string) => { close(); onCreate(value); } : undefined;

  useLayoutEffect(() => {
    if (open) { setQuery(''); setExpanded(new Set([session.projectId])); }
  }, [open, session.projectId]);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!open) { if (element.matches(':popover-open')) element.hidePopover(); return; }
    if (!element.matches(':popover-open')) element.showPopover();
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      if (!trigger) { onClose(); return; }
      const below = innerHeight - trigger.bottom - 14, above = trigger.top - 14;
      const upwards = below < 240 && above > below;
      const height = Math.max(0, Math.min(480, upwards ? above : below));
      setPosition({
        left: Math.max(8, Math.min(trigger.left, innerWidth - element.offsetWidth - 8)),
        top: upwards ? Math.max(8, trigger.top - Math.min(element.offsetHeight, height) - 6) : trigger.bottom + 6,
        height, upwards,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    const frame = requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, onClose]);

  const options = () => [...panel.current?.querySelectorAll<HTMLButtonElement>('[data-mini-session]') ?? []]
    .filter(button => !button.closest('[inert]'));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const buttons = options();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.target === search.current) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        (event.key === 'ArrowUp' ? buttons.at(-1) : buttons.find(button => button.getAttribute('aria-selected') === 'true') ?? buttons[0])?.focus();
      } else if (event.key === 'Enter' && searching && buttons[0]) {
        event.preventDefault(); select(buttons[0].dataset.miniSession!);
      }
    } else if (index >= 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };
  return createPortal(<div ref={panel} id={id} popover="auto" role="dialog" aria-label={language === 'zh' ? '小窗会话' : 'MiniChat conversations'}
    className="mini-session-picker" aria-hidden={!open} inert={!open}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, maxHeight: position?.height,
      visibility: position ? undefined : 'hidden', transformOrigin: position?.upwards ? 'bottom left' : 'top left' }}
    onToggle={event => {
      if (event.target === event.currentTarget && event.newState === 'closed') onClose();
    }} onKeyDown={onKeyDown}
    onBlur={event => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next) && !anchor.current?.contains(next)) onClose();
    }}>
    <div className="mini-session-search-gutter"><div className="mini-session-search">
      <Search size={15}/>
      <input ref={search} type="search" aria-label={language === 'zh' ? '搜索小窗会话' : 'Search MiniChat conversations'}
        placeholder={language === 'zh' ? '搜索会话或项目' : 'Search conversations or projects'}
        value={query} onChange={event => setQuery(event.target.value)}/>
      {query && <button type="button" className="icon-button" aria-label={language === 'zh' ? '清除搜索' : 'Clear search'}
        onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14}/></button>}
    </div></div>
    <div className="mini-session-groups">
      {groups.map(group => <SessionGroup key={group.project.id} group={group} language={language} selected={session.id} query={query}
        searching={searching} expanded={searching || expanded.has(group.project.id)}
        toggle={() => setExpanded(current => {
          const next = new Set(current);
          if (next.has(group.project.id)) next.delete(group.project.id); else next.add(group.project.id);
          return next;
        })} select={select} create={create}/>)}
      {!groups.length && <p className="mini-session-empty" role="status">{language === 'zh' ? '没有匹配的会话' : 'No matching conversations'}</p>}
    </div>
  </div>, document.body);
}
