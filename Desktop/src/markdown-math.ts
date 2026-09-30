import type { Nodes, Root } from 'mdast';
import type { Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

export const MAX_FORMULA_LENGTH = 12000;

export function remarkChatMath() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const adapt = (node: Nodes): Nodes => {
      if (node.type === 'code' && node.lang === 'math') {
        // rehype-katex also renders math fences; keep all code fences as source.
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: ['language-latex'] } };
      }
      if (node.type === 'inlineMath' || node.type === 'math') {
        const start = node.position?.start.offset ?? 0;
        const end = node.position?.end.offset ?? start;
        const raw = source.slice(start, end);
        const dollars = raw.match(/^\$+/)?.[0].length ?? 0;
        const lastLine = raw.trimEnd().split('\n').at(-1)?.trim().replace(/^(?:>\s*)+/, '') ?? '';
        const closedBlock = /^\${2,}$/.test(lastLine) && lastLine.length >= dollars && raw.includes('\n');
        const currency = node.type === 'inlineMath' && dollars === 1
          && /^\d[\d,.]*(?:\s+[\p{L}\s,.;:!?]*)?$/u.test(node.value)
          && /^\d/.test(source.slice(end));
        if (node.value.length > MAX_FORMULA_LENGTH || currency || (node.type === 'math' && !closedBlock)) {
          const text = { type: 'text' as const, value: raw, position: node.position };
          return node.type === 'math' ? { type: 'paragraph', children: [text], position: node.position } : text;
        }
        if (node.type === 'inlineMath' && dollars >= 2) {
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: ['language-math', 'math-display'] } };
        }
      }
      if ('children' in node) {
        const children = node.children as Nodes[];
        for (let index = 0; index < children.length; index++) children[index] = adapt(children[index]);
      }
      return node;
    };
    adapt(tree);
  };
}

export const messageRemarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath, remarkChatMath];
export const messageRehypePlugins: Options['rehypePlugins'] = [
  [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }],
  rehypeHighlight,
];
