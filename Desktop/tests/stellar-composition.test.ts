import test from 'node:test';
import assert from 'node:assert/strict';
import { compactDragonRect } from '../src/stellar/composition';

const sources = [{ width: 315, height: 205 }, { width: 314, height: 338 }];
const original = { left: -90, top: 120, scale: 1, artWidth: 315, artHeight: 205 };

test('wide workspace composition is preserved exactly', () => {
  for (const width of [1050, 1440, 2560])
    assert.equal(compactDragonRect(width, 960, 0, sources[0], original), original);
});
test('compact silhouettes fit before the rail and above the composer', () => {
  for (const [width, height] of [[320, 640], [390, 844], [760, 880], [900, 620]]) {
    for (const [index, source] of sources.entries()) {
      const rect = compactDragonRect(width, height, index, source, original);
      assert.ok(rect.left >= 0 && rect.left + rect.artWidth < width - 44);
      assert.ok(rect.top >= 46);
      assert.ok(rect.top + rect.artHeight <= height - Math.min(190, height * .26));
      assert.equal(rect.artWidth, source.width * rect.scale);
      assert.equal(rect.artHeight, source.height * rect.scale);
    }
  }
});
test('compact transition joins both endpoints smoothly', () => {
  const wideEdge = compactDragonRect(1049.99, 880, 0, sources[0], original);
  assert.ok(Math.abs(wideEdge.left - original.left) < .001);
  const narrowEdge = compactDragonRect(900.01, 880, 0, sources[0], original);
  const narrow = compactDragonRect(900, 880, 0, sources[0], original);
  assert.ok(Math.abs(narrowEdge.left - narrow.left) < .001);
});
test('docked sidebar clearance follows the actual workspace inset', () => {
  for (const sidebar of [0, 224, 244]) {
    for (const [index, source] of sources.entries()) {
      const rect = compactDragonRect(900, 620, index, source, original, sidebar);
      assert.ok(rect.left >= sidebar + 10);
      assert.ok(rect.left + rect.artWidth < 900 - 44);
    }
  }
});
