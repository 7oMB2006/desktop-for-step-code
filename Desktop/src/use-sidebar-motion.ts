import { useLayoutEffect, useRef } from 'react';

export function useSidebarMotion(layoutKey: string) {
  const tree = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const root = tree.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>('[data-reorder-id]')];
    const next = new Map<string, DOMRect>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rows.forEach(row => row.getAnimations().forEach(animation => animation.cancel()));
    const bounds = root.getBoundingClientRect();
    rows.forEach(row => {
      const rect = row.getBoundingClientRect();
      next.set(`${row.dataset.reorderKind}:${row.dataset.reorderId}`,
        new DOMRect(rect.left - bounds.left, rect.top - bounds.top + root.scrollTop, rect.width, rect.height));
    });
    for (const row of rows) {
      const id = `${row.dataset.reorderKind}:${row.dataset.reorderId}`;
      const old = positions.current.get(id);
      const rect = next.get(id)!;
      if (!old || reduced || !rect.height) continue;
      const x = old.left - rect.left, y = old.top - rect.top;
      if (Math.abs(x) + Math.abs(y) < 1) continue;
      // Sessions inherit their project group's displacement; do not apply it twice.
      const parent = row.dataset.reorderKind === 'session' ? row.closest<HTMLElement>('.workspace-group[data-reorder-id]') : null;
      const parentOld = parent && positions.current.get(`workspace:${parent.dataset.reorderId}`);
      const parentRect = parent && next.get(`workspace:${parent.dataset.reorderId}`);
      const parentX = parentOld && parentRect ? parentOld.left - parentRect.left : 0;
      const parentY = parentOld && parentRect ? parentOld.top - parentRect.top : 0;
      row.animate([{ transform: `translate(${x - parentX}px, ${y - parentY}px)` }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
    positions.current = next;
  }, [layoutKey]);
  return tree;
}
