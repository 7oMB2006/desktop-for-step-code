import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Message } from './contracts';
import { createTurnChangesReader } from './turn-changes';
import { DiffCount } from './DiffCount';
import './live-turn-changes.css';

export function LiveTurnChanges({ messages, busy, language, docked = false, onOpenChange }: {
  messages: Message[]; busy: boolean; language: 'zh' | 'en'; docked?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const read = useMemo(createTurnChangesReader, []);
  let start = messages.length;
  while (start > 0 && messages[start - 1].role !== 'user') start--;
  const changes = read(busy ? messages.slice(start).map((message, offset) => ({ message, index: start + offset })) : []);
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [open, onOpenChange]);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const visible = busy && changes.files.length > 0;
  const [lastChanges, setLastChanges] = useState(changes);
  const [present, setPresent] = useState(visible);
  if (visible && (changes !== lastChanges || !present)) {
    setLastChanges(changes); setPresent(true);
  }
  useLayoutEffect(() => {
    if (!visible && panel.current?.matches(':popover-open')) panel.current.hidePopover();
    if (!visible && matchMedia('(prefers-reduced-motion: reduce)').matches) setPresent(false);
  }, [visible]);
  useEffect(() => {
    if (visible || !present) return;
    const timer = setTimeout(() => setPresent(false), 200);
    return () => clearTimeout(timer);
  }, [visible, present]);
  useLayoutEffect(() => {
    // Preserve the anchor coordinates while the native top-layer exit runs.
    if (!open || !visible) return;
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      const box = panel.current?.getBoundingClientRect();
      if (!trigger || !box) return;
      const titlebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-bar-height')) || 46;
      const next = {
        left: Math.max(12, Math.min(docked ? trigger.right - box.width : trigger.x + trigger.width / 2 - box.width / 2, innerWidth - box.width - 12)),
        top: Math.max(titlebar + 8, trigger.top - box.height - 8),
      };
      setPosition(previous => previous && Math.abs(previous.left - next.left) < .5 && Math.abs(previous.top - next.top) < .5 ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    let frame = 0;
    const follow = () => { place(); frame = requestAnimationFrame(follow); };
    frame = requestAnimationFrame(follow);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open, visible, docked]);
  if (!present) return null;
  const displayed = visible ? changes : lastChanges;
  const zh = language === 'zh';
  return <div className={`live-turn-context${visible ? '' : ' is-leaving'}`} aria-hidden={!visible}>
    <button ref={anchor} type="button" className="live-turn-chip" popoverTarget={id} aria-expanded={open} aria-controls={id}
      disabled={!visible} aria-label={zh ? '查看运行中的变更' : 'View running changes'}>
      <span>{displayed.files.length} {zh ? '个文件' : 'files'}</span>
      <DiffCount value={displayed.added} kind="added"/><DiffCount value={displayed.removed} kind="removed"/>
      {displayed.incomplete && <span className="live-turn-partial">{zh ? '部分记录' : 'Partial'}</span>}
    </button>
    {createPortal(<div ref={panel} id={id} popover="auto" className="live-turn-popover" role="dialog"
      aria-label={zh ? '运行中的变更' : 'Running changes'} aria-hidden={!open} inert={!open}
      onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden', transformOrigin: docked ? 'bottom right' : 'bottom center' }}>
      <ul className="live-turn-files" aria-label={zh ? '已修改文件' : 'Changed files'}>
        {displayed.files.map(file => <li key={file.path}>
          <span className="live-turn-file-name" title={file.path}>{file.path.replace(/\\/g, '/').split('/').at(-1)}</span>
          <span className="live-turn-file-stats"><DiffCount value={file.added} kind="added"/><DiffCount value={file.removed} kind="removed"/></span>
        </li>)}
      </ul>
    </div>, document.body)}
  </div>;
}
