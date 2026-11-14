import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { draggedEffortIndex, effortColorForIndex, effortLabel, ModelEffortPlaceholder, wheeledEffortIndex } from '../src/ModelEffortPicker';

test('navigation placeholders are disabled, localized and contain no model or effort selection', () => {
  for (const language of ['zh', 'en'] as const) {
    for (const failed of [false, true]) {
      const { document } = parseHTML(renderToStaticMarkup(createElement(ModelEffortPlaceholder, { language, failed })));
      const root = document.querySelector('.model-effort-placeholder')!;
      assert.equal(root.getAttribute('aria-hidden'), 'true', 'The shared navigation status announces restoration');
      assert.ok(root.querySelector('button[disabled]'));
      assert.equal(root.textContent, language === 'zh' ? failed ? '模型未就绪' : '正在恢复模型'
        : failed ? 'Model unavailable' : 'Restoring model');
      assert.equal(root.querySelector('.model-effort-loading-icon') !== null, !failed);
      assert.equal(root.querySelector('.model-effort-level, .model-effort-popover'), null);
    }
  }
});

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
  assert.equal(effortLabel('ultra', 'zh'), 'Ultra');
  assert.equal(effortLabel('ultra', 'en'), 'Ultra');
});

test('effort colors are evenly sampled from the gradient for the available levels', () => {
  assert.equal(effortColorForIndex(0, 4), '#FFDC62');
  assert.equal(effortColorForIndex(1, 4), '#FDB3A2');
  assert.equal(effortColorForIndex(2, 4), '#D58FEF');
  assert.equal(effortColorForIndex(3, 4), '#9E72FB');
  assert.equal(effortColorForIndex(1, 3), '#E7A1CF');
  assert.equal(effortColorForIndex(7, 8), '#9E72FB');
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
