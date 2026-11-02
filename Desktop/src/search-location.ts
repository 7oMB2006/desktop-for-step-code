import { searchTerms } from './fulltext-search';

export function searchMessageElement(root: HTMLElement | null, index: number): HTMLElement | null {
  if (index < 0) return null;
  return root?.querySelector<HTMLElement>(`.response-text[data-message-index="${index}"]`)
    ?? root?.querySelector<HTMLElement>(`[data-message-index="${index}"]`) ?? null;
}

export function markSearchMessage(target: HTMLElement, text: string, name: string): () => void {
  target.dataset.searchMatch = 'true';
  const terms = searchTerms(text).map(term => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  if (terms.length && typeof Highlight !== 'undefined' && CSS.highlights) {
    const expression = new RegExp(terms.join('|'), 'giu');
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const ranges: Range[] = [];
    for (let node = walker.nextNode(); node && ranges.length < 200; node = walker.nextNode()) {
      if (node.parentElement?.closest('button, [inert], [aria-hidden=true]')) continue;
      for (const match of (node.textContent ?? '').matchAll(expression)) {
        const range = document.createRange();
        range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        ranges.push(range);
        if (ranges.length >= 200) break;
      }
    }
    CSS.highlights.set(name, new Highlight(...ranges));
  }
  return () => {
    CSS.highlights?.delete(name);
    delete target.dataset.searchMatch;
  };
}

export function searchHighlightRect(name: string): DOMRect | undefined {
  const range = CSS.highlights?.get(name)?.values().next().value;
  return range instanceof Range ? range.getBoundingClientRect() : undefined;
}

export function scrollSearchMessage(viewport: HTMLElement, target: HTMLElement, match?: DOMRect) {
  const rect = match?.height ? match : target.getBoundingClientRect();
  const top = viewport.scrollTop + rect.top - viewport.getBoundingClientRect().top
    - (viewport.clientHeight - Math.min(rect.height, viewport.clientHeight)) / 2;
  viewport.scrollTo({ top, behavior: 'instant' });
}
