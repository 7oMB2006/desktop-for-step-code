import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ActiveTooltip = { anchor: HTMLElement; text: string };

export function AppTooltip() {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const find = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
    const show = (anchor: HTMLElement | null) => {
      const text = anchor?.dataset.tooltip;
      if (anchor && text) setActive(current => current?.anchor === anchor && current.text === text ? current : { anchor, text });
      else setActive(null);
    };
    const pointerOver = (event: PointerEvent) => show(find(event.target));
    const pointerOut = (event: PointerEvent) => {
      const anchor = find(event.target);
      if (anchor && !anchor.contains(event.relatedTarget as Node | null)) setActive(current => current?.anchor === anchor ? null : current);
    };
    const focusIn = (event: FocusEvent) => show(find(event.target));
    const focusOut = (event: FocusEvent) => {
      const anchor = find(event.target);
      if (anchor && !anchor.contains(event.relatedTarget as Node | null)) setActive(current => current?.anchor === anchor ? null : current);
    };
    const hide = () => setActive(null);
    document.addEventListener('pointerover', pointerOver);
    document.addEventListener('pointerout', pointerOut);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', hide);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerover', pointerOver);
      document.removeEventListener('pointerout', pointerOut);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', hide);
      window.removeEventListener('resize', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !tooltip.current || !active.anchor.isConnected) return;
    const anchor = active.anchor.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    if (active.anchor.dataset.tooltipSide === 'left') {
      const left = Math.max(8, anchor.left - box.width - 9);
      let top = Math.max(8, Math.min(window.innerHeight - box.height - 8, anchor.top + (anchor.height - box.height) / 2));
      const close = document.querySelector<HTMLElement>('.conversation-nav-panel header .icon-button, .details-panel header .icon-button')?.getBoundingClientRect();
      if (close && left < close.right && left + box.width > close.left && top < close.bottom && top + box.height > close.top) {
        const above = anchor.top - box.height - 9;
        const titlebarHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--window-bar-height')) || 0;
        top = above >= titlebarHeight + 8 ? above : Math.min(window.innerHeight - box.height - 8, anchor.bottom + 9);
      }
      setPosition({ left, top });
      return;
    }
    const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.left + anchor.width / 2 - box.width / 2));
    const above = anchor.top - box.height - 9;
    const top = above >= 8 ? above : Math.min(window.innerHeight - box.height - 8, anchor.bottom + 9);
    setPosition({ left, top });
  }, [active]);

  return createPortal(active && <div ref={tooltip} className="app-tooltip" role="tooltip" style={position ?? { left: -9999, top: -9999 }}>{active.text}</div>, document.body);
}
