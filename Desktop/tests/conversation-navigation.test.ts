import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTurns, RULER_STEP, rulerOpacity, turnCursor, turnTime } from '../src/ConversationNavigation';
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

test('turn dates use the original user timestamp and local month/day/time, never the current clock', () => {
  const timestamp = new Date(2026, 9, 3, 14, 7).getTime();
  assert.equal(conversationTurns([{ role: 'user', content: 'Question', timestamp }], 'zh')[0].timestamp, timestamp);
  assert.equal(turnTime(timestamp, 'zh'), '10月03日 14:07');
  assert.equal(turnTime(timestamp, 'en'), '10/03 14:07');
  for (const missing of [undefined, NaN, Infinity, 1e20]) assert.equal(turnTime(missing, 'zh'), '');
  assert.equal(conversationTurns([{ role: 'user', content: 'Undated' }], 'zh')[0].timestamp, undefined);
});

test('compact quote thumb preserves both ends and remains bounded on a short rail', () => {
  assert.deepEqual(thumbMetrics(0, 156, 2000, 126, true), { top: 0, height: 20, maxScroll: 1844 });
  assert.deepEqual(thumbMetrics(1844, 156, 2000, 126, true), { top: 106, height: 20, maxScroll: 1844 });
  assert.deepEqual(thumbMetrics(1844, 156, 2000, 12, true), { top: 0, height: 12, maxScroll: 1844 });
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
