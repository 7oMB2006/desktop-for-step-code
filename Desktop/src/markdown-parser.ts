import type { Root } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).freeze();
export type PreparedMarkdown = ReadonlyMap<string, Root>;

// Only an unambiguous single paragraph can skip the Markdown pipeline.
export function plainMarkdownParagraph(text: string): string | undefined {
  if (!/^[\p{L}\p{N}]/u.test(text) || /[^\p{L}\p{M}\p{N} .,;:!?\u3001\u3002\uFF01\uFF0C\uFF1A\uFF1B\uFF1F]/u.test(text)
    || /^\d{1,9}\.(?: |$)/.test(text) || /www\./i.test(text)) return;
  return text.trimEnd();
}

export function parseMarkdown(text: string): Root {
  return parser.parse(text);
}
