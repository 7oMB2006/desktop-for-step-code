import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTurns, RULER_STEP, rulerOpacity, turnCursor } from '../src/ConversationNavigation';
import { thumbMetrics } from '../src/ConversationScrollThumb';
import type { Message } from '../src/contracts';

test('navigation indexes user turns and preserves the underlying message positions', () => {
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: '  First\nrequest  ' }] },
    { role: 'assistant', content: 'Response' },
    { role: 'toolResult', content: 'Output' },
    { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }] },
    { role: 'user', content: 'Another request' },
  ];
  assert.deepEqual(conversationTurns(messages, 'zh'), [
    { index: 0, preview: 'First request' },
    { index: 3, preview: '图片消息' },
    { index: 4, preview: 'Another request' },
  ]);
  assert.equal(conversationTurns(messages, 'en')[1].preview, 'Image message');
});

test('scroll thumb reaches both ends of the full-height overlay track', () => {
  assert.deepEqual(thumbMetrics(0, 500, 2000, 1000), { top: 0, height: 72, maxScroll: 1500 });
  assert.deepEqual(thumbMetrics(1500, 500, 2000, 1000), { top: 928, height: 72, maxScroll: 1500 });
  assert.deepEqual(thumbMetrics(0, 500, 500, 1000), { top: 0, height: 0, maxScroll: 0 });
});

test('ruler keeps turns evenly spaced while interpolating the reading position', () => {
  assert.equal(RULER_STEP, 18);
  assert.equal(turnCursor([100, 300, 900], 0), 0);
  assert.equal(turnCursor([100, 300, 900], 200), 0.5);
  assert.equal(turnCursor([100, 300, 900], 600), 1.5);
  assert.equal(turnCursor([100, 300, 900], 1000), 2);
  assert.equal(rulerOpacity(2), 1);
  assert.ok(rulerOpacity(8) < rulerOpacity(4));
  assert.equal(rulerOpacity(14), 0);
});
