import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { PluginDocumentation, PluginMarkdown, PluginStars, pluginDocumentUrl } from '../src/PluginDocumentation';

test('plugin document links allow credential-free HTTPS only', () => {
  assert.equal(pluginDocumentUrl('https://github.com/owner/plugin'), 'https://github.com/owner/plugin');
  for (const value of [undefined, '', 'javascript:alert(1)', 'data:text/html,bad', 'file:///C:/secret', '/relative',
    'http://example.com', 'https://user:secret@example.com', '//example.com']) assert.equal(pluginDocumentUrl(value), undefined);
});

test('plugin Markdown preserves readable structure without active content or remote images', () => {
  const html = renderToStaticMarkup(createElement(PluginMarkdown, { text: `## Guide

[Documentation](https://example.com/docs)

[Unsafe](javascript:alert%281%29)

![Screenshot](https://example.com/tracker.png)

<iframe src="https://example.com/embed"></iframe>
<script>alert('injected')</script>

| Model | Purpose |
| --- | --- |
| Main | Video |
` }));
  assert.match(html, /<h2>Guide<\/h2>/);
  assert.match(html, /href="https:\/\/example.com\/docs" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<table>/);
  assert.match(html, /Screenshot/);
  assert.doesNotMatch(html, /<(?:iframe|script|img)\b|href="(?:javascript:|data:)|src=/);
});

test('stars preserve zero, omit invalid counts, and expose snapshot time', () => {
  for (const count of [-1, NaN, Infinity, .5]) {
    assert.equal(renderToStaticMarkup(createElement(PluginStars, { value: { count, checkedAt: '2026-11-04' }, language: 'en' })), '');
  }
  assert.equal(renderToStaticMarkup(createElement(PluginStars, { language: 'en' })), '');
  const zero = renderToStaticMarkup(createElement(PluginStars, { value: { count: 0, checkedAt: '2026-11-04' }, language: 'en' }));
  assert.match(zero, /0 GitHub stars, checked 2026-11-04/);
  const large = renderToStaticMarkup(createElement(PluginStars, { value: { count: 12500, checkedAt: '2026-11-04' }, language: 'en' }));
  assert.match(large, /12\.5K/);
});
test('unknown and failed stars keep a truthful localized affordance without inventing a count', () => {
  for (const language of ['zh', 'en']) for (const status of ['unknown', 'limited', 'unavailable'] as const) {
    const { document } = parseHTML(renderToStaticMarkup(createElement(PluginStars, { value: { status }, language })));
    const stars = document.querySelector('.pc-stars')!;
    assert.ok(stars.querySelector('svg'));
    assert.equal(stars.getAttribute('data-status'), status);
    assert.equal(stars.lastElementChild!.textContent, status === 'unknown' ? '...' : '-');
    assert.equal(stars.getAttribute('aria-busy'), String(status === 'unknown'));
    assert.ok(stars.getAttribute('aria-label')?.includes(language === 'zh' ? '星标' : 'star'));
  }
});

test('author, adapter and community tutorial provenance remain separate', () => {
  const html = renderToStaticMarkup(createElement(PluginDocumentation, { language: 'en', presentation: {
    author: 'Original creator', maintainer: 'Desktop adapter', license: 'MIT', readme: 'Quick start.',
    tutorials: [{ title: 'Video guide', creator: 'Community creator', source: 'Bilibili', kind: 'community', url: 'https://www.bilibili.com/video/example/' },
      { title: 'Unsafe tutorial', creator: 'Other', source: 'Other', kind: 'author', url: 'javascript:alert(1)' }],
    links: [{ title: 'Issues', url: 'https://github.com/owner/plugin/issues' }, { title: 'Unsafe link', url: 'file:///C:/secret' }],
  } }));
  assert.match(html, /Community demo/);
  assert.match(html, /Community creator/);
  assert.match(html, /Project author<\/dt><dd>Original creator/);
  assert.match(html, /DFSC adaptation<\/dt><dd>Desktop adapter/);
  assert.doesNotMatch(html, /Unsafe tutorial|Unsafe link/);
});

test('declared website links are leading cards, while body links remain inline', () => {
  const url = 'https://showcase.example:8443/demo?view=plugin';
  const title = 'Author showcase with a long title / \u4f5c\u8005\u7684\u63d2\u4ef6\u5c55\u793a\u7f51\u7ad9';
  const html = renderToStaticMarkup(createElement(PluginDocumentation, { language: 'en', presentation: {
    readme: `Read the [showcase](${url}) in this paragraph.`,
    links: [{ title, url }, { title: 'Unsafe website', url: 'https://user:secret@example.com' }],
  } }));
  const { document } = parseHTML(html);
  const cards = document.querySelectorAll('.pc-document-link');
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.querySelector('strong')?.textContent, title);
  assert.equal(card.querySelector('.pc-document-link-copy > span')?.textContent, 'showcase.example:8443');
  assert.equal(card.getAttribute('href'), url);
  assert.equal(card.getAttribute('target'), '_blank');
  assert.equal(card.getAttribute('rel'), 'noopener noreferrer');
  assert.ok(card.querySelector('.pc-document-link-icon svg'));
  assert.equal(document.querySelector('.pc-documentation')?.firstElementChild?.className, 'pc-document-links');
  const inline = document.querySelector('.pc-document-markdown p > a');
  assert.equal(inline?.textContent, 'showcase');
  assert.equal(inline?.getAttribute('href'), url);
  assert.equal(inline?.closest('.pc-document-link'), null);
  assert.equal(document.querySelectorAll('.pc-document-markdown .pc-document-link').length, 0);
  assert.doesNotMatch(html, /Unsafe website|user:secret/);
});

test('missing documents do not claim a README was loaded', () => {
  const html = renderToStaticMarkup(createElement(PluginDocumentation, { language: 'en', description: 'Plugin description.' }));
  assert.match(html, /Plugin description\./);
  assert.doesNotMatch(html, /README\.md|pc-tutorial|pc-document-links|pc-document-credits/);
});
