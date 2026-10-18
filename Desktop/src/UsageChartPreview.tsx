import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './usage-chart-preview.css';

type PreviewRow = { label: string; value: string; color?: string; line?: boolean; total?: boolean };
type PreviewData = { title: string; subtitle?: string; rows: PreviewRow[] };
type ActivePreview = { key: string; anchor: Element; data: PreviewData; mode: 'pointer' | 'focus' };
type PointerPosition = { x: number; y: number };

export function useChartPreview(language = 'zh') {
  const id = useId();
  const [active, setActive] = useState<ActivePreview | null>(null);
  const pointer = useRef<PointerPosition | null>(null);
  const reposition = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active) return;
    const hide = () => setActive(null);
    const scroll = () => {
      if (active.mode === 'focus') reposition.current?.();
      else hide();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    };
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', hide);
    };
  }, [active]);
  useEffect(() => {
    if (active && !active.anchor.isConnected) setActive(null);
  });
  const bind = (key: string, data: PreviewData) => ({
    'aria-describedby': active?.key === key ? id : undefined,
    onPointerEnter: (event: PointerEvent<Element>) => {
      if (event.pointerType === 'touch' || active?.mode === 'focus') return;
      pointer.current = { x: event.clientX, y: event.clientY };
      setActive({ key, anchor: event.currentTarget, data, mode: 'pointer' });
    },
    onPointerMove: (event: PointerEvent<Element>) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      if (active?.mode === 'focus') setActive({ key, anchor: event.currentTarget, data, mode: 'pointer' });
      reposition.current?.();
    },
    onPointerLeave: () => setActive(current => current?.key === key && current.mode === 'pointer' ? null : current),
    onFocus: (event: FocusEvent<Element>) => {
      if (!event.currentTarget.matches(':focus-visible')) return;
      pointer.current = null;
      setActive({ key, anchor: event.currentTarget, data, mode: 'focus' });
    },
    onBlur: () => setActive(current => current?.key === key ? null : current),
  });
  return { bind, preview: <ChartPreview id={id} active={active} pointer={pointer} reposition={reposition} language={language}/> };
}

export type ChartPreviewBinding = ReturnType<typeof useChartPreview>['bind'];

function ChartPreview({ id, active, pointer, reposition, language }: {
  language: string;
  id: string; active: ActivePreview | null; pointer: RefObject<PointerPosition | null>; reposition: RefObject<(() => void) | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!active?.anchor.isConnected || !panel.current) return;
    const element = panel.current;
    const box = { width: element.offsetWidth, height: element.offsetHeight };
    let frame = 0;
    const place = () => {
      frame = 0;
      const anchor = active.anchor.getBoundingClientRect();
      const x = pointer.current?.x ?? anchor.right;
      const y = pointer.current?.y ?? anchor.bottom;
      const left = x + 28 + box.width <= innerWidth - 10 ? x + 28 : x - box.width - 28;
      const top = y + 24 + box.height <= innerHeight - 10 ? y + 24 : y - box.height - 24;
      element.style.left = `${Math.max(10, Math.min(innerWidth - box.width - 10, left))}px`;
      element.style.top = `${Math.max(10, Math.min(innerHeight - box.height - 10, top))}px`;
    };
    // Pointer moves update only the floating card, at most once per frame.
    reposition.current = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    return () => { cancelAnimationFrame(frame); reposition.current = null; };
  }, [active, pointer, reposition]);
  if (!active) return null;
  return createPortal(<div ref={panel} id={id} className="usage-chart-preview" role="tooltip" aria-label={language === 'zh' ? '图表数据' : 'Chart data'}
    style={{ left: -9999, top: -9999 }}>
    <header><strong>{active.data.title}</strong>{active.data.subtitle && <span>{active.data.subtitle}</span>}</header>
    <dl>{active.data.rows.map(row => <div key={row.label} className={row.total ? 'is-total' : undefined}>
      <dt>{row.color && <i className={row.line ? 'is-line' : undefined} style={{ color: row.color }}/>}<span>{row.label}</span></dt>
      <dd>{row.value}</dd>
    </div>)}</dl>
  </div>, document.body);
}
