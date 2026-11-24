import assert from 'node:assert/strict';
import { test } from 'node:test';
import { descendantListenersOwned, previewListenerPids } from '../electron/preview-listener';

const started = Date.parse('2026-11-24T12:10:00.123Z');
const cutoff = started * 1000;
const processes = `10 1 ${cutoff - 1000000}
11 10 ${cutoff + 1}
12 11 ${cutoff + 500}
13 10 ${cutoff - 1}
20 1 ${cutoff + 69}
21 11 ${cutoff}`;

test('a new dev server must be a live descendant of the current runtime', () => {
  assert.equal(descendantListenersOwned([11, 12], processes, 10, started), true);
  for (const listeners of [[], [10], [13], [20], [21], [11, 20], [11, 22]]) {
    assert.equal(descendantListenersOwned(listeners, processes, 10, started), false, `listeners: ${listeners}`);
  }
  assert.equal(descendantListenersOwned([11], `${processes}\n11 10 ${cutoff + 2}`, 10, started), false,
    'a process changing identity while gathering the tree is uncertain');
});

test('only bounded PID lists from the native listener inventory are accepted', () => {
  assert.deepEqual(previewListenerPids('11\n12\n11\n'), [11, 12]);
  for (const invalid of ['', '0', '11\nmissing', '2147483648', '11\n'.repeat(129)])
    assert.equal(previewListenerPids(invalid), undefined);
});
