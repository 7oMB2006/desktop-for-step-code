import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import './app-menu.css';

export interface AppMenuItem { id: string; label: string; icon?: ReactNode; disabled?: boolean }
export function AppMenu({ anchor, open, label, items, selected, onSelect, onClose }: {
  anchor: RefObject<HTMLButtonElement | null>; open: boolean; label: string;
  items: AppMenuItem[]; selected?: string; onSelect: (id: string) => void; onClose: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; origin: string }>();
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!open) { if (element.matches(':popover-open')) element.hidePopover(); return; }
    if (!element.matches(':popover-open')) element.showPopover();
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      if (!trigger) { onClose(); return; }
      const box = { width: element.offsetWidth, height: element.offsetHeight };
      const below = innerHeight - trigger.bottom - 10;
      const upwards = below < box.height && trigger.top - 54 > below;
      setPosition({ left: Math.max(10, Math.min(trigger.right - box.width, innerWidth - box.width - 10)),
        top: Math.max(54, upwards ? trigger.top - box.height - 5 : Math.min(trigger.bottom + 5, innerHeight - box.height - 10)),
        origin: upwards ? 'bottom right' : 'top right' });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    const focus = requestAnimationFrame(() => {
      (element.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')
        ?? element.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    });
    return () => { cancelAnimationFrame(focus); observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open, anchor, onClose]);
  return createPortal(<div ref={panel} id={id} popover="auto" className="app-menu" role="menu" aria-label={label}
    aria-hidden={!open} inert={!open} onToggle={event => { if (event.newState === 'closed') onClose(); }}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? undefined : 'hidden', transformOrigin: position?.origin }}
    onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.current?.focus(); }
      else if (event.key === 'Tab') { onClose(); anchor.current?.focus(); }
    }}>
    {items.map(item => <button type="button" key={item.id} role="menuitemradio" aria-checked={selected === item.id}
      disabled={item.disabled} onClick={() => { onClose(); anchor.current?.focus(); onSelect(item.id); }}>
      <span className="app-menu-icon">{item.icon}</span><span className="app-menu-label">{item.label}</span>
      <span className="app-menu-check">{selected === item.id && <Check size={14}/>}</span>
    </button>)}
  </div>, document.body);
}
