const rowSelector = '[data-order]';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const animations = new WeakMap<HTMLElement, Animation>();
const rows = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(rowSelector)];
export type OrderAxis = 'y' | 'x';

export function capturePriorityRows(list: HTMLElement, axis: OrderAxis = 'y') {
  const start = list.getBoundingClientRect()[axis];
  return new Map(rows(list).map(row => [row.dataset.order!, row.getBoundingClientRect()[axis] - start]));
}

function position(row: HTMLElement, target: number, from = target, axis: OrderAxis = 'y') {
  animations.get(row)?.cancel();
  const translate = (value: number) => axis === 'x' ? `${value}px 0` : `0 ${value}px`;
  row.style.translate = target ? translate(target) : '';
  if (Math.abs(from - target) < 1 || reducedMotion()) return;
  const animation = row.animate([{ translate: translate(from) }, { translate: translate(target) }],
    { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  animations.set(row, animation);
}

export function settlePriorityRows(list: HTMLElement, before: ReturnType<typeof capturePriorityRows>, axis: OrderAxis = 'y') {
  const items = rows(list);
  for (const row of items) position(row, 0, 0, axis);
  const start = list.getBoundingClientRect()[axis];
  const offsets = items.map(row => {
    const next = row.getBoundingClientRect()[axis] - start;
    return (before.get(row.dataset.order!) ?? next) - next;
  });
  items.forEach((row, i) => position(row, 0, offsets[i], axis));
}

export function bindPriorityDrag(list: HTMLElement,
  reorder: (id: string, index: number, before: ReturnType<typeof capturePriorityRows>) => void, axis: OrderAxis = 'y') {
  const horizontal = axis === 'x';
  const pointerPosition = (event: PointerEvent) => horizontal ? event.clientX : event.clientY;
  const size = (item: HTMLElement) => horizontal ? item.offsetWidth : item.offsetHeight;
  type Drag = {
    handle: HTMLElement; row: HTMLElement; items: HTMLElement[]; starts: number[]; offsets: number[];
    pointer: number; start: number; grab: number; extent: number; source: number; destination: number;
    active: boolean; cursor: number; scroll: number; gap: number;
  };
  let drag: Drag | undefined;
  let frame = 0;
  const controller = new AbortController();
  const { signal } = controller;

  function preview(current: Drag) {
    const { row, items, starts, offsets, extent, source, gap } = current;
    const listRect = list.getBoundingClientRect();
    const scrolled = horizontal ? list.scrollLeft - current.scroll : 0;
    const cursor = current.cursor - listRect[axis] + scrolled;
    const start = Math.max(starts[0], Math.min(cursor - current.grab, starts.at(-1)! + size(items.at(-1)!) - extent));
    let destination = source;
    for (let i = 0; i < items.length; i++) {
      const midpoint = starts[i] + size(items[i]) / 2;
      if (i < source && cursor < midpoint) { destination = i; break; }
      if (i > source && cursor > midpoint) destination = i;
    }
    current.destination = destination;
    // Measure against stationary slots so a shifting row cannot change its own hit target.
    const shifts = items.map((_, i) => i > source && i <= destination ? -(extent + gap)
      : i < source && i >= destination ? extent + gap : 0);
    const from = items.map((item, i) => shifts[i] === offsets[i] ? 0 : item.getBoundingClientRect()[axis] - listRect[axis] + scrolled - starts[i]);
    items.forEach((item, i) => {
      if (item !== row && shifts[i] !== offsets[i]) position(item, shifts[i], from[i], axis);
    });
    current.offsets = shifts;
    position(row, start - starts[source], start - starts[source], axis);
  }

  function scrollEdges() {
    if (!drag?.active) return;
    const { left, right } = list.getBoundingClientRect();
    if (drag.cursor >= left && drag.cursor <= right) {
      const step = drag.cursor < left + 22 ? -7 : drag.cursor > right - 22 ? 7 : 0;
      if (step) list.scrollLeft += step;
    }
    frame = requestAnimationFrame(scrollEdges);
  }

  function finish(commit = false) {
    const current = drag;
    if (!current) return;
    drag = undefined;
    cancelAnimationFrame(frame);
    const { handle, pointer, row, active, source, destination } = current;
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    if (!active) return;
    const before = capturePriorityRows(list, axis);
    delete row.dataset.orderDragging;
    if (commit && source !== destination) reorder(row.dataset.order!, destination, before);
    else settlePriorityRows(list, before, axis);
  }

  list.addEventListener('pointerdown', event => {
    if (drag || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    const handle = event.target.closest<HTMLElement>('[data-order-grip]');
    const row = handle?.closest<HTMLElement>(rowSelector);
    if (!handle || !row || handle.getAttribute('aria-disabled') === 'true') return;
    const items = rows(list);
    const source = items.indexOf(row);
    if (items.length < 2 || source < 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    for (const item of items) position(item, 0, 0, axis);
    const starts = items.map(item => item.getBoundingClientRect()[axis] - list.getBoundingClientRect()[axis]);
    const cursor = pointerPosition(event);
    drag = { handle, row, items, starts, offsets: items.map(() => 0), pointer: event.pointerId,
      start: cursor, grab: cursor - row.getBoundingClientRect()[axis], extent: size(row), source,
      destination: source, active: false, cursor, scroll: list.scrollLeft, gap: horizontal ? starts[1] - starts[0] - size(items[0]) : 0 };
  }, { signal });
  list.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    if (!drag.active && Math.abs(pointerPosition(event) - drag.start) < 4) return;
    if (!drag.active) {
      drag.active = true;
      drag.row.dataset.orderDragging = '';
      if (horizontal) frame = requestAnimationFrame(scrollEdges);
    }
    drag.cursor = pointerPosition(event);
    preview(drag);
  }, { signal });
  list.addEventListener('pointerup', event => {
    if (drag?.pointer !== event.pointerId) return;
    const rect = list.getBoundingClientRect();
    finish(event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
  }, { signal });
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    list.addEventListener(type, event => { if (drag?.pointer === event.pointerId) finish(); }, { signal });
  }
  window.addEventListener('scroll', () => { if (drag?.active) preview(drag); }, { capture: true, signal });
  window.addEventListener('blur', () => finish(), { signal });
  window.addEventListener('keydown', event => {
    if (!drag || event.isComposing || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  }, { capture: true, signal });
  return () => { controller.abort(); finish(); };
}
