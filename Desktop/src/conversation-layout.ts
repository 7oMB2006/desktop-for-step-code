type LayoutWindow = { begin: () => void; release: () => void; followTail: () => void; afterLayout: (action: () => void) => () => void };
const windows = new WeakMap<HTMLElement, LayoutWindow>();
const minimumRows = 80;

function layoutWindow(element: Element | null) {
  const viewport = element?.closest<HTMLElement>('.conversation')
    ?? element?.closest('.app')?.querySelector<HTMLElement>('.conversation');
  return viewport ? windows.get(viewport) : undefined;
}

export function beginConversationLayout(element: Element | null) {
  layoutWindow(element)?.begin();
}

export function releaseConversationLayout(element: Element | null) {
  layoutWindow(element)?.release();
}

export function followConversationTail(viewport: HTMLElement) {
  const window = windows.get(viewport);
  if (window) window.followTail();
  else viewport.scrollTop = viewport.scrollHeight;
}

export function afterConversationLayout(element: Element | null, action: () => void): () => void {
  const window = layoutWindow(element);
  if (window) return window.afterLayout(action);
  action();
  return () => {};
}

/** Keep real, mounted history at its measured width until a width gesture settles. */
export function observeConversationLayout(viewport: HTMLElement, content: HTMLElement, following: () => boolean) {
  const root = viewport.closest<HTMLElement>('.app');
  const document = viewport.ownerDocument;
  const view = document.defaultView;
  if (!root || !view) return () => {};
  type Anchor = { element?: HTMLElement; offset: number; top: number; follow: boolean };
  type Locked = { element: HTMLElement; width: string; priority: string };
  let locked: Locked[] = [];
  let anchor: Anchor | undefined;
  let motion: { width: number; position: Anchor } | undefined;
  let members: HTMLElement[] | undefined;
  let expectedTop = viewport.scrollTop;
  let expectedWidth = 0;
  let blocked = false;
  let disposed = false;
  let firstFrame = 0, secondFrame = 0;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const transitions = new Map<Element, Set<string>>();
  const pending = new Set<() => void>();
  const articles = () => [...content.querySelectorAll<HTMLElement>(':scope > article[data-message-index]')];
  const sameMembers = (elements: HTMLElement[]) => members?.length === elements.length
    && members.every((element, index) => element === elements[index]);
  const followTail = () => {
    viewport.scrollTop = viewport.scrollHeight;
    // Live text follows before ResizeObserver runs; this is not user input.
    expectedTop = viewport.scrollTop;
  };
  const capture = (rows?: { element: HTMLElement; rect: DOMRect }[]): Anchor => {
    const top = viewport.getBoundingClientRect().top;
    let element = rows?.find(row => row.rect.bottom > top)?.element;
    if (!rows) {
      const elements = articles();
      let low = 0, high = elements.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (elements[middle].getBoundingClientRect().bottom > top) high = middle;
        else low = middle + 1;
      }
      element = elements[low];
    }
    return { element, offset: element ? element.getBoundingClientRect().top - top : 0,
      top: viewport.scrollTop, follow: following() };
  };
  const restore = (position: Anchor) => {
    if (!content.isConnected || !viewport.clientHeight) return;
    const bounds = viewport.getBoundingClientRect();
    expectedWidth = bounds.width;
    if (position.follow) followTail();
    else if (position.element?.isConnected && content.contains(position.element)) {
      // Settle viewport geometry before sampling the anchor, then read scrollTop.
      const shift = position.element.getBoundingClientRect().top
        - bounds.top - position.offset;
      viewport.scrollTop = viewport.scrollTop + shift;
    } else viewport.scrollTop = position.top;
    expectedTop = viewport.scrollTop;
  };
  const finish = (preserveAnchor = false) => {
    if (!locked.length) return;
    const position = content.isConnected && viewport.clientHeight
      ? (preserveAnchor ? anchor : capture()) : undefined;
    // Restore every width before reading geometry: one final reflow, no estimates.
    for (const { element, width, priority } of locked) {
      if (width) element.style.setProperty('width', width, priority);
      else element.style.removeProperty('width');
      element.removeAttribute('data-layout-locked');
    }
    locked = [];
    anchor = undefined;
    delete viewport.dataset.layoutWindow;
    if (position) restore(position);
  };
  const begin = () => {
    if (disposed || blocked || locked.length || !viewport.clientHeight) return;
    const elements = articles();
    if (motion && !sameMembers(elements)) { release(); return; }
    if (elements.length < minimumRows) return;
    const selection = view.getSelection();
    if (selection && !selection.isCollapsed && (content.contains(selection.anchorNode) || content.contains(selection.focusNode))) return;
    const bounds = viewport.getBoundingClientRect();
    const rows = elements.map(element => ({ element, rect: element.getBoundingClientRect() }));
    const position = motion?.position ?? capture(rows);
    const anchored = rows.find(row => row.element === position.element);
    const shift = position.follow ? Math.max(0, viewport.scrollHeight - viewport.clientHeight) - viewport.scrollTop
      : anchored ? anchored.rect.top - bounds.top - position.offset : 0;
    const offscreen = rows.filter(({ element, rect }, index) => index < rows.length - 2 && rect.width > 0
      && !element.contains(document.activeElement) && !element.classList.contains('response-active')
      && (rect.bottom - shift < bounds.top - bounds.height || rect.top - shift > bounds.bottom + bounds.height));
    locked = offscreen.map(({ element }) => ({ element, width: element.style.getPropertyValue('width'),
      priority: element.style.getPropertyPriority('width') }));
    for (const { element, rect } of offscreen) {
      element.style.setProperty('width', `${rect.width}px`);
      element.dataset.layoutLocked = '';
    }
    if (!locked.length) return;
    members = elements;
    anchor = position;
    viewport.dataset.layoutWindow = '';
    restore(position);
  };
  const isLayoutTransition = (target: EventTarget | null, property: string) => {
    if (!(target instanceof view.Element)) return false;
    if (property === 'max-width') return target === content;
    if (property !== 'flex-basis') return false;
    return target === root || target.parentElement === root && [...target.classList].some(name => name.endsWith('-track'));
  };
  const dragging = () => root.hasAttribute('data-panel-drag');
  const pruneTransitions = () => {
    for (const target of transitions.keys()) if (!target.isConnected) transitions.delete(target);
  };
  const scheduleFinish = () => {
    view.cancelAnimationFrame(firstFrame); view.cancelAnimationFrame(secondFrame);
    firstFrame = view.requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = view.requestAnimationFrame(() => {
        secondFrame = 0;
        pruneTransitions();
        if (dragging() || transitions.size) return;
        finish(true);
        motion = undefined;
        members = undefined;
        blocked = false;
        const actions = [...pending]; pending.clear();
        if (content.isConnected && viewport.clientHeight) actions.forEach(action => action());
      });
    });
  };
  const release = (cancelPending = true) => {
    if (cancelPending) pending.clear();
    blocked = true; finish(); motion = undefined; members = undefined; scheduleFinish();
  };
  const key = (event: TransitionEvent) => `${event.propertyName}:${event.pseudoElement}`;
  const run = (event: TransitionEvent) => {
    if (!isLayoutTransition(event.target, event.propertyName)) return;
    if (!transitions.size && !blocked && !locked.length) {
      const elements = articles();
      if (elements.length >= minimumRows) {
        members = elements;
        motion = { width: content.getBoundingClientRect().width, position: capture() };
      }
    }
    const target = event.target as Element;
    const properties = transitions.get(target) ?? new Set<string>();
    properties.add(key(event)); transitions.set(target, properties);
    clearTimeout(fallback);
    // Removed surfaces need not dispatch transitionend.
    fallback = setTimeout(() => {
      transitions.clear();
      scheduleFinish();
    }, 1000);
  };
  const end = (event: TransitionEvent) => {
    if (!isLayoutTransition(event.target, event.propertyName)) return;
    const properties = transitions.get(event.target as Element);
    properties?.delete(key(event));
    if (!properties?.size) transitions.delete(event.target as Element);
    if (!transitions.size) clearTimeout(fallback);
    scheduleFinish();
  };
  const attributes = new view.MutationObserver(() => {
    if (dragging()) begin();
    else scheduleFinish();
  });
  attributes.observe(root, { attributes: true, attributeFilter: ['data-panel-drag'] });
  const membership = new view.MutationObserver(() => {
    if ((locked.length || motion) && !sameMembers(articles())) release();
  });
  membership.observe(content, { childList: true });
  const resize = new view.ResizeObserver(() => {
    // Spare horizontal space can absorb a sidebar transition without reflow.
    if (motion && Math.abs(content.getBoundingClientRect().width - motion.width) > .5) begin();
    if (anchor && locked.length) restore(anchor);
  });
  resize.observe(content); resize.observe(viewport);
  const scroll = () => {
    if (!locked.length || Math.abs(viewport.scrollTop - expectedTop) <= 2) return;
    // Native layout scrolling can arrive before the corresponding resize callback.
    if (anchor && viewport.getBoundingClientRect().width !== expectedWidth) restore(anchor);
    else release();
  };
  const pointer = (event: Event) => { if (event.target instanceof view.Node && viewport.contains(event.target)) release(); };
  const input = () => release();
  const visibility = () => { if (document.hidden) release(); };
  const selected = () => {
    const selection = view.getSelection();
    if (selection && !selection.isCollapsed && (content.contains(selection.anchorNode) || content.contains(selection.focusNode))) release();
  };
  root.addEventListener('transitionrun', run);
  root.addEventListener('transitionend', end);
  root.addEventListener('transitioncancel', end);
  root.addEventListener('keydown', input, true);
  root.addEventListener('pointerdown', pointer, true);
  viewport.addEventListener('wheel', input, { capture: true, passive: true });
  viewport.addEventListener('touchstart', input, { capture: true, passive: true });
  viewport.addEventListener('focusin', input);
  viewport.addEventListener('scroll', scroll, { passive: true });
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('selectionchange', selected);
  view.addEventListener('resize', input);
  const window = { begin, release, followTail, afterLayout: (action: () => void) => {
    pending.clear();
    pending.add(action);
    release(false);
    return () => { pending.delete(action); };
  } };
  windows.set(viewport, window);
  return () => {
    if (disposed) return;
    disposed = true;
    pending.clear();
    view.cancelAnimationFrame(firstFrame); view.cancelAnimationFrame(secondFrame);
    clearTimeout(fallback);
    attributes.disconnect(); membership.disconnect(); resize.disconnect();
    root.removeEventListener('transitionrun', run);
    root.removeEventListener('transitionend', end);
    root.removeEventListener('transitioncancel', end);
    root.removeEventListener('keydown', input, true);
    root.removeEventListener('pointerdown', pointer, true);
    viewport.removeEventListener('wheel', input, true);
    viewport.removeEventListener('touchstart', input, true);
    viewport.removeEventListener('focusin', input);
    viewport.removeEventListener('scroll', scroll);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('selectionchange', selected);
    view.removeEventListener('resize', input);
    if (windows.get(viewport) === window) windows.delete(viewport);
    finish();
  };
}
