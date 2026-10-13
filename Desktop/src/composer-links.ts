import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);
type Node = Root | RootContent;
function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  if ('children' in node) for (const child of node.children) walk(child, visit);
}
function label(node: Node): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  return 'children' in node ? node.children.map(label).join('') : '';
}

export function composerLinkRanges(draft: string): { href: string; label: string; from: number; to: number }[] {
  if (!draft.includes('://') || draft.length > 64000) return [];
  const root = parser.parse(draft);
  const definitions = new Map<string, string>();
  walk(root, node => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });
  const links: { href: string; label: string; from: number; to: number }[] = [];
  walk(root, node => {
    if (node.type !== 'link' && node.type !== 'linkReference') return;
    const href = node.type === 'link' ? node.url : definitions.get(node.identifier);
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (!href || href.length > 2048 || links.length >= 32 || from === undefined || to === undefined) return;
    try {
      const url = new URL(href);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
      const text = label(node);
      links.push({ href: url.href, from, to, label: text && text !== href
        ? text : `${url.host}${url.pathname === '/' ? '' : url.pathname}` });
    } catch { /* Incomplete input remains ordinary editable text. */ }
  });
  return links;
}

export function composerLinks(draft: string): { href: string; label: string }[] {
  const links = new Map<string, { href: string; label: string }>();
  for (const { href, label } of composerLinkRanges(draft)) if (!links.has(href)) links.set(href, { href, label });
  return [...links.values()];
}
