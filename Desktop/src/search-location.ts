import { searchPattern } from './fulltext-search';
import { releaseConversationLayout } from './conversation-layout';
import { setTextHighlight } from './text-highlights';

function* searchableText(target: HTMLElement): Generator<Node> {
  const walker = target.ownerDocument.createTreeWalker(target, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('button, [inert], [aria-hidden=true], .large-message-controls')) yield node;
  }
}

function containsSearchText(target: HTMLElement, query: string): boolean {
  const expression = searchPattern(query);
  if (!expression) return false;
  for (const node of searchableText(target)) {
    expression.lastIndex = 0;
    if (expression.test(node.textContent ?? '')) return true;
  }
  return false;
}

export function searchMessageElement(root: HTMLElement | null, index: number, query = ''): HTMLElement | null {
  if (index < 0) return null;
  const blocks = [...root?.querySelectorAll<HTMLElement>(`.response-text[data-message-index="${index}"]`) ?? []];
  const targets = blocks.length ? blocks : [...root?.querySelectorAll<HTMLElement>(`[data-message-index="${index}"]`) ?? []];
  return targets.find(target => containsSearchText(target, query)) ?? targets[0] ?? null;
}

export function markSearchMessage(target: HTMLElement, text: string, name: string): { matched: boolean; cleanup: () => void } {
  target.dataset.searchMatch = 'true';
  const expression = searchPattern(text);
  const ranges: Range[] = [];
  if (expression) {
    for (const node of searchableText(target)) {
      for (const match of (node.textContent ?? '').matchAll(expression)) {
        const range = target.ownerDocument.createRange();
        range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        ranges.push(range);
        if (ranges.length >= 200) break;
      }
      if (ranges.length >= 200) break;
    }
  }
  const clearHighlight = typeof Highlight !== 'undefined'
    ? setTextHighlight(name, new Highlight(...ranges)) : () => {};
  return { matched: ranges.length > 0, cleanup: () => {
    clearHighlight();
    delete target.dataset.searchMatch;
  } };
}

export function revealSearchHighlight(name: string): DOMRect | undefined {
  const range = CSS.highlights?.get(name)?.values().next().value;
  if (!(range instanceof Range)) return;
  releaseConversationLayout(range.startContainer.parentElement);
  const page = range.startContainer.parentElement?.closest<HTMLElement>('.large-message-text > pre');
  if (page) {
    const match = range.getBoundingClientRect(), bounds = page.getBoundingClientRect();
    page.scrollTo({ top: page.scrollTop + match.top - bounds.top - (page.clientHeight - match.height) / 2, behavior: 'instant' });
  }
  return range.getBoundingClientRect();
}

export function scrollSearchMessage(viewport: HTMLElement, target: HTMLElement, match?: DOMRect) {
  releaseConversationLayout(viewport);
  const rect = match?.height ? match : target.getBoundingClientRect();
  const top = viewport.scrollTop + rect.top - viewport.getBoundingClientRect().top
    - (viewport.clientHeight - Math.min(rect.height, viewport.clientHeight)) / 2;
  viewport.scrollTo({ top, behavior: 'instant' });
}
