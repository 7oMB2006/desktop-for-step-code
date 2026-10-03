import { useEffect, useRef, useState } from 'react';

type Drag = { id: string; kind: 'session' | 'workspace'; group: string; title: string; x: number; y: number; target?: string; after: boolean };
type Pending = { x: number; y: number; pointerId: number; timer: ReturnType<typeof setTimeout> };

export function useSidebarReorder(enabled: boolean, manualSessions: boolean, onMove: (id: string, target: string, after: boolean, kind: Drag['kind']) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const active = useRef<Drag | null>(null);
  const pending = useRef<Pending | null>(null);
  const suppressClick = useRef(false);
  const callback = useRef(onMove);
  callback.current = onMove;
  useEffect(() => {
    let frame = 0;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      active.current = null;
      setDrag(null);
      cancelAnimationFrame(frame);
    };
    const updateTarget = () => {
      const current = active.current;
      if (!current) return;
      const row = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>(`[data-reorder-kind="${current.kind}"]`);
      const valid = row?.dataset.reorderGroup === current.group && row.dataset.reorderId !== current.id;
      const next = { ...current, target: valid ? row!.dataset.reorderId : undefined,
        after: valid ? current.y > row!.getBoundingClientRect().top + row!.offsetHeight / 2 : false };
      active.current = next;
      setDrag(next);
    };
    const autoScroll = () => {
      const current = active.current;
      if (!current) return;
      const tree = document.querySelector<HTMLElement>('.workspace-tree');
      if (tree) {
        const rect = tree.getBoundingClientRect();
        if (current.x >= rect.left && current.x <= rect.right) {
          const speed = current.y < rect.top + 32 ? -8 : current.y > rect.bottom - 32 ? 8 : 0;
          if (speed) {
            const previousTop = tree.scrollTop;
            tree.scrollTop += speed;
            if (tree.scrollTop !== previousTop) updateTarget();
          }
        }
      }
      frame = requestAnimationFrame(autoScroll);
    };
    const down = (event: PointerEvent) => {
      suppressClick.current = false;
      if (!enabled || event.button !== 0 || !event.isPrimary) return;
      const button = (event.target as HTMLElement).closest<HTMLElement>('.session-row > button:first-child, .workspace-heading > .workspace-toggle');
      const row = button?.closest<HTMLElement>('[data-reorder-id]');
      if (!row || button?.hasAttribute('disabled')) return;
      const { reorderId: id, reorderGroup: group, reorderTitle: title, reorderKind: kind } = row.dataset;
      if (!id || !group || group === '__archived__') return;
      if (kind !== 'workspace' && (kind !== 'session' || !manualSessions)) return;
      pending.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId,
        timer: setTimeout(() => {
          if (!pending.current) return;
          active.current = { id, kind, group, title: title ?? '', x: event.clientX, y: event.clientY, after: false };
          suppressClick.current = true;
          window.getSelection()?.removeAllRanges();
          setDrag(active.current);
          frame = requestAnimationFrame(autoScroll);
        }, 280) };
    };
    const move = (event: PointerEvent) => {
      if (pending.current?.pointerId !== event.pointerId) return;
      if (!active.current) {
        if (Math.hypot(event.clientX - pending.current.x, event.clientY - pending.current.y) > 7) clear();
        return;
      }
      event.preventDefault();
      active.current = { ...active.current, x: event.clientX, y: event.clientY };
      updateTarget();
    };
    const up = (event: PointerEvent) => {
      if (suppressClick.current) clickTimer = setTimeout(() => { suppressClick.current = false; }, 0);
      if (pending.current?.pointerId !== event.pointerId) return;
      const current = active.current;
      clear();
      if (current?.target) callback.current(current.id, current.target, current.after, current.kind);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      event.preventDefault(); event.stopPropagation(); suppressClick.current = false;
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    const cancel = () => { clear(); suppressClick.current = false; };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('click', click, true);
    return () => {
      clear();
      clearTimeout(clickTimer);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('click', click, true);
    };
  }, [enabled, manualSessions]);
  return drag;
}
