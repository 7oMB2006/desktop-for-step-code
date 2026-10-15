import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export function ProjectRemoval({ title, path, language, onCancel, onConfirm }: {
  title: string; path: string; language: 'zh' | 'en'; onCancel: () => void; onConfirm: () => Promise<boolean>;
}) {
  const zh = language === 'zh';
  const [closing, setClosing] = useState(false);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const finish = useRef(onCancel);
  finish.current = onCancel;
  const dismiss = () => {
    if (pending) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onCancel();
    else setClosing(true);
  };
  useEffect(() => {
    cancel.current?.focus();
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  }, []);
  useEffect(() => {
    if (!closing) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) { finish.current(); return; }
    const reduce = () => { if (motion.matches) finish.current(); };
    const timer = setTimeout(() => finish.current(), 260);
    motion.addEventListener('change', reduce);
    return () => { clearTimeout(timer); motion.removeEventListener('change', reduce); };
  }, [closing]);
  useEffect(() => { if (pending) dialog.current?.focus(); }, [pending]);
  return <div className={`modal-backdrop settings-backdrop project-removal-backdrop${closing ? ' is-closing' : ''}`}
    onAnimationEnd={event => {
      if (event.target === event.currentTarget && event.animationName === 'settings-backdrop-exit') finish.current();
    }}
    onMouseDown={event => { if (event.target === event.currentTarget) dismiss(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); dismiss(); }
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <section ref={dialog} tabIndex={-1} className="small-dialog project-removal-dialog" role="dialog" aria-modal="true"
      aria-labelledby="project-removal-title" aria-describedby="project-removal-description" inert={closing}>
      <header><h2 id="project-removal-title">{zh ? '移除项目' : 'Remove project'}</h2>
        <button className="icon-button" aria-label={zh ? '关闭' : 'Close'} disabled={pending} onClick={dismiss}><X size={18}/></button></header>
      <strong>{title}</strong><p className="project-removal-path">{path}</p>
      <p id="project-removal-description" className="muted">{zh
        ? '仅从左栏移除项目。磁盘文件不会删除，已有会话保留在独立会话中，运行中的任务不会中断。'
        : 'Remove this project from the sidebar only. Files remain on disk, conversations move to Independent sessions, and running tasks are not interrupted.'}</p>
      <div className="button-row"><button ref={cancel} disabled={pending} onClick={dismiss}>{zh ? '取消' : 'Cancel'}</button>
        <button className="project-remove-confirm" disabled={pending} onClick={async () => {
          setPending(true);
          try { if (await onConfirm()) setClosing(true); } finally { setPending(false); }
        }}>{pending ? (zh ? '正在移除…' : 'Removing...') : (zh ? '移除项目' : 'Remove project')}</button></div>
    </section>
  </div>;
}
