import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import type { Root } from 'mdast';
import type { Message } from '../src/contracts';
import { parseMarkdown } from '../src/markdown-parser';
import { historyMarkdownTexts, prepareHistoryMarkdown } from '../src/markdown-preparation';
import { remarkPreparedBlock } from '../src/markdown-blocks';
import { messageRemarkPlugins, messageRehypePlugins } from '../src/markdown-math';
import { remarkCommandReferences } from '../src/command-references';

function render(text: string, tree?: Root) {
  return renderToStaticMarkup(createElement(Markdown, {
    children: text, skipHtml: true,
    remarkPlugins: [...(tree ? [[remarkPreparedBlock, tree] as [typeof remarkPreparedBlock, Root]] : []),
      ...messageRemarkPlugins!, [remarkCommandReferences, []]],
    rehypePlugins: messageRehypePlugins,
  }));
}

for (const text of [
  '# Header\n\n**Strong** and _emphasis_, ~~deleted~~, `inline`.\n\n- [x] Done\n- [ ] Next',
  '| A | B |\n| :- | -: |\n| `x` | **y** |\n\n> Nested\n>\n> - list\n> - items',
  '[later][ref] and ![picture][pic]\n\n[ref]: https://example.com/ "Title"\n[pic]: data:image/png;base64,AAA',
  '> [r]: https://first.example/\n\n[r]: https://second.example/\n\n[outside][r]',
  'Reference[^a] twice[^a] and [^b].\n\n[^a]: **First**\n\n[^b]: Second',
  'Math $x^2$ and $$x^2$$.\n\n$$\n\\frac{a}{b}\n$$\n\nCost $20 and $30.\n\n```math\nx^2\n```',
  '````typescript\nconst text = "<script> & hello";\n````\n\n```unknown\n<source>\n```',
  '<script>alert(1)</script>\n\nUnsafe [URL](javascript:alert%281%29) and `https://example.com/`.',
  'Unicode \u{1F680} and /clm.\n\n[link](https://example.com/) <b>not trusted HTML</b>.',
  'Entities &amp; &NotEqualTilde; &Afr; &colon; &notit; &#x1F680; &#0; &#xD800;.\n\n[unsafe](javascript&colon;alert%281%29)',
]) {
  test(`prepared Markdown retains the complete rendering pipeline: ${text.slice(0, 26)}`, () => {
    const tree = parseMarkdown(text), source = JSON.stringify(tree);
    assert.equal(render(text, tree), render(text));
    assert.equal(render(text, tree), render(text), 'Repeated rendering must not mutate prepared input');
    assert.equal(JSON.stringify(tree), source);
    for (let end = 1; end < text.length; end += 11) {
      const prefix = text.slice(0, end);
      assert.equal(render(prefix, parseMarkdown(prefix)), render(prefix));
    }
  });
}

test('history preparation only includes bounded visible-role source and deduplicates it', () => {
  const text = 'Markdown **source**. '.repeat(30);
  assert.deepEqual(historyMarkdownTexts([
    { role: 'assistant', content: [{ type: 'thinking', thinking: text }, { type: 'text', text }] },
    { role: 'user', content: text }, { role: 'toolResult', content: text },
    { role: 'assistant', content: 'short' },
    { role: 'assistant', content: 'x'.repeat(32_769) },
  ]), [text]);
  assert.deepEqual(historyMarkdownTexts(Array.from({ length: 200 }, (_, index) => ({
    role: 'assistant', content: `${index} ${'x'.repeat(30_000)}`,
  }))), [], 'Oversized work must use the existing synchronous fallback, not retain an unbounded AST cache');
});

const history: Message[] = Array.from({ length: 20 }, (_, index) => ({
  role: 'assistant', content: `# ${index}\n\n${'A paragraph **with formatting**. '.repeat(300)}`,
}));

test('short histories and already-cancelled work never start a Worker', async () => {
  assert.equal(await prepareHistoryMarkdown(history.slice(0, 1), new AbortController().signal), undefined);
  const controller = new AbortController(); controller.abort();
  assert.equal(await prepareHistoryMarkdown(history, controller.signal), undefined);
});

test('optional Worker failure falls back; cancellation terminates work and late results cannot win', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
    else Reflect.deleteProperty(globalThis, 'Worker');
  });
  let instance: FakeWorker;
  class FakeWorker {
    onmessage?: (event: { data: [string, Root][] }) => void;
    onerror?: (event: { preventDefault: () => void }) => void;
    onmessageerror?: () => void;
    terminated = 0;
    sent: string[] = [];
    constructor() { instance = this; }
    postMessage(texts: string[]) { this.sent = texts; }
    terminate() { this.terminated++; }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
  const success = prepareHistoryMarkdown(history, new AbortController().signal);
  assert.deepEqual(instance!.sent, historyMarkdownTexts(history));
  const entries: [string, Root][] = instance!.sent.map(text => [text, parseMarkdown(text)]);
  instance!.onmessage!({ data: entries });
  assert.deepEqual([...(await success)!], entries);
  assert.equal(instance!.terminated, 1);

  const controller = new AbortController();
  const cancelled = prepareHistoryMarkdown(history, controller.signal);
  const cancelledWorker = instance!;
  controller.abort();
  assert.equal(await cancelled, undefined);
  assert.equal(cancelledWorker.terminated, 1);
  cancelledWorker.onmessage!({ data: entries });
  assert.equal(await cancelled, undefined);
  assert.equal(cancelledWorker.terminated, 1);

  const failure = prepareHistoryMarkdown(history, new AbortController().signal);
  let prevented = false;
  instance!.onerror!({ preventDefault: () => { prevented = true; } });
  assert.equal(await failure, undefined);
  assert.equal(prevented, true);
  assert.equal(instance!.terminated, 1);

  const decodeFailure = prepareHistoryMarkdown(history, new AbortController().signal);
  instance!.onmessageerror!();
  assert.equal(await decodeFailure, undefined);

  const malformed = prepareHistoryMarkdown(history, new AbortController().signal);
  instance!.onmessage!({ data: [] });
  assert.equal(await malformed, undefined);

  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class {
    constructor() { throw new Error('Worker blocked'); }
  } });
  assert.equal(await prepareHistoryMarkdown(history, new AbortController().signal), undefined);
});

test('a hung optional Worker has a bounded fallback deadline', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
    else Reflect.deleteProperty(globalThis, 'Worker');
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let terminated = 0;
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class {
    postMessage() {}
    terminate() { terminated++; }
  } });
  const pending = prepareHistoryMarkdown(history, new AbortController().signal);
  t.mock.timers.tick(5000);
  assert.equal(await pending, undefined);
  assert.equal(terminated, 1);
});
