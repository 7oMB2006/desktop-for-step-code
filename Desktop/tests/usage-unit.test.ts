import assert from 'node:assert/strict';
import test from 'node:test';
import { formatUsageTotal } from '../src/usage-unit';

test('usage units preserve the complete default count and use decimal K/M/B', () => {
  assert.equal(formatUsageTotal(26964762, 'default'), '26,964,762');
  assert.equal(formatUsageTotal(26964762, 'K'), '26,964.76K');
  assert.equal(formatUsageTotal(26964762, 'M'), '26.96M');
  assert.equal(formatUsageTotal(26964762, 'B'), '0.03B');
  assert.equal(formatUsageTotal(1e9, 'B'), '1.00B');
});

test('zero and small nonzero totals remain distinguishable', () => {
  assert.equal(formatUsageTotal(0, 'default'), '0');
  assert.equal(formatUsageTotal(0, 'B'), '0.00B');
  assert.equal(formatUsageTotal(1, 'B'), '<0.01B');
  assert.equal(formatUsageTotal(10, 'K'), '0.01K');
});
