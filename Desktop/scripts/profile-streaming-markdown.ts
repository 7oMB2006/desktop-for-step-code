import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown, { type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import type { Processor } from 'unified';
import { messageRemarkPlugins, messageRehypePlugins } from '../src/markdown-math';
import { rehypeStreamReveal } from '../src/stream-reveal';
import { blockRevealBatches, createMarkdownBlockReader, remarkPreparedBlock } from '../src/markdown-blocks';
import { markdownDeltas, markdownScenarios, streamingMarkdownCorpus } from '../tests/fixtures/streaming-markdown-corpus';

const segmented = process.env.DESKTOP_MARKDOWN_PROFILE_BLOCKS === '1';
const reports = [];
for (const kind of markdownScenarios) {
  const source = streamingMarkdownCorpus(kind);
  assert.ok(source.length < 32_768, 'Exercise the actual Markdown path, not paginated plain text');
  const totals: Record<string, number> = { blockReadMs: 0, parseMs: 0, remarkMs: 0, bridgeMs: 0,
    katexMs: 0, highlightSetupMs: 0, highlightMs: 0, revealMs: 0, reactAndSetupMs: 0 };
  const deltas = markdownDeltas(source);
  const read = createMarkdownBlockReader();
  let retained = new Set<unknown>();
  let renders = 0;
  let previous = 0;
  for (const text of deltas) {
    const readStart = performance.now();
    const blocks = segmented ? read(text) : undefined;
    totals.blockReadMs += performance.now() - readStart;
    const changed = blocks ? blocks.filter(block => !retained.has(block)) : [undefined];
    retained = new Set(blocks);
    for (const block of changed) {
      renders++;
      let last = 0;
      const mark = (name: string) => () => () => {
        const now = performance.now();
        totals[name] += now - last;
        last = now;
      };
      function profileParser(this: Processor) {
        const parse = this.parser!;
        this.parser = (document, file) => {
          const start = performance.now();
          const tree = parse(document, file);
          last = performance.now();
          totals.parseMs += last - start;
          return tree;
        };
      }
      function profileHighlight(this: Processor) {
        const start = performance.now();
        const highlight = messageRehypePlugins![1] as typeof rehypeHighlight;
        const transform = highlight.call(this);
        totals.highlightSetupMs += performance.now() - start;
        return transform;
      }
      const prepared: Options['remarkPlugins'] = block ? [[remarkPreparedBlock, block.tree]] : [];
      const batches = [{ start: previous, end: text.length, id: 0, at: performance.now() }];
      const start = performance.now();
      const before = Object.values(totals).reduce((sum, value) => sum + value, 0);
      renderToStaticMarkup(createElement(Markdown, {
        children: block?.text ?? text, skipHtml: true,
        remarkPlugins: [...prepared, profileParser, ...messageRemarkPlugins!, mark('remarkMs')],
        rehypePlugins: [mark('bridgeMs'), messageRehypePlugins![0], mark('katexMs'),
          profileHighlight, mark('highlightMs'),
          [rehypeStreamReveal, { batches: block ? blockRevealBatches(block, batches) : batches }], mark('revealMs')],
      }));
      const measured = Object.values(totals).reduce((sum, value) => sum + value, 0) - before;
      totals.reactAndSetupMs += performance.now() - start - measured;
    }
    previous = text.length;
  }
  const report = { kind, characters: source.length, updates: deltas.length, renders,
    ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * 10) / 10])) };
  reports.push(report);
  console.log(JSON.stringify(report));
}
await mkdir('test-results/streaming-markdown', { recursive: true });
await writeFile(`test-results/streaming-markdown/pipeline-profile${segmented ? '-blocks' : ''}.json`,
  JSON.stringify({ segmented, reports }, null, 2) + '\n');
