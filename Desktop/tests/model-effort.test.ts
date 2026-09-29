import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draggedEffortIndex, effortColorForIndex, effortLabel, wheeledEffortIndex } from '../src/ModelEffortPicker';

test('localized effort labels preserve every upstream level and unknown values', () => {
  const cases = {
    off: '关闭',
    minimal: '极简',
    low: '轻度',
    medium: '中',
    high: '高',
    xhigh: '极高',
    max: '最高',
  };
  for (const [raw, localized] of Object.entries(cases)) {
    assert.equal(effortLabel(raw, 'zh'), localized);
    assert.equal(effortLabel(raw, 'en'), raw);
  }
  assert.equal(effortLabel('future-level', 'zh'), 'future-level');
});

test('effort colors are evenly sampled from the gradient for the available levels', () => {
  assert.equal(effortColorForIndex(0, 4), '#FFDC62');
  assert.equal(effortColorForIndex(1, 4), '#FDB3A2');
  assert.equal(effortColorForIndex(2, 4), '#D58FEF');
  assert.equal(effortColorForIndex(3, 4), '#9E72FB');
  assert.equal(effortColorForIndex(1, 3), '#E7A1CF');
});

test('fader resists clicks and sub-threshold drags, then crosses discrete stops', () => {
  assert.equal(draggedEffortIndex(1, 0, 4), 1);
  assert.equal(draggedEffortIndex(1, 0.61, 4), 1);
  assert.equal(draggedEffortIndex(1, 0.62, 4), 2);
  assert.equal(draggedEffortIndex(2, -0.61, 4), 2);
  assert.equal(draggedEffortIndex(2, -0.62, 4), 1);
  assert.equal(draggedEffortIndex(1, 2.1, 4), 3);
  assert.equal(draggedEffortIndex(0, -5, 4), 0);
  assert.equal(draggedEffortIndex(0, 5, 4), 3);
});

test('wheel moves one available level in its direction and stops at the ends', () => {
  assert.equal(wheeledEffortIndex(1, -100, 4), 2);
  assert.equal(wheeledEffortIndex(1, 100, 4), 0);
  assert.equal(wheeledEffortIndex(3, -100, 4), 3);
  assert.equal(wheeledEffortIndex(0, 100, 4), 0);
});
