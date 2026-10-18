import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUsageDate, usageDateKey, usageRange, validUsageRange } from '../src/usage-range';

test('dates validate calendar days without UTC conversion', () => {
  assert.equal(usageDateKey(parseUsageDate('2024-02-29')!), '2024-02-29');
  for (const date of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-01', 'invalid'])
    assert.equal(parseUsageDate(date), undefined);
});

test('range validation accepts one day and rejects reversed or unavailable ranges', () => {
  const min = '2025-10-19', max = '2026-10-18';
  assert.equal(validUsageRange({ start: min, end: max }, min, max), true);
  assert.equal(validUsageRange({ start: max, end: max }, min, max), true);
  for (const range of [
    { start: max, end: min }, { start: '2025-10-18', end: max },
    { start: min, end: '2026-10-19' }, { start: '2026-02-30', end: max },
  ]) assert.equal(validUsageRange(range, min, max), false);
});

test('filtering includes both endpoints across month and year boundaries', () => {
  const days = ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'].map((date, i) => ({ date, tokens: i + 1 }));
  assert.deepEqual(usageRange(days, { start: '2025-12-31', end: '2026-01-01' }), days.slice(1, 3));
  assert.deepEqual(usageRange(days, { start: '2026-01-01', end: '2026-01-01' }), [days[2]]);
  assert.deepEqual(usageRange(days, { start: '2026-10-01', end: '2026-10-18' }), []);
  assert.equal(days.length, 4);
});
