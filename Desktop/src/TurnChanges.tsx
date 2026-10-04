import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import type { TurnChanges as Changes, TurnFile } from './turn-changes';
import './turn-changes.css';
import type { TurnUndoState } from './contracts';

for (const [name, grammar] of Object.entries({ javascript, typescript, css, json, python, xml })) hljs.registerLanguage(name, grammar);
const languages: Record<string, string> = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  css: 'css', json: 'json', py: 'python', html: 'xml', svg: 'xml', xml: 'xml' };

export function FilePreview({ file, language, onError }: { file: TurnFile; language: 'zh' | 'en'; onError: (error: string) => void }) {
  const [operation, setOperation] = useState(file.edits.length - 1);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const edit = file.edits[Math.min(operation, file.edits.length - 1)];
  const grammar = languages[file.path.split('.').at(-1)?.toLowerCase() ?? ''];
  const rows = useMemo(() => edit.rows.map(row => {
    if (!grammar || row.kind === 'hunk' || row.kind === 'note') return { ...row, html: undefined };
    return { ...row, html: hljs.highlight(row.text, { language: grammar, ignoreIllegals: true }).value };
  }), [edit, grammar]);
  const zh = language === 'zh';
  return <div className="turn-diff">
    <div className="turn-diff-toolbar">
      {file.edits.length > 1 ? <select aria-label={zh ? '编辑记录' : 'Edit record'} value={operation}
        onChange={event => { setOperation(Number(event.target.value)); setCopied(false); }}>
        {file.edits.map((item, index) => <option value={index} key={item.id}>{zh ? `第 ${index + 1} 次编辑` : `Edit ${index + 1}`}</option>)}
      </select> : <span>{zh ? '修改记录' : 'Edit record'}</span>}
      <span className="turn-diff-legend"><span className="diff-added">+{edit.added}</span><span className="diff-removed">-{edit.removed}</span></span>
      <button type="button" className="icon-button" aria-label={zh ? '复制变更片段' : 'Copy changed excerpt'}
        data-tooltip={zh ? '复制变更片段' : 'Copy changed excerpt'} onClick={() => {
          const text = edit.rows.filter(row => row.kind !== 'hunk' && row.kind !== 'note' && row.kind !== 'remove').map(row => row.text).join('\n');
          if (!window.desktop) { onError(zh ? '剪贴板不可用' : 'Clipboard unavailable'); return; }
          void window.desktop.copyText(text).then(() => setCopied(true)).catch(error => onError(String(error)));
        }}>{copied ? <Check size={13}/> : <Copy size={13}/>}</button>
    </div>
    <div className="turn-diff-scroll" tabIndex={0} role="region" aria-label={`${file.path} ${zh ? '变更预览' : 'diff preview'}`}>
      <table className="turn-diff-table"><tbody>{rows.map((row, index) => <tr key={index} className={`diff-line-${row.kind}`}>
        <td className="diff-line-number" aria-label={zh ? '旧行号' : 'Old line'}>{row.oldLine ?? ''}</td>
        <td className="diff-line-number" aria-label={zh ? '新行号' : 'New line'}>{row.newLine ?? ''}</td>
        <td className="diff-line-sign">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ''}</td>
        <td className="diff-line-text"><code>{row.html === undefined ? row.text : <span dangerouslySetInnerHTML={{ __html: row.html }}/>}</code></td>
      </tr>)}</tbody></table>
    </div>
  </div>;
}

