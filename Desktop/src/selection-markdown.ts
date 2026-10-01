import { fencedSelection } from './chat-quotes';

export function selectionMarkdown(fragment: DocumentFragment, fallback: string): string {
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return [...node.childNodes].map(render).join('');
    if (node.matches('.code-header, .katex-html, .katex-mathml')) return '';
    if (node.matches('.katex')) {
      const formula = node.querySelector('annotation')?.textContent;
      return formula ? `$${formula}$` : '';
    }
    if (node.matches('pre')) {
      const code = node.querySelector('code');
      const language = /language-([\w+#.-]+)/.exec(code?.className ?? '')?.[1] ?? '';
      return `\n\n${fencedSelection(code?.textContent ?? node.textContent ?? '', language)}\n\n`;
    }
    const content = [...node.childNodes].map(render).join('');
    switch (node.tagName.toLowerCase()) {
      case 'strong': case 'b': return `**${content}**`;
      case 'em': case 'i': return `*${content}*`;
      case 'del': return `~~${content}~~`;
      case 'code': {
        const runs = [...content.matchAll(/`+/g)].map(match => match[0].length + 1);
        const fence = '`'.repeat(Math.max(1, ...runs));
        return `${fence} ${content} ${fence}`;
      }
      case 'a': {
        const href = node.getAttribute('href');
        return href && /^https?:\/\//i.test(href) ? `[${content}](${href})` : content;
      }
      case 'br': return '\n';
      case 'p': case 'div': return `\n\n${content}\n\n`;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        return `\n\n${'#'.repeat(Number(node.tagName[1]))} ${content}\n\n`;
      case 'li': {
        const parent = node.parentElement;
        const number = parent?.tagName === 'OL' ? [...parent.children].indexOf(node) + 1 : null;
        return `\n${number ? `${number}.` : '-'} ${content.trim()}\n`;
      }
      case 'ul': case 'ol': return `\n\n${content.trim()}\n\n`;
      case 'blockquote': return `\n\n${content.trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
      case 'tr': return `${content}\n`;
      case 'td': case 'th': return `${content}\t`;
      default: return content;
    }
  };
  return render(fragment).trim() || fallback;
}
