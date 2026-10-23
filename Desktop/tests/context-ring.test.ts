import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ContextRing } from '../src/ContextRing';

test('context usage has an accessible value and a minimal localized tooltip', () => {
  const known = renderToStaticMarkup(createElement(ContextRing, { usage: { percent: 37.6, tokens: 12000, contextWindow: 32000 }, language: 'zh' }));
  assert.match(known, /data-tooltip="已用 38%"/);
  assert.match(known, /tabindex="0"/);
  assert.match(known, /aria-valuenow="37.6"/);
  assert.doesNotMatch(known, /12000|32000/);
  assert.match(renderToStaticMarkup(createElement(ContextRing, { usage: { percent: 37.6, tokens: 12000, contextWindow: 32000 }, language: 'en' })), /data-tooltip="38% used"/);
  const unknown = renderToStaticMarkup(createElement(ContextRing, { usage: { percent: null, tokens: null, contextWindow: 32000 }, language: 'zh' }));
  assert.doesNotMatch(unknown, /data-tooltip=|aria-valuenow=/);
  assert.doesNotMatch(unknown, /tabindex=/);
  assert.match(unknown, /aria-valuetext="未知"/);
});

test('decorative command rings are inline and do not add focus stops or meters', () => {
  const html = renderToStaticMarkup(createElement(ContextRing, {
    usage: { percent: 33, tokens: 84480, contextWindow: 256000 }, language: 'zh', decorative: true,
  }));
  assert.match(html, /^<span class="context-ring"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /--context-percent:33%/);
  assert.doesNotMatch(html, /role=|tabindex=|data-tooltip=|aria-value/);
});
