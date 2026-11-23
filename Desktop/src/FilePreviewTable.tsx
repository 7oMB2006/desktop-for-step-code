import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Table2 } from 'lucide-react';
import { parsePreviewTable, tablePageSize } from './file-preview-table';

export function FilePreviewTable({ text, format, language }: { text: string; format: 'CSV' | 'TSV'; language: 'zh' | 'en' }) {
  const [firstRow, setFirstRow] = useState(true);
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const table = useMemo(() => {
    try { return parsePreviewTable(text, format); } catch { return undefined; }
  }, [text, format]);
  const zh = language === 'zh';
  if (!table?.records.length) return <div className="file-preview-document-state" role="status">
    <Table2 size={23}/>{table ? (zh ? '表格为空' : 'Empty table')
      : (zh ? '无法解析表格，可切换到源码查看' : 'Could not parse the table. The source is still available.')}
  </div>;
  const headers = firstRow ? table.records[0] : [];
  const rows = firstRow ? table.records.slice(1) : table.records;
  const pages = Math.max(1, Math.ceil(rows.length / tablePageSize));
  const current = Math.min(page, pages - 1);
  const offset = current * tablePageSize;
  const changePage = (value: number) => {
    setPage(value);
    if (scroll.current) scroll.current.scrollTop = 0;
  };
  const label = (cn: string, en: string) => ({ 'aria-label': zh ? cn : en, 'data-tooltip': zh ? cn : en });
  return <div className="file-preview-data">
    <div className="file-preview-data-controls">
      <label className="file-preview-data-header-option"><input type="checkbox" checked={firstRow} onChange={event => {
        setFirstRow(event.target.checked);
        changePage(0);
      }}/>{zh ? '首行作为表头' : 'First row as headers'}</label>
      {pages > 1 && <div className="file-preview-pagination">
        <button className="icon-button" {...label('上一批行', 'Previous rows')} disabled={current === 0} onClick={() => changePage(current - 1)}><ChevronLeft size={15}/></button>
        <span aria-live="polite">{current + 1} / {pages}</span>
        <button className="icon-button" {...label('下一批行', 'Next rows')} disabled={current >= pages - 1} onClick={() => changePage(current + 1)}><ChevronRight size={15}/></button>
      </div>}
    </div>
    {table.truncated && <div className="file-preview-data-limit" role="status">
      {zh ? '表格预览最多显示 1,000 条记录及 40 列，完整内容见源码。' : 'Preview is limited to 1,000 records and 40 columns. Use source view for the full file.'}
    </div>}
    <div className="file-preview-data-scroll" ref={scroll} tabIndex={0}>
      <table aria-label={zh ? `${format} 表格` : `${format} table`}>
        <thead><tr><th>{zh ? '行' : 'Row'}</th>{Array.from({ length: table.columns }, (_, index) =>
          <th scope="col" key={index}>{headers[index] ?? (zh ? `列 ${index + 1}` : `Column ${index + 1}`)}</th>)}</tr></thead>
        <tbody>{rows.slice(offset, offset + tablePageSize).map((row, index) =>
          <tr key={offset + index}><th scope="row">{offset + index + (firstRow ? 2 : 1)}</th>
            {Array.from({ length: table.columns }, (_, column) => <td key={column}>{row[column] ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>;
}
