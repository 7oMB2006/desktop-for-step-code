import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import type { ElementContent } from 'hast';
import { highlightCode, messageRemarkPlugins, messageRehypePlugins } from '../src/markdown-math';
import { pendingCodeClassName } from '../src/useViewportCodeHighlight';

const render = (source: string, reference = false) => renderToStaticMarkup(createElement(Markdown, {
  children: source, skipHtml: true, remarkPlugins: messageRemarkPlugins,
  rehypePlugins: reference ? [messageRehypePlugins![0], rehypeHighlight] : messageRehypePlugins,
}));

test('message processors share the highlighter without caching document trees', () => {
  const plugin = messageRehypePlugins![1] as () => unknown;
  assert.equal(plugin(), plugin());
});

const samples = [
  'Plain **text** with no code.',
  '```typescript\nexport const ready = { value: 42, text: "hello" };\n```',
  '```js\n/* multi\nline comment */\nconst text = `first\n${1 + 2}\nlast`;\n```',
  '```python\nvalue = """a\nmultiline string"""\nprint(value)\n```',
  '```json\n{"ready": true, "amount": 3}\n```\n\n```css\n.a { color: red }\n```',
  '```html\n<script>const ready = true;</script>\n```',
  '```unknown-language\nconst noGrammar = true;\n```',
  '```text\n<script>alert("source")</script>\n```\n\n```\nno language\n```',
  '```math\nx^2\n```\n\nInline $x^2$.\n\n$$\n\\frac{a}{b}\n$$',
  '> ```ts\n> const nested = true;\n> ```\n\n- ```sh\n  echo "$HOME"\n  ```',
];
for (const [index, sample] of samples.entries()) {
  test(`reused highlighter matches a fresh upstream highlighter ${index}`, () => {
    for (let end = 1; end < sample.length; end += 13) {
      const prefix = sample.slice(0, end);
      assert.equal(render(prefix), render(prefix, true), `Prefix ${end}`);
    }
    assert.equal(render(sample), render(sample, true));
  });
}

test('alternating documents do not leak a language, open token, or source into one another', () => {
  const sources = [
    '```js\n/* open comment',
    '```js\nconst independent = 1;\n```',
    '```unknown-language\nunknown\n```',
    '```python\n"""open string',
    '```python\nprint("independent")\n```',
    'No code.',
    ...[...samples].reverse(),
  ];
  for (const source of [...sources, ...[...sources].reverse()]) {
    assert.equal(render(source), render(source, true));
  }
});

function codeMarkup(text: string, className: string) {
  const node = highlightCode(text, className);
  const children = (nodes: ElementContent[]): ReactNode =>
    nodes.map((child, index) => child.type === 'text' ? child.value
      : child.type === 'element' ? createElement(child.tagName, { key: index,
        className: (child.properties.className as string[] | undefined)?.join(' ') }, children(child.children)) : '');
  return renderToStaticMarkup(createElement('code', {
    className: (node.properties.className as string[]).join(' '),
  }, children(node.children)));
}

for (const language of ['typescript', 'js', 'python', 'json', 'html', 'css', 'sh', 'unknown-language', 'text']) {
  test(`deferred code uses the identical upstream grammar and escaping: ${language}`, () => {
    const code = '/* comment */\nconst text = "<script>& 中文 😀";\nreturn { value: 42, ready: true };\n';
    for (const end of [1, 14, 37, code.length]) {
      const source = code.slice(0, end).replace(/\n?$/, '\n');
      const reference = render(`\`\`\`${language}\n${source}\`\`\`\n`, true)
        .replace(/^<pre>/, '').replace(/<\/pre>$/, '');
      assert.equal(codeMarkup(source, `language-${language}`), reference);
    }
  });
}

test('deferred code retains opt-outs and uses no auto-detection for unlabelled code', () => {
  const source = 'const ready = true;\n';
  assert.equal(codeMarkup(source, ''), '<code class="">const ready = true;\n</code>');
  assert.equal(codeMarkup(source, 'language-js no-highlight'),
    '<code class="language-js no-highlight">const ready = true;\n</code>');
  assert.equal(pendingCodeClassName('language-ts'), 'hljs language-ts');
  assert.equal(pendingCodeClassName('hljs language-ts'), 'hljs language-ts');
  assert.equal(pendingCodeClassName('language-js nohighlight'), 'language-js nohighlight');
  assert.equal(pendingCodeClassName(undefined), undefined);
});
