import { useEffect, useId, useRef, useState } from 'react';
import { Activity, Clock3, Goal, Loader, LogOut, X } from 'lucide-react';
import { quitConfirmation, type QuitReasons } from './quit-confirmation';
import './quit-confirmation.css';

export function QuitConfirmation({ reasons, language, stopping = false, onCancel, onConfirm }: {
  reasons: QuitReasons;
  language: 'zh' | 'en';
  stopping?: boolean;
  onCancel: () => void | Promise<void>;
  onConfirm: () => Promise<void>;
}) {
  const presentation = quitConfirmation(reasons, language);
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const [closing, setClosing] = useState(false);
  const [submitting, setPending] = useState(false);
  const pending = submitting || stopping;
  const [error, setError] = useState(false);
  const zh = language === 'zh';
  const icons = { cron: Clock3, running: Activity, goal: Goal, transition: Loader };
  useEffect(() => { if (error && !pending && !closing) cancel.current?.focus(); }, [error, pending, closing]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      Promise.resolve().then(() => onCancelRef.current()).catch(() => {
        setClosing(false); setError(true);
      });
    },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
    return () => clearTimeout(timer);
  }, [closing]);
  const dismiss = () => {
    if (locked.current || pending || closing) return;
    setClosing(true);
  };
  return <dialog ref={dialog} className={`quit-confirmation${closing ? ' is-closing' : ''}`}
    aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending} inert={closing}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault(); buttons.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
        event.preventDefault(); buttons[0].focus();
      }
    }}>
    <header>
      <h2 id={titleId}>{presentation.title}</h2>
      <button className="icon-button" aria-label={zh ? '取消退出' : 'Cancel quit'} disabled={pending}
        onClick={dismiss}><X size={18}/></button>
    </header>
    <div id={descriptionId}>
      <ul className="quit-reasons">
        {presentation.items.map(item => {
          const Icon = icons[item.kind];
          return <li key={item.kind}><Icon size={19} aria-hidden="true"/>
            <div><strong>{item.title}</strong><p>{item.description}</p></div>
          </li>;
        })}
      </ul>
      {presentation.notes.length > 0 && <div className="quit-notes">
        {presentation.notes.map((note, index) => <p key={note} className={reasons.temporaryJobs > 0 && index === 0 ? 'quit-loss' : ''}>{note}</p>)}
      </div>}
    </div>
    {error && <p className="quit-error" role="alert">{zh
      ? '未能退出，当前窗口仍保留，请重试。' : 'Could not quit. This window remains open. Try again.'}</p>}
    <footer>
      <button ref={cancel} disabled={pending} onClick={dismiss}>{zh ? '取消退出' : 'Cancel quit'}</button>
      <button className="quit-confirm" disabled={pending} onClick={async () => {
        if (locked.current) return;
        locked.current = true;
        setPending(true);
        setError(false);
        try { await onConfirm(); }
        catch { locked.current = false; setPending(false); setError(true); }
      }}><LogOut size={15} aria-hidden="true"/>{pending ? zh ? '正在退出…' : 'Quitting...' : presentation.confirm}</button>
    </footer>
  </dialog>;
}
