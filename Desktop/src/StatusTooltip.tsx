import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Circle, CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { SubagentStatus } from './SubagentStatusIcon';
import './status-tooltip.css';

const copy = {
  pending: ['待执行', '尚未开始执行。', 'Pending', 'Execution has not started.'],
  running: ['进行中', '仍在执行，尚未返回最终结果。', 'Running', 'Execution is ongoing; no final result has been returned.'],
  done: ['已完成', '本次执行已正常结束。', 'Completed', 'This execution has finished normally.'],
  failed: ['已失败', '本次执行未成功结束，不代表其他任务也已失败。', 'Failed', 'This execution did not finish successfully. Other tasks may have different outcomes.'],
  stopped: ['已中断', '执行已停止，未继续完成；这不等同于执行报错。', 'Interrupted', 'Execution stopped before completion. This is not the same as an execution error.'],
} as const;
const symbols = { pending: Circle, running: LoaderCircle, done: CircleCheck, failed: CircleX, stopped: TriangleAlert };

export function StatusTooltip({ state, language, detail, children }: {
  state: SubagentStatus; language: 'zh' | 'en'; detail?: string; children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focused = useRef(false);
  const hovered = useRef(false);
  const pointerFocus = useRef(false);
  const id = useId();
  const [embedded, setEmbedded] = useState(true);
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [position, setPosition] = useState({ left: -9999, top: -9999, origin: '0px 0px' });
  const [title, explanation] = language === 'zh' ? copy[state].slice(0, 2) : copy[state].slice(2);
  const description = detail || explanation;
  const Symbol = symbols[state];
  const enter = () => {
    hovered.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 220);
  };
  const leave = () => {
    hovered.current = false;
    clearTimeout(timer.current);
    if (!focused.current) timer.current = setTimeout(() => setOpen(false), 100);
  };

  useEffect(() => {
    const target = anchor.current!;
    const owner = target.closest<HTMLElement>('button, a[href]');
    setEmbedded(!!owner);
    const control = owner ?? target;
    const dismiss = () => { clearTimeout(timer.current); focused.current = false; setOpen(false); };
    const pointer = () => { pointerFocus.current = true; dismiss(); };
    const keyboard = () => { pointerFocus.current = false; };
    const focus = () => {
      if (pointerFocus.current) return;
      focused.current = true; clearTimeout(timer.current); setOpen(true);
    };
    const blur = () => { focused.current = false; if (!hovered.current) setOpen(false); };
    control.addEventListener('focus', focus);
    control.addEventListener('blur', blur);
    control.addEventListener('click', dismiss);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      clearTimeout(timer.current);
      control.removeEventListener('focus', focus);
      control.removeEventListener('blur', blur);
      control.removeEventListener('click', dismiss);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, []);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const exit = setTimeout(() => setPresent(false), 160);
    return () => clearTimeout(exit);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const target = anchor.current!;
    const control = target.closest<HTMLElement>('button, a[href]') ?? target;
    const before = control.getAttribute('aria-describedby');
    control.setAttribute('aria-describedby', [before, id].filter(Boolean).join(' '));
    return () => {
      const ids = control.getAttribute('aria-describedby')?.split(/\s+/).filter(value => value !== id);
      if (ids?.length) control.setAttribute('aria-describedby', ids.join(' '));
      else control.removeAttribute('aria-describedby');
    };
  }, [open, id]);
  useLayoutEffect(() => {
    if (!present || !anchor.current || !surface.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const box = surface.current.getBoundingClientRect();
    const inset = 12;
    const left = Math.max(inset, Math.min(rect.left - 12, window.innerWidth - box.width - inset));
    const titlebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-bar-height')) || 0;
    const below = rect.bottom + 8;
    const fitsBelow = below + box.height <= window.innerHeight - inset;
    const top = fitsBelow ? below : Math.max(titlebar + inset, rect.top - box.height - 8);
    setPosition({ left, top, origin: `${rect.left + rect.width / 2 - left}px ${fitsBelow ? '0%' : '100%'}` });
    const hide = () => { clearTimeout(timer.current); setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault(); event.stopImmediatePropagation(); hide();
      }
    };
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('resize', hide);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [present, open, title, description]);

  return <>
    <span ref={anchor} className="status-tooltip-anchor" tabIndex={embedded ? undefined : 0}
      role={embedded ? undefined : 'img'} aria-label={embedded ? undefined : title}
      onMouseEnter={enter} onMouseLeave={leave}
      onClick={() => { clearTimeout(timer.current); setOpen(false); }}>
      {children}
    </span>
    {present && createPortal(<div ref={surface} id={id} className={`status-tooltip${open ? '' : ' is-closing'}`}
      data-state={state} role="tooltip" aria-hidden={!open} inert={!open}
      style={{ left: position.left, top: position.top, transformOrigin: position.origin }}
      onMouseEnter={() => { hovered.current = true; clearTimeout(timer.current); }} onMouseLeave={leave}>
      <div className="status-tooltip-heading"><Symbol size={16} strokeWidth={1.9} aria-hidden="true"/><strong>{title}</strong></div>
      <p>{description}</p>
    </div>, document.body)}
  </>;
}
