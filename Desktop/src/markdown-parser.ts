import type { Root } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).freeze();
export type PreparedMarkdown = ReadonlyMap<string, Root>;

export function parseMarkdown(text: string): Root {
  return parser.parse(text);
}
