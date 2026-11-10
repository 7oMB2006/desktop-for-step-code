import assert from 'node:assert/strict';
import test from 'node:test';
import { thumbMetrics } from '../src/ConversationScrollThumb';

test('scroll thumb geometry and accessible percentage share one measurement', () => {
  assert.deepEqual(thumbMetrics(0, 400, 1200, 300), { top: 0, height: 72, maxScroll: 800, percent: 0 });
  assert.deepEqual(thumbMetrics(400, 400, 1200, 300), { top: 114, height: 72, maxScroll: 800, percent: 50 });
  assert.deepEqual(thumbMetrics(800, 400, 1200, 300), { top: 228, height: 72, maxScroll: 800, percent: 100 });
  assert.deepEqual(thumbMetrics(400, 400, 1200, 300, true), { top: 128, height: 44, maxScroll: 800, percent: 50 });
});

test('nonoverflowing and zero-size tracks do not expose a scroll percentage', () => {
  assert.deepEqual(thumbMetrics(0, 400, 400, 300), { top: 0, height: 0, maxScroll: 0, percent: 0 });
  assert.deepEqual(thumbMetrics(0, 400, 300, 300), { top: 0, height: 0, maxScroll: 0, percent: 0 });
  assert.deepEqual(thumbMetrics(400, 400, 1200, 0), { top: 0, height: 0, maxScroll: 800, percent: 0 });
  assert.equal(thumbMetrics(0, 400, 1_000_000, 300).height, 44);
  assert.equal(thumbMetrics(0, 400, 1_000_000, 300, true).height, 20);
});

test('overscroll never takes the accessible percentage outside its declared range', () => {
  assert.equal(thumbMetrics(-30, 400, 1200, 300).percent, 0);
  assert.equal(thumbMetrics(830, 400, 1200, 300).percent, 100);
});
