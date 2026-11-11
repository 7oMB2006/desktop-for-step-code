import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { parseHTML } from 'linkedom';
import type { Options } from 'react-markdown';
import { blockRevealBatches, createMarkdownBlockReader, remarkPreparedBlock, sameRevealBatches } from '../src/markdown-blocks';
import { messageRemarkPlugins, messageRehypePlugins } from '../src/markdown-math';
import { rehypeStreamReveal } from '../src/stream-reveal';
import { remarkCommandReferences } from '../src/command-references';

function render(text: string, split: boolean, commands = false) {
  const blocks = split ? createMarkdownBlockReader()(text) : undefined;
  const options: Options = { skipHtml: true,
    remarkPlugins: [...messageRemarkPlugins!, ...(commands ? [[remarkCommandReferences, []] as [typeof remarkCommandReferences, []]] : [])],
    rehypePlugins: messageRehypePlugins };
  const html = renderToStaticMarkup(blocks ? createElement(Fragment, null, ...blocks.map(block =>
    createElement(Markdown, { ...options, key: block.key, children: block.text,
      remarkPlugins: [[remarkPreparedBlock, block.tree], ...options.remarkPlugins!] })))
    : createElement(Markdown, { ...options, children: text }));
  const { document } = parseHTML(`<html><body><main>${html}</main></body></html>`);
  // Separate React fragments need no inter-block formatting whitespace.
  return [...document.querySelector('main')!.childNodes]
    .filter(node => node.nodeType !== 3 || node.textContent?.trim()).map(node => node.toString()).join('');
}

const cases = [
  '# Heading\n\nParagraph **bold** and _emphasis_.\n\n---\n\nTail.',
  'Heading\n=======\n\nA paragraph\nwith a hard break.  \nAnother line.',
  '- one\n- two\n\n  continuation **bold**\n\n  ```js\n  const a = 1;\n  ```\n\n- three',
  '> Quote\n>\n> paragraph\n>\n> $$\n> x^2\n> $$\n\nOutside',
  '| A | B |\n| :- | -: |\n| x | ~~gone~~ |\n\n- [x] done\n- [ ] next',
  '```typescript\nconst one = 1;\n```\n\n```unknownlang\nsource\n```\n\n    indented code\n',
  '```math\nx^2\n```\n\n$E=mc^2$ and $$x^2$$.\n\n$$\n\\frac{a}{b}\n$$\n\nCost $20 and $30.',
  'First [later][ref] and ![image][picture].\n\n[ref]: https://example.com/ "Title"\n[picture]: data:image/png;base64,AAA',
  '[duplicate][r]\n\n[r]: https://first.example/\n[r]: https://second.example/',
  '[first][] and [second].\n\n[first]: /path/file.ts\n[second]: javascript:alert(1)',
  '<div>\nhidden HTML\n</div>\n\nVisible <b>inline</b> text.\n\n<script>alert(1)</script>',
  'Entities &amp; &lt; **quoted**. `https://example.com/`\n\nEmoji \u{1F680} /clm and /plugin.',
  'Paragraph /clm.\n\n[/clm][r]\n\n[r]: https://example.com/',
  'Reference[^note].\n\n[^note]: A footnote with **formatting**.',
  'Same[^a] and twice[^a].\n\n[^a]: Note.',
  '> [ref]: https://nested.example/\n\n[outside][ref].',
  '- Saved definition:\n\n  [picture]: https://example.com/picture.png\n\nOutside ![image][picture].',
  '[r]: https://first.example/\n\n> [r]: https://second.example/\n>\n> [inside][r]\n\n[outside][r]',
  '> [r]: https://first.example/\n\n[r]: https://second.example/\n\n[outside][r]',
];
for (const [index, text] of cases.entries()) {
  test(`block rendering retains complete Markdown semantics ${index}`, () => {
    assert.equal(render(text, true, true), render(text, false, true));
  });
  test(`partial streaming Markdown retains full-parser semantics ${index}`, () => {
    for (let end = 1; end <= text.length; end += 9) {
      const prefix = text.slice(0, end);
      assert.equal(render(prefix, true), render(prefix, false), `Prefix ${end}: ${prefix}`);
    }
  });
}

test('completed blocks retain identity and changed tails invalidate only their own rendering', () => {
  const read = createMarkdownBlockReader();
  const start = '# Heading\n\n```js\nconst a = 1;\n```\n\nMath $x^2$.\n\nTail';
  const before = read(start)!;
  const after = read(start + ' continues')!;
  assert.equal(after.length, 4);
  assert.equal(after[0], before[0]);
  assert.equal(after[1], before[1]);
  assert.equal(after[2], before[2]);
  assert.notEqual(after[3], before[3]);
  assert.equal(after[1].reveal, false);
  assert.equal(read(start + ' continues\n\nNew paragraph')![1], before[1]);
});

test('new global definitions invalidate prior blocks and authoritative replacements discard caches', () => {
  const read = createMarkdownBlockReader();
  const original = '[later][ref]\n\nUnrelated';
  const before = read(original)!;
  const after = read(original + '\n\n[ref]: https://example.com/')!;
  assert.notEqual(after[0], before[0]);
  assert.equal(after[0].tree.children.filter(node => node.type === 'definition').length, 1);
  assert.notEqual(read(original)![1], before[1]);
  assert.equal(read('Only[^note]\n\n[^note]: Text'), undefined);
  assert.ok(read('A new message'));
  const nested = '[nested][ref]\n\nStable';
  const nestedBefore = read(nested)!;
  const nestedAfter = read(nested + '\n\n> [ref]: https://nested.example/')!;
  assert.notEqual(nestedAfter[0], nestedBefore[0]);
  assert.equal(nestedAfter[0].tree.children.find(node => node.type === 'definition')?.url, 'https://nested.example/');
});

test('render plugins cannot mutate cached blocks or their shared definition context', () => {
  const read = createMarkdownBlockReader();
  const blocks = read('Math $x^2$.\n\n```math\nx^2\n```\n\n[r]: https://example.com/')!;
  const before = JSON.stringify(blocks);
  for (const block of blocks) renderToStaticMarkup(createElement(Markdown, {
    children: block.text, remarkPlugins: [[remarkPreparedBlock, block.tree], ...messageRemarkPlugins!],
    rehypePlugins: messageRehypePlugins,
  }));
  assert.equal(JSON.stringify(blocks), before);
});

test('reveal batches use local UTF-16 source offsets and never animate completed code', () => {
  const text = 'Old paragraph.\n\nNew \u{1F680} **text**.\n\n```js\nconst a = 1;\n```';
  const blocks = createMarkdownBlockReader()(text)!;
  const batches = [{ start: 21, end: text.length, id: 3, at: performance.now() }];
  assert.deepEqual(blockRevealBatches(blocks[0], batches), []);
  assert.deepEqual(blockRevealBatches(blocks[2], batches), []);
  const local = blockRevealBatches(blocks[1], batches);
  const html = renderToStaticMarkup(createElement(Markdown, {
    children: blocks[1].text,
    remarkPlugins: [[remarkPreparedBlock, blocks[1].tree], ...messageRemarkPlugins!],
    rehypePlugins: [...messageRehypePlugins!, [rehypeStreamReveal, { batches: local }]],
  }));
  assert.match(html, /\u{1F680}/u);
  assert.match(html, /stream-reveal/);
  assert.equal(sameRevealBatches(local, local.map(batch => ({ ...batch }))), true);
  assert.equal(sameRevealBatches(local, []), false);
});
