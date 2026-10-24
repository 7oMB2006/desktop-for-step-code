export type ScrollIntent = 'backward' | 'forward' | 'tail';

export function followAfterScroll(following: boolean, distance: number, intent?: ScrollIntent): boolean {
  // Keep layout reflows tolerant while following, but never undo an explicit
  // upward gesture just because a short transcript is still near the bottom.
  if (intent === 'backward') return false;
  if (intent === 'tail') return true;
  return following || intent === undefined ? distance < 100 : distance <= 1;
}

export function scrollKeyIntent(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): ScrollIntent | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) return 'backward';
  if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) return 'forward';
  if (event.key === ' ') return event.shiftKey ? 'backward' : 'forward';
}


// Navigation markers and custom scroll handles are siblings of the viewport.
// Native wheel chaining cannot reach that sibling, so forward only their gestures.
export function scrollOverlayWheel(scroll: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey' | 'defaultPrevented' | 'preventDefault'>): boolean {
  if (event.ctrlKey || event.defaultPrevented || !event.deltaY || scroll.scrollHeight <= scroll.clientHeight) return false;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? scroll.clientHeight : 1);
  scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, scroll.scrollTop + delta));
  return true;
}
