const rowSelector = '[data-order]';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const animations = new WeakMap<HTMLElement, Animation>();
const rows = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(rowSelector)];

export function capturePriorityRows(list: HTMLElement) {
  const top = list.getBoundingClientRect().top;
  return new Map(rows(list).map(row => [row.dataset.order!, row.getBoundingClientRect().top - top]));
}

function position(row: HTMLElement, target: number, from = target) {
  animations.get(row)?.cancel();
  const translate = (value: number) => `0 ${value}px`;
  row.style.translate = target ? translate(target) : '';
  if (Math.abs(from - target) < 1 || reducedMotion()) return;
  const animation = row.animate([{ translate: translate(from) }, { translate: translate(target) }],
    { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  animations.set(row, animation);
}

export function settlePriorityRows(list: HTMLElement, before: ReturnType<typeof capturePriorityRows>) {
  const items = rows(list);
  for (const row of items) position(row, 0);
  const top = list.getBoundingClientRect().top;
  const offsets = items.map(row => {
    const next = row.getBoundingClientRect().top - top;
    return (before.get(row.dataset.order!) ?? next) - next;
  });
  items.forEach((row, i) => position(row, 0, offsets[i]));
}

export function bindPriorityDrag(list: HTMLElement,
  reorder: (id: string, index: number, before: ReturnType<typeof capturePriorityRows>) => void) {
  type Drag = {
    handle: HTMLElement; row: HTMLElement; items: HTMLElement[]; tops: number[]; offsets: number[];
    pointer: number; startY: number; grab: number; height: number; source: number; destination: number;
    active: boolean; y: number;
  };
  let drag: Drag | undefined;
  const controller = new AbortController();
  const { signal } = controller;

  function preview(current: Drag) {
    const { row, items, tops, offsets, height, source } = current;
    const listRect = list.getBoundingClientRect();
    const cursor = current.y - listRect.top;
    const top = Math.max(0, Math.min(cursor - current.grab, listRect.height - height));
    let destination = source;
    for (let i = 0; i < items.length; i++) {
      const midpoint = tops[i] + items[i].offsetHeight / 2;
      if (i < source && cursor < midpoint) { destination = i; break; }
      if (i > source && cursor > midpoint) destination = i;
    }
    current.destination = destination;
    // Measure against stationary slots so a shifting row cannot change its own hit target.
    const shifts = items.map((_, i) => i > source && i <= destination ? -height
      : i < source && i >= destination ? height : 0);
    const from = items.map((item, i) => shifts[i] === offsets[i] ? 0 : item.getBoundingClientRect().top - listRect.top - tops[i]);
    items.forEach((item, i) => {
      if (item !== row && shifts[i] !== offsets[i]) position(item, shifts[i], from[i]);
    });
    current.offsets = shifts;
    position(row, top - tops[source]);
  }

  function finish(commit = false) {
    const current = drag;
    if (!current) return;
    drag = undefined;
    const { handle, pointer, row, active, source, destination } = current;
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    if (!active) return;
    const before = capturePriorityRows(list);
    delete row.dataset.orderDragging;
    if (commit && source !== destination) reorder(row.dataset.order!, destination, before);
    else settlePriorityRows(list, before);
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
    drag = { handle, row, items, tops: items.map(item => item.offsetTop), offsets: items.map(() => 0),
      pointer: event.pointerId, startY: event.clientY, grab: event.clientY - row.getBoundingClientRect().top,
      height: row.offsetHeight, source, destination: source, active: false, y: event.clientY };
  }, { signal });
  list.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < 4) return;
    if (!drag.active) {
      drag.active = true;
      drag.row.dataset.orderDragging = '';
    }
    drag.y = event.clientY;
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
