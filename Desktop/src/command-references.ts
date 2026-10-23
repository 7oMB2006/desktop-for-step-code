import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { decodeString } from 'micromark-util-decode-string';
import type { Nodes, Root } from 'mdast';
import type { ComposerCommand } from './composer-commands';

const parser = unified().use(remarkParse).use(remarkGfm);
const fallback: ComposerCommand[] = ['clm', 'clm-compact', 'plugin'].map(name => ({ name, source: 'core' }));
export interface CommandRange { name: string; source?: string; from: number; to: number }

function commandMatcher(commands: ComposerCommand[]) {
  const catalog = new Map([...fallback, ...commands].map(command => [command.name, command]));
  const names = [...catalog.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(^|\\s)/(${names.join('|')})(?=$|[\\s.,!?;，。！？；：、）)\\]}])`, 'gu');
  return (text: string): CommandRange[] => [...text.matchAll(pattern)].map(match => {
    const from = match.index + match[1].length, name = match[2];
    return { name, source: catalog.get(name)?.source, from, to: from + name.length + 1 };
  });
}

// Source positions keep editor decorations out of code, links and file paths.
export function commandRanges(text: string, commands: ComposerCommand[]): CommandRange[] {
  if (!text.includes('/')) return [];
  const excluded: { from: number; to: number }[] = [];
  const visit = (node: Nodes) => {
    if (['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'definition', 'html'].includes(node.type)) {
      const from = node.position?.start.offset, to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) excluded.push({ from, to });
      return;
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(parser.parse(text));
  return commandMatcher(commands)(text).filter(range => !excluded.some(item => range.from < item.to && range.to > item.from));
}

export function remarkCommandReferences(commands: ComposerCommand[]) {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const sourceRanges = commandRanges(source, commands);
    const visit = (node: Nodes) => {
      if (['link', 'linkReference', 'code', 'inlineCode', 'html'].includes(node.type) || !('children' in node)) return;
      const children = node.children as Nodes[];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.type !== 'text') { visit(child); continue; }
        const start = child.position?.start.offset, end = child.position?.end.offset;
        if (start === undefined || end === undefined) continue;
        // Markdown decoding changes offsets; match source first, then decode only the prefix.
        const ranges = sourceRanges.filter(range => range.from >= start && range.to <= end).map(range => {
          const from = decodeString(source.slice(start, range.from)).length;
          return { ...range, from, to: from + range.name.length + 1 };
        }).filter(range => child.value.slice(range.from, range.to) === `/${range.name}`);
        if (!ranges.length) continue;
        const replacements: Nodes[] = [];
        let offset = 0;
        for (const range of ranges) {
          if (range.from > offset) replacements.push({ type: 'text', value: child.value.slice(offset, range.from) });
          replacements.push({ type: 'text', value: child.value.slice(range.from, range.to),
            data: { hName: 'span', hProperties: { 'data-command': range.name, 'data-command-source': range.source ?? '' } } });
          offset = range.to;
        }
        if (offset < child.value.length) replacements.push({ type: 'text', value: child.value.slice(offset) });
        children.splice(index, 1, ...replacements);
        index += replacements.length - 1;
      }
    };
    visit(tree);
  };
}
