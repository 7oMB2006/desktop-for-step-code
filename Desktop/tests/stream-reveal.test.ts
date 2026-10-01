import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { messageRemarkPlugins, messageRehypePlugins } from '../src/markdown-math';
import { rehypeStreamReveal, updateReveal, REVEAL_DURATION, type RevealState } from '../src/stream-reveal';

const initial = (): RevealState => ({ text: '', active: false, nextId: 0, batches: [] });
const render = (text: string, start: number) => renderToStaticMarkup(createElement(Markdown, {
  children: text, skipHtml: true, remarkPlugins: messageRemarkPlugins,
  rehypePlugins: [...messageRehypePlugins!, [rehypeStreamReveal, {
    batches: [{ start, end: text.length, id: 0, at: performance.now() }],
  }]],
}));

test('rapid deltas share a batch, older text is not replayed and metadata is bounded', () => {
  let state = updateReveal(initial(), 'Old', false, 0);
  state = updateReveal(state, 'Old new', true, 10);
  assert.deepEqual(state.batches, [{ start: 3, end: 7, id: 0, at: 10 }]);
  state = updateReveal(state, 'Old newer', true, 30);
  assert.deepEqual(state.batches, [{ start: 3, end: 9, id: 0, at: 10 }]);
  state = updateReveal(state, 'Old newer!', true, 60);
  assert.equal(state.batches.length, 2);
  assert.deepEqual(updateReveal(state, state.text, true, 60 + REVEAL_DURATION).batches, []);
  assert.deepEqual(updateReveal(state, 'Authoritative replacement', true, 70).batches, []);
  assert.deepEqual(updateReveal(state, state.text, false, 70).batches, []);
});

test('prose fades only the appended source region, without hiding or duplicating text', () => {
  const html = render('Existing text and **new text**.', 18);
  assert.match(html, /Existing text and <strong><span class="stream-reveal"/);
  assert.match(html, /new text<\/span><\/strong>/);
  assert.equal((html.match(/Existing text/g) ?? []).length, 1);
  assert.doesNotMatch(html, /opacity:\s*0(?:[;" ])/);
});

test('Markdown, entities, code, math and unsafe HTML keep their normal parsing', () => {
  const html = render('Text &amp; **bold** `$code$`\n\n```js\nconst value = 1;\n```\n\nMath $x^2$.\n\n<script>alert(1)</script>', 0);
  assert.match(html, /&amp;/);
  assert.match(html, /<strong><span class="stream-reveal"/);
  assert.match(html, /<code>\$code\$<\/code>/);
  assert.doesNotMatch(html, /<code[^>]*>[^]*?class="stream-reveal"[^]*?<\/code>/);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /class="katex"[^]*?class="stream-reveal"[^]*?<\/math>/);
  assert.doesNotMatch(html, /<script|alert\(1\)/);
});

test('a reveal boundary cannot divide an emoji surrogate pair', () => {
  const html = render('A\u{1F680}B', 2);
  assert.match(html, /A<span class="stream-reveal"[^>]*>\u{1F680}B<\/span>/u);
});
