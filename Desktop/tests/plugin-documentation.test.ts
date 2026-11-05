import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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

test('stars preserve zero, omit unknown or invalid counts, and expose snapshot time', () => {
  for (const count of [-1, NaN, Infinity, .5]) {
    assert.equal(renderToStaticMarkup(createElement(PluginStars, { value: { count, checkedAt: '2026-11-04' }, language: 'en' })), '');
  }
  assert.equal(renderToStaticMarkup(createElement(PluginStars, { language: 'en' })), '');
  const zero = renderToStaticMarkup(createElement(PluginStars, { value: { count: 0, checkedAt: '2026-11-04' }, language: 'en' }));
  assert.match(zero, /0 GitHub stars, checked 2026-11-04/);
  const large = renderToStaticMarkup(createElement(PluginStars, { value: { count: 12500, checkedAt: '2026-11-04' }, language: 'en' }));
  assert.match(large, /12\.5K/);
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

test('missing documents do not claim a README was loaded', () => {
  const html = renderToStaticMarkup(createElement(PluginDocumentation, { language: 'en', description: 'Plugin description.' }));
  assert.match(html, /Plugin description\./);
  assert.doesNotMatch(html, /README\.md|pc-tutorial|pc-document-credits/);
});
