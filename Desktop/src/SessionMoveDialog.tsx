import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRightLeft, FolderOpen, Search, ShieldCheck, X } from 'lucide-react';
import { normalizedWorkspaceKey } from './workspace-key';
import type { Preferences, Session } from './contracts';
import { sessionMoveError } from './session-move-error';
import './quit-confirmation.css';
import './session-move.css';

export function SessionMoveDialog({ session, preferences, platform, initialDestination, onCancel, onConfirm }: {
  session: Session; preferences: Preferences; platform?: string; initialDestination?: string;
  onCancel(): void; onConfirm(destination: string): Promise<void>;
}) {
  const zh = preferences.language === 'zh';
  const t = (cn: string, en: string) => zh ? cn : en;
  const identity = (path: string) => normalizedWorkspaceKey(path, platform ?? 'win32');
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const title = useId();
  const description = useId();
  const group = useId();
  const [destination, setDestination] = useState(initialDestination ?? '');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const projects = preferences.workspaces.filter(path => identity(path) !== identity(session.cwd));
  const projectName = (path: string) => preferences.workspaceNames?.[identity(path)]
    ?? path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path;
  const filtered = projects.filter(path => `${projectName(path)} ${path}`.toLowerCase().includes(query.toLowerCase()));
  const selected = projects.find(path => path === destination);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="quit-confirmation session-move-dialog" aria-labelledby={title}
    aria-describedby={description} aria-busy={pending}
    onCancel={event => { event.preventDefault(); if (!locked.current) onCancel(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
        .filter(element => element.getClientRects().length && (!(element instanceof HTMLInputElement) || element.type !== 'radio'
          || element.checked || !selected && element === dialog.current!.querySelector('input[type="radio"]')));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }}>
    <header><h2 id={title}>{t('移至项目', 'Move to project')}</h2>
      <button type="button" className="icon-button" aria-label={t('关闭', 'Close')} disabled={pending} onClick={onCancel}><X size={18}/></button></header>
    <div className="session-move-source"><strong>{session.name || session.firstMessage || t('新会话', 'New session')}</strong>
      <span>{t('原目录', 'Current folder')}</span><code>{session.cwd}</code></div>
    {projects.length > 5 && <label className="session-move-search"><Search size={15}/><input
      aria-label={t('搜索目标项目', 'Search destination projects')} value={query} disabled={pending}
      placeholder={t('搜索项目', 'Search projects')} onChange={event => setQuery(event.target.value)}/></label>}
    <div className="session-move-projects" role="radiogroup" aria-label={t('目标项目', 'Destination project')}>
      {filtered.map(path => <label key={path} className={destination === path ? 'is-selected' : ''}>
        <input type="radio" name={group} checked={destination === path} value={path} disabled={pending}
          onChange={() => { setDestination(path); setError(''); }}/><FolderOpen size={16}/>
        <span><strong>{projectName(path)}</strong><code>{path}</code></span>
      </label>)}
      {!filtered.length && <p className="muted">{projects.length
        ? t('没有匹配的项目', 'No matching projects')
        : t('暂无其他项目', 'No other projects')}</p>}
    </div>
    {selected && <p className="session-move-destination">{t('后续执行目录：', 'Future working directory: ')}<code>{selected}</code></p>}
    <p id={description} className="muted">{t(
      '聊天历史保留。原目录中的文件、改动和终端不会搬移；旧对话可能仍引用原目录。',
      'Chat history stays. Files, changes and terminals remain in the original folder; earlier messages may still refer to it.')}</p>
    <p className="session-move-permission"><ShieldCheck size={15}/>{t(
      '目标项目从逐次审批开始，不继承原目录的完全访问授权。',
      'The destination starts with approval required. Full Access from the old folder is not carried over.')}</p>
    {error && <p className="session-move-error" role="alert">{error}</p>}
    <footer><button type="button" ref={cancel} disabled={pending} onClick={onCancel}>{t('取消', 'Cancel')}</button>
      <button type="button" className="quit-confirm" disabled={pending || !selected} onClick={async () => {
        if (locked.current || !selected) return;
        locked.current = true; setPending(true); setError('');
        try { await onConfirm(selected); }
        catch (cause) {
          locked.current = false; setPending(false);
          setError(sessionMoveError(cause, zh));
        }
      }}><ArrowRightLeft size={15}/>{pending ? t('正在移动…', 'Moving…') : t('确认移动', 'Confirm move')}</button></footer>
  </dialog>;
}
