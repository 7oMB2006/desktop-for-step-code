import { useEffect, useRef } from 'react';
import { Info, TriangleAlert, X } from 'lucide-react';

export interface NoticeToastItem {
  id: number;
  message: string;
  type: 'info' | 'warning';
  mcpServer?: string;
}

export function NoticeToast({ notice, language, onDismiss, onDetails }: {
  notice: NoticeToastItem | null;
  language: 'zh' | 'en';
  onDismiss: () => void;
  onDetails: () => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const remaining = useRef(0);
  const started = useRef(0);
  const hovered = useRef(false);
  const focused = useRef(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const zh = language === 'zh';

  useEffect(() => {
    if (!notice) return;
    hovered.current = false;
    focused.current = false;
    remaining.current = notice.type === 'warning' ? 8000 : 4000;
    started.current = Date.now();
    timer.current = window.setTimeout(() => dismiss.current(), remaining.current);
    return () => window.clearTimeout(timer.current);
  }, [notice?.id]);

  const pause = () => {
    if (timer.current === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
  };
  const resume = () => {
    if (hovered.current || focused.current || timer.current !== undefined) return;
    started.current = Date.now();
    timer.current = window.setTimeout(() => dismiss.current(), remaining.current);
  };

  if (!notice) return null;
  return <div className={`notice-toast ${notice.type}`} role="status" aria-live="polite"
    onMouseEnter={() => { hovered.current = true; pause(); }}
    onMouseLeave={() => { hovered.current = false; resume(); }}
    onFocusCapture={() => { focused.current = true; pause(); }}
    onBlurCapture={event => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      focused.current = false;
      resume();
    }}>
    {notice.type === 'warning' ? <TriangleAlert size={17}/> : <Info size={17}/>}
    <span>{notice.message}</span>
    {notice.mcpServer && <button type="button" className="notice-details" onClick={onDetails}>{zh ? '查看 MCP' : 'View MCP'}</button>}
    <button type="button" className="icon-button" title={zh ? '关闭通知' : 'Dismiss notification'} aria-label={zh ? '关闭通知' : 'Dismiss notification'} onClick={onDismiss}><X size={15}/></button>
  </div>;
}
