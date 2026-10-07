import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FORMULA_LENGTH, messageRemarkPlugins, messageRehypePlugins } from '../src/markdown-math';

const render = (source: string) => renderToStaticMarkup(createElement(Markdown, {
  children: source, skipHtml: true, remarkPlugins: messageRemarkPlugins, rehypePlugins: messageRehypePlugins,
}));

test('inline and block math render with accessible MathML and retain TeX annotations', () => {
  const html = render('Energy $E=mc^2$.\n\n$$\n\\frac{a}{b}+\\sqrt{x^2+y^2}\n$$');
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 1);
  assert.match(html, /<math /);
  assert.match(html, /encoding="application\/x-tex"/);
});

test('same-line double-dollar formulas, matrices, cases and calculus render', () => {
  for (const formula of [
    'A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}',
    'f(x)=\\begin{cases}x^2&x\\ge0\\\\-x&x<0\\end{cases}',
    '\\sum_{i=1}^{n}i=\\frac{n(n+1)}{2}',
    '\\int_a^b f(x)\\,dx',
    '\\lim_{x\\to0}\\frac{\\sin x}{x}=1',
  ]) {
    const html = render(`Formula $$${formula}$$`);
    assert.match(html, /class="katex-display"/);
    assert.doesNotMatch(html, /katex-error/);
  }
});

test('code fences, inline code, escaped dollars and ordinary prices remain source', () => {
  const html = render('Cost $20 and $30. \\$5. `$x^2$`\n\n```latex\n$$E=mc^2$$\n```\n\n```math\nx^2\n```');
  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /Cost \$20 and \$30/);
  assert.match(html, /<code>\$x\^2\$<\/code>/);
  assert.equal((html.match(/<pre>/g) ?? []).length, 2);
});

test('incomplete streaming blocks stay source and completed blocks render', () => {
  for (const source of ['Before $\\frac{1', 'Before\n\n$$\n\\frac{1}{2}', '> $$\n> x^2']) {
    assert.doesNotMatch(render(source), /class="katex"/);
  }
  assert.match(render('Before\n\n$$\n\\frac{1}{2}\n$$'), /class="katex-display"/);
  assert.match(render('> $$\n> x^2\n> $$'), /class="katex-display"/);
});

test('invalid and over-budget formulas do not break subsequent Markdown', () => {
  const html = render('$$\n\\frac{1}{\n$$\n\n**Still readable**');
  assert.match(html, /katex-error/);
  assert.match(html, /<strong>Still readable<\/strong>/);
  assert.doesNotThrow(() => render('$$\\unknowncommand{x}$$'));
  assert.doesNotMatch(render(`$${'x'.repeat(MAX_FORMULA_LENGTH + 1)}$`), /class="katex"/);
  assert.doesNotThrow(() => render('$\\def\\loop{\\loop}\\loop$'));
});

test('untrusted math cannot create external links, images or raw HTML', () => {
  const html = render('$\\href{https://example.com}{link}$ $\\includegraphics{https://example.com/a.png}$\n<script>alert(1)</script>');
  assert.doesNotMatch(html, /<a |<img |<script>/);
});

test('standalone code-styled web addresses stay links without rewriting code samples', () => {
  const html = render('Home: `https://example.com/`\n\n`curl https://example.com/`\n\n```text\nhttps://example.com/\n```\n\n[Label `https://example.org/`](https://example.net/)\n\n`javascript:alert(1)` `https://user:secret@example.com/`');
  assert.match(html, /<a href="https:\/\/example.com\/">https:\/\/example.com\/<\/a>/);
  assert.match(html, /<code>curl https:\/\/example.com\/<\/code>/);
  assert.match(html, /<pre><code[^>]*>https:\/\/example.com\//);
  assert.match(html, /<a href="https:\/\/example.net\/">Label <code>https:\/\/example.org\/<\/code><\/a>/);
  assert.match(html, /<code>javascript:alert\(1\)<\/code>/);
  assert.match(html, /<code>https:\/\/user:secret@example.com\/<\/code>/);
  assert.equal((html.match(/<a /g) ?? []).length, 2);
});
