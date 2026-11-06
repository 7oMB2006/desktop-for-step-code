import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm);
const escape = value => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);

/** Keep CommonMark/GFM, but never turn model HTML into Feishu mentions or media. */
export function remoteMarkdown(text) {
  const tree = parser.parse(text), edits = [], splits = [];
  let tables = 0;
  const visit = node => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (node.type === 'html') {
        edits.push({ start, end, text: escape(text.slice(start, end)) });
        return;
      }
      if (node.type === 'image' || node.type === 'imageReference') {
        edits.push({ start, end, text: escape(node.alt || '[image / 图片]') });
        return;
      }
      if ((node.type === 'link' || node.type === 'definition') && !/^https?:\/\//i.test(node.url)) {
        edits.push({ start, end, text: escape(text.slice(start, end)).replace(/[[\]()`*_]/g, char => `&#${char.charCodeAt(0)};`) });
        return;
      }
      // Feishu permits at most four Markdown tables per component.
      if (node.type === 'table' && ++tables > 4) { splits.push(start); tables = 1; }
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  const render = (start, end) => {
    let result = '', cursor = start;
    for (const edit of edits) if (edit.start >= start && edit.end <= end) {
      result += text.slice(cursor, edit.start) + edit.text; cursor = edit.end;
    }
    return result + text.slice(cursor, end);
  };
  return [...splits, text.length].map((end, index) => render(index ? splits[index - 1] : 0, end));
}