export function TurnChanges({ changes, language, onError, runtimeId }: { changes: Changes; language: 'zh' | 'en'; onError: (error: string) => void; runtimeId?: string }) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [undo, setUndo] = useState<TurnUndoState>({ state: 'unavailable' });
  const [confirmation, setConfirmation] = useState<TurnUndoState | null>(null);
  const [pending, setPending] = useState(false);
  const [undoError, setUndoError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const toolIds = useMemo(() => changes.files.flatMap(file => file.edits.map(edit => edit.id)), [changes]);
  const id = useId();
  const zh = language === 'zh';
  useEffect(() => {
    if (!runtimeId || !toolIds.length || !window.desktop) return;
    let live = true;
    const refresh = () => {
      void window.desktop!.turnUndo(runtimeId, toolIds, 'status').then(value => {
        if (live && value?.state) setUndo(value);
      }).catch(() => { if (live) setUndo({ state: 'unavailable' }); });
    };
    refresh();
    const unsubscribe = window.desktop.onEvent(event => {
      if (event.type === 'desktop_undo_ready' && event.runtimeId === runtimeId) refresh();
    });
    return () => { live = false; unsubscribe(); };
  }, [runtimeId, toolIds]);
  useEffect(() => {
    if (!confirmation) return;
    const root = document.getElementById('root');
    const previous = root?.inert ?? false;
    if (root) root.inert = true;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!pending) setConfirmation(null); }
      if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (!buttons.length) { event.preventDefault(); return; }
        const first = buttons[0]; const last = buttons.at(-1)!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      if (root) root.inert = previous;
      document.removeEventListener('keydown', keydown);
      trigger.current?.focus();
    };
  }, [Boolean(confirmation), pending]);
  const prepare = async () => {
    if (!runtimeId || !window.desktop) return;
    setPending(true); setUndoError('');
    try {
      const value = await window.desktop.turnUndo(runtimeId, toolIds, 'prepare');
      setUndo(value); setConfirmation(value);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  const commit = async () => {
    if (!runtimeId || !window.desktop || !confirmation?.token) return;
    setPending(true); setUndoError('');
    try {
      const value = await window.desktop.turnUndo(runtimeId, toolIds, 'undo', confirmation.token);
      setUndo(value);
      if (value.state === 'undone') setConfirmation(null);
      else setConfirmation(value);
    } catch (error) {
      setUndoError(error instanceof Error ? error.message : String(error));
      setConfirmation({ state: 'failed' }); setUndo({ state: 'failed' });
    } finally { setPending(false); }
  };
  if (!changes.files.length) return null;
  const repeated = changes.files.some(file => file.edits.length > 1);
  const files = showAll ? changes.files : changes.files.slice(0, 3);
  return <section className="turn-changes" aria-label={zh ? '本轮变更' : 'Turn changes'}>
    <header className="turn-changes-header"><h3>{zh ? '本轮变更' : 'Turn changes'}</h3>
      <span>{changes.files.length} {zh ? '个文件' : 'files'}</span>
      <button ref={trigger} type="button" className="turn-undo-action" onClick={() => void prepare()}
        disabled={pending || undo.state === 'unavailable' || undo.state === 'undone' || !runtimeId}
        title={undo.state === 'unavailable' ? (zh ? '没有可靠的文件版本记录，无法撤销' : 'No reliable file version record') : undefined}>
        {undo.state === 'undone' ? (zh ? '已撤销' : 'Undone') : undo.state === 'conflict' || undo.state === 'failed'
          ? (zh ? '无法撤销' : 'Cannot undo') : (zh ? '撤销' : 'Undo')}</button>
      <span className="turn-change-totals" title={zh ? '已记录工具补丁的累计增删行数，不是工作区净变化' : 'Recorded patch totals, not net workspace changes'}>
        <b className="diff-added">+{changes.added}</b><b className="diff-removed">-{changes.removed}</b></span>
    </header>
    <div className="turn-changes-provenance">{zh ? '工具记录' : 'Tool records'}{repeated ? (zh ? ' · 按次累计' : ' · per-edit totals') : ''}
      {changes.incomplete ? <span>{zh ? '部分记录' : 'Partial records'}</span> : null}</div>
    <div id={id}>{files.map((file, index) => {
      const open = expanded === file.path;
      const normalized = file.path.replace(/\\/g, '/');
      const slash = normalized.lastIndexOf('/');
      return <div className={`turn-change-file${open ? ' is-expanded' : ''}`} key={file.path}>
        <button type="button" className="turn-change-row" aria-expanded={open} aria-controls={`${id}-${index}`}
          aria-label={`${zh ? '预览变更' : 'Preview changes'} ${file.path}`} onClick={() => setExpanded(open ? null : file.path)}>
          <span className="turn-file-order">{String(index + 1).padStart(2, '0')}</span>
          <span className="turn-file-name" title={file.path}><b>{normalized.slice(slash + 1)}</b>
            <small>{slash >= 0 ? normalized.slice(0, slash + 1) : './'}{file.edits.length > 1 ? ` · ${file.edits.length} ${zh ? '次编辑' : 'edits'}` : ''}</small></span>
          <span className="turn-file-stats"><span className="diff-added">+{file.added}</span><span className="diff-removed">-{file.removed}</span></span>
        </button>
        {open && <div id={`${id}-${index}`}><FilePreview key={file.path} file={file} language={language} onError={onError}/></div>}
      </div>;
    })}</div>
    {changes.files.length > 3 && <button type="button" className="turn-changes-more" aria-expanded={showAll} aria-controls={id}
      onClick={() => { setShowAll(!showAll); setExpanded(null); }}>
      {showAll ? (zh ? '收起文件' : 'Show fewer') : (zh ? `另外 ${changes.files.length - 3} 个文件` : `${changes.files.length - 3} more files`)}</button>}
    {confirmation && createPortal(<div className="modal-backdrop higher turn-undo-backdrop">
      <section ref={dialog} className="small-dialog turn-undo-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${id}-undo-title`} aria-describedby={`${id}-undo-description`}>
        <h2 id={`${id}-undo-title`}>{confirmation.state === 'available' ? (zh ? '撤销本轮已记录变更？' : 'Undo recorded changes?')
          : (zh ? '暂时无法撤销' : 'Cannot undo these changes')}</h2>
        <p id={`${id}-undo-description`}>{confirmation.state === 'available'
          ? (zh ? `将恢复 ${changes.files.length} 个文件中的已记录修改。对话不会回退，未记录的写入、命令和外部操作不会撤销。`
            : `Restore recorded edits in ${changes.files.length} files. Conversation history, unrecorded writes, commands and external actions remain unchanged.`)
          : confirmation.state === 'failed'
            ? (zh ? '撤销未能完成，可能已有部分文件恢复。恢复记录已保留，请先检查文件，不要重复覆盖。'
              : 'Undo did not finish; some files may have been restored. Recovery records were retained. Inspect the files before further changes.')
            : (zh ? '文件存在后续修改、路径变化或缺少版本记录。本轮操作不会覆盖它们。'
              : 'Files have later edits, changed paths or missing version records. They will not be overwritten.')}</p>
        {confirmation.state === 'available' && <p className="turn-undo-note">{zh ? '确认时会再次校验版本；若有冲突则不开始撤销。' : 'Versions will be checked again before any write.'}</p>}
        {undoError && <p role="alert">{undoError}</p>}
        <div className="button-row">
          <button type="button" disabled={pending} onClick={() => setConfirmation(null)}>{confirmation.state === 'available' ? (zh ? '取消' : 'Cancel') : (zh ? '关闭' : 'Close')}</button>
          {confirmation.state === 'available' && <button type="button" className="turn-undo-confirm" disabled={pending}
            onClick={() => void commit()}>{pending ? (zh ? '正在撤销' : 'Undoing') : (zh ? '撤销变更' : 'Undo changes')}</button>}
        </div>
      </section>
    </div>, document.body)}
  </section>;
}
