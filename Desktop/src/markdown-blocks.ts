import type { Nodes, Root, RootContent, Definition } from 'mdast';
import type { Processor } from 'unified';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { RevealBatch } from './stream-reveal';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).freeze();
export type MarkdownBlock = { key: number; text: string; tree: Root; from: number; to: number; reveal: boolean };

function documentContext(tree: Root) {
  const definitions: Definition[] = [];
  let footnotes = false;
  const visit = (node: Nodes) => {
    if (node.type === 'footnoteDefinition' || node.type === 'footnoteReference') footnotes = true;
    if (node.type === 'definition') {
      const { type, identifier, label, url, title } = node;
      definitions.push({ type, identifier, label, url, title });
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(tree);
  return { definitions, footnotes };
}

function localNode(node: RootContent): RootContent {
  const start = node.position!.start;
  if (start.offset === 0 && start.line === 1 && start.column === 1) return node;
  const result = structuredClone(node);
  const adjust = (item: Nodes) => {
    if (item.position) for (const point of [item.position.start, item.position.end]) {
      if (point.offset !== undefined) point.offset -= start.offset!;
      if (point.line === start.line) point.column -= start.column - 1;
      point.line -= start.line - 1;
    }
    if ('children' in item) item.children.forEach(adjust);
  };
  adjust(result);
  return result;
}

// Parse the whole document for Markdown dependencies; cache rendering, not guessed boundaries.
export function createMarkdownBlockReader() {
  let previous = '';
  let definitionsKey = '';
  type Cached = { node: RootContent; signature?: string; block: MarkdownBlock };
  let cached = new Map<number, Cached>();
  return (text: string): MarkdownBlock[] | undefined => {
    const tree = parser.parse(text);
    const { definitions, footnotes } = documentContext(tree);
    // Footnote numbering and its final section belong to one complete document.
    if (footnotes) { cached.clear(); previous = text; return; }
    const signature = JSON.stringify(definitions);
    if (!text.startsWith(previous) || signature !== definitionsKey) cached.clear();
    previous = text; definitionsKey = signature;
    const next = new Map<number, Cached>();
    const blocks: MarkdownBlock[] = [];
    for (const node of tree.children) {
      if (node.type === 'definition') continue;
      const from = node.position?.start.offset, to = node.position?.end.offset;
      if (from === undefined || to === undefined) { cached.clear(); return; }
      const source = text.slice(from, to);
      const old = cached.get(from);
      const entry = old?.block.text === source && (old.signature ??= JSON.stringify(old.node)) === JSON.stringify(node) ? old : {
        node,
        block: { key: from, from, to, text: source,
          // Global traversal order must win over a duplicate nested in this block.
          tree: { type: 'root' as const, children: [...definitions, localNode(node)] },
          reveal: !['code', 'math', 'html', 'thematicBreak'].includes(node.type) },
      };
      next.set(from, entry); blocks.push(entry.block);
    }
    cached = next;
    return blocks;
  };
}

// react-markdown retains its standard transforms, URL policy and component mapping.
export function remarkPreparedBlock(this: Processor, tree: Root) {
  this.parser = () => structuredClone(tree);
}

export function blockRevealBatches(block: MarkdownBlock, batches: RevealBatch[]): RevealBatch[] {
  if (!block.reveal) return [];
  return batches.filter(batch => batch.start < block.to && batch.end > block.from)
    .map(batch => ({ ...batch, start: Math.max(0, batch.start - block.from), end: Math.min(block.text.length, batch.end - block.from) }));
}

export function sameRevealBatches(left: RevealBatch[], right: RevealBatch[]) {
  return left.length === right.length && left.every((batch, index) => {
    const other = right[index];
    return batch.start === other.start && batch.end === other.end && batch.id === other.id && batch.at === other.at;
  });
}
