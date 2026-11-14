import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, Smartphone, X } from 'lucide-react';
import { remoteNavigationTitle, type RemoteNavigationWait } from './remote-navigation';
import './remote-navigation.css';

export function RemoteNavigationEntry({ waiting, target, language, hidden, open, disabled, onClick }: {
  waiting?: RemoteNavigationWait;
  target: string;
  language: string;
  hidden: boolean;
  open: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const zh = language === 'zh', label = zh ? '远程访问' : 'Remote access';
  const [ready, setReady] = useState<number>();
  const [shown, setShown] = useState(false);
  const dismissed = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const description = useId();
  const visible = Boolean(waiting && ready === waiting.id && shown && !hidden);
  const keepOpen = () => clearTimeout(closeTimer.current);
  const dismiss = () => {
    keepOpen();
    if (bubble.current?.contains(document.activeElement)) button.current?.focus({ preventScroll: true });
    dismissed.current = true;
    setShown(false);
  };
  useEffect(() => {
    setReady(undefined); setShown(false); dismissed.current = false;
    keepOpen();
    if (!waiting) return;
    const timer = setTimeout(() => { setReady(waiting.id); setShown(true); }, 1000);
    return () => { clearTimeout(timer); keepOpen(); };
  }, [waiting?.id]);
  useEffect(() => {
    if (!visible) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); dismiss();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [visible]);
  const reveal = () => {
    keepOpen();
    if (waiting && ready === waiting.id) setShown(true);
  };
  const leave = () => {
    keepOpen();
    if (dismissed.current) closeTimer.current = setTimeout(() => {
      if (!button.current?.matches(':hover, :focus') && !bubble.current?.matches(':hover, :focus-within')) setShown(false);
    }, 140);
  };
  return <div className="remote-navigation-entry" onPointerEnter={reveal} onPointerLeave={leave}
    onFocusCapture={reveal} onBlurCapture={leave}>
    <button ref={button} className={`icon-button remote-entry${waiting ? ' remote-navigation-busy' : ''}`}
      aria-label={label} data-tooltip={waiting ? undefined : label} disabled={disabled}
      aria-pressed={open} aria-busy={Boolean(waiting)} aria-describedby={visible ? description : undefined}
      onClick={onClick}><Smartphone size={17}/></button>
    {visible && <section ref={bubble} className="remote-navigation-hint"
      aria-label={zh ? 'Remote 准备状态' : 'Remote preparation status'}>
      <div className="remote-navigation-heading">
        <LoaderCircle size={15} className="remote-navigation-spinner" aria-hidden="true"/>
        <strong>{remoteNavigationTitle(waiting!.source, language)}</strong>
        <button type="button" className="icon-button" aria-label={zh ? '关闭提示' : 'Dismiss hint'}
          data-tooltip={zh ? '关闭提示' : 'Dismiss hint'} onClick={dismiss}><X size={14}/></button>
      </div>
      <p id={description} role="status" aria-live="polite">
        {zh ? `准备完成后将自动打开「${target}」。` : `“${target}” will open automatically when ready.`}
      </p>
    </section>}
  </div>;
}
