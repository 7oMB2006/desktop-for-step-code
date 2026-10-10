import { useCallback, useEffect, useRef, useState } from 'react';
import { Columns2, Maximize2, PanelRight, PanelRightClose } from 'lucide-react';
import { AppMenu } from './AppMenu';
import type { RightPanelWidth } from './RightPanelWidthControl';
import './right-panel-handle.css';

export function RightPanelHandle({ panel, value, standard, wide, language, onChange, onClose, onBlocked }: {
  panel: string; value: RightPanelWidth; standard: number; wide: boolean; language: 'zh' | 'en';
  onChange: (value: RightPanelWidth) => void; onClose: () => void; onBlocked: (blocked: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const settling = useRef<(() => void) | undefined>(undefined);
  const [left, setLeft] = useState(0);
  const [menu, setMenu] = useState(false);
  const drag = useRef<{ x: number; width: number; max: number; surface: HTMLElement; track: HTMLElement | null; moved: boolean } | undefined>(undefined);
  const zh = language === 'zh';
  const closeMenu = useCallback(() => setMenu(false), []);
  useEffect(() => { onBlocked(menu); return () => onBlocked(false); }, [menu, onBlocked]);
  useEffect(() => {
    const surface = document.querySelector<HTMLElement>(`.right-inspector-surface:not([aria-hidden="true"]):not(.is-closing)`);
    if (!surface) return;
    const measure = () => setLeft(Math.max(surface.getBoundingClientRect().left, 0));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [panel, value]);
  const restore = useCallback(() => {
    settling.current?.();
    settling.current = undefined;
    const current = drag.current;
    if (!current) return;
    current.surface.style.removeProperty('width');
    current.track?.style.removeProperty('flex-basis');
    document.querySelector('.app')?.removeAttribute('data-panel-drag');
    drag.current = undefined;
    onBlocked(false);
  }, [onBlocked]);
  useEffect(() => restore, [restore, panel]);
  const select = (next: string) => next === 'closed' ? onClose() : onChange(next as RightPanelWidth);
  return <><button ref={trigger} className="right-panel-handle" style={{ left }} type="button"
    aria-label={zh ? '调整右栏宽度' : 'Adjust panel width'} aria-haspopup="menu" aria-expanded={menu}
    onClick={() => setMenu(true)}
    onKeyDown={event => {
      const sizes: RightPanelWidth[] = wide ? ['standard', 'wide', 'fullscreen'] : ['standard', 'fullscreen'];
      const index = sizes.indexOf(value);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.key === 'ArrowRight' && index === 0) onClose();
        else onChange(sizes[Math.max(0, Math.min(sizes.length - 1, index + (event.key === 'ArrowLeft' ? 1 : -1)))]!);
      } else if (event.key === 'Escape') { event.preventDefault(); restore(); }
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      const surface = document.querySelector<HTMLElement>('.right-inspector-surface:not([aria-hidden="true"]):not(.is-closing)');
      const app = document.querySelector<HTMLElement>('.app');
      if (!surface || !app) return;
      const sidebar = parseFloat(getComputedStyle(app).getPropertyValue('--sidebar-track')) || 0;
      drag.current = { x: event.clientX, width: surface.getBoundingClientRect().width, max: innerWidth - sidebar - 44,
        surface, track: surface.parentElement, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current) return;
      const delta = current.x - event.clientX;
      if (!current.moved && Math.abs(delta) < 5) return;
      if (!current.moved) current.moved = true;
      document.querySelector('.app')?.setAttribute('data-panel-drag', '');
      const width = Math.max(80, Math.min(current.max, current.width + delta));
      current.surface.style.width = `${width}px`;
      if (current.track && !current.track.classList.contains('is-overlay')) current.track.style.flexBasis = `${width}px`;
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (!current) return;
      const moved = current.moved;
      const desired = current.width + current.x - event.clientX;
      const max = current.max;
      if (moved) {
        // Keep the dragged geometry for one paint so the CSS transition starts
        // at the pointer, rather than jumping back to the original preset.
        current.surface.getBoundingClientRect();
        const clear = () => {
          current.surface.style.removeProperty('width');
          current.track?.style.removeProperty('flex-basis');
        };
        settling.current = clear;
        drag.current = undefined;
        document.querySelector('.app')?.removeAttribute('data-panel-drag');
        requestAnimationFrame(() => {
          if (settling.current === clear) { clear(); settling.current = undefined; }
        });
      } else restore();
      if (!moved) return;
      event.preventDefault();
      // Suppress the synthetic click after a drag without suppressing keyboard activation.
      event.currentTarget.addEventListener('click', event => event.stopImmediatePropagation(), { once: true, capture: true });
      const base = Math.min(standard, max);
      if (desired < base - 100) { onClose(); return; }
      const middle = Math.max(620, Math.min(max * .6, max - 480));
      const sizes: [RightPanelWidth, number][] = [['standard', base], ...(wide ? [['wide', Math.min(middle, max)] as [RightPanelWidth, number]] : []), ['fullscreen', max]];
      onChange(sizes.reduce((best, item) => Math.abs(item[1] - desired) < Math.abs(best[1] - desired) ? item : best)[0]);
    }} onPointerCancel={restore} onLostPointerCapture={() => { if (drag.current) restore(); }}/>
    <AppMenu anchor={trigger} open={menu} label={zh ? '右栏宽度' : 'Panel width'} selected={value} onClose={closeMenu}
      items={[{ id: 'standard', label: zh ? '标准' : 'Standard', icon: <PanelRight/> },
        ...(wide ? [{ id: 'wide', label: zh ? '宽幅' : 'Wide', icon: <Columns2/> }] : []),
        { id: 'fullscreen', label: zh ? '全屏' : 'Fullscreen', icon: <Maximize2/> },
        { id: 'closed', label: zh ? '收起' : 'Close', icon: <PanelRightClose/> }]} onSelect={select}/></>;
}
