import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderOpen, MessageSquare, Plus, Search, Settings } from 'lucide-react';
import { DisclosureChevron } from './DisclosureChevron';
import './new-session.css';
import { nextGreeting, selectFirstGreeting } from './session-greetings';

interface Props {
  language: 'zh' | 'en';
  workspace?: string;
  workspaces: string[];
  title: (path: string) => string;
  disabled: boolean;
  composing: boolean;
  onSelect: (path?: string) => void;
  onOpenProject: () => void;
  onSettings: () => void;
  onOpenChange: (open: boolean) => void;
}

export function NewSession({ language, workspace, workspaces, title, disabled, composing, onSelect, onOpenProject, onSettings, onOpenChange }: Props) {
  const zh = language === 'zh';
  const [text, setText] = useState(() => selectFirstGreeting(language));
  const greetingLanguage = useRef(language);
  const [count, setCount] = useState(0);
  const phase = useRef<'typing' | 'holding' | 'deleting' | 'waiting'>('typing');
  const seen = useRef(new Set<string>());
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const closing = useRef<Animation | null>(null);
  const close = () => {
    const element = picker.current;
    if (!element || closing.current) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setOpen(false); return; }
    const style = getComputedStyle(element);
    const animation = element.animate([
      { opacity: style.opacity, transform: style.transform },
      { opacity: 0, transform: 'translateY(-4px)' },
    ], { duration: 160, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    element.inert = true;
    closing.current = animation;
    void animation.finished.then(() => { closing.current = null; setOpen(false); }).catch(() => {});
  };
  const [position, setPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const top = (document.querySelector('main')?.getBoundingClientRect().top ?? 40) + 12;
      const bottom = (document.querySelector('.composer')?.getBoundingClientRect().top ?? innerHeight) - 12;
      const above = anchor.top - top - 8;
      const below = bottom - anchor.bottom - 8;
      const menu = picker.current!;
      // Measure the preferred five-row list before choosing the opening direction.
      menu.style.setProperty('--project-list-height', '190px');
      const desiredHeight = menu.scrollHeight + 2;
      const upward = below < desiredHeight && above > below;
      const room = Math.max(150, upward ? above : below);
      const width = Math.min(320, innerWidth - 32);
      const listHeight = Math.min(190, Math.max(34, room - 140));
      menu.style.setProperty('--project-list-height', `${listHeight}px`);
      const height = Math.min(menu.scrollHeight + 2, room);
      setPosition({
        width, left: Math.max(16, Math.min(innerWidth - width - 16, anchor.left + anchor.width / 2 - width / 2)),
        top: upward ? Math.max(top, anchor.top - 8 - height) : Math.min(anchor.bottom + 8, bottom - height),
        maxHeight: room, '--project-list-height': `${listHeight}px`,
      } as CSSProperties);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, search, workspaces.length]);
  useEffect(() => {
    if (greetingLanguage.current === language) return;
    greetingLanguage.current = language;
    setText(selectFirstGreeting(language)); setCount(0); phase.current = 'typing'; seen.current.clear();
  }, [language]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches || composing) { setCount(text.length); phase.current = 'holding'; return; }
    if (phase.current === 'typing' && count >= text.length) phase.current = 'holding';
    if (phase.current === 'deleting' && count === 0) phase.current = 'waiting';
    const state = phase.current;
    const delay = state === 'holding' ? 6500 : state === 'waiting' ? 450 : state === 'deleting' ? 55 : zh ? 105 : 48;
    const timer = setTimeout(() => {
      if (state === 'holding') { phase.current = 'deleting'; setCount(value => Math.max(0, value - 1)); }
      else if (state === 'waiting') { phase.current = 'typing'; setText(nextGreeting(language, text, seen.current)); }
      else setCount(value => state === 'deleting' ? value - 1 : value + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [text, count, zh, language, composing]);
  useEffect(() => {
    onOpenChange(open);
    if (!open) return;
    input.current?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !picker.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
      closing.current?.cancel(); closing.current = null;
      onOpenChange(false);
    };
  }, [open, onOpenChange]);
  const choose = (path?: string) => { close(); onSelect(path); };
  const matches = workspaces.filter(path => `${title(path)} ${path}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="new-session empty-state">
    <div className="empty-symbol"><img src="./StepCode.svg" width="48" height="48" alt=""/></div>
    <h1 aria-label={text}><span className="terminal-heading" aria-hidden="true"><span className="terminal-line"><span className="terminal-heading-space">{text}</span>
      <span className="terminal-heading-output">{text.slice(0, count)}<span className="terminal-cursor"/></span>
    </span></span></h1>
    <div className="new-session-project" ref={root}>
      <button ref={trigger} type="button" className="new-session-project-trigger" disabled={disabled}
        aria-label={`${zh ? '会话归属' : 'Session project'}: ${workspace ? title(workspace) : zh ? '独立会话' : 'Independent session'}`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls="new-session-project-picker"
        onClick={() => {
          if (closing.current && picker.current) {
            const element = picker.current;
            const style = getComputedStyle(element);
            const from = { opacity: style.opacity, transform: style.transform };
            closing.current.cancel(); closing.current = null; element.inert = false;
            element.animate([from, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)' });
            setSearch('');
          } else if (open) close();
          else { setSearch(''); setOpen(true); }
        }}>
        {workspace ? <FolderOpen size={16}/> : <MessageSquare size={16}/>}
        <span>{workspace ? title(workspace) : zh ? '独立会话' : 'Independent session'}</span><DisclosureChevron/>
      </button>
      {open && createPortal(<div ref={picker} style={position} id="new-session-project-picker" className="new-session-project-picker" role="dialog" aria-label={zh ? '选择项目' : 'Choose project'}>
        <label className="new-session-search"><Search size={15}/><input ref={input} aria-label={zh ? '搜索项目' : 'Search projects'}
          placeholder={zh ? '搜索项目' : 'Search projects'} value={search} onChange={event => setSearch(event.target.value)}/></label>
        <div className="new-session-project-list">
          {matches.map(path => <button key={path} type="button" title={path} aria-pressed={path === workspace} onClick={() => choose(path)}>
            <FolderOpen size={16}/><span>{title(path)}</span>{path === workspace && <Check size={15}/>}
          </button>)}
          {!matches.length && <p>{zh ? '暂无匹配项目' : 'No matching projects'}</p>}
        </div>
        <div className="new-session-project-options">
          <button type="button" onClick={() => { close(); onOpenProject(); }}><Plus size={16}/><span>{zh ? '打开新项目…' : 'Open new project...'}</span></button>
          <button type="button" aria-pressed={!workspace} onClick={() => choose()}><MessageSquare size={16}/><span>{zh ? '独立会话' : 'Independent session'}</span>{!workspace && <Check size={15}/>}</button>
        </div>
      </div>, document.body)}
    </div>
    <button type="button" className="new-session-settings" disabled={disabled} onClick={onSettings}><Settings size={14}/>{zh ? '账户设置' : 'Account settings'}</button>
    <span className="community-note">Desktop for Step Code · {zh ? '独立社区项目' : 'Independent community project'}</span>
  </section>;
}
