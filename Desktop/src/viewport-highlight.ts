type Job = { element: HTMLElement; run: () => void; visible: boolean };
const queues = new WeakMap<Document, ReturnType<typeof createQueue>>();

function selectionTouches(element: HTMLElement) {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  }
  return false;
}

function createQueue(document: Document) {
  const view = document.defaultView!;
  const jobs = new Map<HTMLElement, Job>();
  const pending = new Set<Job>();
  let frame = 0;
  let pointing = false;
  const ready = (job: Job) => job.visible && job.element.isConnected && !selectionTouches(job.element);
  const schedule = () => {
    if (!frame && !pointing && [...pending].some(ready)) frame = view.requestAnimationFrame(drain);
  };
  const observer = typeof view.IntersectionObserver === 'function' ? new view.IntersectionObserver(entries => {
    for (const entry of entries) {
      const job = jobs.get(entry.target as HTMLElement);
      if (!job) continue;
      job.visible = entry.isIntersecting;
      if (job.visible) pending.add(job);
      else pending.delete(job);
    }
    schedule();
  }, { rootMargin: '200px 0px' }) : undefined;
  const stop = () => {
    observer?.disconnect();
    view.cancelAnimationFrame(frame);
    frame = 0;
    document.removeEventListener('selectionchange', schedule);
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true);
    view.removeEventListener('blur', up);
    queues.delete(document);
  };
  const remove = (job: Job) => {
    if (jobs.get(job.element) !== job) return;
    jobs.delete(job.element);
    pending.delete(job);
    observer?.unobserve(job.element);
    if (!jobs.size) stop();
  };
  function drain() {
    frame = 0;
    if (pointing) return;
    const start = view.performance.now();
    try {
      for (const job of pending) {
        if (!ready(job)) continue;
        pending.delete(job);
        try { job.run(); } finally { remove(job); }
        // A single grammar invocation is not preemptible; bound batches, not individual blocks.
        if (view.performance.now() - start >= 4) break;
      }
    } finally { schedule(); }
  }
  function down() { pointing = true; }
  function up() { pointing = false; schedule(); }
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  view.addEventListener('blur', up);
  return {
    add(element: HTMLElement, run: () => void) {
      const job: Job = { element, run, visible: !observer };
      jobs.set(element, job);
      if (observer) observer.observe(element);
      else { pending.add(job); schedule(); }
      return () => remove(job);
    },
  };
}

export function observeCodeHighlight(element: HTMLElement, run: () => void) {
  const document = element.ownerDocument;
  if (!document.defaultView) return () => {};
  let queue = queues.get(document);
  if (!queue) { queue = createQueue(document); queues.set(document, queue); }
  return queue.add(element, run);
}

export function preserveCodeHighlightRanges(element: HTMLElement, change: () => void) {
  const document = element.ownerDocument;
  const view = document.defaultView!;
  const ranges = new Set<Range>();
  for (const highlight of view.CSS?.highlights?.values() ?? []) {
    for (const range of highlight) if (range instanceof view.Range) ranges.add(range);
  }
  const offset = (node: Node, position: number) => {
    if (!element.contains(node)) return undefined;
    const prefix = document.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(node, position);
    return prefix.toString().length;
  };
  const saved = [...ranges].map(range => ({
    range, start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset),
  })).filter(value => value.start !== undefined || value.end !== undefined);
  const locate = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(element, 4);
    let last: Node = element;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (offset <= length) return [node, offset];
      offset -= length;
      last = node;
    }
    return [last, last.textContent?.length ?? 0];
  };
  change();
  // CSS search/annotation highlights own live Ranges independently of native Selection.
  for (const { range, start, end } of saved) {
    if (start !== undefined) range.setStart(...locate(start));
    if (end !== undefined) range.setEnd(...locate(end));
  }
}
