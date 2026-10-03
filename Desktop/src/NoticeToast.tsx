import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, Check, GitBranch, Info, TriangleAlert, X } from 'lucide-react';

export interface NoticeToastItem {
  id: number;
  message: string;
  type: 'info' | 'warning' | 'success';
  transitionFrom?: number;
  mcpServer?: string;
  icon?: 'copy' | 'archive' | 'branch' | 'restored';
  actions?: { label: string; primary?: boolean; onClick: () => Promise<void> | void }[];
}

export function NoticeToast({ notice, language, onDismiss, onDetails }: {
  notice: NoticeToastItem | null;
  language: 'zh' | 'en';
  onDismiss: () => void;
  onDetails: () => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const bubble = useRef<HTMLDivElement>(null);
  const previousSize = useRef<{ id: number; width: number } | null>(null);
  const resizeAnimation = useRef<Animation | null>(null);
  const [pending, setPending] = useState(false);
  const executing = useRef(false);
  const activeId = useRef(notice?.id);
  activeId.current = notice?.id;
  const remaining = useRef(0);
  const started = useRef(0);
  const hovered = useRef(false);
  const focused = useRef(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const zh = language === 'zh';

  useLayoutEffect(() => {
    resizeAnimation.current?.cancel();
    const element = bubble.current;
    if (!element || !notice) { previousSize.current = null; return; }
    const width = element.getBoundingClientRect().width;
    const previous = previousSize.current;
    if (previous && notice.transitionFrom === previous.id && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resizeAnimation.current = element.animate([{ width: `${previous.width}px` }, { width: `${width}px` }],
        { duration: 220, easing: 'cubic-bezier(.215, .61, .355, 1)' });
    }
    previousSize.current = { id: notice.id, width };
    return () => resizeAnimation.current?.cancel();
  }, [notice?.id]);

  useEffect(() => {
    if (!notice) return;
    hovered.current = notice.transitionFrom !== undefined && Boolean(bubble.current?.matches(':hover'));
    focused.current = Boolean(bubble.current?.contains(document.activeElement));
    setPending(false);
    executing.current = false;
    remaining.current = notice.type === 'success' ? 3000 : notice.type === 'warning' || notice.actions?.length ? 8000 : 4000;
    started.current = Date.now();
    if (!hovered.current && !focused.current) timer.current = window.setTimeout(() => dismiss.current(), remaining.current);
    return () => { window.clearTimeout(timer.current); timer.current = undefined; };
  }, [notice?.id]);

  const pause = () => {
    if (timer.current === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
  };
  const resume = () => {
    if (executing.current || hovered.current || focused.current || timer.current !== undefined) return;
    started.current = Date.now();
    timer.current = window.setTimeout(() => dismiss.current(), remaining.current);
  };

  if (!notice) return null;
  const Icon = notice.type === 'warning' ? TriangleAlert : notice.icon === 'archive' ? Archive
    : notice.icon === 'branch' ? GitBranch : notice.icon === 'copy' || notice.type === 'success' ? Check : Info;
  return <div ref={bubble} key={notice.transitionFrom ?? notice.id}
    className={`notice-toast ${notice.type}${notice.transitionFrom !== undefined ? ' notice-replaced' : ''}`} role="status" aria-live="polite"
    onMouseEnter={() => { hovered.current = true; pause(); }}
    onMouseLeave={() => { hovered.current = false; resume(); }}
    onFocusCapture={() => { focused.current = true; pause(); }}
    onBlurCapture={event => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      focused.current = false;
      resume();
    }}>
    <Icon key={`icon-${notice.id}`} size={16}/>
    <span key={`message-${notice.id}`}>{notice.message}</span>
    {!!notice.actions?.length && <div className="notice-actions">{notice.actions.map(action =>
      <button key={action.label} type="button" className={`notice-action${action.primary ? ' primary' : ''}`} disabled={pending}
        onClick={async () => {
          if (executing.current) return;
          const id = notice.id;
          executing.current = true;
          setPending(true);
          pause();
          try { await action.onClick(); } finally {
            if (activeId.current === id) {
              executing.current = false;
              setPending(false);
              resume();
            }
          }
        }}>{action.label}</button>)}</div>}
    {notice.mcpServer && <button type="button" className="notice-details" onClick={onDetails}>{zh ? '查看 MCP' : 'View MCP'}</button>}
    <button type="button" className="icon-button" data-tooltip={zh ? '关闭通知' : 'Dismiss notification'} aria-label={zh ? '关闭通知' : 'Dismiss notification'} onClick={onDismiss}><X size={15}/></button>
  </div>;
}
