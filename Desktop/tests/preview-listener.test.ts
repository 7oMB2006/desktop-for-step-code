import assert from 'node:assert/strict';
import { test } from 'node:test';
import { descendantListenersOwned } from '../electron/preview-listener';

const processes = `  10   1 Tue Nov 24 12:00:00 2026
  11  10 Tue Nov 24 12:10:02 2026
  12  11 Tue Nov 24 12:10:03 2026
  13  10 Tue Nov 24 12:09:59 2026
  20   1 Tue Nov 24 12:10:03 2026
  21  11 Tue Nov 24 12:10:01 2026`;
const started = Date.parse('2026-11-24T12:10:00Z');

test('a new dev server must be a live descendant of the current runtime', () => {
  assert.equal(descendantListenersOwned('11\n12\n', processes, 10, started), true);
  for (const listeners of ['', '10', '13', '20', '21', '11\n20', '11\nmissing', '11\n22']) {
    assert.equal(descendantListenersOwned(listeners, processes, 10, started), false, listeners);
  }
});
