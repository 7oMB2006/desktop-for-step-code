import type { DiffRow } from './turn-changes';

export type SplitDiffRow<Row extends DiffRow = DiffRow> =
  | { kind: 'pair'; left?: Row; right?: Row }
  | { kind: 'separator'; row: Row };

// Align each change block without pairing lines across context or hunk boundaries.
export function splitDiffRows<Row extends DiffRow>(rows: readonly Row[]): SplitDiffRow<Row>[] {
  const result: SplitDiffRow<Row>[] = [];
  let removed: Row[] = [];
  let added: Row[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++)
      result.push({ kind: 'pair', left: removed[index], right: added[index] });
    removed = []; added = [];
  };
  for (const row of rows) {
    if (row.kind === 'remove') removed.push(row);
    else if (row.kind === 'add') added.push(row);
    else {
      flush();
      result.push(row.kind === 'context' ? { kind: 'pair', left: row, right: row } : { kind: 'separator', row });
    }
  }
  flush();
  return result;
}
