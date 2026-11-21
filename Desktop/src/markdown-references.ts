import type { Nodes, Root } from 'mdast';
import { sessionLinkRanges } from './session-reference';

export function standaloneWebAddress(value: string): string | undefined {
  if (value.length > 4096 || !/^https?:\/\/\S+$/i.test(value)) return;
  try {
    const url = new URL(value);
    if (url.username || url.password) return;
    return url.href;
  } catch { return; }
}

// A code-styled standalone address is still a reference, not a code sample.
export function remarkWebReferences() {
  return (tree: Root) => {
    const adapt = (node: Nodes): Nodes => {
      if (node.type === 'link' || node.type === 'linkReference') return node;
      if (node.type === 'inlineCode') {
        const url = standaloneWebAddress(node.value);
        if (url) return {
          type: 'link', url, position: node.position,
          children: [{ type: 'text', value: node.value }],
        };
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

export function remarkSessionReferences() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    if (!source.includes('stepcode-desktop://sessions/')) return;
    const visit = (node: Nodes) => {
      if (node.type === 'link' || node.type === 'linkReference' || !('children' in node)) return;
      const children = node.children as Nodes[];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.type !== 'text') { visit(child); continue; }
        const matches = sessionLinkRanges(child.value);
        if (!matches.length) continue;
        const start = child.position?.start;
        const end = child.position?.end;
        const pointAt = (offset: number) => {
          const lines = child.value.slice(0, offset).split('\n');
          return { offset: start!.offset! + offset, line: start!.line + lines.length - 1,
            column: lines.length === 1 ? start!.column + offset : lines.at(-1)!.length + 1 };
        };
        const textAt = (from: number, to: number) => ({
          type: 'text' as const, value: child.value.slice(from, to),
          position: start?.offset !== undefined && end?.offset !== undefined
            && source.slice(start.offset, end.offset) === child.value ? { start: pointAt(from), end: pointAt(to) } : undefined,
        });
        const replacement: Nodes[] = [];
        let from = 0;
        for (const link of matches) {
          if (from < link.from) replacement.push(textAt(from, link.from));
          replacement.push({ type: 'link', url: link.href, children: [textAt(link.from, link.to)] });
          from = link.to;
        }
        if (from < child.value.length) replacement.push(textAt(from, child.value.length));
        children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
      }
    };
    visit(tree);
  };
}
