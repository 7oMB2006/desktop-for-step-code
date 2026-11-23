import { parse } from 'csv-parse/browser/esm/sync';

export const tableRowLimit = 1000;
export const tableColumnLimit = 40;
export const tablePageSize = 100;

export function parsePreviewTable(text: string, format: 'CSV' | 'TSV') {
  let columnCount = 0;
  const records: string[][] = parse(text, {
    delimiter: format === 'TSV' ? '\t' : ',',
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    to: tableRowLimit + 1,
    on_record: (cells: string[]) => {
      columnCount = Math.max(columnCount, cells.length);
      return cells.slice(0, tableColumnLimit);
    },
  });
  return {
    records: records.slice(0, tableRowLimit),
    columns: Math.min(tableColumnLimit, columnCount),
    truncated: records.length > tableRowLimit || columnCount > tableColumnLimit,
  };
}
