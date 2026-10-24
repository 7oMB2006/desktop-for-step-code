import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitDiffRows } from '../src/split-diff';
import { parseToolPatch, type DiffRow } from '../src/turn-changes';

test('split diff pairs unequal change blocks and preserves both line numbers and blank lines', () => {
  const rows: DiffRow[] = [
    { kind: 'context', text: 'before', oldLine: 1, newLine: 1 },
    { kind: 'remove', text: 'old', oldLine: 2 },
    { kind: 'remove', text: '', oldLine: 3 },
    { kind: 'add', text: 'new', newLine: 2 },
    { kind: 'context', text: 'after', oldLine: 4, newLine: 3 },
  ];
  const original = structuredClone(rows);
  assert.deepEqual(splitDiffRows(rows), [
    { kind: 'pair', left: rows[0], right: rows[0] },
    { kind: 'pair', left: rows[1], right: rows[3] },
    { kind: 'pair', left: rows[2], right: undefined },
    { kind: 'pair', left: rows[4], right: rows[4] },
  ]);
  assert.deepEqual(rows, original);
});

test('split diff does not pair across hunks, notes or unchanged context', () => {
  const rows: DiffRow[] = [
    { kind: 'remove', text: 'gone', oldLine: 1 },
    { kind: 'note', text: '\\ No newline at end of file' },
    { kind: 'hunk', text: '@@ -10 +10 @@' },
    { kind: 'add', text: 'new', newLine: 10 },
    { kind: 'context', text: 'stable', oldLine: 11, newLine: 11 },
    { kind: 'add', text: '', newLine: 12 },
  ];
  assert.deepEqual(splitDiffRows(rows), [
    { kind: 'pair', left: rows[0], right: undefined },
    { kind: 'separator', row: rows[1] },
    { kind: 'separator', row: rows[2] },
    { kind: 'pair', left: undefined, right: rows[3] },
    { kind: 'pair', left: rows[4], right: rows[4] },
    { kind: 'pair', left: undefined, right: rows[5] },
  ]);
  assert.deepEqual(splitDiffRows([]), []);
});

test('real parsed patches retain every old and new line in the split projection', () => {
  const patch = parseToolPatch('--- a/test.ts\n+++ b/test.ts\n@@ -1,3 +1,4 @@\n keep\n-old\n+new\n+extra\n tail\n', 'edit')!;
  assert.ok(patch);
  const pairs = splitDiffRows(patch.rows).filter(row => row.kind === 'pair');
  assert.deepEqual(pairs.flatMap(row => row.left ? [row.left.text] : []), ['keep', 'old', 'tail']);
  assert.deepEqual(pairs.flatMap(row => row.right ? [row.right.text] : []), ['keep', 'new', 'extra', 'tail']);
});
