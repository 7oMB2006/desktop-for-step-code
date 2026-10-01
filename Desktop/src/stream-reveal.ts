import type { Element, Root, RootContent, Text } from 'hast';

export const REVEAL_DURATION = 180;
export type RevealBatch = { start: number; end: number; id: number; at: number };
export type RevealState = { text: string; active: boolean; nextId: number; batches: RevealBatch[] };

export function updateReveal(state: RevealState, text: string, active: boolean, now: number): RevealState {
  if (!active || !text.startsWith(state.text)) return { text, active, nextId: state.nextId, batches: [] };
  const batches = state.batches.filter(batch => now - batch.at < REVEAL_DURATION);
  if (text.length > state.text.length) {
    const previous = batches.at(-1);
    if (previous && now - previous.at < 40) {
      batches[batches.length - 1] = { ...previous, end: text.length };
    } else {
      batches.push({ start: state.text.length, end: text.length, id: state.nextId, at: now });
      return { text, active, nextId: state.nextId + 1, batches: batches.slice(-16) };
    }
  }
  return { text, active, nextId: state.nextId, batches };
}

// Source positions let Markdown keep its structure while only new plain text fades in.
export function rehypeStreamReveal({ batches }: { batches: RevealBatch[] }) {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const decorate = (node: Text): RootContent[] => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || source.slice(start, end) !== node.value) return [node];
      const result: RootContent[] = [];
      let cursor = start;
      for (const batch of batches) {
        let from = Math.max(start, batch.start);
        const to = Math.min(end, batch.end);
        if (from >= to) continue;
        // Never split a UTF-16 surrogate pair between faded and settled text.
        if (from > start && /[\uDC00-\uDFFF]/u.test(source[from])) from--;
        from = Math.max(cursor, from);
        if (from > cursor) result.push({ type: 'text', value: source.slice(cursor, from) });
        result.push({
          type: 'element', tagName: 'span',
          properties: { className: ['stream-reveal'], 'data-stream-batch': batch.id,
            style: `animation-delay: -${Math.max(0, Math.min(REVEAL_DURATION, performance.now() - batch.at))}ms` },
          children: [{ type: 'text', value: source.slice(from, to) }],
        });
        cursor = to;
      }
      if (cursor < end) result.push({ type: 'text', value: source.slice(cursor, end) });
      return result;
    };
    const walk = (node: Root | Element) => {
      if (node.type === 'element' && (['pre', 'code', 'math', 'svg'].includes(node.tagName)
        || (node.properties.className as string[] | undefined)?.includes('katex'))) return;
      node.children = node.children.flatMap(child => {
        if (child.type === 'text') return decorate(child);
        if (child.type === 'element') walk(child);
        return [child];
      }) as typeof node.children;
    };
    walk(tree);
  };
}
