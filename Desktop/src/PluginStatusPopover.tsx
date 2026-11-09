import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { PluginConnectionPanel, type PluginConnectionBridge } from './PluginConnectionPanel';
import type { PluginDesktopEntry } from './plugin-desktop';
import './plugin-status-popover.css';

export function PluginStatusPopover({ id, entry, anchor, bridge, language, onClose, onOpen }: {
  id: string; entry: PluginDesktopEntry; anchor: RefObject<HTMLButtonElement | null>;
  bridge: PluginConnectionBridge; language: 'zh' | 'en'; onClose(): void; onOpen(): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; height: number }>();
  const zh = language === 'zh';
  const close = () => { onClose(); anchor.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    element.showPopover();
    const place = () => {
      const trigger = anchor.current;
      if (!trigger?.isConnected || trigger.closest('[inert], [hidden]') || !trigger.getClientRects().length) {
        onClose(); return;
      }
      const box = trigger.getBoundingClientRect();
      const top = box.bottom + 6;
      const next = { left: Math.max(8, Math.min(box.right - element.offsetWidth, innerWidth - element.offsetWidth - 8)),
        top, height: Math.max(0, Math.min(520, innerHeight - top - 8)) };
      setPosition(previous => previous && previous.left === next.left && previous.top === next.top
        && previous.height === next.height ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    const frame = requestAnimationFrame(() => element.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [anchor, onClose]);
  return createPortal(<div ref={panel} id={id} popover="auto" role="dialog" tabIndex={-1}
    aria-label={`${entry.desktop.title} · ${zh ? '智能体状态' : 'Agent status'}`} className="plugin-status-popover"
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, maxHeight: position?.height,
      visibility: position ? undefined : 'hidden' }}
    onToggle={event => {
      if (event.target === event.currentTarget && event.newState === 'closed' && !event.currentTarget.matches(':popover-open')) onClose();
    }}
    onBlur={event => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next) && !anchor.current?.contains(next)) onClose();
    }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if ((!event.shiftKey && document.activeElement === buttons.at(-1))
          || (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === panel.current))) {
          event.preventDefault(); close();
        }
      }
    }}>
    <header className="plugin-status-header">
      <h2>{entry.desktop.title}</h2>
      <button type="button" className="icon-button" aria-label={zh ? '关闭状态面板' : 'Close status panel'}
        data-tooltip={zh ? '关闭状态面板' : 'Close status panel'} onClick={close}><X size={16}/></button>
    </header>
    <div className="plugin-status-body">
      <PluginConnectionPanel bridge={bridge} packageRef={entry.plugin.package!.ref} language={language}
        active compact onGuide={onOpen}/>
    </div>
    <footer className="plugin-status-footer">
      <button type="button" onClick={() => { close(); onOpen(); }}>
        <ArrowUpRight size={15}/>{zh ? '打开完整工作台' : 'Open full workspace'}
      </button>
    </footer>
  </div>, document.body);
}
